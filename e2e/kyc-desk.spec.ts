import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* The KYC desk (Kyc.tsx) on omnichannel only: applicants from the
 * applications by registry result and the photos, their standing from the
 * customer record, a decision through POST /investors/{id}/kyc-status. The
 * engine's compliance reviews and investor register (every institution's)
 * are never read. Stubbed. */

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const P3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const INV1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const DOC = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

type Obj = Record<string, unknown>;
const app = (profileId: string, identityResult: string, over: Obj = {}): Obj => ({
  id: `app-${profileId.slice(-1)}`, profileId, fullName: "Test Farmer One", dateOfBirth: "1990-04-02", nationality: "KE",
  identityResult, identityMismatches: identityResult === "MISMATCH" ? ["name"] : null, identitySource: "IPRS",
  identityCheckedAt: "2026-11-06T08:00:00Z", screeningClear: true, product: "TOKENIZATION", externalRef: INV1,
  submittedAt: "2026-11-06T08:00:00Z", ...over,
});
const doc = (profileId: string, over: Obj = {}): Obj => ({
  id: DOC, profileId, type: "SELFIE", contentType: "image/png", sizeBytes: 10, status: "PENDING_REVIEW",
  reviewNote: null, reviewedBy: null, reviewedAt: null, uploadedAt: "2026-11-06T09:00:00Z", ...over,
});
const customer = (profileId: string, kycStatus: string): Obj => ({
  profileId, displayName: "Test Farmer One", legalName: "Test Farmer One", status: "ACTIVE", registeredAt: "2026-11-06T07:00:00Z",
  contacts: [], links: [], account: { linked: true, investorId: INV1, legalName: "Test Farmer One", kycStatus, canInvest: false },
  activeDevices: 1, pushEnabled: false,
});

async function stub(page: Page, opts: { apps?: Record<string, Obj[]>; waiting?: Obj[]; kyc?: string; decide?: { status: number; body: unknown }; appsFail?: boolean } = {}) {
  const engine: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  let kyc = opts.kyc ?? "PENDING";
  page.on("request", (r) => { if (/\/tok\/accounting\//.test(r.url())) engine.push(new URL(r.url()).pathname); });
  await page.route(/\/omni\/api\/operator\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    if (req.method() === "POST") {
      posts.push({ path, body: req.postDataJSON() });
      if (path === `/investors/${INV1}/kyc-status`) {
        const d = opts.decide ?? { status: 200, body: { investorId: INV1, legalName: "Test Farmer One", kycStatus: (req.postDataJSON() as Obj).kycStatus } };
        if (d.status === 200) kyc = String((d.body as Obj).kycStatus);
        return json(route, d.body, d.status);
      }
      return json(route, envelope(404, "Not stubbed"), 404);
    }
    if (path === "/onboarding/applications") {
      if (opts.appsFail) return json(route, envelope(500, "applications down"), 500);
      return json(route, (opts.apps ?? { MISMATCH: [app(P1, "MISMATCH")] })[url.searchParams.get("identityResult") ?? "MISMATCH"] ?? []);
    }
    if (path === "/onboarding/applications/screening-hits") return json(route, []);
    if (path === "/onboarding/documents") {
      if (url.searchParams.get("status") === "PASSED") return json(route, []);
      if (url.searchParams.get("profileId")) return json(route, []);
      return json(route, opts.waiting ?? []);
    }
    if (path.startsWith("/onboarding/documents/")) return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from([]) });
    if (path.startsWith("/customers/")) return json(route, customer(path.split("/")[2], kyc));
    return json(route, []);
  });
  return { engine, posts };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the desk lists this institution's applicants from omnichannel, and never reads the engine's reviews or register", async ({ page }) => {
  const { engine } = await stub(page, {
    apps: { MISMATCH: [app(P1, "MISMATCH")], UNCHECKED: [app(P2, "UNCHECKED", { fullName: "Test Farmer Two", externalRef: "" })], MATCH: [app(P3, "MATCH", { fullName: "Test Farmer Three" })] },
    waiting: [doc(P3)],
  });
  await page.goto("/token-console/kyc");
  await expect(page.getByRole("heading", { name: "KYC desk", level: 1 })).toBeVisible();
  const main = page.locator("main");
  for (const n of ["Test Farmer One", "Test Farmer Two", "Test Farmer Three"]) await expect(main.getByText(n).first()).toBeVisible();
  await expect(main).toContainText("Differs: name");
  await expect(main).not.toContainText("Reviews open");
  await page.waitForLoadState("networkidle");
  expect(engine).toEqual([]);
});

test("a matched application with nothing waiting is not on the desk", async ({ page }) => {
  await stub(page, { apps: { MATCH: [app(P3, "MATCH", { fullName: "Test Farmer Three" })] } });
  await page.goto("/token-console/kyc");
  await expect(page.getByText("Nothing is waiting on a KYC decision")).toBeVisible();
  await expect(page.locator("main").getByText("Test Farmer Three")).toHaveCount(0);
});

test("the panel shows their KYC status from omnichannel, and Approve sets it there", async ({ page }) => {
  const { posts, engine } = await stub(page);
  await page.goto("/token-console/kyc");
  await page.locator("main").getByText("Test Farmer One").first().click();
  const standing = page.getByTestId("applicant-standing");
  await expect(standing).toContainText(INV1);
  await expect(standing).toContainText("Pending");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Approve applicant" }).click();
  await expect(page.getByText("KYC status is now verified")).toBeVisible();
  expect(posts).toEqual([{ path: `/investors/${INV1}/kyc-status`, body: { kycStatus: "VERIFIED" } }]);
  await expect(standing).toContainText("Verified");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  expect(engine).toEqual([]);
});

test("Reject sets REJECTED; a refusal shows omnichannel's reason", async ({ page }) => {
  const { posts } = await stub(page, { decide: { status: 404, body: envelope(404, "Investor not found") } });
  await page.goto("/token-console/kyc");
  await page.locator("main").getByText("Test Farmer One").first().click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: "Reject applicant" }).click();
  await expect(page.getByText("Investor not found")).toBeVisible();
  expect(posts.map((p) => p.body)).toEqual([{ kycStatus: "REJECTED" }]);
});

test("someone with photos but no application has nothing to decide yet", async ({ page }) => {
  await stub(page, { apps: {}, waiting: [doc(P2)] });
  await page.goto("/token-console/kyc");
  await page.locator("main").getByText("Has not applied yet").first().click();
  await expect(page.getByText("there is no KYC status to decide")).toBeVisible();
});

test("applications that cannot be read are an error, not an empty desk", async ({ page }) => {
  await stub(page, { appsFail: true });
  await page.goto("/token-console/kyc");
  await expect(page.getByText("Could not load the KYC desk")).toBeVisible();
  await expect(page.getByText("Nothing is waiting on a KYC decision")).toHaveCount(0);
});
