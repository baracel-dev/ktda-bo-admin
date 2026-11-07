import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* Agents (prototype 3.9) on omnichannel's /agents (merchantsAgentsContract.ts):
 * tiles, tabs with counts, search, the float bar, suspend with a reason,
 * reinstate, the register form, and the drawer (?focus=) with a top-up, a
 * "record activity" form and the activities list. Stubbed. */

type Obj = Record<string, unknown>;
const agent = (agentNo: string, over: Obj = {}): Obj => ({
  agentNo, fullName: "Test Agent One", phone: "+254700000401", town: "Kericho", status: "ACTIVE",
  float: { balance: 150000, limit: 200000, low: false }, today: { transactions: 7 }, onboardedThisMonth: 12, commissionThisMonth: 840.5,
  suspension: null, createdAt: "2026-11-01T08:00:00Z", updatedAt: null, ...over,
});
const LOW = agent("A-0043", { fullName: "Test Agent Two", town: "Litein", status: "LOW_FLOAT", float: { balance: 20000, limit: 200000, low: true } });
const SUMMARY = { active: 5, lowFloat: 2, suspended: 1, onboardedThisMonth: 40, commissionThisMonth: 3200 };
const ACTIVITY = { id: "act-1", type: "CASH_IN", amount: 2500, commission: 12.5, growerNo: "TEST000011", reference: "AG-REF-1", floatAfter: 147500, occurredAt: "2026-11-07T09:00:00Z", recordedBy: "officer@ktda.test" };
const approval = (over: Obj = {}): Obj => ({
  id: "ap-1", reference: "AP-10001", type: "AGENT_FLOAT_TOP_UP", title: "Top up float of agent A-0042 by KES 50,000.00",
  target: { kind: "AGENT", reference: "A-0042", name: "Test Agent One" }, changes: [], reason: null, payload: {}, status: "PENDING",
  maker: "ktda-operator", madeAt: "2026-11-07T10:00:00Z", checker: null, decidedAt: null, decisionNote: null, appliedAt: null, error: null, checkerRoles: ["ADMIN"], ...over,
});
type Answer = { status: number; body: unknown };
const headers = (n: number) => ({ "X-Total-Count": String(n), "X-Page": "1", "X-Size": "20", "X-Total-Pages": "1" });

