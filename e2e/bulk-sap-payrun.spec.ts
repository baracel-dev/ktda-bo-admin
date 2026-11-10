import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ME, OTHER, envelope, json, signIn } from "./stubs";
import { luhnDigit } from "../src/lib/bulk-file";
import { SapFileChecker, periodFromName } from "../src/lib/sapPaymentFile";

/* Bulk payments with KTDA's SAP pay file and maker-checker, against stubbed
 * omnichannel answers in the shapes of tokenization-omnichannel #98
 * (BulkLoadDtos, BulkLoadOperatorController, ErrorCode). The SAP file is
 * checked in the browser with the KTDA back office's rules before anything is
 * sent; a payment run is SUBMITTED at upload and starts only when a different
 * signed-in operator releases it; what omnichannel paid to wallets, routed to
 * bank or SACCO and held is shown, with its exception report. An omnichannel
 * without any of this keeps today's behaviour. */

const KTDA = "11111111-1111-4111-8111-111111111111";
const RUN = "44444444-4444-4444-8444-444444444444";
const EARLIER = "55555555-5555-4555-8555-555555555555";
const R = /\/omni\/api\/operator\/bulk-loads/;

const HEADER = "LineNo,GNo,Name,WalletID,PhoneNo,FactoryCode,FactoryName,BuyingCentre,KgDelivered,RateKES,GrossKES,LoanKES,InputsKES,AdvanceKES,Amount,PayTo";
const wallet = (n: number, ok = true) => {
  const d = String(n).padStart(8, "0");
  return `KTW${d}${ok ? luhnDigit(d) : (luhnDigit(d) + 1) % 10}`;
};
type L = { n: number; g: number; name?: string; w?: string; fac?: string; kg?: string; gross: string; loan?: string; amount: string; payTo?: string };
const line = ({ n, g, name, w, fac, kg, gross, loan, amount, payTo }: L) =>
  [n, `KG-${String(g).padStart(6, "0")}`, name ?? `Farmer ${g}`, w ?? wallet(g), "254700000000", fac ?? "KG", "Kangaita Tea Factory", "Kangaita BC1", kg ?? "100", "21.00", gross, loan ?? "0.00", "0.00", "0.00", amount, payTo ?? "WALLET"].join(",");

/* Eleven lines: four pay to wallets (KES 5,000.00), one is paid by bank
   (KES 600.00), six are held by a rule (KES 3,350.00); the file's net is
   KES 8,950.00. */
const SAP_LINES = [
  line({ n: 1, g: 1, gross: "1000.00", amount: "1000.00" }),
  line({ n: 2, g: 2, gross: "2100.50", loan: "100.00", amount: "2000.50" }),
  line({ n: 3, g: 3, gross: "1500.25", amount: "1500.25" }),
  line({ n: 4, g: 1, gross: "700.00", amount: "700.00" }), // E03: grower 1 again
  line({ n: 5, g: 5, w: wallet(5, false), gross: "800.00", amount: "800.00" }), // E04
  line({ n: 6, g: 6, fac: "NY", gross: "900.00", amount: "900.00" }), // E07
  line({ n: 7, g: 7, gross: "1000.00", amount: "950.00" }), // E08
  line({ n: 8, g: 8, gross: "0.00", amount: "0.00" }), // E09
  line({ n: 9, g: 9, kg: "lots", gross: "100.00", amount: "100.00" }), // E01
  line({ n: 10, g: 10, name: '"Doe, Jane"', gross: "499.25", amount: "499.25" }),
  line({ n: 11, g: 11, gross: "600.00", amount: "600.00", payTo: "BANK" }), // routed
];
const SAP_CSV = `${HEADER}\n${SAP_LINES.join("\n")}\n`;
const SAP_SHA = createHash("sha256").update(SAP_CSV).digest("hex");
const NAME = "KTDA_GL_2026_10_11.csv";
const CONTROL = { file: NAME, rows: 11, totalAmountKES: "8950.00", sha256: SAP_SHA, period: "2026-10" };

const file = (name: string, text: string, mimeType = "text/csv") => ({ name, mimeType, buffer: Buffer.from(text) });

