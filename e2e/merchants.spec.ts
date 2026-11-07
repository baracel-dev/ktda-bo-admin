import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn, STAFF } from "./stubs";

/* Merchants (prototype 3.8) on omnichannel's /merchants (merchantsAgentsContract.ts):
 * tiles from the summary, tabs by KYB status, search, the drawer linkable as
 * ?focus=, the BRS card, documents, decisions for the roles that may decide
 * KYC, and the register form. Stubbed. */

type Obj = Record<string, unknown>;
const DOCS = ["CERTIFICATE_OF_REGISTRATION", "KRA_PIN_CERTIFICATE", "DIRECTOR_ID_COPIES", "BANK_LETTER"];
const merchant = (reference: string, over: Obj = {}): Obj => ({
  reference, name: "Kericho Agrovet", type: "AGRO_DEALER", town: "Kericho", county: "Kericho",
  ownerName: "Test Owner", ownerPhone: "+254700000301", tillNo: "512345",
  brs: { registrationNo: "PVT-AB12CD", status: "VERIFIED", registeredName: "Kericho Agrovet", registeredType: "Private company", registeredOwner: "Test Owner", checkedAt: "2026-11-07T08:00:00Z" },
  kyb: { status: "IN_REVIEW", decidedAt: null, decidedBy: null, note: null },
  settlement: { bank: "Test Bank", accountMasked: "****1234" }, commissionRate: 0.005,
  vouchers: { accepts: true, categories: ["FERTILISER", "SEEDLINGS"] },
  documents: DOCS.map((type) => ({ type, received: true, receivedAt: "2026-11-07T08:00:00Z", reference: null })),
  sales30d: null, transactions30d: null, joinedAt: "2026-11-01T08:00:00Z", updatedAt: null, ...over,
});
const SUMMARY = { approved: 3, agroDealers: 2, waitingForKyb: 4, acceptVouchers: 1, sales30d: null, byStatus: { inReview: 3, needsDocuments: 1, approved: 3, rejected: 1 } };
type Answer = { status: number; body: unknown };
const headers = (n: number) => ({ "X-Total-Count": String(n), "X-Page": "1", "X-Size": "20", "X-Total-Pages": "1" });

