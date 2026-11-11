import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* Approvals (prototype 3.4) on omnichannel's queue (approvalsContract.ts):
 * tabs, the rows, the drawer at ?open=, approve, reject with a note, cancel,
 * a replay that fails, and the menu badge from the summary. Stubbed. */

type Obj = Record<string, unknown>;
const approval = (reference: string, over: Obj = {}): Obj => ({
  id: `id-${reference}`, reference, type: "AGENT_FLOAT_TOP_UP", title: "Top up float of agent A-0001 by KES 150,000.00",
  target: { kind: "AGENT", reference: "A-0001", name: "Kevin Onyango" },
  changes: [{ setting: "Float balance", now: "147,500.00", proposed: "297,500.00" }],
  reason: "Market day tomorrow.", payload: { amount: 150000, reference: "BANK-1" }, status: "PENDING",
  maker: "ktda-operator", madeAt: new Date(Date.now() - 90 * 60000).toISOString(), checker: null, decidedAt: null, decisionNote: null,
  appliedAt: null, error: null, checkerRoles: ["ADMIN", "COMPLIANCE"], ...over,
});
const PENDING = [
  approval("AP-10001"),
  approval("AP-10002", { type: "FARMER_KYC_OVERRIDE", title: "Verify farmer TEST000014 despite registry MISMATCH", target: { kind: "FARMER", reference: "TEST000014", name: "Hawa Otieno" }, changes: [], reason: null }),
];
type Answer = { status: number; body: unknown };
const headers = (n: number) => ({ "X-Total-Count": String(n), "X-Page": "1", "X-Size": "20", "X-Total-Pages": "1" });

/** lists are keyed by status, or "mine:<status>" for mine=true. details: by reference; a missing one answers 404 (before v2). */
async function stub(page: Page, opts: { lists?: Record<string, Obj[]>; one?: Obj | null; post?: (path: string, body: Obj) => Answer | undefined; unavailable?: boolean; details?: Record<string, Obj | null>; summary?: Obj } = {}) {
  const sent: { method: string; path: string; query: URLSearchParams; body: unknown }[] = [];
  let current = opts.one === undefined ? approval("AP-10001") : opts.one;
  await page.route(/\/omni\/api\/operator\/approvals/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    const body = req.method() === "POST" ? (req.postDataJSON() as Obj) : null;
    sent.push({ method: req.method(), path, query: url.searchParams, body });
    if (opts.unavailable) return json(route, envelope(404, "Not Found"), 404);
    if (req.method() === "POST") {
      const verb = path.split("/").pop()!;
      const a = opts.post?.(path, body!) ?? {
        status: 200,
        body: { ...current, status: verb === "approve" ? "APPROVED" : verb === "reject" ? "REJECTED" : "CANCELLED", checker: "ktda-operator", decidedAt: new Date().toISOString(), decisionNote: body?.note ?? null },
      };
      if (a.status === 200) current = a.body as Obj;
      return json(route, a.body, a.status);
    }
    if (path === "/approvals") {
      const key = `${url.searchParams.get("mine") === "true" ? "mine:" : ""}${url.searchParams.get("status") ?? "PENDING"}`;
      const items = (opts.lists ?? { PENDING })[key] ?? [];
      return route.fulfill({ status: 200, contentType: "application/json", headers: headers(items.length), body: JSON.stringify(items) });
    }
    if (path === "/approvals/summary") return json(route, opts.summary ?? { pending: 2, decidedToday: 5 });
    if (path.endsWith("/details")) {
      const ref = path.split("/")[2]!;
      return opts.details && ref in opts.details ? json(route, { details: opts.details[ref] }) : json(route, envelope(404, "Not Found"), 404);
    }
    return current ? json(route, current) : json(route, envelope(404, "No such request"), 404);
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the queue: tabs with the pending count, the rows, and no demo data", async ({ page }) => {
  await stub(page);
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Waiting on me\s*2$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^All pending\s*2$/ })).toBeVisible();
  const rows = page.getByTestId("approvals-table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Top up float of agent A-0001 by KES 150,000.00");
  await expect(rows.nth(0)).toContainText("AP-10001");
  await expect(rows.nth(0)).toContainText("Float top-up");
  await expect(rows.nth(0)).toContainText("ktda-operator");
  await expect(rows.nth(0)).toContainText("2 h");
  await expect(rows.nth(0)).toContainText("Market day tomorrow.");
  await expect(rows.nth(0)).toContainText("Waiting");
  await expect(rows.nth(1)).toContainText("KYC override");
  await expect(page.getByTestId("demo-footer")).toHaveCount(0);
  await expect(page.getByText("Demo data", { exact: true })).toHaveCount(0);
});