type Run = Record<string, unknown>;
/** A BulkRunResponse as omnichannel #98 answers for a SAP pay file. */
const run = (over: Run = {}): Run => ({
  runId: RUN, flow: "PAYMENT", institutionId: KTDA, currency: "KES", sourceName: NAME,
  status: "SUBMITTED", totalRows: 11, processedCount: 0, skippedCount: 0, failureCount: 0, totalAmount: 0,
  startedAt: "2026-11-06T08:00:00Z", completedAt: null, message: null,
  submittedBy: ME, submittedAt: "2026-11-06T08:00:01Z", releasedBy: null, releasedAt: null, fileSha256: SAP_SHA,
  fileFormat: "SAP", period: "2026-10", payableCount: 4, payableAmount: 5000, routedCount: 1, routedAmount: 600,
  heldCount: 6, heldAmount: 3350, heldCodes: "E01_MALFORMED=1,E03_DUPLICATE=1,E04_WALLET_CHECK_DIGIT=1,E07_FACTORY_MISMATCH=1,E08_AMOUNT_ARITHMETIC=1,E09_AMOUNT_NOT_POSITIVE=1",
  ...over,
});
/** An older omnichannel's run: none of the SAP or maker-checker fields. */
const legacyRun = (over: Run = {}): Run => ({
  runId: RUN, flow: "PAYMENT", institutionId: KTDA, currency: "KES", sourceName: "p.csv", status: "RUNNING", totalRows: 4,
  processedCount: 0, skippedCount: 0, failureCount: 0, totalAmount: 0, startedAt: "2026-11-06T08:00:00Z", completedAt: null, message: null, ...over,
});

type Sent = { method: string; path: string; query: URLSearchParams; subject: string | undefined; body: string | null };

async function stubOmni(page: Page, opts: {
  upload?: { status: number; body: unknown };
  process?: { status: number; body: unknown };
  /** The run as each GET answers, the last repeating. */
  polls?: Run[];
  recent?: Run[];
  release?: { status: number; body: unknown };
  reject?: { status: number; body: unknown };
  reconciliation?: Run;
  exceptions?: { status: number; body: string };
  farmersSummary?: Record<string, number>;
} = {}) {
  const sent: Sent[] = [];
  let poll = 0;
  await page.route(/\/omni\/api\/operator\/institutions$/, (route) => json(route, [{ id: KTDA, name: "KTDA Holdings", localCurrency: "KES", country: "KE", status: "ACTIVE" }]));
  await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => json(route, opts.farmersSummary ?? { registered: 0, activated: 0, funded: 0, total: 0, clash: 0 }));
  await page.route(R, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator\/bulk-loads/, "");
    sent.push({ method: req.method(), path, query: url.searchParams, subject: req.headers()["x-operator-subject"], body: req.postData() });
    if (path === "/onboarding-status") return json(route, { onboardingCompleted: true, registrationCompleted: true });
    if (path === "") return json(route, opts.recent ?? []);
    if (req.method() === "POST" && path === "/upload") {
      const out = opts.upload ?? { status: 202, body: run() };
      return json(route, out.body, out.status);
    }
    if (req.method() === "POST" && path === `/${RUN}/process`) {
      const out = opts.process ?? { status: 409, body: envelope(409, `A payment run starts when a second member of staff releases it: POST /${RUN}/release.`, "RELEASE_REQUIRED") };
      return json(route, out.body, out.status);
    }
    if (req.method() === "POST" && path === `/${RUN}/release`) {
      const out = opts.release ?? { status: 200, body: run({ status: "RUNNING", releasedBy: OTHER, releasedAt: "2026-11-06T08:05:00Z" }) };
      return json(route, out.body, out.status);
    }
    if (req.method() === "POST" && path === `/${RUN}/reject`) {
      const out = opts.reject ?? { status: 200, body: run({ status: "REJECTED", rejectedBy: OTHER, rejectedAt: "2026-11-06T08:05:00Z", decisionNote: "Totals do not match the control sheet.", completedAt: "2026-11-06T08:05:00Z" }) };
      return json(route, out.body, out.status);
    }
    if (path === `/${RUN}/exceptions`) {
      const out = opts.exceptions ?? { status: 200, body: "line_no,grower_no,name,pay_to,amount_kes,code,reason\n4,KG-000001,Farmer 1,WALLET,700.00,E03_DUPLICATE,Grower already appears earlier in this file (line 1)\n11,KG-000011,Farmer 11,BANK,600.00,ROUTED_BANK,\"Paid by BANK, not to the wallet\"\n" };
      return route.fulfill({ status: out.status, contentType: "text/csv", body: out.body, headers: { "content-disposition": `attachment; filename="${RUN}-exceptions.csv"` } });
    }
    if (path === `/${RUN}`) {
      const polls = opts.polls ?? [run()];
      const r = polls[Math.min(poll, polls.length - 1)];
      poll++;
      return json(route, r);
    }
    if (path === `/${RUN}/reconciliation`) return json(route, opts.reconciliation ?? {});
    return json(route, { message: "Not stubbed" }, 404);
  });
  return sent;
}

