import { expect, test, type Page, type Route } from "@playwright/test";
import { envelope, json, rejectedRequest, signIn, stubLastRejection } from "./stubs";

/* A farmer's profile and wallet (FarmerDetail), all from omnichannel:
 * GET /farmers/{growerNo}, /farmers/{growerNo}/wallet and
 * /farmers/{growerNo}/wallet/movements (paged by the X-Total-* headers).
 * Stubbed; nothing goes to the engine directly. */

type Obj = Record<string, unknown>;
const farmer = (growerNo: string, status: string, over: Obj = {}): Obj => ({
  growerNo, fullName: "Test Farmer One", phone: "+254700000101", factory: "Test Factory A", status,
  registeredAt: "2026-11-06T08:00:00Z", activatedAt: status === "REGISTERED" ? null : "2026-11-06T09:00:00Z",
  lastFundedAt: status === "FUNDED" ? "2026-11-06T10:00:00Z" : null, customerId: null, ...over,
});
const open = (available: number): Obj => ({ growerNo: "TEST000001", status: "FUNDED", walletOpen: true, balances: [{ currency: "KES", available, updatedAt: "2026-11-06T10:05:00Z" }] });
const MOVES = [
  { reference: "PAY-OCT-0001", type: "CREDIT", event: "CASH_DEPOSIT", amount: 4250.5, currency: "KES", description: "October tea payment", occurredAt: "2026-11-06T10:00:00Z" },
  { reference: "TRF-0002", type: "DEBIT", event: "CASH_TRANSFER", amount: 250, currency: "KES", description: null, occurredAt: "2026-11-05T10:00:00Z" },
  { reference: "PAY-SEP-0001", type: "CREDIT", event: "CASH_DEPOSIT", amount: 1000, currency: "KES", description: "September tea payment", occurredAt: "2026-10-06T10:00:00Z" },
];
type Answer = { status: number; body: unknown; headers?: Record<string, string> };
const answer = (route: Route, a: Answer) => route.fulfill({ status: a.status, contentType: "application/json", headers: a.headers, body: JSON.stringify(a.body) });
const paged = (items: Obj[], total = items.length, page = 1, size = 20): Answer => ({
  status: 200, body: items,
  headers: { "X-Total-Count": String(total), "X-Page": String(page), "X-Size": String(size), "X-Total-Pages": String(Math.max(1, Math.ceil(total / size))) },
});
const NO_ENDPOINT: Answer = { status: 404, body: envelope(404, "Not Found") };

