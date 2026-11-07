import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn, STAFF } from "./stubs";

/* The KYC desk (Kyc.tsx): this institution's farmers by KYC status, from
 * omnichannel's farmer list (?kyc=) and the summary's kyc counts. A row
 * opens the farmer: Start KYC, Approve or Reject with a note through the
 * farmer endpoints, and the application and photos through their app
 * profile. Nothing from the engine. Stubbed. */

type Obj = Record<string, unknown>;
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const kyc = (status: string, over: Obj = {}): Obj => ({
  status, identityResult: status === "NONE" ? null : "MATCH", startedAt: status === "NONE" ? null : "2026-11-07T08:00:00Z",
  decidedAt: status === "VERIFIED" || status === "REJECTED" ? "2026-11-07T09:00:00Z" : null, note: null, ...over,
});
const farmer = (growerNo: string, k: Obj, over: Obj = {}): Obj => ({
  growerNo, fullName: `Test Farmer ${growerNo.slice(-1)}`, phone: "+254700000101", factory: "Test Factory A", status: "FUNDED",
  registeredAt: "2026-11-06T08:00:00Z", activatedAt: "2026-11-06T09:00:00Z", lastFundedAt: "2026-11-06T10:00:00Z",
  customerId: P1, clashReason: null, kyc: k, ...over,
});
const application = (over: Obj = {}): Obj => ({
  id: "app-1", profileId: P1, fullName: "Test Farmer 1", dateOfBirth: "1994-03-12", nationality: "KE", identityResult: "MATCH",
  identityMismatches: null, identitySource: "IPRS", identityCheckedAt: "2026-11-07T08:00:00Z", screeningClear: true,
  product: "TOKENIZATION", externalRef: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", submittedAt: "2026-11-07T08:00:00Z", ...over,
});
const SUMMARY = { registered: 0, activated: 2, funded: 3, total: 5, kycPending: 2, kyc: { none: 1, pending: 2, verified: 1, rejected: 1 } };
type Answer = { status: number; body: unknown };
const paged = (items: Obj[]) => ({ "X-Total-Count": String(items.length), "X-Page": "1", "X-Size": "20", "X-Total-Pages": "1" });