test("Decided asks for one outcome at a time; a kind filters", async ({ page }) => {
  const sent = await stub(page, { lists: { PENDING, REJECTED: [approval("AP-10009", { status: "REJECTED", decisionNote: "No bank letter." })] } });
  await page.goto("/approvals");
  await page.getByRole("tab", { name: /^Decided/ }).click();
  await expect.poll(() => sent.some((s) => s.path === "/approvals" && s.query.get("status") === "APPROVED")).toBe(true);
  await expect(page.getByTestId("approvals-empty")).toHaveText("Nothing approved.");
  await expect(page.getByText("5 decided today.")).toBeVisible();
  await page.getByLabel("Outcome").selectOption("REJECTED");
  await expect(page.getByTestId("approvals-table")).toContainText("AP-10009");
  await page.getByRole("button", { name: "Every kind" }).click();
  await page.getByRole("option", { name: "KYC override" }).click();
  await expect.poll(() => sent.some((s) => s.path === "/approvals" && s.query.get("type") === "FARMER_KYC_OVERRIDE" && s.query.get("status") === "REJECTED")).toBe(true);
});

test("a row opens the drawer at ?open=: details, the target's link, who decides, and Now struck through", async ({ page }) => {
  await stub(page);
  await page.goto("/approvals");
  await page.getByTestId("approvals-table").getByText("AP-10001").click();
  await expect(page).toHaveURL(/open=AP-10001/);
  const drawer = page.getByTestId("approval-drawer");
  await expect(drawer).toContainText("Float top-up");
  await expect(page.getByTestId("approval-reason")).toHaveText("Market day tomorrow.");
  await expect(drawer).toContainText("ktda-operator");
  await expect(page.getByTestId("approval-target")).toHaveAttribute("href", "/agents?focus=A-0001");
  await expect(page.getByTestId("approval-target")).toContainText("Kevin Onyango");
  await expect(drawer).toContainText("Admin, Compliance");
  const changes = page.getByTestId("approval-changes");
  await expect(changes.locator("s")).toHaveText("147,500.00");
  await expect(changes).toContainText("297,500.00");
  await expect(drawer).toContainText("Required when you reject. Saved in the audit log.");
});

test("approve, with an optional note; the maker is not blocked", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/approvals?open=AP-10001");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByTestId("approval-outcome")).toContainText("Approved by ktda-operator");
  expect(sent.find((s) => s.method === "POST")).toMatchObject({ path: "/approvals/AP-10001/approve", body: {} });
});

test("reject needs a note, and sends it", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/approvals?open=AP-10001");
  const reject = page.getByRole("button", { name: "Reject", exact: true });
  await expect(reject).toBeDisabled();
  await page.getByLabel("Note").fill("The bank reference does not match.");
  await reject.click();
  await expect(page.getByTestId("approval-outcome")).toContainText("Rejected by ktda-operator");
  await expect(page.getByTestId("approval-outcome")).toContainText("Note: The bank reference does not match.");
  expect(sent.find((s) => s.method === "POST")).toMatchObject({ path: "/approvals/AP-10001/reject", body: { note: "The bank reference does not match." } });
});

test("cancel by the maker", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/approvals?open=AP-10001");
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByTestId("approval-outcome")).toContainText("Cancelled by the requester");
  expect(sent.find((s) => s.method === "POST")!.path).toBe("/approvals/AP-10001/cancel");
});

