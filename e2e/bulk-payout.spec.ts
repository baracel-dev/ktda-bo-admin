import { expect, test, type Page, type Route } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* Pay to M-PESA (bulk-loads flow PAYOUT), stubbed: the same payment file,
 * upload, process and release as a wallet credit run, but each row is drawn
 * from the farmer's wallet and paid to their M-PESA. Its gate is the
 * institution having funded farmers (onboarding-status payoutReady, or the
 * farmers summary's funded count on an omnichannel without it); its rows are
 * JSON pages by outcome; and the demo's mock SasaPay shows under the runs. */

const KTDA = "11111111-1111-4111-8111-111111111111";
const RUN = "55555555-5555-4555-8555-555555555555";
const R = /\/omni\/api\/operator\/bulk-loads/;
const PAYOUT_CSV = "grower_no,amount_kes,payment_ref\nKTDA000001,1500.00,PO-2026-11-0001\nKTDA000002,2500.00,PO-2026-11-0002\nKTDA000003,1000.00,PO-2026-11-0003\n";
const PROVIDER_SAYS = "SasaPay: receiver MSISDN is not registered for M-PESA";

type Obj = Record<string, unknown>;

const run = (over: Obj = {}): Obj => ({
  runId: RUN, flow: "PAYOUT", institutionId: KTDA, currency: "KES", sourceName: "payouts.csv",
  status: "RUNNING", totalRows: 3, processedCount: 0, skippedCount: 0, failureCount: 0, totalAmount: 0,
  startedAt: "2026-11-09T08:00:00Z", completedAt: null, message: null, ...over,
});

const ROWS: Record<string, Obj[]> = {
  SENT: [
    { row: 1, growerNo: "KTDA000001", amount: 1500, currency: "KES", paymentRef: "PO-2026-11-0001", outcome: "SENT", message: null, paymentId: "SP-0001", at: "2026-11-09T08:00:02Z" },
    { row: 2, growerNo: "KTDA000002", amount: 2500, currency: "KES", paymentRef: "PO-2026-11-0002", outcome: "SENT", message: null, paymentId: "SP-0002", at: "2026-11-09T08:00:02Z" },
  ],
  FAILED: [
    { row: 3, growerNo: "KTDA000003", amount: 1000, currency: "KES", paymentRef: "PO-2026-11-0003", outcome: "FAILED", message: PROVIDER_SAYS, paymentId: null, at: "2026-11-09T08:00:03Z" },
  ],
};

type Sent = { method: string; path: string; query: URLSearchParams; body: string | null };

const paged = (route: Route, items: Obj[]) => route.fulfill({
  status: 200, contentType: "application/json",
  headers: { "X-Total-Count": String(items.length), "X-Total-Pages": items.length ? "1" : "0", "X-Page": "1", "X-Size": "50" },
  body: JSON.stringify(items),
});

async function stub(page: Page, opts: {
  status?: Obj;
  funded?: number;
  upload?: { status: number; body: unknown };
  polls?: Obj[];
  recent?: Obj[];
  recon?: Obj;
  sasapay?: { status: number; body: unknown };
} = {}) {
  const sent: Sent[] = [];
  let poll = 0;
  await page.route(/\/tok\/accounting\/institutions$/, (route) => json(route, [{ institutionId: KTDA, name: "KTDA Holdings", localCurrency: "KES" }]));
  await page.route(/\/omni\/api\/operator\/institutions$/, (route) => json(route, [{ id: KTDA, name: "KTDA Holdings", localCurrency: "KES", country: "KE", status: "ACTIVE" }]));
  await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => {
    sent.push({ method: "GET", path: "farmers/summary", query: new URLSearchParams(), body: null });
    return json(route, { registered: 0, activated: 1, funded: opts.funded ?? 0, total: 1 + (opts.funded ?? 0) });
  });
  await page.route(/\/omni\/api\/operator\/mock-sasapay/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/omni\/api\/operator/, "");
    sent.push({ method: req.method(), path, query: new URLSearchParams(), body: req.postData() });
    if (req.method() === "POST" && path === "/mock-sasapay/reset") return json(route, { enabled: true, workingBalance: 50000, utilityBalance: 2000, payouts: [] });
    const out = opts.sasapay ?? { status: 404, body: envelope(404, "Not found") };
    return json(route, out.body, out.status);
  });
  await page.route(R, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator\/bulk-loads/, "");
    sent.push({ method: req.method(), path, query: url.searchParams, body: req.postData() });
    if (req.method() === "POST" && path === "/upload") {
      const out = opts.upload ?? { status: 202, body: run() };
      return json(route, out.body, out.status);
    }
    if (req.method() === "POST" && path === `/${RUN}/process`) return json(route, run());
    if (path === "/onboarding-status") return json(route, opts.status ?? { onboardingCompleted: true, registrationCompleted: true, payoutReady: true });
    if (path === "") return json(route, opts.recent ?? []);
    if (path === `/${RUN}`) {
      const polls = opts.polls ?? [run()];
      const r = polls[Math.min(poll, polls.length - 1)];
      poll++;
      return json(route, r);
    }
    if (path === `/${RUN}/rows`) return paged(route, ROWS[url.searchParams.get("outcome") ?? ""] ?? []);
    if (path === `/${RUN}/reconciliation`) return json(route, opts.recon ?? { runId: RUN, flow: "PAYOUT", status: "PARTIAL", sentCount: 2, sentAmount: 4000, failedCount: 1, failedAmount: 1000, refusedCount: 0, refusedAmount: 0, alreadyPaidCount: 0, alreadyPaidAmount: 0 });
    if (path === `/${RUN}/exceptions`) return route.fulfill({ status: 200, contentType: "text/csv", headers: { "Content-Disposition": `attachment; filename="${RUN}-exceptions.csv"` }, body: "row,grower_no,reason\n3,KTDA000003,failed\n" });
    return json(route, { message: "Not stubbed" }, 404);
  });
  return sent;
}