async function stub(page: Page, opts: { list?: Obj[] | Answer; summary?: Answer; one?: Obj | null; post?: (path: string, body: Obj) => Answer } = {}) {
  const sent: { method: string; path: string; query: URLSearchParams; body: unknown }[] = [];
  let current = opts.one === undefined ? merchant("M-10200") : opts.one;
  await page.route(/\/omni\/api\/operator\/merchants/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    const body = req.method() === "POST" ? (req.postDataJSON() as Obj) : null;
    sent.push({ method: req.method(), path, query: url.searchParams, body });
    if (req.method() === "POST") {
      const a = opts.post?.(path, body!) ?? { status: path === "/merchants" ? 201 : 200, body: current };
      if (a.status < 300 && a.body && typeof a.body === "object") current = a.body as Obj;
      return json(route, a.body, a.status);
    }
    if (path === "/merchants") {
      const l = opts.list ?? [merchant("M-10200"), merchant("M-10201", { name: "Litein Shop", type: "SHOP", town: "Litein", tillNo: "512346", vouchers: { accepts: false, categories: [] }, kyb: { status: "APPROVED", decidedAt: null, decidedBy: null, note: null } })];
      if (!Array.isArray(l)) return json(route, l.body, l.status);
      return route.fulfill({ status: 200, contentType: "application/json", headers: headers(l.length), body: JSON.stringify(l) });
    }
    if (path === "/merchants/summary") { const a = opts.summary ?? { status: 200, body: SUMMARY }; return json(route, a.body, a.status); }
    return current ? json(route, current) : json(route, envelope(404, "No such merchant"), 404);
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("tiles, tabs with counts, the table, and sales not yet measured", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/merchants");
  await expect(page.getByRole("heading", { name: "Merchants", level: 1 })).toBeVisible();
  const tiles = page.getByTestId("merchant-tiles");
  await expect(tiles).toContainText("Approved merchants3");
  await expect(tiles).toContainText("2 agro-dealers");
  await expect(tiles).toContainText("Waiting for KYB4");
  await expect(tiles).toContainText("Sales in the last 30 daysNot yet measured");
  for (const [name, n] of [["All", 8], ["In review", 3], ["Needs documents", 1], ["Approved", 3], ["Rejected", 1]] as const) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${name}\\s*${n}$`) })).toBeVisible();
  }
  const rows = page.getByTestId("merchants-table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Agro-dealer · Kericho");
  await expect(rows.nth(0)).toContainText("Fertiliser, Seedlings");
  await expect(rows.nth(0)).toContainText("Not yet measured");
  await expect(rows.nth(1)).toContainText("No");
  await page.getByRole("tab", { name: /^Needs documents/ }).click();
  await page.getByPlaceholder("Name, town, owner or till").fill("Kericho");
  await expect.poll(() => sent.some((s) => s.path === "/merchants" && s.query.get("status") === "NEEDS_DOCUMENTS" && s.query.get("q") === "Kericho")).toBe(true);
});

test("a row opens the drawer at ?focus=, with the BRS card, settlement and documents", async ({ page }) => {
  await stub(page, { one: merchant("M-10200", { documents: DOCS.map((type, i) => ({ type, received: i < 2, receivedAt: i < 2 ? "2026-11-07T08:00:00Z" : null, reference: null })) }) });
  await page.goto("/merchants");
  await page.getByTestId("merchants-table").getByText("Kericho Agrovet").click();
  await expect(page).toHaveURL(/focus=M-10200/);
  const drawer = page.getByTestId("merchant-drawer");
  await expect(page.getByTestId("brs-card")).toContainText("PVT-AB12CD");
  await expect(page.getByTestId("brs-card")).toContainText("Verified");
  await expect(page.getByTestId("merchant-details")).toContainText("Test Bank · ****1234");
  await expect(page.getByTestId("merchant-details")).toContainText("0.50% per sale");
  const docs = page.getByTestId("merchant-documents");
  await expect(docs.locator('[data-doc="CERTIFICATE_OF_REGISTRATION"]')).toContainText("Received");
  await expect(docs.locator('[data-doc="BANK_LETTER"]')).toContainText("Missing");
  // Not ready: two documents short.
  await expect(drawer.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByTestId("not-ready")).toContainText("2 more documents");
});

test("mark a document received, check BRS again, then approve with a note", async ({ page }) => {
  const sent = await stub(page, {
    one: merchant("M-10200", { documents: DOCS.map((type) => ({ type, received: type !== "BANK_LETTER", receivedAt: null, reference: null })) }),
    post: (path, body) => {
      const docs = DOCS.map((type) => ({ type, received: true, receivedAt: "2026-11-07T09:00:00Z", reference: null }));
      if (path.endsWith("/documents")) return { status: 200, body: merchant("M-10200", { documents: docs }) };
      if (path.endsWith("/brs-check")) return { status: 200, body: merchant("M-10200", { documents: docs }) };
      return { status: 200, body: merchant("M-10200", { documents: docs, kyb: { status: body.decision, decidedAt: "2026-11-07T10:00:00Z", decidedBy: "officer@ktda.test", note: body.note ?? null } }) };
    },
  });
  await page.goto("/merchants?focus=M-10200");
  const drawer = page.getByTestId("merchant-drawer");
  await page.getByTestId("merchant-documents").locator('[data-doc="BANK_LETTER"]').getByRole("button", { name: "Mark received" }).click();
  await expect(page.getByTestId("merchant-documents").locator('[data-doc="BANK_LETTER"]')).toContainText("Received");
  await page.getByTestId("brs-card").getByRole("button", { name: "Check again" }).click();
  await drawer.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByLabel("Decision note").fill("All four documents seen.");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("kyb-note")).toContainText("All four documents seen.");
  await expect(drawer.getByRole("button", { name: "Revoke approval" })).toBeVisible();
  const posts = sent.filter((s) => s.method === "POST");
  expect(posts.map((s) => s.path)).toEqual(["/merchants/M-10200/documents", "/merchants/M-10200/brs-check", "/merchants/M-10200/decision"]);
  expect(posts[0].body).toEqual({ type: "BANK_LETTER" });
  expect(posts[2].body).toEqual({ decision: "APPROVED", note: "All four documents seen." });
});

test("revoking an approval needs a note; a refusal shows omnichannel's reason", async ({ page }) => {
  await stub(page, {
    one: merchant("M-10200", { kyb: { status: "APPROVED", decidedAt: "2026-11-07T10:00:00Z", decidedBy: "officer@ktda.test", note: null } }),
    post: () => ({ status: 409, body: envelope(409, "This merchant is decided", "MERCHANT_DECIDED") }),
  });
  await page.goto("/merchants?focus=M-10200");
  await page.getByRole("button", { name: "Revoke approval" }).click();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await page.getByLabel("Decision note").fill("Licence withdrawn.");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("This merchant is decided")).toBeVisible();
});

test("someone who may not decide KYC sees the merchant but no decision", async ({ page }) => {
  await page.route(/\/tok\/auth\/me$/, (route) => json(route, { email: STAFF.email, fullName: STAFF.fullName, roles: ["ACCOUNTANT"], admin: false }));
  await stub(page);
  await page.goto("/merchants?focus=M-10200");
  await expect(page.getByTestId("merchant-drawer")).toContainText("Deciding KYB needs the Admin or Compliance role.");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
});

test("a reference that is not this institution's", async ({ page }) => {
  await stub(page, { one: null });
  await page.goto("/merchants?focus=M-99999");
  await expect(page.getByTestId("merchant-not-found")).toContainText("No merchant M-99999");
});

test("register a merchant: the body follows the contract and the drawer opens on it", async ({ page }) => {
  const sent = await stub(page, { post: () => ({ status: 201, body: merchant("M-10300", { name: "Kapkatet Agrovet", brs: { registrationNo: "PVT-XY0000", status: "NOT_FOUND", registeredName: null, registeredType: null, registeredOwner: null, checkedAt: "2026-11-07T08:00:00Z" } }) }) });
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
  await expect(page).toHaveURL(/focus=M-10300/);
  await expect(page.getByTestId("brs-card")).toContainText("Not registered");
  const post = sent.find((s) => s.method === "POST")!;
  expect(post.path).toBe("/merchants");
  expect(post.body).toEqual({
    name: "Kapkatet Agrovet", type: "AGRO_DEALER", town: "Kapkatet", county: "Kericho", ownerName: "Test Owner Two", ownerPhone: "0700000302",
    tillNo: "512399", registrationNo: "PVT-XY0000", settlement: { bank: "Test Bank", account: "0011223344" }, commissionRate: 0.005,
    vouchers: { accepts: true, categories: ["FERTILISER"] },
  });
});

test("a till already taken shows omnichannel's message", async ({ page }) => {
  await stub(page, { post: () => ({ status: 409, body: envelope(409, "Till 512345 is already another merchant's", "MERCHANT_TILL_TAKEN") }) });
  await page.goto("/merchants");
  await page.getByRole("button", { name: "Register merchant" }).click();
  for (const [l, v] of [["Business name", "X"], ["Registration no.", "PVT-1"], ["Till number", "512345"], ["Town", "T"], ["County", "C"], ["Owner name", "O"], ["Owner phone", "0700000303"], ["Settlement bank", "B"], ["Settlement account", "1"]]) {
    await page.getByLabel(l, { exact: true }).fill(v);
  }
  await page.getByRole("dialog").getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText("Till 512345 is already another merchant's")).toBeVisible();
});

test("an omnichannel without merchants says so", async ({ page }) => {
  await stub(page, { list: { status: 404, body: envelope(404, "Not Found") }, summary: { status: 404, body: envelope(404, "Not Found") } });
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