test("a replay omnichannel refuses (APPROVAL_FAILED) shows why, and the request as Failed", async ({ page }) => {
  let failed = false;
  await stub(page, {
    post: (path) => {
      if (!path.endsWith("/approve")) return undefined;
      failed = true;
      return { status: 409, body: envelope(409, "Agent A-0001 is suspended", "APPROVAL_FAILED") };
    },
  });
  // After the refusal the request reads FAILED.
  await page.route(/\/omni\/api\/operator\/approvals\/AP-10001$/, (route) =>
    json(route, failed ? approval("AP-10001", { status: "FAILED", error: "Agent A-0001 is suspended", checker: "ktda-operator", decidedAt: new Date().toISOString() }) : approval("AP-10001")));
  await page.goto("/approvals?open=AP-10001");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByTestId("approval-error")).toContainText("It could not be applied: Agent A-0001 is suspended");
  await expect(page.getByTestId("approval-drawer")).toContainText("Failed");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
});

test("a decided request has no decision buttons; a farmer's target links to the farmer", async ({ page }) => {
  await stub(page, { one: approval("AP-10002", { status: "APPROVED", type: "FARMER_KYC_OVERRIDE", target: { kind: "FARMER", reference: "TEST000014", name: "Hawa Otieno" }, checker: "ktda-operator", decidedAt: new Date().toISOString(), appliedAt: new Date().toISOString() }) });
  await page.goto("/approvals?open=AP-10002");
  await expect(page.getByTestId("approval-target")).toHaveAttribute("href", "/farmers/TEST000014");
  await expect(page.getByTestId("approval-outcome")).toContainText("Applied");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel request" })).toHaveCount(0);
});

test("a reference that is not this institution's", async ({ page }) => {
  await stub(page, { one: null });
  await page.goto("/approvals?open=AP-99999");
  await expect(page.getByTestId("approval-not-found")).toContainText("No request AP-99999");
});

test("an omnichannel without the queue says so", async ({ page }) => {
  await stub(page, { unavailable: true });
  await page.goto("/approvals");
  await expect(page.getByTestId("not-available")).toContainText("Not available on this environment yet");
});

test("the menu's Approvals badge is the queue's pending count", async ({ page }) => {
  await stub(page);
  await page.goto("/farmers");
  await expect(page.locator("aside").first().getByRole("link", { name: /^Approvals/ })).toContainText("2");
});

test("a bulk KYC decision: its own kind in the filter, and its target is the KYC desk's waiting list", async ({ page }) => {
  const bulk = approval("AP-10020", {
    type: "FARMER_KYC_BULK_DECISION", title: "Verify KYC for every farmer waiting (10,014)",
    target: { kind: "FARMER", reference: "ALL_PENDING", name: null }, changes: [], reason: "Payouts this evening.",
  });
  const sent = await stub(page, { lists: { PENDING: [bulk] }, one: bulk });
  await page.goto("/approvals");
  await expect(page.getByTestId("approvals-table").locator("tbody tr").first()).toContainText("Bulk KYC decision");
  await page.getByRole("button", { name: "Every kind" }).click();
  await page.getByRole("option", { name: "Bulk KYC decision" }).click();
  await expect.poll(() => sent.some((s) => s.path === "/approvals" && s.query.get("type") === "FARMER_KYC_BULK_DECISION")).toBe(true);
  await page.getByTestId("approvals-table").getByText("AP-10020").click();
  await expect(page.getByTestId("approval-drawer")).toContainText("Bulk KYC decision");
  await expect(page.getByTestId("approval-target")).toHaveAttribute("href", "/token-console/kyc?kyc=PENDING");
});


/* ---- v2: what the checker sees, and the way on after a rejection ---- */

const AGENT_DETAILS = {
  agentNo: "A-0001", fullName: "Kevin Onyango", phone: "•••••••••904", town: "Kericho", status: "LOW_FLOAT",
  floatBalance: 147500.0, floatLimit: 500000.0, floatLow: true, suspensionReason: null, suspendedAt: null, suspendedBy: null, joinedAt: "2026-10-02T08:00:00Z",
};
const rejected = (reference: string, over: Obj = {}) => approval(reference, {
  status: "REJECTED", checker: "staff:checker@ktda.test", decidedAt: new Date().toISOString(), decisionNote: "The bank slip does not show this amount.", ...over,
});
const before = (a: { boundingBox: () => Promise<{ y: number } | null> }, b: { boundingBox: () => Promise<{ y: number } | null> }) =>
  Promise.all([a.boundingBox(), b.boundingBox()]).then(([x, y]) => x!.y < y!.y);