/** Signs in as the second operator instead of the stubs' default one. */
async function signInAs(page: Page, email: string, fullName: string) {
  await page.route(/\/tok\/auth\/me$/, (route) => json(route, { email, fullName, roles: ["ADMIN"], admin: true }));
}

/** A run with held lines ends PARTIAL even when every wallet line was paid. */
const finished = (over: Run = {}) => run({
  status: "PARTIAL", releasedBy: OTHER, releasedAt: "2026-11-06T08:05:00Z", processedCount: 4, totalAmount: 5000,
  completedAt: "2026-11-06T08:05:03Z", message: "4 credited; 6 lines held, 1 paid by bank or SACCO", ...over,
});

/** A BulkReconciliationResponse for that run. */
const reconciled = {
  runId: RUN, flow: "PAYMENT", institutionId: KTDA, institutionName: "KTDA Holdings", status: "PARTIAL",
  walletCount: 120, processedCount: 4, skippedCount: 0, failureCount: 0, creditedTotal: 5000,
  depositDebitTotal: 5000, depositCreditTotal: 5000, doubleEntryBalanced: true, expectedTotal: 5000, matchesExpected: true,
  fileFormat: "SAP", payableCount: 4, payableAmount: 5000, routedCount: 1, routedAmount: 600, heldCount: 6, heldAmount: 3350,
  heldCodes: "E01_MALFORMED=1,E03_DUPLICATE=1,E04_WALLET_CHECK_DIGIT=1,E07_FACTORY_MISMATCH=1,E08_AMOUNT_ARITHMETIC=1,E09_AMOUNT_NOT_POSITIVE=1",
};

const formField = (body: string | null, name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body ?? "")?.[1] ?? null;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the browser check of a SAP file matches the KTDA back office's rules and omnichannel's split, line for line", () => {
  const c = new SapFileChecker();
  for (const l of SAP_CSV.split("\n").filter(Boolean)) c.feed(l);
  const r = c.result();
  expect(r.lines).toBe(11);
  expect(r.summary.net).toBe(895000);
  expect(r.heldCount).toBe(6);
  expect(r.heldCents).toBe(335000);
  expect(r.routedCount).toBe(1);
  expect(r.routedCents).toBe(60000);
  expect(r.expectedCents).toBe(500000);
  expect(r.expectedCount).toBe(4);
  expect(r.summary.byCode).toEqual({ OK: 5, E03_DUPLICATE: 1, E04_WALLET_CHECK_DIGIT: 1, E07_FACTORY_MISMATCH: 1, E08_AMOUNT_ARITHMETIC: 1, E09_AMOUNT_NOT_POSITIVE: 1, E01_MALFORMED: 1 });
  const rows = r.exceptionsCsv.split("\n").filter(Boolean);
  expect(rows[0]).toBe("line_no,grower_no,name,pay_to,amount_kes,code,reason");
  expect(rows).toHaveLength(8);
  expect(rows.at(-1)).toBe('11,KG-000011,Farmer 11,BANK,600.00,ROUTED_BANK,"Paid by BANK, not to the wallet"');
  // omnichannel's own reading of a period in a file name (SapPayFile.period).
  expect(periodFromName("KTDA_GL_2026_10_600000.csv")).toBe("2026-10");
  expect(periodFromName("KTDA-GL-202611.csv")).toBe("2026-11");
  expect(periodFromName("payfile.csv")).toBeNull();
});

