import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* Farmer KYC (journeyContract.ts, omnichannel feat/farmer-kyc): the KYC
 * column, filter and count on Farmers and the journey overview; the KYC
 * section on a farmer's profile (Start KYC, Approve or Reject with a note).
 * The KYC desk is kyc-desk.spec.ts. Stubbed. */

type Obj = Record<string, unknown>;
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const INV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const kyc = (status: string, over: Obj = {}): Obj => ({
  status, identityResult: status === "NONE" ? null : "UNCHECKED", startedAt: status === "NONE" ? null : "2026-11-07T08:00:00Z",
  decidedAt: status === "VERIFIED" || status === "REJECTED" ? "2026-11-07T09:00:00Z" : null, note: null, ...over,
});
const farmer = (growerNo: string, status: string, k: Obj | undefined, over: Obj = {}): Obj => ({
  growerNo, fullName: `Test Farmer ${growerNo.slice(-1)}`, phone: "+254700000101", factory: "Test Factory A", status,
  registeredAt: "2026-11-06T08:00:00Z", activatedAt: status === "REGISTERED" ? null : "2026-11-06T09:00:00Z",
  lastFundedAt: null, customerId: P1, clashReason: null, ...(k === undefined ? {} : { kyc: k }), ...over,
});

type Sent = { method: string; path: string; query: URLSearchParams; body: unknown };
type Answer = { status: number; body: unknown };