async function stub(page: Page, opts: { farmer?: Obj | null; wallet?: Answer; moves?: Answer | ((q: URLSearchParams) => Answer) } = {}) {
  const sent: { path: string; query: URLSearchParams }[] = [];
  const tok: string[] = [];
  page.on("request", (r) => { if (/\/tok\/accounting\/investors\//.test(r.url())) tok.push(r.url()); });
  await page.route(/\/omni\/api\/operator\/farmers\/[^?]+(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    sent.push({ path, query: url.searchParams });
    if (path.endsWith("/wallet/movements")) {
      const m = opts.moves ?? paged(MOVES);
      return answer(route, typeof m === "function" ? m(url.searchParams) : m);
    }
    if (path.endsWith("/wallet")) return answer(route, opts.wallet ?? { status: 200, body: open(5000.5) });
    const f = opts.farmer === undefined ? farmer("TEST000001", "FUNDED") : opts.farmer;
    return f ? json(route, f) : answer(route, { status: 404, body: envelope(404, "No such farmer") });
  });
  return { sent, tok };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("a funded farmer: details, wallet balance, last credit and every movement, all from omnichannel", async ({ page }) => {
  const { sent, tok } = await stub(page);
  await page.goto("/farmers/TEST000001");
  const profile = page.getByTestId("farmer-profile");
  await expect(profile.getByRole("heading", { name: "Test Farmer One", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("FarmersTEST000001");
  const details = page.getByTestId("farmer-details");
  for (const t of ["TEST000001", "+254700000101", "Test Factory A", "Funded"]) await expect(details).toContainText(t);

  await expect(page.getByTestId("wallet-available")).toContainText("KES 5,000.50");
  await expect(profile).toContainText("KES 4,250.50");
  const rows = page.getByTestId("wallet-activity").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("October tea payment");
  await expect(rows.nth(0)).toContainText("+KES 4,250.50");
  await expect(rows.nth(1)).toContainText("Money out");
  await expect(rows.nth(1)).toContainText("−KES 250.00");

  const read = sent.find((s) => s.path === "/farmers/TEST000001/wallet/movements")!;
  expect(read.query.get("currency")).toBe("KES");
  expect(read.query.get("page")).toBe("1");
  expect(sent.some((s) => s.path === "/farmers/TEST000001/wallet")).toBe(true);
  expect(tok).toEqual([]);
  await expect(page.getByTestId("customer-desk-link")).toHaveCount(0);
});

test("the movements page through the X-Total-* headers", async ({ page }) => {
  const { sent } = await stub(page, { moves: (q) => paged(MOVES, 45, Number(q.get("page")), 20) });
  await page.goto("/farmers/TEST000001");
  await expect(page.getByText("45 movements · page 1 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("45 movements · page 2 of 3")).toBeVisible();
  await expect.poll(() => sent.some((s) => s.path.endsWith("/wallet/movements") && s.query.get("page") === "2")).toBe(true);
});

test("a registered farmer has no wallet yet, and no movements are asked for", async ({ page }) => {
  const { sent } = await stub(page, {
    farmer: farmer("TEST000003", "REGISTERED"),
    wallet: { status: 200, body: { growerNo: "TEST000003", status: "REGISTERED", walletOpen: false, balances: [] } },
  });
  await page.goto("/farmers/TEST000003");
  await expect(page.getByTestId("wallet-none")).toContainText("opens when the farmer finishes onboarding");
  await expect(page.getByTestId("farmer-details")).toContainText("Registered");
  expect(sent.some((s) => s.path.endsWith("/wallet/movements"))).toBe(false);
});

test("an activated farmer with an empty wallet", async ({ page }) => {
  await stub(page, { farmer: farmer("TEST000002", "ACTIVATED"), wallet: { status: 200, body: open(0) }, moves: paged([]) });
  await page.goto("/farmers/TEST000002");
  await expect(page.getByTestId("wallet-available")).toContainText("KES 0.00");
  await expect(page.getByTestId("wallet-activity-empty")).toBeVisible();
  await expect(page.getByTestId("farmer-profile")).toContainText("None yet");
});

test("a farmer with an omnichannel profile links to the Customer desk", async ({ page }) => {
  const id = "44444444-4444-4444-8444-444444444444";
  await stub(page, { farmer: farmer("TEST000001", "FUNDED", { customerId: id }) });
  await page.goto("/farmers/TEST000001");
  await expect(page.getByTestId("customer-desk-link")).toHaveAttribute("href", `/token-console/customers?q=${id}`);
});

test("a grower number not in this institution", async ({ page }) => {
  await stub(page, { farmer: null });
  await page.goto("/farmers/OTHER0001");
  await expect(page.getByTestId("farmer-not-found")).toContainText("No farmer with grower number OTHER0001");
});

test("an omnichannel without the wallet read: the record shows, the wallet says not available", async ({ page }) => {
  await stub(page, { wallet: NO_ENDPOINT });
  await page.goto("/farmers/TEST000001");
  await expect(page.getByTestId("wallet-not-available")).toBeVisible();
  await expect(page.getByTestId("farmer-details")).toContainText("Test Factory A");
});

test("a wallet read that fails shows the error with a retry", async ({ page }) => {
  await stub(page, { wallet: { status: 500, body: envelope(500, "ledger down") } });
  await page.goto("/farmers/TEST000001");
  await expect(page.getByText("Could not load the wallet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a row in the farmers list opens that farmer's profile", async ({ page }) => {
  await stub(page);
  await page.route(/\/omni\/api\/operator\/farmers(\?.*)?$/, (route) => json(route, [farmer("TEST000001", "FUNDED")]));
  await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => json(route, { registered: 0, activated: 0, funded: 1, total: 1 }));
  await page.goto("/farmers");
  await expect(page.getByRole("link", { name: "TEST000001" })).toHaveAttribute("href", "/farmers/TEST000001");
  await page.getByTestId("farmers-table").getByText("Test Factory A").click();
  await expect(page).toHaveURL(/\/farmers\/TEST000001$/);
  await expect(page.getByTestId("wallet-available")).toBeVisible();
});

test("the last refused change for the farmer shows with the checker's note and a link to it", async ({ page }) => {
  await stub(page);
  const asked = await stubLastRejection(page, "TEST000001", { ...rejectedRequest("AP-10012", { kind: "FARMER", reference: "TEST000001", name: "Test Farmer One" }, "Verify farmer TEST000001 despite registry MISMATCH", "The ID photo is not readable."), type: "FARMER_KYC_OVERRIDE" });
  await page.goto("/farmers/TEST000001");
  const note = page.getByTestId("last-rejection");
  await expect(note).toContainText("Last change refused: Verify farmer TEST000001 despite registry MISMATCH");
  await expect(note).toContainText("staff:checker@ktda.test rejected it");
  await expect(page.getByTestId("last-rejection-note")).toHaveText("The ID photo is not readable.");
  await expect(page.getByTestId("last-rejection-link")).toHaveAttribute("href", "/approvals?open=AP-10012");
  const q = asked.find((x) => x.get("target") === "TEST000001")!;
  expect(q.get("status")).toBe("REJECTED");
  expect(q.get("size")).toBe("1");
});

test("no note when nothing for the farmer was refused", async ({ page }) => {
  await stub(page);
  const asked = await stubLastRejection(page, "TEST000001", null);
  await page.goto("/farmers/TEST000001");
  await expect(page.getByTestId("farmer-details")).toBeVisible();
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  await expect(page.getByTestId("last-rejection")).toHaveCount(0);
});