test("Details: the agent as it stands now, above the change rows, with a link to the agent", async ({ page }) => {
  await stub(page, { details: { "AP-10001": AGENT_DETAILS } });
  await page.goto("/approvals?open=AP-10001");
  const d = page.getByTestId("approval-details");
  await expect(d).toContainText("Kevin Onyango");
  await expect(d).toContainText("•••••••••904");
  await expect(d).toContainText("Kericho");
  await expect(d).toContainText("Low float");
  await expect(d).toContainText("147,500.00");
  await expect(d).toContainText("500,000.00");
  await expect(page.getByTestId("details-link")).toHaveText("Open agent A-0001");
  await expect(page.getByTestId("details-link")).toHaveAttribute("href", "/agents?focus=A-0001");
  expect(await before(d, page.getByTestId("approval-changes"))).toBe(true);
});

test("Details: a merchant's BRS answer, KYB and settlement (masked), linking to the merchant", async ({ page }) => {
  const m = approval("AP-10003", { type: "MERCHANT_UPDATE", title: "Change settlement of merchant M-10200", target: { kind: "MERCHANT", reference: "M-10200", name: "Kericho Agrovet" } });
  await stub(page, {
    one: m,
    details: { "AP-10003": {
      reference: "M-10200", name: "Kericho Agrovet", type: "AGROVET", town: "Kericho", county: "Kericho", ownerName: "Owner of record", ownerPhone: "•••••••••312",
      tillNo: "512345", registrationNo: "BN-2019-00412", brsStatus: "REGISTERED", brsRegisteredName: "KERICHO AGROVET", brsRegisteredOwner: "Owner of record",
      brsCheckedAt: "2026-11-03T09:00:00Z", kybStatus: "APPROVED", kybNote: null, kybDecidedAt: "2026-11-04T10:00:00Z",
      settlementBank: "KCB", settlementAccount: "•••••••••771", commissionRate: 0.015, acceptsVouchers: true, joinedAt: "2026-09-12T08:00:00Z",
    } },
  });
  await page.goto("/approvals?open=AP-10003");
  const d = page.getByTestId("approval-details");
  await expect(page.getByTestId("details-brs")).toHaveText("Registered");
  await expect(d).toContainText("KERICHO AGROVET");
  await expect(d).toContainText("Approved");
  await expect(d).toContainText("KCB");
  await expect(d).toContainText("•••••••••771");
  await expect(d).toContainText("1.50%");
  await expect(page.getByTestId("details-link")).toHaveAttribute("href", "/merchants/M-10200");
});

test("Details: a farmer's registry answer and KYC, linking to the farmer", async ({ page }) => {
  const f = approval("AP-10002", { type: "FARMER_KYC_OVERRIDE", title: "Verify farmer GN-142078 despite registry MISMATCH", target: { kind: "FARMER", reference: "GN-142078", name: "Peter Kimathi M'Ikiara" }, changes: [] });
  await stub(page, {
    one: f,
    details: { "AP-10002": {
      growerNo: "GN-142078", fullName: "Peter Kimathi M'Ikiara", factory: "Githongo", phone: "•••••••••118", nationalId: "•••••417",
      state: "ACTIVATED", kycStatus: "PENDING", identityResult: "MISMATCH", kycStartedAt: "2026-11-05T08:00:00Z", kycNote: "Name on the ID differs.",
      onboardingChannel: "AGENT", onboardingAgentNo: "AG-2041", activatedAt: "2026-11-01T08:00:00Z", lastFundedAt: null,
    } },
  });
  await page.goto("/approvals?open=AP-10002");
  const d = page.getByTestId("approval-details");
  await expect(page.getByTestId("details-identity")).toHaveText("Mismatch");
  await expect(d).toContainText("Githongo");
  await expect(d).toContainText("•••••417");
  await expect(d).toContainText("Name on the ID differs.");
  await expect(d).toContainText("agent AG-2041");
  await expect(page.getByTestId("details-link")).toHaveAttribute("href", "/farmers/GN-142078");
});

