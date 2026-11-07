import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* Assisted onboarding (KTDA 5.2.1) and a farmer's photos on the farmer
 * profile, and how farmers joined on Farmers: POST /farmers/{g}/assisted-
 * onboarding, POST and GET /farmers/{g}/documents, the farmer's onboarding
 * {channel, agentNo, at}, the list's channel= filter and the summary's
 * byChannel. Stubbed. */

type Obj = Record<string, unknown>;
const farmer = (status: string, over: Obj = {}): Obj => ({
  growerNo: "TEST000011", fullName: "Alice Wanjiru Kamau", phone: "+254700000211", factory: "Test Factory A", status,
  registeredAt: "2026-11-07T08:00:00Z", activatedAt: status === "REGISTERED" ? null : "2026-11-07T09:00:00Z", lastFundedAt: null,
  customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", clashReason: null,
  kyc: { status: "NONE", identityResult: null, startedAt: null, decidedAt: null, note: null }, onboarding: null, ...over,
});
const ONBOARDED = farmer("ACTIVATED", {
  kyc: { status: "PENDING", identityResult: "MATCH", startedAt: "2026-11-07T09:00:00Z", decidedAt: null, note: null },
  onboarding: { channel: "AGENT", agentNo: "A-0042", at: "2026-11-07T09:00:00Z" },
});
const doc = (type: string, status: string, over: Obj = {}): Obj => ({
  id: `doc-${type}`, type, contentType: "image/png", sizeBytes: 1000, status, reviewNote: null, reviewedAt: null, uploadedAt: "2026-11-07T08:30:00Z", required: true, ...over,
});
type Answer = { status: number; body: unknown };

