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

async function stub(page: Page, opts: { lists?: Record<string, Obj[]>; one?: Obj | null; post?: (path: string, body: Obj) => Answer | undefined; unavailable?: boolean } = {}) {
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
      const items = (opts.lists ?? { PENDING })[url.searchParams.get("status") ?? "PENDING"] ?? [];
      return route.fulfill({ status: 200, contentType: "application/json", headers: headers(items.length), body: JSON.stringify(items) });
    }
    if (path === "/approvals/summary") return json(route, { pending: 2, decidedToday: 5 });
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