test("Details: a bulk decision shows the total large and the sample as a small table", async ({ page }) => {
  const bulk = approval("AP-10020", { type: "FARMER_KYC_BULK_DECISION", title: "Verify KYC for every farmer waiting (10,014)", target: { kind: "FARMER", reference: "farmers", name: null }, changes: [] });
  const sample = Array.from({ length: 25 }, (_, i) => ({ growerNo: `GN-1000${String(i).padStart(2, "0")}`, fullName: `Farmer ${i + 1}`, factory: "Litein", kycStatus: "PENDING", identityResult: i === 3 ? "NOT_FOUND" : "MATCH" }));
  await stub(page, { one: bulk, details: { "AP-10020": { decision: "VERIFIED", scope: "ALL_PENDING", note: "Payouts this evening.", listed: null, total: 10014, sampleSize: 25, sample } } });
  await page.goto("/approvals?open=AP-10020");
  await expect(page.getByTestId("details-total")).toHaveText("10,014");
  await expect(page.getByTestId("approval-details")).toContainText("farmers would be verified: every farmer waiting on a KYC decision");
  await expect(page.getByTestId("details-sample").locator("tbody tr")).toHaveCount(25);
  await expect(page.getByTestId("details-sample").locator("tbody tr").nth(3)).toContainText("Not found");
  await expect(page.getByTestId("details-link")).toHaveText("Open the KYC desk");
  await expect(page.getByTestId("details-link")).toHaveAttribute("href", "/token-console/kyc?kyc=PENDING");
});

test("Details: a target that has gone says so; an omnichannel without the read shows no section", async ({ page }) => {
  await stub(page, { details: { "AP-10001": null } });
  await page.goto("/approvals?open=AP-10001");
  await expect(page.getByTestId("details-gone")).toContainText("no longer on record");
  await page.unroute(/\/omni\/api\/operator\/approvals/);
  const sent = await stub(page);
  await page.goto("/approvals?open=AP-10001");
  await expect(page.getByTestId("approval-changes")).toBeVisible();
  await expect.poll(() => sent.some((x) => x.path === "/approvals/AP-10001/details")).toBe(true);
  await expect(page.getByTestId("approval-details")).toHaveCount(0);
});

test("a request asked again names the earlier one, in the row and the drawer, as a link that opens it", async ({ page }) => {
  const again = approval("AP-10031", { resubmitOf: "AP-10001" });
  await stub(page, { lists: { PENDING: [again] }, one: again });
  await page.goto("/approvals");
  const link = page.getByTestId("row-resubmit-of");
  await expect(link).toHaveText("Asked again after AP-10001");
  await link.click();
  await expect(page).toHaveURL(/open=AP-10001/);
  await page.goto("/approvals?open=AP-10031");
  await page.getByTestId("approval-resubmit-of").click();
  await expect(page).toHaveURL(/open=AP-10001/);
});

test("a rejected request: the checker's note first, what happens now, and Resubmit with a new reason opens the new request", async ({ page }) => {
  const sent = await stub(page, {
    one: rejected("AP-10001"),
    post: (path, body) => path.endsWith("/resubmit")
      ? { status: 202, body: approval("AP-10031", { resubmitOf: "AP-10001", reason: (body.reason as string) ?? "Market day tomorrow." }) }
      : undefined,
  });
  await page.goto("/approvals?open=AP-10001");
  const outcome = page.getByTestId("approval-outcome");
  await expect(page.getByTestId("approval-note")).toHaveText("Note: The bank slip does not show this amount.");
  expect(await outcome.evaluate((el) => el.firstElementChild?.getAttribute("data-testid"))).toBe("approval-note");
  await expect(outcome).toContainText("Rejected by staff:checker@ktda.test");
  await expect(page.getByTestId("what-now")).toHaveText("Nothing was changed on agent A-0001 (Kevin Onyango). Fix what the note asks and ask again, or leave it.");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await page.getByLabel("New reason").fill("Slip re-issued for KES 150,000.");
  await page.getByRole("button", { name: "Resubmit" }).click();
  await expect(page).toHaveURL(/open=AP-10031/);
  await expect(page.getByText("Asked again as AP-10031.")).toBeVisible();
  expect(sent.find((s) => s.method === "POST")).toMatchObject({ path: "/approvals/AP-10001/resubmit", body: { reason: "Slip re-issued for KES 150,000." } });
});

