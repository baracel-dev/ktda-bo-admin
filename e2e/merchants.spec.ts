import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn, STAFF } from "./stubs";

/* Merchants (prototype 3.8). Reads come from the channel-api's real
 * merchants through omnichannel's /ktda/merchants passthrough, mapped to the
 * merchantsAgentsContract shape in api.merchants.ts (status and search are
 * applied in the page's client); writes go to omnichannel's own /merchants
 * register and answer the contract's Merchant, or 202 { approval } for a
 * controlled one. Stubbed. */

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
const approval = (over: Obj = {}): Obj => ({
  id: "ap-1", reference: "AP-10001", type: "MERCHANT_DECISION", title: "Approve merchant M-10200",
  target: { kind: "MERCHANT", reference: "M-10200", name: "Kericho Agrovet" }, changes: [], reason: null, payload: {}, status: "PENDING",
  maker: "ktda-operator", madeAt: "2026-11-07T10:00:00Z", checker: null, decidedAt: null, decisionNote: null, appliedAt: null, error: null, checkerRoles: ["ADMIN"], ...over,
});
type Answer = { status: number; body: unknown };

async function stub(page: Page, opts: { list?: Obj[] | Answer; write?: (method: string, path: string, body: Obj) => Answer | undefined } = {}) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const list = Array.isArray(opts.list) ? [...opts.list] : opts.list ?? [...LIST];
  await page.route(/\/omni\/api\/operator\/(ktda\/)?merchants/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/omni\/api\/operator/, "");
    const write = req.method() === "POST" || req.method() === "PUT";
    const body = write ? (req.postDataJSON() as Obj) : null;
    sent.push({ method: req.method(), path, body });
    if (path === "/ktda/merchants") return Array.isArray(list) ? json(route, list) : json(route, list.body, list.status);
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

test("a row opens the drawer at ?focus=, with the BRS card and the documents", async ({ page }) => {
  await stub(page);
  await page.goto("/merchants");
  await page.getByTestId("merchants-table").getByText("Kericho Agrovet").click();
  await expect(page).toHaveURL(/focus=M-10200/);
  await expect(page.getByTestId("brs-card")).toContainText("M-10200");
  await expect(page.getByTestId("brs-card")).toContainText("Not checked");
  await expect(page.getByTestId("merchant-details")).toContainText("0.50% per sale");
  await expect(page.getByTestId("merchant-documents").locator('[data-doc="BANK_LETTER"]')).toContainText("Missing");
  await expect(page.getByTestId("merchant-drawer").getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByTestId("not-ready")).toContainText("a verified BRS check and 4 more documents");
});

test("mark a document received and check BRS again: the drawer shows omnichannel's answer", async ({ page }) => {
  const sent = await stub(page, {
    write: (_m, path) => {
      if (path.endsWith("/documents")) return { status: 200, body: merchant("M-10200", { documents: DOCS.map((type) => ({ type, received: type === "BANK_LETTER", receivedAt: null, reference: null })), brs: { registrationNo: "M-10200", status: "UNCHECKED", registeredName: null, registeredType: null, registeredOwner: null, checkedAt: null } }) };
      if (path.endsWith("/brs-check")) return { status: 200, body: merchant("M-10200") };
      return undefined;
    },
  });
  await page.goto("/merchants?focus=M-10200");
  await page.getByTestId("merchant-documents").locator('[data-doc="BANK_LETTER"]').getByRole("button", { name: "Mark received" }).click();
  await expect(page.getByTestId("merchant-documents").locator('[data-doc="BANK_LETTER"]')).toContainText("Received");
  await page.getByTestId("brs-card").getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("brs-card")).toContainText("Verified");
  await expect(page.getByTestId("merchant-drawer").getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  const posts = sent.filter((s) => s.method === "POST");
  expect(posts.map((s) => s.path)).toEqual(["/merchants/M-10200/documents", "/merchants/M-10200/brs-check"]);
  expect(posts[0].body).toEqual({ type: "BANK_LETTER" });
});

test("approving is sent for approval: the request's reference, a link, and nothing reloaded", async ({ page }) => {
  const sent = await stub(page, {
    write: (_m, path, body) => {
      if (path.endsWith("/brs-check")) return { status: 200, body: merchant("M-10200") };
      if (path.endsWith("/decision")) return { status: 202, body: { approval: approval({ reason: body.reason ?? null }) } };
      return undefined;
    },
  });
  await page.goto("/merchants?focus=M-10200");
  await page.getByTestId("brs-card").getByRole("button", { name: "Check again" }).click();
  await page.getByTestId("merchant-drawer").getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByLabel("Decision note").fill("All four documents seen.");
  await page.getByLabel("Reason", { exact: true }).fill("Documents checked in person.");
  await page.getByRole("button", { name: "Confirm" }).click();
  const notice = page.getByTestId("sent-for-approval");
  await expect(notice).toContainText("Sent for approval AP-10001");
  await expect(notice.getByRole("link", { name: "Approvals" })).toHaveAttribute("href", "/approvals?open=AP-10001");
  const decision = sent.find((s) => s.path.endsWith("/decision"))!;
  expect(decision.body).toEqual({ decision: "APPROVED", note: "All four documents seen.", reason: "Documents checked in person." });
  await page.getByRole("button", { name: "Done" }).click();
  // Still in review: nothing changed yet.
  await expect(page.getByTestId("merchant-drawer")).toContainText("In review");
});

