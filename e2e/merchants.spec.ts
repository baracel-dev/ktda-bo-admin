import { expect, test, type Page } from "@playwright/test";
import { envelope, json, rejectedRequest, signIn, stubLastRejection } from "./stubs";

/* Merchants (prototype 3.8). Reads come from the channel-api's real
 * merchants through omnichannel's /ktda/merchants passthrough, mapped to the
 * merchantsAgentsContract shape in api.merchants.ts (status and search are
 * applied in the page's client); writes go to omnichannel's own /merchants
 * register and answer the contract's Merchant. A row opens the merchant's
 * own page (/merchants/:id) with the passthrough's detail (and wallet) and
 * wallet movements; no KYB decision is taken there. Stubbed. */

type Obj = Record<string, unknown>;
const DOCS = ["CERTIFICATE_OF_REGISTRATION", "KRA_PIN_CERTIFICATE", "DIRECTOR_ID_COPIES", "BANK_LETTER"];

/** A channel-api merchant as the passthrough returns it. */
const channel = (brsNo: string, over: Obj = {}): Obj => ({
  id: `ch-${brsNo}`, name: "Kericho Agrovet", brsNo, businessType: "Sole proprietor", category: "Agro-dealer",
  kyb: "in_review", kybSubmittedAt: "2026-11-01T08:00:00Z", commissionBps: 50, walletId: "w-1", createdAt: "2026-11-01T08:00:00Z",
  tills: [{ till: "512345", outlet: "Main", town: "Kericho", label: "Main till" }], ...over,
});
const LIST = [channel("M-10200"), channel("M-10201", { name: "Litein Shop", category: "Shop", kyb: "approved", tills: [{ till: "512346", outlet: "Main", town: "Litein", label: "" }] })];

/** A merchant as omnichannel's register answers a write. */
const merchant = (reference: string, over: Obj = {}): Obj => ({
  reference, name: "Kericho Agrovet", type: "AGRO_DEALER", town: "Kericho", county: "Kericho",
  ownerName: "Test Owner", ownerPhone: "+254700000301", tillNo: "512345",
  brs: { registrationNo: reference, status: "VERIFIED", registeredName: "Kericho Agrovet", registeredType: "Private company", registeredOwner: "Test Owner", checkedAt: "2026-11-07T08:00:00Z" },
  kyb: { status: "IN_REVIEW", decidedAt: null, decidedBy: null, note: null },
  settlement: { bank: "Test Bank", accountMasked: "****1234" }, commissionRate: 0.005,
  vouchers: { accepts: true, categories: ["FERTILISER", "SEEDLINGS"] },
  documents: DOCS.map((type) => ({ type, received: true, receivedAt: "2026-11-07T08:00:00Z", reference: null })),
  sales30d: null, transactions30d: null, joinedAt: "2026-11-01T08:00:00Z", updatedAt: null, ...over,
});
/** The detail read: the list's merchant with its wallet. */
const detail = (brsNo: string, over: Obj = {}): Obj => ({
  ...channel(brsNo), wallet: { open: true, balances: [{ currency: "KES", available: 12500.5, updatedAt: "2026-11-09T09:00:00Z" }] }, ...over,
});
const movement = (n: number, over: Obj = {}): Obj => ({
  reference: `TX-${String(n).padStart(4, "0")}`, type: n % 2 ? "CREDIT" : "DEBIT", event: null, amount: 100 * n, currency: "KES",
  description: n % 2 ? "Sale at till 512345" : null, occurredAt: `2026-11-0${(n % 9) + 1}T10:00:00Z`, ...over,
});
type Answer = { status: number; body: unknown };