test("Resubmit with no new reason sends none; a 409 shows omnichannel's message as a toast", async ({ page }) => {
  const sent = await stub(page, {
    one: approval("AP-10001", { status: "FAILED", error: "Agent A-0001 is suspended", checker: "ktda-operator", decidedAt: new Date().toISOString() }),
    post: (path) => path.endsWith("/resubmit")
      ? { status: 409, body: envelope(409, "Request AP-10040 for agent A-0001 is still waiting", "APPROVAL_PENDING") }
      : undefined,
  });
  await page.goto("/approvals?open=AP-10001");
  await expect(page.getByTestId("what-now")).toContainText("Nothing was changed on agent A-0001");
  await page.getByRole("button", { name: "Resubmit" }).click();
  await expect(page.getByText("Request AP-10040 for agent A-0001 is still waiting")).toBeVisible();
  await expect(page).toHaveURL(/open=AP-10001/);
  expect(sent.find((s) => s.method === "POST")).toMatchObject({ path: "/approvals/AP-10001/resubmit", body: {} });
});

test("an approved request cannot be asked again; a cancelled one can", async ({ page }) => {
  await stub(page, { one: approval("AP-10001", { status: "APPROVED", checker: "ktda-operator", decidedAt: new Date().toISOString(), appliedAt: new Date().toISOString() }) });
  await page.goto("/approvals?open=AP-10001");
  await expect(page.getByTestId("approval-outcome")).toContainText("Applied");
  await expect(page.getByTestId("resubmit")).toHaveCount(0);
  await page.unroute(/\/omni\/api\/operator\/approvals/);
  await stub(page, { one: approval("AP-10001", { status: "CANCELLED", decidedAt: new Date().toISOString() }) });
  await page.goto("/approvals?open=AP-10001");
  await expect(page.getByRole("button", { name: "Resubmit" })).toBeVisible();
});

test("My requests: mine=true, its own count and a status; the banner counts this week's rejections and links there", async ({ page }) => {
  const sent = await stub(page, {
    summary: { pending: 4, decidedToday: 1, minePending: 1, mineRejected: 2 },
    lists: { PENDING, "mine:PENDING": [approval("AP-10001")], "mine:REJECTED": [rejected("AP-10007"), rejected("AP-10008")] },
  });
  await page.goto("/approvals");
  const banner = page.getByTestId("mine-rejected-banner");
  await expect(banner).toContainText("2 of your requests were rejected in the last 7 days.");
  await page.getByRole("tab", { name: /^My requests\s*1$/ }).click();
  await expect.poll(() => sent.some((s) => s.path === "/approvals" && s.query.get("mine") === "true" && s.query.get("status") === "PENDING")).toBe(true);
  await expect(page.getByTestId("approvals-table").locator("tbody tr")).toHaveCount(1);
  await banner.getByRole("link", { name: "See them in My requests" }).click();
  await expect(page).toHaveURL(/tab=BYME/);
  await expect(page).toHaveURL(/status=REJECTED/);
  await expect(page.getByLabel("Status")).toHaveValue("REJECTED");
  await expect(page.getByTestId("approvals-table").locator("tbody tr")).toHaveCount(2);
  expect(sent.some((s) => s.path === "/approvals" && s.query.get("mine") === "true" && s.query.get("status") === "REJECTED")).toBe(true);
  // The other tabs do not ask for mine.
  expect(sent.filter((s) => s.path === "/approvals" && s.query.get("mine") !== "true").every((s) => s.query.get("mine") === null)).toBe(true);
});

test("no banner when none of the caller's requests was rejected, or before v2", async ({ page }) => {
  await stub(page, { summary: { pending: 2, decidedToday: 0, minePending: 0, mineRejected: 0 } });
  await page.goto("/approvals");
  await expect(page.getByTestId("approvals-table")).toBeVisible();
  await expect(page.getByTestId("mine-rejected-banner")).toHaveCount(0);
});

/* ---- Reconciliation resolutions (omnichannel PR 152) ---- */