async function stub(page: Page, opts: { list?: Obj[] | Answer; summary?: Answer; one?: Obj | null; activities?: Obj[]; post?: (path: string, body: Obj) => Answer | undefined } = {}) {
  const sent: { method: string; path: string; query: URLSearchParams; body: unknown }[] = [];
  const one = opts.one === undefined ? agent("A-0042") : opts.one;
  await page.route(/\/omni\/api\/operator\/agents/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    const body = req.method() === "POST" ? (req.postDataJSON() as Obj) : null;
    sent.push({ method: req.method(), path, query: url.searchParams, body });
    if (req.method() === "POST") {
      const a = opts.post?.(path, body!) ?? { status: path === "/agents" ? 201 : 200, body: path.endsWith("/activities") ? ACTIVITY : one };
      return json(route, a.body, a.status);
    }
    if (path === "/agents") {
      const l = opts.list ?? [agent("A-0042"), LOW];
      if (!Array.isArray(l)) return json(route, l.body, l.status);
      return route.fulfill({ status: 200, contentType: "application/json", headers: headers(l.length), body: JSON.stringify(l) });
    }
    if (path === "/agents/summary") { const a = opts.summary ?? { status: 200, body: SUMMARY }; return json(route, a.body, a.status); }
    if (path.endsWith("/activities")) {
      const items = opts.activities ?? [ACTIVITY];
      return route.fulfill({ status: 200, contentType: "application/json", headers: headers(items.length), body: JSON.stringify(items) });
    }
    return one ? json(route, one) : json(route, envelope(404, "No such agent"), 404);
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("tiles, tabs with counts, and the float bar red when low", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
  const tiles = page.getByTestId("agent-tiles");
  // `active` already counts the low-float agents.
  await expect(tiles).toContainText("Active agents5");
  await expect(tiles).toContainText("2 of them low on float");
  await expect(tiles).toContainText("Low on float2");
  await expect(tiles).toContainText("Below 25% of their limit");
  await expect(tiles).toContainText("Onboarded this month40");
  await expect(tiles).toContainText("KES 3,200.00");
  for (const [name, n] of [["All", 6], ["Low float", 2], ["Suspended", 1]] as const) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${name}\\s*${n}$`) })).toBeVisible();
  }
  const rows = page.getByTestId("agents-table").locator("tbody tr");
  await expect(rows.nth(0)).toContainText("A-0042 · Kericho");
  await expect(rows.nth(0).getByTestId("float")).toContainText("150,000.00 of 200.0K");
  await expect(rows.nth(0).locator("[data-low]")).toHaveAttribute("data-low", "false");
  await expect(rows.nth(1).locator("[data-low]")).toHaveAttribute("data-low", "true");
  await expect(rows.nth(1)).toContainText("Low float");
  await page.getByRole("tab", { name: /^Suspended/ }).click();
  await page.getByPlaceholder("Name, agent no. or town").fill("Litein");
  await expect.poll(() => sent.some((s) => s.path === "/agents" && s.query.get("status") === "SUSPENDED" && s.query.get("q") === "Litein")).toBe(true);
});

test("suspend asks for a reason; reinstate a suspended agent", async ({ page }) => {
  const sent = await stub(page, {
    list: [agent("A-0042"), agent("A-0044", { fullName: "Test Agent Three", status: "SUSPENDED", suspension: { reason: "Float shortfall", at: "2026-11-06T08:00:00Z", by: "officer@ktda.test" } })],
  });
  await page.goto("/agents");
  const rows = page.getByTestId("agents-table").locator("tbody tr");
  await rows.nth(0).getByRole("button", { name: "Suspend" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Suspend", exact: true })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Cash count did not agree.");
  await dialog.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(page.getByText("Test Agent One is suspended.")).toBeVisible();
  await rows.nth(1).getByRole("button", { name: "Reinstate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reinstate", exact: true }).click();
  await expect(page.getByText("Test Agent Three is reinstated.")).toBeVisible();
  const posts = sent.filter((s) => s.method === "POST");
  expect(posts.map((s) => [s.path, s.body])).toEqual([["/agents/A-0042/suspend", { reason: "Cash count did not agree." }], ["/agents/A-0044/reinstate", {}]]);
});

test("the drawer at ?focus=: details, top up, record a cash in, and the activities", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/agents");
  await page.getByTestId("agents-table").getByText("Test Agent One").click();
  await expect(page).toHaveURL(/focus=A-0042/);
  const drawer = page.getByTestId("agent-drawer");
  await expect(drawer).toContainText("7 transactions");
  const acts = page.getByTestId("activities");
  await expect(acts).toContainText("Cash in · TEST000011");
  await expect(acts).toContainText("147,500.00");

  const topUp = page.getByTestId("top-up");
  await topUp.getByLabel("Top-up amount").fill("50000");
  await topUp.getByLabel("Top-up reference").fill("BANK-REF-9");
  await topUp.getByRole("button", { name: "Top up" }).click();
  await expect(page.getByText("Float topped up by KES 50,000.00.")).toBeVisible();

  const rec = page.getByTestId("record-activity");
  await rec.getByLabel("Activity type").selectOption("CASH_IN");
  await expect(rec.getByRole("button", { name: "Record" })).toBeDisabled();
  await rec.getByLabel("Activity amount").fill("2500");
  await rec.getByLabel("Grower number").fill("TEST000011");
  await rec.getByLabel("Activity reference").fill("AG-REF-2");
  await rec.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("Cash in recorded.")).toBeVisible();

  await rec.getByLabel("Activity type").selectOption("ONBOARDING");
  await expect(rec.getByLabel("Activity amount")).toHaveCount(0);
  await rec.getByLabel("Activity reference").fill("AG-REF-3");
  await rec.getByRole("button", { name: "Record" }).click();

  const posts = sent.filter((s) => s.method === "POST");
  expect(posts.map((s) => [s.path, s.body])).toEqual([
    ["/agents/A-0042/float/top-up", { amount: 50000, reference: "BANK-REF-9" }],
    ["/agents/A-0042/activities", { type: "CASH_IN", reference: "AG-REF-2", amount: 2500, growerNo: "TEST000011" }],
    ["/agents/A-0042/activities", { type: "ONBOARDING", reference: "AG-REF-3" }],
  ]);
});

test("a top-up sent for approval says so, with the reason, and reloads nothing", async ({ page }) => {
  const sent = await stub(page, { post: (path, body) => path.endsWith("/float/top-up") ? { status: 202, body: { approval: approval({ reason: body.reason }) } } : undefined });
  await page.goto("/agents?focus=A-0042");
  const topUp = page.getByTestId("top-up");
  await topUp.getByLabel("Top-up amount").fill("50000");
  await topUp.getByLabel("Top-up reference").fill("BANK-REF-9");
  await topUp.getByLabel("Top-up reason").fill("Market day tomorrow.");
  const reads = sent.filter((s) => s.method === "GET").length;
  await topUp.getByRole("button", { name: "Top up" }).click();
  await expect(topUp.getByTestId("sent-for-approval")).toContainText("Sent for approval AP-10001");
  await expect(topUp.getByRole("link", { name: "Approvals" })).toHaveAttribute("href", "/approvals?open=AP-10001");
  await expect(page.getByText("Float topped up")).toHaveCount(0);
  expect(sent.find((s) => s.path.endsWith("/float/top-up"))!.body).toEqual({ amount: 50000, reference: "BANK-REF-9", reason: "Market day tomorrow." });
  expect(sent.filter((s) => s.method === "GET").length).toBe(reads);
});

test("a suspension sent for approval says so in the modal", async ({ page }) => {
  await stub(page, { post: (path) => path.endsWith("/suspend") ? { status: 202, body: { approval: approval({ reference: "AP-10003", type: "AGENT_SUSPEND", title: "Suspend agent A-0042" }) } } : undefined });
  await page.goto("/agents");
  await page.getByTestId("agents-table").locator("tbody tr").nth(0).getByRole("button", { name: "Suspend" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Cash count did not agree.");
  await dialog.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(page.getByTestId("sent-for-approval")).toContainText("Sent for approval AP-10003");
  await expect(page.getByText("is suspended.")).toHaveCount(0);
});

test("a top-up while one is waiting (APPROVAL_PENDING) links to the open request", async ({ page }) => {
  await stub(page, { post: (path) => path.endsWith("/float/top-up") ? { status: 409, body: envelope(409, "A top-up for A-0042 is already waiting: AP-10001", "APPROVAL_PENDING") } : undefined });
  await page.goto("/agents?focus=A-0042");
  const topUp = page.getByTestId("top-up");
  await topUp.getByLabel("Top-up amount").fill("1000");
  await topUp.getByLabel("Top-up reference").fill("BANK-REF-10");
  await topUp.getByRole("button", { name: "Top up" }).click();
  await expect(topUp.getByTestId("approval-ref-link")).toHaveAttribute("href", "/approvals?open=AP-10001");
});

test("a cash in the float cannot cover shows omnichannel's reason", async ({ page }) => {
  await stub(page, { post: (path) => path.endsWith("/activities") ? { status: 409, body: envelope(409, "Float too low for this cash in", "AGENT_FLOAT_INSUFFICIENT") } : undefined });
  await page.goto("/agents?focus=A-0042");
  const rec = page.getByTestId("record-activity");
  await rec.getByLabel("Activity amount").fill("999999");
  await rec.getByLabel("Activity reference").fill("AG-REF-4");
  await rec.getByRole("button", { name: "Record" }).click();
  await expect(rec.getByText("Float too low for this cash in")).toBeVisible();
});

test("a suspended agent shows why, and has no top-up or record forms", async ({ page }) => {
  await stub(page, { one: agent("A-0044", { status: "SUSPENDED", suspension: { reason: "Float shortfall", at: "2026-11-06T08:00:00Z", by: "officer@ktda.test" } }), activities: [] });
  await page.goto("/agents?focus=A-0044");
  await expect(page.getByTestId("suspension")).toContainText("Float shortfall");
  await expect(page.getByTestId("top-up")).toHaveCount(0);
  await expect(page.getByTestId("record-activity")).toHaveCount(0);
  await expect(page.getByTestId("activities-empty")).toBeVisible();
});

test("register an agent: the body follows the contract and the drawer opens on it", async ({ page }) => {
  const sent = await stub(page, { post: (path) => path === "/agents" ? { status: 201, body: agent("A-0050", { fullName: "Test Agent Four", float: { balance: 0, limit: 100000, low: true } }) } : undefined });
  await page.goto("/agents");
  await page.getByRole("button", { name: "Register agent" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Test Agent Four");
  await page.getByLabel("Phone", { exact: true }).fill("0700000404");
  await page.getByLabel("Town", { exact: true }).fill("Bomet");
  await page.getByLabel("Float limit (KES)").fill("100000");
  await page.getByRole("dialog").getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/focus=A-0050/);
  expect(sent.find((s) => s.method === "POST")!.body).toEqual({ fullName: "Test Agent Four", phone: "0700000404", town: "Bomet", floatLimit: 100000 });
});

test("an agent number already taken shows omnichannel's message", async ({ page }) => {
  await stub(page, { post: () => ({ status: 409, body: envelope(409, "Agent number A-0042 is taken", "AGENT_NO_TAKEN") }) });
  await page.goto("/agents");
  await page.getByRole("button", { name: "Register agent" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("X");
  await page.getByLabel("Phone", { exact: true }).fill("0700000405");
  await page.getByLabel("Town", { exact: true }).fill("T");
  await page.getByLabel("Float limit (KES)").fill("1000");
  await page.getByLabel("Agent no. (optional)").fill("A-0042");
  await page.getByRole("dialog").getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText("Agent number A-0042 is taken")).toBeVisible();
});

test("an omnichannel without agents says so", async ({ page }) => {
  await stub(page, { list: { status: 404, body: envelope(404, "Not Found") }, summary: { status: 404, body: envelope(404, "Not Found") } });
  await page.goto("/agents");
  await expect(page.getByTestId("not-available")).toContainText("Not available on this environment yet");
});

test("an agent number that is not this institution's", async ({ page }) => {
  await stub(page, { one: null });
  await page.goto("/agents?focus=A-9999");
  await expect(page.getByTestId("agent-not-found")).toContainText("No agent A-9999");
});