test("SAP file: checked before upload, sent with its period, submitted by the uploader, who cannot release it", async ({ page }) => {
  const sent = await stubOmni(page);
  await page.goto("/bulk/payments");
  await expect(page.getByRole("heading", { name: "Bulk payments" })).toBeVisible();
  const submit = page.getByRole("button", { name: "Submit", exact: true });
  await expect(submit).toBeDisabled();

  await page.getByLabel("CSV file").setInputFiles(file(NAME, SAP_CSV));
  const check = page.getByTestId("sap-check");
  await expect(check).toContainText("KTDA SAP export, 11 lines");
  await expect(page.getByTestId("sap-net")).toHaveText("KES 8,950.00");
  await expect(page.getByTestId("sap-expected")).toHaveText("KES 5,000.00");
  await expect(page.getByTestId("sap-expected-count")).toContainText("4 lines");
  await expect(page.getByTestId("sap-routed")).toHaveText("1");
  await expect(check).toContainText("KES 600.00, not paid to wallets by this run");
  await expect(page.getByTestId("sap-held")).toHaveText("6");
  const byCode = page.getByTestId("sap-by-code");
  for (const [code, n] of [["OK", 5], ["E01_MALFORMED", 1], ["E03_DUPLICATE", 1], ["E04_WALLET_CHECK_DIGIT", 1], ["E07_FACTORY_MISMATCH", 1], ["E08_AMOUNT_ARITHMETIC", 1], ["E09_AMOUNT_NOT_POSITIVE", 1]] as const) {
    await expect(byCode.locator(`tr[data-code="${code}"] td`).last()).toHaveText(String(n));
  }
  await expect(page.getByTestId("sap-exceptions")).toContainText("Factory code doesn't match the grower number");
  await expect(page.getByTestId("sap-exceptions")).toContainText("Paid by BANK: not paid to wallets by this run");
  await expect(page.getByLabel("Pay period")).toHaveValue("2026-10");

  // The browser's exception report reads like omnichannel's.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exception report, held and bank\/SACCO \(7 lines\)/ }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe("KTDA_GL_2026_10_11.exceptions.csv");
  const report = readFileSync(await d.path(), "utf8").trim().split("\n");
  expect(report[0]).toBe("line_no,grower_no,name,pay_to,amount_kes,code,reason");
  expect(report).toHaveLength(8);
  expect(report.find((r) => r.startsWith("4,"))).toContain("E03_DUPLICATE");

  await page.getByLabel("Control sheet").setInputFiles(file("KTDA_GL_2026_10_11.control.json", JSON.stringify(CONTROL), "application/json"));
  await expect(page.getByTestId("control-result")).toContainText("This is the file SAP sent for 2026-10");
  await expect(page.getByTestId("control-result")).toContainText("Checksum matches");

  await submit.click();
  const approval = page.getByTestId("run-approval");
  await expect(approval.getByTestId("approval-submitted")).toContainText("amina@baracel.ae");
  await expect(approval.getByTestId("approval-released")).toContainText("Waiting for release");
  await expect(approval.getByTestId("release-summary")).toContainText("4 lines, KES 5,000.00");
  await expect(approval.getByTestId("release-summary")).toContainText("1 bank or SACCO line is not paid to wallets by this run");
  await expect(approval.getByTestId("release-summary")).toContainText("6 held lines are never paid");
  await expect(approval.getByRole("button", { name: "Release" })).toBeDisabled();
  await expect(approval.getByTestId("release-blocked")).toHaveText("You submitted this run. A different operator must sign in and release it.");
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
  await expect(page.getByTestId("run-progress")).toHaveCount(0);
  const checks = page.getByTestId("run-checks");
  await expect(checks.locator('tr[data-row="routed"]')).toContainText("Not paid to wallets by this run");
  await expect(checks.locator('tr[data-code="E08_AMOUNT_ARITHMETIC"]')).toContainText("Amount isn't gross pay minus deductions");

  const upload = sent.find((s) => s.method === "POST" && s.path === "/upload")!;
  expect(formField(upload.body, "period")).toBe("2026-10");
  expect(formField(upload.body, "flow")).toBe("PAYMENT");
  // SUBMITTED at upload: /process is never called, nor /release; every call named the operator.
  expect(sent.some((s) => s.path.endsWith("/process"))).toBe(false);
  expect(sent.some((s) => s.path.endsWith("/release"))).toBe(false);
  expect(sent.every((s) => s.subject === ME)).toBe(true);
});

test("a SAP file whose name has no period cannot be sent until one is picked, and is sent with it", async ({ page }) => {
  const sent = await stubOmni(page);
  await page.goto("/bulk/payments");
  await page.getByLabel("CSV file").setInputFiles(file("payfile.csv", SAP_CSV));
  await expect(page.getByTestId("sap-check")).toBeVisible();
  await expect(page.getByLabel("Pay period")).toHaveValue("");
  await expect(page.getByTestId("pay-period")).toContainText("pick the month this file pays for");
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
  await expect(page.getByTestId("process-blocked")).toHaveText("Pick the pay period this file is for.");
  await page.getByLabel("Pay period").fill("2026-11");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("run-approval")).toBeVisible();
  expect(formField(sent.find((s) => s.path === "/upload")!.body, "period")).toBe("2026-11");
});