async function stub(page: Page, opts: { one?: Obj; afterOnboard?: Obj; onboard?: Answer; docs?: Answer; upload?: Answer } = {}) {
  const sent: { method: string; path: string; body: unknown; raw: string }[] = [];
  let current = opts.one ?? farmer("REGISTERED");
  await page.route(/\/omni\/api\/operator\/farmers\//, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/omni\/api\/operator/, "");
    const raw = req.postDataBuffer()?.toString("latin1") ?? "";
    const isJson = (req.headers()["content-type"] ?? "").includes("json");
    sent.push({ method: req.method(), path, body: req.method() === "POST" && isJson ? req.postDataJSON() : null, raw });
    if (path.endsWith("/assisted-onboarding")) {
      const a = opts.onboard ?? { status: 200, body: opts.afterOnboard ?? ONBOARDED };
      if (a.status === 200) current = a.body as Obj;
      return json(route, a.body, a.status);
    }
    if (path.endsWith("/documents")) {
      if (req.method() === "POST") { const a = opts.upload ?? { status: 201, body: doc("SELFIE", "PENDING_REVIEW") }; return json(route, a.body, a.status); }
      const a = opts.docs ?? { status: 200, body: [doc("SELFIE", "PASSED"), doc("ID_FRONT", "FAILED", { reviewNote: "Blurred, take it again." })] };
      return json(route, a.body, a.status);
    }
    if (/\/wallet/.test(path)) return json(route, path.endsWith("movements") ? [] : { growerNo: "x", status: "REGISTERED", walletOpen: false, balances: [] });
    return json(route, current);
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.describe("assisted onboarding", () => {
  test("a registered farmer: the form, the body as the contract has it, and the outcome", async ({ page }) => {
    const sent = await stub(page);
    await page.goto("/farmers/TEST000011");
    const form = page.getByTestId("assisted-onboarding");
    const submit = form.getByRole("button", { name: "Complete onboarding" });
    await expect(submit).toBeDisabled();
    await form.getByLabel("National ID").fill("12345678");
    await form.getByLabel("Date of birth").fill("1990-05-14");
    await expect(page.getByTestId("assisted-problem")).toContainText("agree to the terms");
    await form.getByLabel("ID document reference").fill("TEST-ID-000011");
    await form.getByLabel("Field agent number").fill("A-0042");
    await expect(form).toContainText("earns the onboarding commission");
    await form.getByText("The farmer has agreed to the institution's terms, in front of me.").click();
    await submit.click();
    const done = page.getByTestId("assisted-done");
    await expect(done).toContainText("is activated");
    await expect(done).toContainText("KYC: to decide, the registry says: matches the registry");
    await expect(done).toContainText("by agent A-0042");
    const post = sent.find((s) => s.path.endsWith("/assisted-onboarding"))!;
    expect(post.body).toEqual({ nationalId: "12345678", dateOfBirth: "1990-05-14", idDocumentRef: "TEST-ID-000011", agentNo: "A-0042", consent: { terms: true } });
    // The farmer is read again: activated now, and how they joined is on the header line.
    await expect(page.getByTestId("farmer-profile")).toContainText("joined via agent (agent A-0042)");
    await expect(page.getByTestId("farmer-details")).toContainText("Activated");
  });

  test("a national ID already on file is not asked for and not sent", async ({ page }) => {
    const sent = await stub(page, { one: farmer("REGISTERED", { nationalIdOnFile: true }) });
    await page.goto("/farmers/TEST000011");
    const form = page.getByTestId("assisted-onboarding");
    await expect(form.getByLabel("National ID")).toHaveValue("On file");
    await expect(form.getByLabel("National ID")).toBeDisabled();
    await form.getByLabel("Date of birth").fill("1990-05-14");
    await form.getByText("The farmer has agreed to the institution's terms, in front of me.").click();
    await form.getByRole("button", { name: "Complete onboarding" }).click();
    await expect(page.getByTestId("assisted-done")).toBeVisible();
    expect(sent.find((s) => s.path.endsWith("/assisted-onboarding"))!.body).toEqual({ dateOfBirth: "1990-05-14", consent: { terms: true } });
  });

  test("with none on file the national ID is needed", async ({ page }) => {
    await stub(page, { one: farmer("REGISTERED", { nationalIdOnFile: false }) });
    await page.goto("/farmers/TEST000011");
    const form = page.getByTestId("assisted-onboarding");
    await form.getByLabel("Date of birth").fill("1990-05-14");
    await form.getByText("The farmer has agreed to the institution's terms, in front of me.").click();
    await expect(page.getByTestId("assisted-problem")).toContainText("national ID is needed");
    await expect(form.getByRole("button", { name: "Complete onboarding" })).toBeDisabled();
  });

  for (const [code, message] of [
    ["FARMER_ALREADY_ACTIVATED", "This farmer's wallet is already open"],
    ["WALLET_NOT_OPENED", "The ledger opened no wallet: grower TEST000011 already exists"],
    ["AGENT_SUSPENDED", "Agent A-0042 is suspended"],
    ["FARMER_HELD", "The phone given is already another farmer's login"],
  ]) {
    test(`a refusal (${code}) shows omnichannel's message`, async ({ page }) => {
      await stub(page, { onboard: { status: 409, body: envelope(409, message, code) } });
      await page.goto("/farmers/TEST000011");
      const form = page.getByTestId("assisted-onboarding");
      await form.getByLabel("National ID").fill("12345678");
      await form.getByLabel("Date of birth").fill("1990-05-14");
      await form.getByText("The farmer has agreed to the institution's terms, in front of me.").click();
      await form.getByRole("button", { name: "Complete onboarding" }).click();
      await expect(form.getByRole("alert")).toHaveText(message);
      await expect(page.getByTestId("assisted-done")).toHaveCount(0);
    });
  }

  test("an omnichannel without it says not available", async ({ page }) => {
    await stub(page, { onboard: { status: 404, body: envelope(404, "Not Found") } });
    await page.goto("/farmers/TEST000011");
    const form = page.getByTestId("assisted-onboarding");
    await form.getByLabel("National ID").fill("12345678");
    await form.getByLabel("Date of birth").fill("1990-05-14");
    await form.getByText("The farmer has agreed to the institution's terms, in front of me.").click();
    await form.getByRole("button", { name: "Complete onboarding" }).click();
    await expect(form).toContainText("Not available on this environment yet");
  });

  test("not offered to an activated farmer or a clash; a clash has no photos either", async ({ page }) => {
    await stub(page, { one: ONBOARDED });
    await page.goto("/farmers/TEST000011");
    await expect(page.getByTestId("farmer-photos")).toBeVisible();
    await expect(page.getByTestId("assisted-onboarding")).toHaveCount(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await signIn(page);
    await stub(page, { one: farmer("CLASH", { clashReason: "The phone is another farmer's login." }) });
    await page.goto("/farmers/TEST000011");
    await expect(page.getByTestId("farmer-profile")).toBeVisible();
    await expect(page.getByTestId("assisted-onboarding")).toHaveCount(0);
    await expect(page.getByTestId("farmer-photos")).toHaveCount(0);
  });
});

test.describe("photos", () => {
  test("lists each photo's review state, and uploads one as multipart type and file", async ({ page }) => {
    const sent = await stub(page);
    await page.goto("/farmers/TEST000011");
    const photos = page.getByTestId("farmer-photos");
    await expect(photos.locator('[data-photo="SELFIE"]')).toContainText("Approved");
    await expect(photos.locator('[data-photo="ID_FRONT"]')).toContainText("Rejected");
    await expect(photos.locator('[data-photo="ID_FRONT"]')).toContainText("Blurred, take it again.");
    await expect(photos.locator('[data-photo="ID_BACK"]')).toContainText("Not sent");
    await photos.getByLabel("Photo type").selectOption("ID_BACK");
    await photos.getByLabel("Photo file").setInputFiles({ name: "id-back.png", mimeType: "image/png", buffer: Buffer.from("png") });
    await photos.getByRole("button", { name: "Upload" }).click();
    await expect.poll(() => sent.filter((s) => s.method === "GET" && s.path.endsWith("/documents")).length).toBeGreaterThan(1);
    const post = sent.find((s) => s.method === "POST" && s.path.endsWith("/documents"))!;
    expect(post.path).toBe("/farmers/TEST000011/documents");
    expect(post.raw).toContain('name="type"');
    expect(post.raw).toContain("ID_BACK");
    expect(post.raw).toMatch(/name="file"; filename="id-back.png"/);
  });

  test("a file that is not a JPEG or PNG is refused before upload; omnichannel's refusal is shown", async ({ page }) => {
    await stub(page, { upload: { status: 400, body: envelope(400, "The file is not an image", undefined, "file") } });
    await page.goto("/farmers/TEST000011");
    const photos = page.getByTestId("farmer-photos");
    await photos.getByLabel("Photo file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.getByTestId("photo-problem")).toHaveText("A photo is a JPEG or PNG.");
    await expect(photos.getByRole("button", { name: "Upload" })).toBeDisabled();
    await photos.getByLabel("Photo file").setInputFiles({ name: "s.jpg", mimeType: "image/jpeg", buffer: Buffer.from("jpg") });
    await photos.getByRole("button", { name: "Upload" }).click();
    await expect(photos.getByRole("alert")).toHaveText("The file is not an image");
  });

  test("an omnichannel without farmer photos says so", async ({ page }) => {
    await stub(page, { docs: { status: 404, body: envelope(404, "Not Found") } });
    await page.goto("/farmers/TEST000011");
    await expect(page.getByTestId("photos-not-available")).toBeVisible();
  });
});

test.describe("how farmers joined", () => {
  test("a Joined via column, the channel filter, and the chart from byChannel", async ({ page }) => {
    const sent: URLSearchParams[] = [];
    await page.route(/\/omni\/api\/operator\/farmers(\?.*)?$/, (route) => {
      sent.push(new URL(route.request().url()).searchParams);
      return json(route, [ONBOARDED, farmer("ACTIVATED", { growerNo: "TEST000012", onboarding: { channel: "BULK", agentNo: null, at: "2026-11-07T09:00:00Z" } }), farmer("REGISTERED", { growerNo: "TEST000013" })]);
    });
    await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => json(route, {
      registered: 1, activated: 2, funded: 0, total: 3, byChannel: { bulk: 6, agent: 3, staff: 1, app: 0, ussd: 0, unknown: 0 },
    }));
    await page.goto("/farmers");
    const cells = page.getByTestId("channel-cell");
    await expect(cells.nth(0)).toContainText("Agent");
    await expect(cells.nth(0)).toContainText("A-0042");
    await expect(cells.nth(1)).toHaveText("Bulk (factory file)");
    await expect(cells.nth(2)).toHaveText("—");
    const chart = page.getByTestId("how-joined");
    await expect(chart).toContainText("How farmers joined");
    await expect(chart.getByRole("img")).toHaveAttribute("aria-label", /Bulk \(factory file\) 6 \(60%\), Agent 3 \(30%\), Staff, in person 1 \(10%\)/);
    await page.getByRole("button", { name: "Any way of joining" }).click();
    await page.getByRole("option", { name: "Joined via agent" }).click();
    await expect(page).toHaveURL(/channel=AGENT/);
    await expect.poll(() => sent.some((q) => q.get("channel") === "AGENT")).toBe(true);
  });

  test("no chart where omnichannel does not count channels", async ({ page }) => {
    await page.route(/\/omni\/api\/operator\/farmers(\?.*)?$/, (route) => json(route, []));
    await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => json(route, { registered: 0, activated: 0, funded: 0, total: 0 }));
    await page.goto("/farmers");
    await expect(page.getByTestId("farmers-empty")).toBeVisible();
    await expect(page.getByTestId("how-joined")).toHaveCount(0);
  });
});