test("needs documents applies at once", async ({ page }) => {
  await stub(page, { write: (_m, path, body) => path.endsWith("/decision") ? { status: 200, body: merchant("M-10200", { kyb: { status: body.decision, decidedAt: null, decidedBy: null, note: body.note ?? null } }) } : undefined });
  await page.goto("/merchants?focus=M-10200");
  await page.getByRole("button", { name: "Needs documents" }).click();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveCount(0);
  await page.getByLabel("Decision note").fill("Bank letter missing.");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("kyb-note")).toContainText("Bank letter missing.");
});

test("a request already open (APPROVAL_PENDING) links to it", async ({ page }) => {
  await stub(page, { write: (_m, path) => path.endsWith("/decision") ? { status: 409, body: envelope(409, "A request is already waiting: AP-10007", "APPROVAL_PENDING") } : { status: 200, body: merchant("M-10200") } });
  await page.goto("/merchants?focus=M-10200");
  await page.getByTestId("brs-card").getByRole("button", { name: "Check again" }).click();
  await page.getByTestId("merchant-drawer").getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("approval-ref-link")).toHaveAttribute("href", "/approvals?open=AP-10007");
});

test("revoking an approval needs a note; a refusal shows omnichannel's reason", async ({ page }) => {
  await stub(page, { write: () => ({ status: 409, body: envelope(409, "This merchant is decided", "MERCHANT_DECIDED") }) });
  await page.goto("/merchants?focus=M-10201");
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
  await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
});

test("a reference that is not this institution's", async ({ page }) => {
  await stub(page);
  await page.goto("/merchants?focus=M-99999");
  await expect(page.getByTestId("merchant-not-found")).toContainText("No merchant M-99999");
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
  await expect(page).toHaveURL(/focus=M-10300/);
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

/** Opens Edit on M-10200 and fills what the channel-api's merchant does not carry. */
async function openEdit(page: Page) {
  await page.goto("/merchants?focus=M-10200");
  await page.getByRole("button", { name: "Edit details" }).click();
  const form = page.getByTestId("merchant-form");
  await expect(form).toContainText("The registration number (M-10200) cannot change here.");
  await expect(form.getByLabel("Registration no.", { exact: true })).toHaveCount(0);
  await expect(form.getByLabel("Business name", { exact: true })).toHaveValue("Kericho Agrovet");
  await expect(form.getByLabel("Commission % per sale (optional)", { exact: true })).toHaveValue("0.5");
  for (const [l, v] of [["County", "Kericho"], ["Owner name", "Test Owner"], ["Owner phone", "0700000301"], ["Settlement bank", "Test Bank"]]) {
    await form.getByLabel(l, { exact: true }).fill(v);
  }
  return form;
}

test("edit details: PUT without the registration number, the account only when typed", async ({ page }) => {
  const sent = await stub(page);
  const form = await openEdit(page);
  await expect(form.getByLabel("Settlement account", { exact: true })).toHaveValue("");
  await form.getByLabel("Till number", { exact: true }).fill("512350");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Kericho Agrovet: details saved.")).toBeVisible();
  const put = sent.find((s) => s.method === "PUT")!;
  expect(put.path).toBe("/merchants/M-10200");
  expect(put.body).toEqual({
    name: "Kericho Agrovet", type: "AGRO_DEALER", town: "Kericho", county: "Kericho", ownerName: "Test Owner", ownerPhone: "0700000301",
    tillNo: "512350", commissionRate: 0.005, vouchers: { accepts: false, categories: [] }, settlement: { bank: "Test Bank" },
  });
});

test("a settlement change is sent for approval, with the reason", async ({ page }) => {
  const sent = await stub(page, { write: (m) => m === "PUT" ? { status: 202, body: { approval: approval({ reference: "AP-10002", type: "MERCHANT_UPDATE", title: "Change settlement details of merchant M-10200" }) } } : undefined });
  const form = await openEdit(page);
  await form.getByLabel("Settlement account", { exact: true }).fill("9988776655");
  await form.getByLabel("Reason", { exact: true }).fill("New bank letter received.");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("sent-for-approval")).toContainText("Sent for approval AP-10002");
  const body = sent.find((s) => s.method === "PUT")!.body as Obj;
  expect(body.settlement).toEqual({ bank: "Test Bank", account: "9988776655" });
  expect(body.reason).toBe("New bank letter received.");
  await expect(page.getByText("details saved.")).toHaveCount(0);
});

test("a rejected merchant has no Edit", async ({ page }) => {
  await stub(page, { list: [channel("M-10200", { kyb: "rejected" })] });
  await page.goto("/merchants?focus=M-10200");
  await expect(page.getByTestId("merchant-drawer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
});

test("an edit omnichannel refuses shows why", async ({ page }) => {
  await stub(page, { write: () => ({ status: 409, body: envelope(409, "This merchant is rejected", "MERCHANT_REJECTED") }) });
  await openEdit(page);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("This merchant is rejected")).toBeVisible();
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