async function stub(page: Page, opts: {
  list?: Obj[];
  summary?: Obj;
  one?: Obj;
  byCustomer?: Record<string, Obj | null>;
  apps?: Record<string, Obj[]>;
  start?: Answer;
  decision?: Answer;
} = {}) {
  const sent: Sent[] = [];
  const engine: string[] = [];
  page.on("request", (r) => { if (/\/tok\/accounting\//.test(r.url())) engine.push(new URL(r.url()).pathname); });
  await page.route(/\/omni\/api\/operator\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    const body = req.method() === "POST" ? req.postDataJSON() : null;
    sent.push({ method: req.method(), path, query: url.searchParams, body });
    const one = opts.one ?? farmer("TEST000001", "ACTIVATED", kyc("PENDING"));
    if (req.method() === "POST") {
      if (path.endsWith("/kyc/start")) { const a = opts.start ?? { status: 200, body: { ...one, kyc: kyc("PENDING") } }; return json(route, a.body, a.status); }
      if (path.endsWith("/kyc/decision")) {
        const a = opts.decision ?? { status: 200, body: { ...one, kyc: kyc((body as Obj).decision as string, { note: (body as Obj).note ?? null }) } };
        return json(route, a.body, a.status);
      }
      if (path.endsWith("/kyc-status")) return json(route, { investorId: INV, legalName: "x", kycStatus: (body as Obj).kycStatus });
      return json(route, envelope(404, "Not stubbed"), 404);
    }
    if (path === "/farmers") return json(route, opts.list ?? [one]);
    if (path === "/farmers/summary") return json(route, opts.summary ?? { registered: 1, activated: 1, funded: 0, total: 2, kycPending: 1 });
    if (path.startsWith("/farmers/by-customer/")) {
      const id = path.split("/").pop()!;
      const f = (opts.byCustomer ?? {})[id];
      return f ? json(route, f) : json(route, envelope(404, "Not a farmer"), 404);
    }
    if (/^\/farmers\/[^/]+\/wallet/.test(path)) return json(route, path.endsWith("movements") ? [] : { growerNo: "x", status: "ACTIVATED", walletOpen: false, balances: [] });
    if (/^\/farmers\/[^/]+$/.test(path)) return json(route, one);
    if (path === "/onboarding/applications") return json(route, (opts.apps ?? {})[url.searchParams.get("identityResult") ?? "MISMATCH"] ?? []);
    if (path.startsWith("/customers/")) return json(route, { profileId: path.split("/")[2], displayName: "x", legalName: "x", status: "ACTIVE", registeredAt: "2026-11-06T07:00:00Z", contacts: [], links: [], account: { linked: true, investorId: INV, legalName: "x", kycStatus: "PENDING", canInvest: false }, activeDevices: 0, pushEnabled: false });
    if (path === "/institutions") return json(route, [{ id: "11111111-1111-4111-8111-111111111111", name: "KTDA", localCurrency: "KES", country: "KE", status: "ACTIVE" }]);
    return json(route, []);
  });
  return { sent, engine };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.describe("Farmers list", () => {
  test("a KYC column, a KYC filter sent as kyc=, and the count waiting on a decision", async ({ page }) => {
    const { sent } = await stub(page, { list: [farmer("TEST000001", "ACTIVATED", kyc("PENDING")), farmer("TEST000002", "ACTIVATED", kyc("VERIFIED")), farmer("TEST000003", "REGISTERED", undefined)] });
    await page.goto("/farmers");
    const cells = page.getByTestId("kyc-cell");
    await expect(cells.nth(0)).toHaveText("To decide");
    await expect(cells.nth(1)).toHaveText("Verified");
    await expect(cells.nth(2)).toHaveText("—");
    await page.getByTestId("kyc-pending").click();
    await expect(page).toHaveURL(/kyc=PENDING/);
    await expect.poll(() => sent.some((s) => s.path === "/farmers" && s.query.get("kyc") === "PENDING")).toBe(true);
    await expect(page.getByTestId("kyc-pending")).toHaveCount(0);
  });

  test("the journey overview has a KYC to decide tile where omnichannel counts it", async ({ page }) => {
    await stub(page, { summary: { registered: 1, activated: 1, funded: 0, total: 2, kycPending: 3 } });
    await page.goto("/journey");
    const tile = page.getByTestId("kyc-pending-tile");
    await expect(tile).toContainText("3");
    await expect(tile.getByRole("link")).toHaveAttribute("href", "/farmers?kyc=PENDING");
  });

  test("an older omnichannel without kycPending shows no tile", async ({ page }) => {
    await stub(page, { summary: { registered: 1, activated: 1, funded: 0, total: 2 } });
    await page.goto("/journey");
    await expect(page.getByTestId("stage-counts")).toBeVisible();
    await expect(page.getByTestId("kyc-pending-tile")).toHaveCount(0);
  });
});

test.describe("farmer profile", () => {
  test("not started, with the reason, and Start KYC for an activated farmer", async ({ page }) => {
    const { sent } = await stub(page, { one: farmer("TEST000001", "ACTIVATED", kyc("NONE", { note: "needs a date of birth" })) });
    await page.goto("/farmers/TEST000001");
    const k = page.getByTestId("farmer-kyc");
    await expect(k).toContainText("Not started");
    await expect(page.getByTestId("kyc-note")).toHaveText("Not started: needs a date of birth");
    await expect(page.getByTestId("kyc-desk-link")).toHaveAttribute("href", "/token-console/kyc?kyc=NONE&grower=TEST000001");
    await k.getByRole("button", { name: "Start KYC" }).click();
    await expect(k).toContainText("To decide");
    expect(sent.filter((s) => s.method === "POST").map((s) => s.path)).toEqual(["/farmers/TEST000001/kyc/start"]);
  });

  test("a registered farmer cannot start KYC yet", async ({ page }) => {
    await stub(page, { one: farmer("TEST000001", "REGISTERED", kyc("NONE")) });
    await page.goto("/farmers/TEST000001");
    await expect(page.getByTestId("farmer-kyc")).toContainText("KYC starts once the farmer is activated");
    await expect(page.getByRole("button", { name: "Start KYC" })).toHaveCount(0);
  });

  test("pending: Approve with a note goes to the farmer's decision endpoint", async ({ page }) => {
    const { sent, engine } = await stub(page);
    await page.goto("/farmers/TEST000001");
    const k = page.getByTestId("farmer-kyc");
    await expect(k).toContainText("Registry not checked");
    await expect(page.getByTestId("kyc-desk-link")).toHaveAttribute("href", "/token-console/kyc?kyc=PENDING&grower=TEST000001");
    await k.getByRole("button", { name: "Approve" }).click();
    await page.getByLabel("Decision note").fill("Details checked against the ID.");
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(k).toContainText("Verified");
    await expect(page.getByTestId("kyc-note")).toHaveText("Note: Details checked against the ID.");
    const post = sent.find((s) => s.method === "POST")!;
    expect(post).toMatchObject({ path: "/farmers/TEST000001/kyc/decision", body: { decision: "VERIFIED", note: "Details checked against the ID." } });
    expect(sent.some((s) => s.path.endsWith("/kyc-status"))).toBe(false);
    expect(engine).toEqual([]);
  });

  test("a decision omnichannel refuses (409) shows why", async ({ page }) => {
    await stub(page, { decision: { status: 409, body: envelope(409, "KYC has not started: needs a national ID") } });
    await page.goto("/farmers/TEST000001");
    await page.getByTestId("farmer-kyc").getByRole("button", { name: "Reject" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page.getByText("KYC has not started: needs a national ID")).toBeVisible();
  });

  test("an omnichannel without farmer KYC says so", async ({ page }) => {
    await stub(page, { one: farmer("TEST000001", "ACTIVATED", undefined) });
    await page.goto("/farmers/TEST000001");
    await expect(page.getByTestId("kyc-not-available")).toContainText("Not available on this environment yet");
  });
});

test("the demo KYC pages are refused by their address", async ({ page }) => {
  await stub(page);
  for (const path of ["/kyc-queue", "/kyc-queue/123", "/kyc-periodic", "/kyc-dynamic", "/screening"]) {
    await page.goto(path);
    await expect(page.getByTestId("page-removed")).toBeVisible();
  }
});