async function stub(page: Page, opts: {
  byKyc?: Record<string, Obj[]>;
  summary?: Obj;
  one?: Obj;
  apps?: Obj[];
  docs?: Obj[];
  start?: Answer;
  decision?: Answer;
  listFail?: boolean;
} = {}) {
  const sent: { method: string; path: string; query: URLSearchParams; body: unknown }[] = [];
  const engine: string[] = [];
  page.on("request", (r) => { if (/\/tok\/accounting\//.test(r.url())) engine.push(new URL(r.url()).pathname); });
  const byKyc = opts.byKyc ?? { PENDING: [farmer("TEST000001", kyc("PENDING")), farmer("TEST000002", kyc("PENDING"))] };
  await page.route(/\/omni\/api\/operator\//, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    const body = req.method() === "POST" ? req.postDataJSON() : null;
    sent.push({ method: req.method(), path, query: url.searchParams, body });
    const one = opts.one ?? farmer("TEST000001", kyc("PENDING"));
    if (req.method() === "POST") {
      if (path.endsWith("/kyc/start")) { const a = opts.start ?? { status: 200, body: { ...one, kyc: kyc("PENDING", { identityResult: "UNCHECKED" }) } }; return json(route, a.body, a.status); }
      if (path.endsWith("/kyc/decision")) {
        const a = opts.decision ?? { status: 200, body: { ...one, kyc: kyc((body as Obj).decision as string, { note: (body as Obj).note ?? null }) } };
        return json(route, a.body, a.status);
      }
      return json(route, envelope(404, "Not stubbed"), 404);
    }
    if (path === "/farmers") {
      if (opts.listFail) return json(route, envelope(500, "farmers down"), 500);
      const items = url.searchParams.get("kyc") ? byKyc[url.searchParams.get("kyc")!] ?? [] : Object.values(byKyc).flat();
      return route.fulfill({ status: 200, contentType: "application/json", headers: paged(items), body: JSON.stringify(items) });
    }
    if (path === "/farmers/summary") return json(route, opts.summary ?? SUMMARY);
    if (path === "/farmers/kyc/sweep") return json(route, envelope(404, "No sweep"), 404);
    if (/^\/farmers\/[^/]+$/.test(path)) return json(route, one);
    if (path === "/onboarding/applications") {
      const r = url.searchParams.get("identityResult");
      return json(route, (opts.apps ?? [application()]).filter((a) => a.identityResult === r));
    }
    if (path === "/onboarding/documents") return json(route, url.searchParams.get("profileId") ? opts.docs ?? [] : []);
    return json(route, []);
  });
  return { sent, engine };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("opens on To decide: tabs with the summary's counts, the farmers asked for by kyc=PENDING, no engine reads", async ({ page }) => {
  const { sent, engine } = await stub(page);
  await page.goto("/token-console/kyc");
  await expect(page.getByRole("heading", { name: "KYC desk", level: 1 })).toBeVisible();
  for (const [name, n] of [["To decide", 2], ["Not started", 1], ["Verified", 1], ["Rejected", 1], ["Everyone", 5]] as const) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${name}\\s*${n}$`) })).toBeVisible();
  }
  const rows = page.getByTestId("kyc-table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("TEST000001");
  await expect(rows.first()).toContainText("Matches the registry");
  expect(sent.find((s) => s.path === "/farmers")!.query.get("kyc")).toBe("PENDING");
  await page.waitForLoadState("networkidle");
  expect(engine).toEqual([]);
});

test("a tab asks for its status; search goes with it", async ({ page }) => {
  const { sent } = await stub(page, { byKyc: { VERIFIED: [farmer("TEST000003", kyc("VERIFIED", { note: "Checked." }))] } });
  await page.goto("/token-console/kyc");
  await page.getByRole("tab", { name: /^Verified/ }).click();
  await expect(page.getByTestId("kyc-row-note")).toHaveText("Checked.");
  await page.getByPlaceholder("Grower number, name or phone").fill("TEST0003");
  await expect.poll(() => sent.some((s) => s.path === "/farmers" && s.query.get("kyc") === "VERIFIED" && s.query.get("q") === "TEST0003")).toBe(true);
});

test("Not started: the reason as the note, Start KYC on the row, and the sweep", async ({ page }) => {
  const { sent } = await stub(page, {
    byKyc: { NONE: [farmer("TEST000004", kyc("NONE", { note: "needs a date of birth" }), { status: "ACTIVATED", lastFundedAt: null }), farmer("TEST000005", kyc("NONE"), { status: "REGISTERED", activatedAt: null, lastFundedAt: null })] },
    one: farmer("TEST000004", kyc("NONE"), { status: "ACTIVATED" }),
  });
  await page.goto("/token-console/kyc?kyc=NONE");
  await expect(page.getByTestId("kyc-sweep")).toBeVisible();
  const rows = page.getByTestId("kyc-table").locator("tbody tr");
  await expect(rows.nth(0).getByTestId("kyc-row-note")).toHaveText("needs a date of birth");
  // Only an activated farmer can start.
  await expect(rows.nth(1).getByRole("button", { name: "Start KYC" })).toHaveCount(0);
  await rows.nth(0).getByRole("button", { name: "Start KYC" }).click();
  await expect(rows.nth(0)).toContainText("To decide");
  expect(sent.filter((s) => s.method === "POST").map((s) => s.path)).toEqual(["/farmers/TEST000004/kyc/start"]);
  await expect(page).toHaveURL(/kyc=NONE/);
});

test("the sweep is only on Not started", async ({ page }) => {
  await stub(page);
  await page.goto("/token-console/kyc");
  await expect(page.getByTestId("kyc-table")).toBeVisible();
  await expect(page.getByTestId("kyc-sweep")).toHaveCount(0);
});

test("a row opens the farmer: KYC, the application and the photos; Approve with a note through the farmer endpoint", async ({ page }) => {
  const { sent } = await stub(page, {
    docs: [{ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", profileId: P1, type: "SELFIE", contentType: "image/png", sizeBytes: 10, status: "PENDING_REVIEW", reviewNote: null, reviewedBy: null, reviewedAt: null, uploadedAt: "2026-11-07T08:30:00Z" }],
  });
  await page.goto("/token-console/kyc");
  await page.getByTestId("kyc-table").getByText("Test Farmer 1").click();
  const panel = page.getByTestId("kyc-panel");
  await expect(panel.getByTestId("farmer-kyc")).toContainText("To decide");
  await expect(panel.getByTestId("kyc-desk-link")).toHaveCount(0);
  await expect(panel).toContainText("Every photo sent");
  await expect(panel.getByRole("link", { name: "TEST000001" })).toHaveAttribute("href", "/farmers/TEST000001");
  await panel.getByTestId("farmer-kyc").getByRole("button", { name: "Approve" }).click();
  await page.getByLabel("Decision note").fill("Registry and photos agree.");
  await page.locator("[role=dialog]").last().getByRole("button", { name: "Approve", exact: true }).click();
  await expect(panel.getByTestId("farmer-kyc")).toContainText("Verified");
  const post = sent.find((s) => s.method === "POST")!;
  expect(post).toMatchObject({ path: "/farmers/TEST000001/kyc/decision", body: { decision: "VERIFIED", note: "Registry and photos agree." } });
  expect(sent.some((s) => s.path.endsWith("/kyc-status"))).toBe(false);
  // The row moves with the decision.
  await expect(page.getByTestId("kyc-table").locator("tbody tr").first()).toContainText("Verified");
});

test("a farmer whose KYC has not started has no application yet, and says so", async ({ page }) => {
  await stub(page, { apps: [], one: farmer("TEST000004", kyc("NONE"), { status: "ACTIVATED" }), byKyc: { NONE: [farmer("TEST000004", kyc("NONE"), { status: "ACTIVATED" })] } });
  await page.goto("/token-console/kyc?kyc=NONE&grower=TEST000004");
  await expect(page.getByTestId("no-application")).toContainText("No application yet");
  await expect(page.getByTestId("farmer-kyc").getByRole("button", { name: "Start KYC" })).toBeVisible();
});

test("?grower= opens that farmer", async ({ page }) => {
  await stub(page, { one: farmer("TEST000002", kyc("PENDING")) });
  await page.goto("/token-console/kyc?kyc=PENDING&grower=TEST000002");
  await expect(page.getByTestId("kyc-panel")).toContainText("TEST000002");
});

test("someone who may not decide sees the desk but no Approve", async ({ page }) => {
  await page.route(/\/tok\/auth\/me$/, (route) => json(route, { email: STAFF.email, fullName: STAFF.fullName, roles: ["ACCOUNTANT"], admin: false }));
  await stub(page);
  await page.goto("/token-console/kyc?grower=TEST000001");
  await expect(page.getByTestId("farmer-kyc")).toContainText("Deciding KYC needs the");
  await expect(page.getByTestId("farmer-kyc").getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("a summary without kyc counts: the tabs show no counts and say so", async ({ page }) => {
  await stub(page, { summary: { registered: 0, activated: 2, funded: 3, total: 5 } });
  await page.goto("/token-console/kyc");
  await expect(page.getByTestId("counts-not-available")).toBeVisible();
  await expect(page.getByTestId("kyc-table")).toBeVisible();
});

test("a farmer list that cannot be read is an error, not an empty desk", async ({ page }) => {
  await stub(page, { listFail: true });
  await page.goto("/token-console/kyc");
  await expect(page.getByText("Could not load the KYC desk")).toBeVisible();
  await expect(page.getByTestId("kyc-empty")).toHaveCount(0);
});