const csv = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
const partial = run({
  status: "PARTIAL", processedCount: 2, failureCount: 1, totalAmount: 4000, completedAt: "2026-11-09T08:00:04Z",
  message: "1 of 3 payouts failed at the provider.",
});

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("payment runs offer Pay to M-PESA beside the wallet credit run", async ({ page }) => {
  await stub(page);
  await page.goto("/bulk/payments");
  const kind = page.getByTestId("payment-kind");
  await expect(kind.getByRole("tab", { name: "Credit wallets" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Bulk payments" })).toBeVisible();
  await kind.getByRole("tab", { name: "Pay to M-PESA" }).click();
  await expect(page).toHaveURL(/\/bulk\/payments\?flow=payout$/);
  await expect(page.getByRole("heading", { name: "Pay to M-PESA" })).toBeVisible();
  await expect(kind.getByRole("tab", { name: "Pay to M-PESA" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("step-2")).toContainText("grower_no,amount_kes,payment_ref");
  await expect(page.getByTestId("step-2")).toContainText("paid to their M-PESA");
  await expect(page.getByTestId("payout-gate")).toContainText("Payouts are open");
  // The other pages of the bulk flows have no such switch.
  await page.goto("/bulk/onboarding");
  await expect(page.getByRole("heading", { name: "Bulk onboarding" })).toBeVisible();
  await expect(page.getByTestId("payment-kind")).toHaveCount(0);
});

test("payouts stay closed until the institution has a funded farmer", async ({ page }) => {
  await stub(page, { status: { onboardingCompleted: true, registrationCompleted: true, payoutReady: false } });
  await page.goto("/bulk/payments?flow=payout");
  await expect(page.getByText("Payouts are closed")).toBeVisible();
  await expect(page.getByLabel("CSV file")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
});

test("an omnichannel without payoutReady: the gate reads the farmers summary's funded count", async ({ page }) => {
  const sent = await stub(page, { status: { onboardingCompleted: true, registrationCompleted: true }, funded: 0 });
  await page.goto("/bulk/payments?flow=payout");
  await expect(page.getByText("Payouts are closed")).toBeVisible();
  expect(sent.some((s) => s.path === "farmers/summary")).toBe(true);

  await page.unroute(/\/omni\/api\/operator\/farmers\/summary$/);
  await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => json(route, { registered: 0, activated: 1, funded: 4, total: 5 }));
  await page.reload();
  await expect(page.getByTestId("payout-gate")).toContainText("Payouts are open");
  await expect(page.getByLabel("CSV file")).toBeEnabled();
});

test("a payout run: uploaded as PAYOUT, polled to PARTIAL, rows by outcome, the provider's words and the reconciliation", async ({ page }) => {
  const sent = await stub(page, { polls: [run(), partial] });
  await page.goto("/bulk/payments?flow=payout");
  await page.getByLabel("CSV file").setInputFiles(csv("payouts.csv", PAYOUT_CSV));
  await expect(page.getByTestId("file-summary")).toContainText("payouts.csv: 3 rows, total KES 5,000.00");
  await page.getByRole("button", { name: "Submit", exact: true }).click();

  await expect(page.getByText("Partly paid: some payouts failed")).toBeVisible();
  await expect(page.getByTestId("run-message")).toHaveText("1 of 3 payouts failed at the provider.");
  await expect(page.getByTestId("step-4").getByRole("link", { name: "payments issues list" }).first()).toHaveAttribute("href", "/token-console/transactions?tab=issues");
  await expect(page.getByTestId("run-progress")).toContainText("Sent to M-PESA");

  // A run with failures opens on its failed rows, each in the provider's words.
  const rows = page.getByTestId("payout-rows");
  await expect(rows.getByRole("tab", { name: /Failed/ })).toHaveAttribute("aria-selected", "true");
  const table = rows.getByTestId("payout-table");
  await expect(table).toContainText(PROVIDER_SAYS);
  await expect(table).toContainText("KTDA000003");
  await expect(rows).toContainText("Retry these on the payments issues list");
  await expect(table.getByRole("link", { name: "KTDA000003" })).toHaveAttribute("href", "/farmers/KTDA000003");

  await rows.getByRole("tab", { name: /Sent/ }).click();
  await expect(table).toContainText("SP-0001");
  await expect(table).toContainText("KES 2,500.00");
  await rows.getByRole("tab", { name: /Already paid/ }).click();
  await expect(rows.getByTestId("payout-rows-empty")).toContainText("No already paid rows");

  const recon = page.getByTestId("payout-recon");
  await expect(recon).toContainText("Sent to M-PESA");
  await expect(recon).toContainText("2 · KES 4,000.00");
  await expect(recon).toContainText("1 · KES 1,000.00");

  const upload = sent.find((s) => s.method === "POST" && s.path === "/upload")!;
  expect(upload.body).toContain('name="flow"\r\n\r\nPAYOUT');
  expect(upload.body).toContain(`name="institutionId"\r\n\r\n${KTDA}`);
  const outcomes = sent.filter((s) => s.path === `/${RUN}/rows`).map((s) => s.query.get("outcome"));
  expect(outcomes).toContain("FAILED");
  expect(outcomes).toContain("SENT");
  expect(outcomes).toContain("ALREADY_PAID");
  const first = sent.find((s) => s.path === `/${RUN}/rows`)!;
  expect(first.query.get("page")).toBe("1");
  expect(first.query.get("size")).toBe("50");
  // The payout reconciliation takes no expected total.
  const reconCall = sent.find((s) => s.path === `/${RUN}/reconciliation`)!;
  expect(reconCall.query.has("expectedTotal")).toBe(false);

  const download = page.waitForEvent("download");
  await rows.getByRole("button", { name: "Exceptions CSV" }).click();
  expect((await download).suggestedFilename()).toBe(`${RUN}-exceptions.csv`);
});

test("a reconciliation with names the page does not know is shown as it comes", async ({ page }) => {
  const done = run({ status: "COMPLETED", processedCount: 3, totalAmount: 5000, completedAt: "2026-11-09T08:00:04Z" });
  await stub(page, { polls: [done], recent: [done], recon: { runId: RUN, flow: "PAYOUT", sent: { count: 3, amount: 5000 }, providerFees: 75 } });
  await page.goto("/bulk/payments?flow=payout");
  await page.getByRole("row").filter({ hasText: "payouts.csv" }).click();
  await expect(page.getByText("Completed: all sent")).toBeVisible();
  // No failures: the rows open on what was sent.
  await expect(page.getByTestId("payout-rows").getByRole("tab", { name: /Sent/ })).toHaveAttribute("aria-selected", "true");
  const recon = page.getByTestId("payout-recon");
  await expect(recon).toContainText("3 · KES 5,000.00");
  await expect(recon).toContainText("Provider fees");
  await expect(recon).toContainText("75");
  await expect(page.getByRole("columnheader", { name: "Paid out" })).toBeVisible();
});

test("a FAILED payout run says none was paid, and where to retry", async ({ page }) => {
  const failed = run({ status: "FAILED", failureCount: 3, completedAt: "2026-11-09T08:00:04Z", message: "SasaPay working balance is too low" });
  await stub(page, { polls: [failed], recent: [failed] });
  await page.goto("/bulk/payments?flow=payout");
  await page.getByRole("row").filter({ hasText: "payouts.csv" }).click();
  await expect(page.getByText("Failed: none paid")).toBeVisible();
  await expect(page.getByTestId("run-message")).toHaveText("SasaPay working balance is too low");
});

test("an omnichannel without PAYOUT says Pay to M-PESA is not available there yet", async ({ page }) => {
  const sent = await stub(page, { upload: { status: 400, body: envelope(400, "Parameter 'flow' must be a valid BulkFlow") } });
  await page.goto("/bulk/payments?flow=payout");
  await page.getByLabel("CSV file").setInputFiles(csv("payouts.csv", PAYOUT_CSV));
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("not-available")).toContainText("does not pay out to M-PESA");
  expect(sent.some((s) => s.path.endsWith("/process"))).toBe(false);
  expect(sent.filter((s) => s.path === "/upload")).toHaveLength(1);
});

test("Demo SasaPay: balances and last payouts where the mock answers, and a reset", async ({ page }) => {
  const sent = await stub(page, {
    sasapay: {
      status: 200,
      body: {
        enabled: true, workingBalance: 12500.5, utilityBalance: 300,
        payouts: [{ receiver: "2547****0001", amount: 1500, result: "SUCCESS", at: "2026-11-09T08:00:02Z", reference: "SP-0001" }],
      },
    },
  });
  await page.goto("/bulk/payments");
  const panel = page.getByTestId("demo-sasapay");
  await expect(panel.getByRole("heading", { name: "Demo SasaPay" })).toBeVisible();
  await expect(panel.getByTestId("sasapay-working")).toHaveText("KES 12,500.50");
  await expect(panel.getByTestId("sasapay-utility")).toHaveText("KES 300.00");
  await expect(panel.getByTestId("sasapay-payouts")).toContainText("2547****0001");
  await expect(panel.getByTestId("sasapay-payouts")).toContainText("KES 1,500.00");

  await panel.getByLabel("Working balance (KES)").fill("50000");
  await panel.getByRole("button", { name: "Reset" }).click();
  await expect(panel.getByLabel("Working balance (KES)")).toHaveValue("");
  const reset = sent.find((s) => s.method === "POST" && s.path === "/mock-sasapay/reset")!;
  expect(JSON.parse(reset.body ?? "{}")).toEqual({ workingBalance: 50000 });

  // The payout page shows it too.
  await page.goto("/bulk/payments?flow=payout");
  await expect(page.getByTestId("demo-sasapay")).toBeVisible();
});

test("Demo SasaPay is not shown where the mock is off (404)", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/bulk/payments?flow=payout");
  await expect(page.getByRole("heading", { name: "Pay to M-PESA" })).toBeVisible();
  await expect.poll(() => sent.some((s) => s.path === "/mock-sasapay")).toBe(true);
  await expect(page.getByTestId("demo-sasapay")).toHaveCount(0);
  await expect(page.getByText("Demo SasaPay")).toHaveCount(0);
});