test("a file that does not match its control sheet cannot be submitted, and says why", async ({ page }) => {
  await stubOmni(page);
  await page.goto("/bulk/payments");
  await page.getByLabel("CSV file").setInputFiles(file(NAME, SAP_CSV));
  await expect(page.getByTestId("sap-check")).toBeVisible();
  await page.getByLabel("Control sheet").setInputFiles(file("c.control.json", JSON.stringify({ ...CONTROL, rows: 12, totalAmountKES: "9000.00" }), "application/json"));
  await expect(page.getByTestId("control-result")).toContainText("Lines: sheet 12, file 11");
  await expect(page.getByTestId("control-result")).toContainText("Total: sheet KES 9000.00, file KES 8,950.00");
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
  await expect(page.getByTestId("process-blocked")).toContainText("does not match its control sheet");

  await page.getByLabel("Control sheet").setInputFiles(file("broken.control.json", "{not json", "application/json"));
  await expect(page.getByTestId("control-sheet").getByRole("alert")).toContainText("isn't valid JSON");
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
});

test("a second operator opens the submitted run, releases it, and gets the reconciliation and omnichannel's exception report", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  const sent = await stubOmni(page, {
    recent: [run()],
    polls: [run(), run({ status: "RUNNING", releasedBy: OTHER, releasedAt: "2026-11-06T08:05:00Z", processedCount: 1 }), finished()],
    reconciliation: reconciled,
  });
  await page.goto("/bulk/payments");
  const row = page.getByRole("row").filter({ hasText: NAME });
  await expect(row).toContainText("Awaiting release");
  await expect(row).toContainText("amina@baracel.ae / —");
  await row.click();

  const approval = page.getByTestId("run-approval");
  const release = approval.getByRole("button", { name: "Release" });
  await expect(release).toBeEnabled();
  await release.click();

  await expect(page.getByText("Completed, with held lines")).toBeVisible();
  await expect(page.getByTestId("run-progress")).toContainText("11 of 11 rows");
  await expect(approval.getByTestId("approval-released")).toContainText("brian@baracel.ae");
  const panel = page.getByTestId("recon-panel");
  await expect(panel).toContainText("Matches the expected total");
  await expect(panel).toContainText("Expected (wallet lines that pass)");
  const checks = page.getByTestId("run-checks");
  await expect(checks.locator('tr[data-row="payable"]')).toContainText("KES 5,000.00");
  await expect(checks.locator('tr[data-row="routed"]')).toContainText("KES 600.00");
  await expect(checks.locator('tr[data-row="held"]')).toContainText("KES 3,350.00");

  const download = page.waitForEvent("download");
  await checks.getByRole("button", { name: "Exception report" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe(`${RUN}-exceptions.csv`);
  expect(readFileSync(await d.path(), "utf8")).toContain("ROUTED_BANK");

  // A core without ledger refusals: no refused panel, reconciled as before.
  await expect(page.getByTestId("refused-lines")).toHaveCount(0);
  await expect(page.getByTestId("recon-rule")).toHaveCount(0);

  const rel = sent.find((s) => s.method === "POST" && s.path === `/${RUN}/release`)!;
  expect(rel.subject).toBe(OTHER);
  // What omnichannel says it sends to the wallets is what is reconciled against.
  expect(sent.find((s) => s.path === `/${RUN}/reconciliation`)!.query.get("expectedTotal")).toBe("5000.00");
});

test("the approval summary shows the batch, its total, rows and who submitted it, for the checker to verify", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  await stubOmni(page, { recent: [run()], polls: [run()] });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();
  const summary = page.getByTestId("run-approval").getByTestId("run-summary");
  await expect(summary).toContainText(RUN);
  await expect(summary).toContainText("KTDA Holdings");
  await expect(summary).toContainText("2026-10");
  await expect(summary).toContainText(NAME);
  await expect(summary).toContainText("KES 5,000.00");
  await expect(summary).toContainText("amina@baracel.ae");
  await expect(summary).toContainText(SAP_SHA.slice(0, 16));
});

test("a second operator rejects the submitted run with a note, which the run then carries", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  // Polling stays SUBMITTED; the rejection comes from the POST /reject response, not a poll.
  const sent = await stubOmni(page, { recent: [run()], polls: [run()] });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();

  const approval = page.getByTestId("run-approval");
  const reject = approval.getByTestId("reject-button");
  // A rejection needs a note first.
  await expect(reject).toBeDisabled();
  await approval.getByTestId("decision-note-input").fill("Totals do not match the control sheet.");
  await expect(reject).toBeEnabled();
  await reject.click();

  await expect(approval.getByTestId("approval-rejected")).toContainText("brian@baracel.ae");
  await expect(approval.getByTestId("decision-note")).toContainText("Totals do not match the control sheet.");
  // Rejected is terminal: nothing ran, so there is no Result step and no release.
  await expect(page.getByTestId("step-4")).toHaveCount(0);
  const rej = sent.find((s) => s.method === "POST" && s.path === `/${RUN}/reject`)!;
  expect(rej.subject).toBe(OTHER);
  expect(JSON.parse(rej.body ?? "{}").note).toBe("Totals do not match the control sheet.");
  expect(sent.some((s) => s.path === `/${RUN}/release`)).toBe(false);
});