async function stub(page: Page, opts: {
  list?: Obj[] | Answer;
  write?: (method: string, path: string, body: Obj) => Answer | undefined;
  /** The detail read for an id; 404 by default (not on this environment). */
  detail?: (id: string) => Answer | undefined;
  /** All movements; paged here as omnichannel pages them. */
  movements?: Obj[] | Answer;
} = {}) {
  const sent: { method: string; path: string; body: unknown; query?: URLSearchParams }[] = [];
  const list = Array.isArray(opts.list) ? [...opts.list] : opts.list ?? [...LIST];
  await page.route(/\/omni\/api\/operator\/(ktda\/)?merchants/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    const write = req.method() === "POST" || req.method() === "PUT";
    const body = write ? (req.postDataJSON() as Obj) : null;
    sent.push({ method: req.method(), path, body, query: url.searchParams });
    if (path === "/ktda/merchants") return Array.isArray(list) ? json(route, list) : json(route, list.body, list.status);
    const one = /^\/ktda\/merchants\/([^/]+)$/.exec(path);
    if (one && !write) {
      const a = opts.detail?.(decodeURIComponent(one[1])) ?? { status: 404, body: envelope(404, "Not Found") };
      return json(route, a.body, a.status);
    }
    if (/^\/ktda\/merchants\/[^/]+\/movements$/.test(path)) {
      const m = opts.movements ?? { status: 404, body: envelope(404, "Not Found") };
      if (!Array.isArray(m)) return json(route, m.body, m.status);
      const p = Number(url.searchParams.get("page")) || 1;
      const size = Number(url.searchParams.get("size")) || 20;
      const items = m.slice((p - 1) * size, p * size);
      return route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify(items),
        headers: { "X-Total-Count": String(m.length), "X-Page": String(p), "X-Size": String(size), "X-Total-Pages": String(Math.max(1, Math.ceil(m.length / size))) },
      });
    }
    if (write) {
      const a = opts.write?.(req.method(), path, body!) ?? { status: path === "/merchants" ? 201 : 200, body: merchant("M-10200") };
      return json(route, a.body, a.status);
    }
    return json(route, envelope(404, "Not stubbed"), 404);
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("tiles and tab counts from the merchants, the table, and sales not yet measured", async ({ page }) => {
  await stub(page);
  await page.goto("/merchants");
  await expect(page.getByRole("heading", { name: "Merchants", level: 1 })).toBeVisible();
  const tiles = page.getByTestId("merchant-tiles");
  await expect(tiles).toContainText("Approved merchants1");
  await expect(tiles).toContainText("Waiting for KYB1");
  await expect(tiles).toContainText("Sales in the last 30 daysNot yet measured");
  for (const [name, n] of [["All", 2], ["In review", 1], ["Needs documents", 0], ["Approved", 1], ["Rejected", 0]] as const) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${name}\\s*${n}$`) })).toBeVisible();
  }
  const rows = page.getByTestId("merchants-table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Agro-dealer · Kericho");
  await expect(rows.nth(0)).toContainText("Not yet measured");
  await expect(rows.nth(1)).toContainText("Shop · Litein");
  await page.getByRole("tab", { name: /^Approved/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Litein Shop");
});

test("a tab chosen while the search is still waiting is kept", async ({ page }) => {
  await stub(page);
  await page.goto("/merchants");
  // Typed, then the tab picked before the search's pause is over.
  await page.getByPlaceholder("Name, town, owner or till").fill("Litein");
  await page.getByRole("tab", { name: /^Approved/ }).click();
  await expect(page).toHaveURL(/status=APPROVED/);
  await expect(page).toHaveURL(/q=Litein/);
  const rows = page.getByTestId("merchants-table").locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Litein Shop");
  await expect(page).toHaveURL(/status=APPROVED/);
});

test("register a merchant: the body follows the contract", async ({ page }) => {
  const sent = await stub(page, { write: () => ({ status: 201, body: merchant("M-10300", { name: "Kapkatet Agrovet" }) }) });
  await page.goto("/merchants");
  await page.getByRole("button", { name: "Register merchant" }).click();
  const fill = async (label: string, v: string) => page.getByLabel(label, { exact: true }).fill(v);
  await fill("Business name", "Kapkatet Agrovet");
  await page.getByLabel("Type").selectOption("AGRO_DEALER");
  await fill("Registration no.", "PVT-XY0000");
  await fill("Till number", "512399");
  await fill("Town", "Kapkatet");
  await fill("County", "Kericho");
  await fill("Owner name", "Test Owner Two");
  await fill("Owner phone", "0700000302");
  await fill("Settlement bank", "Test Bank");
  await fill("Settlement account", "0011223344");
  await fill("Commission % per sale (optional)", "0.5");
  await page.getByText("Accepts input vouchers").click();
  await page.getByText("Fertiliser", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Register", exact: true }).click();
  // The register's answer opens that merchant's page.
  await expect(page).toHaveURL(/\/merchants\/M-10300$/);
  const post = sent.find((s) => s.method === "POST")!;
  expect(post.path).toBe("/merchants");
  expect(post.body).toEqual({
    name: "Kapkatet Agrovet", type: "AGRO_DEALER", town: "Kapkatet", county: "Kericho", ownerName: "Test Owner Two", ownerPhone: "0700000302",
    tillNo: "512399", registrationNo: "PVT-XY0000", settlement: { bank: "Test Bank", account: "0011223344" }, commissionRate: 0.005,
    vouchers: { accepts: true, categories: ["FERTILISER"] },
  });
});

test("accepting vouchers needs a category; all six are offered", async ({ page }) => {
  await stub(page);
  await page.goto("/merchants");
  await page.getByRole("button", { name: "Register merchant" }).click();
  for (const [l, v] of [["Business name", "X"], ["Registration no.", "PVT-1"], ["Till number", "512345"], ["Town", "T"], ["County", "C"], ["Owner name", "O"], ["Owner phone", "0700000303"], ["Settlement bank", "B"], ["Settlement account", "1"]]) {
    await page.getByLabel(l, { exact: true }).fill(v);
  }
  await page.getByText("Accepts input vouchers").click();
  for (const c of ["Fertiliser", "Seedlings", "Agrochemicals", "Farm tools", "Animal feed", "Fuel"]) await expect(page.getByText(c, { exact: true })).toBeVisible();
  await expect(page.getByTestId("form-problem")).toContainText("Choose at least one voucher category");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Register", exact: true })).toBeDisabled();
  await page.getByText("Farm tools", { exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Register", exact: true })).toBeEnabled();
});

test("a till already taken shows omnichannel's message", async ({ page }) => {
  await stub(page, { write: () => ({ status: 409, body: envelope(409, "Till 512345 is already another merchant's", "MERCHANT_TILL_TAKEN") }) });
  await page.goto("/merchants");
  await page.getByRole("button", { name: "Register merchant" }).click();
  for (const [l, v] of [["Business name", "X"], ["Registration no.", "PVT-1"], ["Till number", "512345"], ["Town", "T"], ["County", "C"], ["Owner name", "O"], ["Owner phone", "0700000303"], ["Settlement bank", "B"], ["Settlement account", "1"]]) {
    await page.getByLabel(l, { exact: true }).fill(v);
  }
  await page.getByRole("dialog").getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText("Till 512345 is already another merchant's")).toBeVisible();
});

test("an omnichannel without the merchants passthrough says so", async ({ page }) => {
  await stub(page, { list: { status: 404, body: envelope(404, "Not Found") } });
  await page.goto("/merchants");
  await expect(page.getByTestId("not-available")).toContainText("Not available on this environment yet");
  await expect(page.getByRole("button", { name: "Register merchant" })).toHaveCount(0);
});

test("Merchants and Agents are in the People menu", async ({ page }) => {
  await stub(page);
  await page.goto("/");
  const menu = page.locator("aside").first();
  await menu.getByRole("button", { name: "People", exact: true }).click();
  await expect(menu.getByRole("link", { name: "Merchants", exact: true })).toHaveAttribute("href", "/merchants");
  await expect(menu.getByRole("link", { name: "Agents", exact: true })).toHaveAttribute("href", "/agents");
});

test("a row opens the merchant's page: header, tiles, details, tills, and the transaction history", async ({ page }) => {
  const sent = await stub(page, {
    detail: (id) => (id === "ch-M-10200" ? { status: 200, body: detail("M-10200") } : undefined),
    movements: [movement(1), movement(2, { amount: 250 })],
  });
  await page.goto("/merchants");
  await page.getByTestId("merchants-table").getByText("Kericho Agrovet").click();
  await expect(page).toHaveURL(/\/merchants\/ch-M-10200$/);
  const profile = page.getByTestId("merchant-profile");
  await expect(profile.getByRole("heading", { name: "Kericho Agrovet", level: 1 })).toBeVisible();
  await expect(profile).toContainText("Merchant · M-10200");
  await expect(profile).toContainText("Sole proprietor · Agro-dealer · since");
  await expect(profile).toContainText("KYB: In review");
  const tiles = page.getByTestId("merchant-tiles");
  await expect(page.getByTestId("wallet-balance")).toContainText("KES 12,500.50");
  await expect(tiles).toContainText("Tills1");
  await expect(tiles).toContainText("0.50%");
  const details = page.getByTestId("merchant-details");
  for (const t of ["M-10200", "Sole proprietor", "Agro-dealer", "w-1"]) await expect(details).toContainText(t);
  await expect(page.getByTestId("tills")).toContainText("512345");
  await expect(page.getByTestId("tills")).toContainText("Main till");
  const moves = page.getByTestId("movements");
  await expect(moves.locator("tbody tr")).toHaveCount(2);
  await expect(moves).toContainText("Sale at till 512345");
  await expect(moves).toContainText("+KES 100.00");
  await expect(moves).toContainText("−KES 250.00");
  const read = sent.find((x) => x.path.endsWith("/movements"))!;
  expect(read.query!.get("currency")).toBe("KES");
  expect(read.query!.get("page")).toBe("1");
  // Read-only: no KYB decision or edit here, and no drawer.
  for (const b of ["Approve", "Reject", "Needs documents", "Edit details"]) await expect(page.getByRole("button", { name: b })).toHaveCount(0);
  await expect(page.getByTestId("merchant-drawer")).toHaveCount(0);
  expect(sent.some((x) => x.method !== "GET")).toBe(false);
});

test("the transaction history pages like the farmer's", async ({ page }) => {
  await stub(page, {
    detail: () => ({ status: 200, body: detail("M-10200") }),
    movements: Array.from({ length: 25 }, (_, i) => movement(i + 1)),
  });
  await page.goto("/merchants/ch-M-10200");
  const rows = page.getByTestId("movements").locator("tbody tr");
  await expect(rows).toHaveCount(20);
  await expect(page.getByText("25 movements · page 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(5);
  await expect(page.getByText("25 movements · page 2 of 2")).toBeVisible();
});

test("no movements yet, and a wallet the accounting core does not know", async ({ page }) => {
  await stub(page, { detail: () => ({ status: 200, body: detail("M-10200") }), movements: [] });
  await page.goto("/merchants/ch-M-10200");
  await expect(page.getByTestId("movements-empty")).toHaveText("No movements yet.");

  await page.unroute(/\/omni\/api\/operator\/(ktda\/)?merchants/);
  await stub(page, { detail: () => ({ status: 200, body: detail("M-10200", { wallet: { open: false, balances: [] } }) }) });
  await page.reload();
  await expect(page.getByTestId("wallet-balance")).toContainText("No wallet");
  await expect(page.getByTestId("wallet-none")).toBeVisible();
});

test("an omnichannel without the detail read: the list's fields, and the wallet not available", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/merchants/ch-M-10201");
  const profile = page.getByTestId("merchant-profile");
  await expect(profile.getByRole("heading", { name: "Litein Shop", level: 1 })).toBeVisible();
  await expect(profile).toContainText("KYB: Approved");
  await expect(page.getByTestId("wallet-balance")).toContainText("Not available");
  await expect(page.getByTestId("wallet-not-available")).toContainText("Wallet not available on this environment yet");
  await expect(page.getByTestId("tills")).toContainText("512346");
  // Nothing asked of a movements read that is not there.
  expect(sent.some((x) => x.path.endsWith("/movements"))).toBe(false);
});

test("a merchant that is not this institution's, and an older ?focus= link", async ({ page }) => {
  await stub(page, { detail: (id) => (id === "ch-M-10200" ? { status: 200, body: detail("M-10200") } : undefined) });
  await page.goto("/merchants/ch-M-99999");
  await expect(page.getByTestId("merchant-not-found")).toContainText("No merchant ch-M-99999");
  // A link by BRS number (the old drawer's) opens the merchant's page.
  await page.goto("/merchants?focus=M-10200");
  await expect(page).toHaveURL(/\/merchants\/M-10200$/);
  await expect(page.getByTestId("merchant-profile").getByRole("heading", { name: "Kericho Agrovet", level: 1 })).toBeVisible();
  await expect(page.getByTestId("wallet-balance")).toContainText("KES 12,500.50");
});

test("the merchant's page shows the last refused change, by its reference, with the checker's note", async ({ page }) => {
  await stub(page, { detail: (id) => (id === "ch-M-10200" ? { status: 200, body: detail("M-10200") } : undefined) });
  const asked = await stubLastRejection(page, "M-10200", rejectedRequest("AP-10015", { kind: "MERCHANT", reference: "M-10200", name: "Kericho Agrovet" }, "Change settlement of merchant M-10200", "No bank letter for the new account."));
  await page.goto("/merchants/ch-M-10200");
  await expect(page.getByTestId("last-rejection")).toContainText("Last change refused: Change settlement of merchant M-10200");
  await expect(page.getByTestId("last-rejection-note")).toHaveText("No bank letter for the new account.");
  await expect(page.getByTestId("last-rejection-link")).toHaveAttribute("href", "/approvals?open=AP-10015");
  expect(asked.some((q) => q.get("target") === "M-10200" && q.get("status") === "REJECTED")).toBe(true);
});