const RECON_RUN = "6f1c2a9e-0000-4c4c-8d8d-000000000001";
const reconRun = approval("AP-10042", {
  type: "RECONCILIATION_RESOLVE", title: "Resolve 2 exceptions in reconciliation of mpesa-paybill-2026-11-03.csv",
  target: { kind: "RECONCILIATION_RUN", reference: RECON_RUN, name: "mpesa-paybill-2026-11-03.csv" },
  changes: [{ setting: "Open exceptions in the run", now: "3", proposed: "1" }, { setting: "Note", now: "", proposed: "Settled with the channel." }],
  reason: null, payload: { runId: RECON_RUN, lineIds: ["l-3", "l-5"], note: "Settled with the channel." }, checkerRoles: [],
});
const RECON_DETAILS = {
  runId: RECON_RUN, fileName: "mpesa-paybill-2026-11-03.csv", periodFrom: "2026-11-01T21:00:00Z", periodTo: "2026-11-03T21:00:00Z", exceptionsOpen: 3,
  note: "Settled with the channel.",
  lines: [
    { id: "l-3", outcome: "LEDGER_ONLY", statementReference: null, statementAmount: null, paidAt: null, paymentReference: "KTD-RCPLEDGER", providerReference: "RCPLEDGER", paymentAmount: 1500, completedAt: "2026-11-03T08:15:20Z", currentNote: null, resolved: false },
    { id: "l-5", outcome: "AMOUNT_MISMATCH", statementReference: "RCPMISMAT", statementAmount: 1000, paidAt: "2026-11-03T08:15:00Z", paymentReference: "KTD-RCPMISMAT", providerReference: "RCPMISMAT", paymentAmount: 500, completedAt: "2026-11-03T08:15:20Z", currentNote: null, resolved: false },
  ],
};

test("a reconciliation resolution: its label, the run as the target, and both sides of each line in Details", async ({ page }) => {
  await stub(page, { lists: { PENDING: [reconRun] }, one: reconRun, details: { "AP-10042": RECON_DETAILS } });
  await page.goto("/approvals");
  await expect(page.getByTestId("approvals-table").locator("tbody tr").first()).toContainText("Reconciliation resolution");
  await page.goto("/approvals?open=AP-10042");
  const target = page.getByTestId("approval-target");
  await expect(target).toHaveText("Reconciliation run mpesa-paybill-2026-11-03.csv");
  await expect(target).toHaveAttribute("href", `/reconciliation/${RECON_RUN}`);
  const d = page.getByTestId("approval-details");
  await expect(d).toContainText("mpesa-paybill-2026-11-03.csv");
  await expect(d).toContainText("2 Nov 2026 – 3 Nov 2026");
  await expect(page.getByTestId("details-note")).toContainText("Settled with the channel.");
  const rows = page.getByTestId("details-lines").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Ledger only");
  await expect(rows.nth(0)).toContainText("RCPLEDGER");
  await expect(rows.nth(1)).toContainText("Amount mismatch");
  await expect(rows.nth(1)).toContainText("1,000.00");
  await expect(rows.nth(1)).toContainText("500.00");
  await expect(page.getByTestId("details-link")).toHaveText("Open the run");
  await expect(page.getByTestId("details-link")).toHaveAttribute("href", `/reconciliation/${RECON_RUN}`);
});

test("a one-line resolution names the line by its reference and links to its run from the payload", async ({ page }) => {
  const one = approval("AP-10043", {
    type: "RECONCILIATION_RESOLVE", title: "Resolve statement-only line RCPSTMT01 in reconciliation of mpesa-paybill-2026-11-03.csv",
    target: { kind: "RECONCILIATION_LINE", reference: "6f1c2a9e-0000-4c4c-8d8d-0000000000aa", name: "RCPSTMT01" },
    changes: [], reason: null, payload: { runId: RECON_RUN, lineIds: ["6f1c2a9e-0000-4c4c-8d8d-0000000000aa"], note: "Credited by hand." }, checkerRoles: [],
  });
  await stub(page, { lists: { PENDING: [one] }, one });
  await page.goto("/approvals?open=AP-10043");
  const target = page.getByTestId("approval-target");
  await expect(target).toHaveText("Reconciliation line RCPSTMT01");
  await expect(target).toHaveAttribute("href", `/reconciliation/${RECON_RUN}`);
});