test("omnichannel's 403 MAKER_CHECKER on a release is shown as it comes", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  const refused = "A payment file is released by a second member of staff, not by the one who uploaded it.";
  await stubOmni(page, { recent: [run({ submittedBy: "staff:someone@baracel.ae" })], polls: [run({ submittedBy: "staff:someone@baracel.ae" })], release: { status: 403, body: envelope(403, refused, "MAKER_CHECKER") } });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();
  await page.getByTestId("run-approval").getByRole("button", { name: "Release" }).click();
  await expect(page.getByTestId("release-error")).toHaveText(refused);
  await expect(page.getByTestId("run-approval").getByRole("button", { name: "Release" })).toBeEnabled();
});

test("the exception report failing to download says so", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  await stubOmni(page, { recent: [finished()], polls: [finished()], reconciliation: reconciled, exceptions: { status: 409, body: JSON.stringify(envelope(409, "Only a KTDA SAP pay file has an exception report.")) } });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();
  await page.getByTestId("run-checks").getByRole("button", { name: "Exception report" }).click();
  await expect(page.getByTestId("exceptions-error")).toContainText("Only a KTDA SAP pay file has an exception report.");
});

test("a run submitted under the proxy's shared identity says why it cannot be released", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  await stubOmni(page, { recent: [run({ submittedBy: "ktda-operator" })], polls: [run({ submittedBy: "ktda-operator" })] });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();
  await expect(page.getByTestId("run-approval")).toContainText("Submitted under a shared identity");
});

test("the same file twice: 409 DUPLICATE_FILE names the earlier run, which opens even when it is not in the list", async ({ page }) => {
  const message = `This payment file was already uploaded as run ${EARLIER} (${NAME}, 2026-11-05T09:00:00Z, PARTIAL). The same file is not paid twice.`;
  const earlier = finished({ runId: EARLIER, startedAt: "2026-11-05T09:00:00Z" });
  await stubOmni(page, { upload: { status: 409, body: envelope(409, message, "DUPLICATE_FILE") }, recent: [] });
  await page.route(new RegExp(`/bulk-loads/${EARLIER}(/reconciliation)?(\\?.*)?$`), (route) =>
    json(route, new URL(route.request().url()).pathname.endsWith("/reconciliation") ? { ...reconciled, runId: EARLIER } : earlier));
  await page.goto("/bulk/payments");
  await page.getByLabel("CSV file").setInputFiles(file(NAME, SAP_CSV));
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("upload-error")).toContainText(message);
  await page.getByRole("button", { name: "Open the earlier run" }).click();
  await expect(page.getByText(`Run ${EARLIER}`)).toBeVisible();
  await expect(page.getByTestId("recon-panel")).toBeVisible();
});

test("413: omnichannel's FILE_TOO_LARGE and nginx's own page both get a clear message", async ({ page }) => {
  await stubOmni(page, { upload: { status: 413, body: envelope(413, "The file must be 200 MB or smaller", "FILE_TOO_LARGE", "file") } });
  await page.goto("/bulk/payments");
  await page.getByLabel("CSV file").setInputFiles(file(NAME, SAP_CSV));
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("upload-error")).toHaveText("The file must be 200 MB or smaller. Split the file by factory and send each part.");

  await page.unroute(R);
  await page.route(R, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/upload")) return route.fulfill({ status: 413, contentType: "text/html", body: "<html><body><h1>413 Request Entity Too Large</h1></body></html>" });
    if (path.endsWith("/onboarding-status")) return json(route, { onboardingCompleted: true });
    return json(route, []);
  });
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("upload-error")).toHaveText("The file is over the 100 MB this site accepts. Split it by factory and send each part.");
});

test("an omnichannel without the SAP pay file: the SAP file is stored but never started", async ({ page }) => {
  const sent = await stubOmni(page, { upload: { status: 202, body: legacyRun({ sourceName: NAME, totalRows: 11 }) } });
  await page.goto("/bulk/payments");
  await page.getByLabel("CSV file").setInputFiles(file(NAME, SAP_CSV));
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("sap-not-taken")).toContainText("does not take the SAP export yet");
  await expect(page.getByRole("button", { name: "Start another" })).toBeVisible();
  expect(sent.some((s) => s.path.endsWith("/process"))).toBe(false);
  await expect(page.getByTestId("run-approval")).toHaveCount(0);
});

test("a file that is neither payment format is refused before upload", async ({ page }) => {
  const sent = await stubOmni(page);
  await page.goto("/bulk/payments");
  await page.getByLabel("CSV file").setInputFiles(file("x.csv", "a,b,c\n1,2,3\n"));
  await expect(page.getByTestId("file-summary")).toContainText("This isn't a payment file.");
  await expect(page.getByTestId("file-summary")).toContainText("grower_no,amount_kes,payment_ref");
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
  expect(sent.some((s) => s.method === "POST")).toBe(false);
});

test("accounting file on an older omnichannel: starts on Process, and the expected total leaves out the rows that will be refused", async ({ page }) => {
  const legacy = legacyRun();
  const sent = await stubOmni(page, {
    upload: { status: 202, body: legacy },
    process: { status: 200, body: legacy },
    polls: [{ ...legacy, status: "PARTIAL", processedCount: 1, failureCount: 3, totalAmount: 1500.5, completedAt: "2026-11-06T08:00:02Z", message: "3 rows failed" }],
    reconciliation: { ...reconciled, fileFormat: undefined, payableCount: undefined, payableAmount: undefined, routedCount: undefined, routedAmount: undefined, heldCount: undefined, heldAmount: undefined, heldCodes: undefined, creditedTotal: 1500.5, expectedTotal: 1500.5, matchesExpected: true },
  });
  await page.goto("/bulk/payments");
  const csv = "grower_no,amount_kes,payment_ref\nKTDA1,1500.50,R1\nKTDA2,2000000,R2\nKTDA3,10.00,R1\nKTDA4,0,R4\n";
  await page.getByLabel("CSV file").setInputFiles(file("p.csv", csv));
  await expect(page.getByTestId("file-summary")).toContainText("4 rows, total KES 2,001,510.50");
  await expect(page.getByTestId("file-expected")).toHaveText("KES 1,500.50");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("recon-panel")).toContainText("Matches the expected total");
  await expect(page.getByText("Partly completed: some rows failed")).toBeVisible();
  await expect(page.getByTestId("run-checks")).toHaveCount(0);
  expect(sent.some((s) => s.path === `/${RUN}/process`)).toBe(true);
  expect(formField(sent.find((s) => s.path === "/upload")!.body, "period")).toBeNull();
  expect(sent.find((s) => s.path === `/${RUN}/reconciliation`)!.query.get("expectedTotal")).toBe("1500.50");
});

test("registration: farmers held as CLASH are counted after the run, with a link to who and why", async ({ page }) => {
  const reg = { ...legacyRun({ flow: "REGISTRATION", sourceName: "register.csv", status: "COMPLETED", totalRows: 3, processedCount: 3, completedAt: "2026-11-06T08:00:02Z" }), submittedBy: ME, submittedAt: "2026-11-06T08:00:00Z", releasedBy: null, releasedAt: null, fileFormat: null };
  await stubOmni(page, { recent: [reg], polls: [reg], farmersSummary: { registered: 2, activated: 0, funded: 0, total: 3, clash: 1 } });
  await page.goto("/journey/register");
  await page.getByRole("row").filter({ hasText: "register.csv" }).click();
  await expect(page.getByTestId("clash-note")).toContainText("1 farmer held as a clash");
  await expect(page.getByTestId("clash-note").getByRole("link", { name: "See who and why" })).toHaveAttribute("href", "/farmers?state=CLASH");
  // A registration run is never released: no approval panel.
  await expect(page.getByTestId("run-approval")).toHaveCount(0);
});

test("farmers: the Clash tab lists the held farmers with omnichannel's reason", async ({ page }) => {
  const sent: string[] = [];
  await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => json(route, { registered: 2, activated: 0, funded: 0, total: 3, clash: 1 }));
  await page.route(/\/omni\/api\/operator\/farmers(\?.*)?$/, (route) => {
    sent.push(route.request().url());
    return route.fulfill({
      status: 200, contentType: "application/json", headers: { "x-total-count": "1", "x-total-pages": "1" },
      body: JSON.stringify([{ growerNo: "KG-000003", fullName: "Farmer Three", phone: "+254700000001", factory: "KG", status: "CLASH", registeredAt: "2026-11-06T08:00:00Z", activatedAt: null, lastFundedAt: null, customerId: null, clashReason: "Phone +254700000001 is already the login of grower KG-000001" }]),
    });
  });
  await page.goto("/farmers?state=CLASH");
  await expect(page.getByRole("tab", { name: /Clash/ })).toContainText("1");
  const row = page.getByTestId("farmers-table").locator('[data-grower="KG-000003"]');
  await expect(row).toContainText("Clash");
  await expect(row.getByTestId("clash-reason")).toHaveText("Phone +254700000001 is already the login of grower KG-000001");
  expect(new URL(sent.at(-1)!).searchParams.get("state")).toBe("CLASH");
});

test("ledger refusals: their own total and download, and the reconciliation matched by posted + applied + refused", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  // The ledger refused one wallet line (a grower with no wallet): KES 499.25 of the 5,000.00 sent.
  const done = finished({ processedCount: 3, failureCount: 1, totalAmount: 4500.75, refusedCount: 1, refusedAmount: 499.25, warningCount: 1, checksNotRun: "E05_WALLET_MISMATCH" });
  const sent = await stubOmni(page, {
    recent: [done], polls: [done],
    reconciliation: { ...reconciled, processedCount: 3, failureCount: 1, creditedTotal: 4500.75, refusedCount: 1, refusedAmount: 499.25, matchesExpected: true, warningCount: 1, checksNotRun: "E05_WALLET_MISMATCH", matchRule: "posted + already applied + refused == expected" },
  });
  const accepts: string[] = [];
  await page.route(new RegExp(`/bulk-loads/${RUN}/rows\\?outcome=REFUSED$`), (route) => {
    accepts.push(route.request().headers()["accept"] ?? "");
    return route.fulfill({ status: 200, contentType: "text/csv", headers: { "content-disposition": `attachment; filename="${RUN}-refused.csv"` }, body: "lineNo,grower_no,payment_ref,amount,outcome,reason\n10,KG-000010,KTDA:2026-10:10:KG-000010,499.25,REFUSED,No KES wallet for this grower\n" });
  });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();

  const panel = page.getByTestId("recon-panel");
  await expect(page.getByText("Completed, with lines the ledger refused")).toBeVisible();
  await expect(panel).toContainText("Matches the expected total");
  await expect(panel).toContainText("Refused by the ledger1 · KES 499.25");
  await expect(page.getByTestId("recon-rule")).toContainText("The ledger's rule: posted + already applied + refused == expected.");
  const refused = page.getByTestId("refused-lines");
  await expect(page.getByTestId("refused-total")).toHaveText("1 line · KES 499.25");
  // Separate from held and bank/SACCO.
  await expect(page.getByTestId("run-checks").locator('tr[data-row="held"]')).toContainText("6");
  await expect(page.getByTestId("run-checks").locator('tr[data-row="warning"]')).toContainText("1");
  await expect(page.getByTestId("checks-not-run")).toContainText("Wallet ID belongs to a different grower");
  const download = page.waitForEvent("download");
  await refused.getByRole("button", { name: "Refused lines" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe(`${RUN}-refused.csv`);
  expect(readFileSync(await d.path(), "utf8")).toContain("No KES wallet for this grower");
  expect(accepts).toEqual(["text/csv"]);
  expect(sent.find((s) => s.path === `/${RUN}/reconciliation`)!.query.get("expectedTotal")).toBe("5000.00");
});

test("ledger refusals with a total that still does not add up: shown as not matching", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  const done = finished({ refusedCount: 0, refusedAmount: 0 });
  await stubOmni(page, { recent: [done], polls: [done], reconciliation: { ...reconciled, creditedTotal: 4000, refusedCount: 0, refusedAmount: 0, matchesExpected: false } });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();
  await expect(page.getByTestId("recon-panel")).toContainText("Does not match the expected total");
  await expect(page.getByTestId("refused-total")).toHaveText("0 lines · KES 0.00");
  await expect(page.getByTestId("refused-lines").getByRole("button", { name: "Refused lines" })).toHaveCount(0);
});

test("refused lines where the ledger keeps no line results for the run (404): says so", async ({ page }) => {
  await signInAs(page, "brian@baracel.ae", "Brian Checker");
  const done = finished({ refusedCount: 1, refusedAmount: 499.25 });
  await stubOmni(page, { recent: [done], polls: [done], reconciliation: { ...reconciled, refusedCount: 1, refusedAmount: 499.25 } });
  await page.goto("/bulk/payments");
  await page.getByRole("row").filter({ hasText: NAME }).click();
  await page.getByTestId("refused-lines").getByRole("button", { name: "Refused lines" }).click();
  await expect(page.getByTestId("refused-error")).toContainText("has not reached the ledger, or this environment's accounting keeps counts only");
});
