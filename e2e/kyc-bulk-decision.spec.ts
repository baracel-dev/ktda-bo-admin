import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn, STAFF } from "./stubs";

/* One KYC decision for many farmers on the KYC desk (KycBulkDecision.tsx):
 * POST /farmers/kyc/decisions/bulk. Verifying only the registry's matches
 * starts at once (201, the run); anything else is one approval request (202).
 * GET reads the latest run, polled while it runs; when it ends the desk's
 * counts are read again. Stubbed. */

type Obj = Record<string, unknown>;
type Answer = { status: number; body: unknown };
const PATH = "/farmers/kyc/decisions/bulk";

const bulk = (status: string, decided: number, over: Obj = {}): Obj => ({
  id: "b1", status, decision: "VERIFIED", scope: "REGISTRY_MATCH", total: 10, decided, skipped: 1, failed: 0,
  requestedBy: "officer@ktda.test", approvedBy: null, startedAt: "2026-11-09T16:00:00Z",
  finishedAt: status === "RUNNING" ? null : "2026-11-09T16:02:00Z",
  message: status === "COMPLETED" ? `Verified ${decided} farmers; 1 skipped.` : null, ...over,
});

const approval = (over: Obj = {}): Obj => ({
  id: "ap-20", reference: "AP-10020", type: "FARMER_KYC_BULK_DECISION", title: "Verify KYC for every farmer waiting (10,014)",
  target: { kind: "FARMER", reference: "ALL_PENDING", name: null }, changes: [], reason: "Payouts this evening.", payload: {}, status: "PENDING",
  maker: "staff:amina@baracel.ae", madeAt: "2026-11-09T16:00:00Z", checker: null, decidedAt: null, decisionNote: null, appliedAt: null, error: null,
  checkerRoles: ["COMPLIANCE"], ...over,
});

/** `gets`: what GET answers before the POST (the first) and after it (the
 *  rest, one per poll, the last repeated). */
async function stub(page: Page, opts: { gets?: Answer[]; post?: Answer } = {}) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  let posted = false;
  let g = 0;
  await page.route(/\/omni\/api\/operator\//, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/omni\/api\/operator/, "");
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    sent.push({ method: req.method(), path, body });
    if (path === PATH) {
      if (req.method() === "POST") { posted = true; const a = opts.post ?? { status: 201, body: bulk("RUNNING", 0) }; return json(route, a.body, a.status); }
      const gets = opts.gets ?? [{ status: 404, body: envelope(404, "No bulk decision") }];
      const after = gets.slice(1);
      const a = !posted || !after.length ? gets[0] : after[Math.min(g++, after.length - 1)];
      return json(route, a.body, a.status);
    }
    if (path === "/farmers/kyc/sweep") return json(route, envelope(404, "No sweep"), 404);
    if (path === "/farmers") return json(route, []);
    if (path === "/farmers/summary") return json(route, { registered: 0, activated: 10, funded: 0, total: 10, kyc: { none: 0, pending: 10, verified: 0, rejected: 0 } });
    return json(route, []);
  });
  return sent;
}

const posts = (sent: { method: string; path: string; body: unknown }[]) => sent.filter((s) => s.method === "POST" && s.path === PATH);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("on To decide: never run says so, and a decider is offered Decide for many", async ({ page }) => {
  await stub(page);
  await page.goto("/token-console/kyc?kyc=PENDING");
  const panel = page.getByTestId("kyc-bulk");
  await expect(panel.getByRole("heading", { name: "Bulk decision" })).toBeVisible();
  await expect(panel.getByTestId("bulk-never")).toHaveText("No bulk decision has run yet.");
  await expect(panel.getByRole("button", { name: "Decide for many" })).toBeEnabled();
});

test("on Not started it sits under the sweep", async ({ page }) => {
  await stub(page);
  await page.goto("/token-console/kyc?kyc=NONE");
  await expect(page.getByTestId("kyc-sweep")).toBeVisible();
  await expect(page.getByTestId("kyc-bulk")).toBeVisible();
  const sweepBox = await page.getByTestId("kyc-sweep").boundingBox();
  const bulkBox = await page.getByTestId("kyc-bulk").boundingBox();
  expect(bulkBox!.y).toBeGreaterThan(sweepBox!.y);
});

test("verifying the registry's matches starts at once: polled while it runs, then the counts refresh", async ({ page }) => {
  const sent = await stub(page, {
    gets: [
      { status: 404, body: envelope(404, "No bulk decision") },
      { status: 200, body: bulk("RUNNING", 6) },
      { status: 200, body: bulk("COMPLETED", 9) },
    ],
  });
  await page.goto("/token-console/kyc?kyc=PENDING");
  await page.getByRole("button", { name: "Decide for many" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Verify")).toBeChecked();
  await expect(dialog.getByLabel("Only those the registry matched")).toBeChecked();
  await expect(dialog.getByTestId("bulk-at-once")).toBeVisible();
  await expect(dialog.getByTestId("bulk-override")).toHaveCount(0);
  // Nothing goes to a checker, so no reason is asked for.
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveCount(0);

  // The note is needed: it goes on every farmer.
  await dialog.getByRole("button", { name: "Verify now" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Write the note");
  expect(posts(sent)).toHaveLength(0);

  await dialog.getByLabel("Decision note").fill("Registry match confirmed in bulk.");
  await dialog.getByRole("button", { name: "Verify now" }).click();
  await expect(dialog).toHaveCount(0);
  const counts = page.getByTestId("bulk-counts");
  await expect(counts).toHaveText("Verified 0 of 10, 1 skipped, 0 failed.");
  await expect(page.getByRole("button", { name: "Running…" })).toBeDisabled();
  await expect(counts).toHaveText("Verified 6 of 10, 1 skipped, 0 failed.", { timeout: 8000 });
  await expect(counts).toHaveText("Verified 9 of 10, 1 skipped, 0 failed.", { timeout: 8000 });
  await expect(page.getByTestId("bulk-message")).toHaveText("Verified 9 farmers; 1 skipped.");
  await expect(page.getByTestId("bulk-state")).toContainText("Finished");

  expect(posts(sent).map((s) => s.body)).toEqual([{ decision: "VERIFIED", scope: "REGISTRY_MATCH", note: "Registry match confirmed in bulk." }]);
  await expect.poll(() => sent.filter((s) => s.path === "/farmers/summary").length).toBeGreaterThan(1);
  await expect(page.getByRole("button", { name: "Decide for many" })).toBeEnabled();
});

test("verifying every farmer waiting is an override: sent for approval with the reason, linked to the request", async ({ page }) => {
  const sent = await stub(page, { post: { status: 202, body: { approval: approval() } } });
  await page.goto("/token-console/kyc?kyc=PENDING");
  await page.getByRole("button", { name: "Decide for many" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Every farmer waiting for a decision").check();
  await expect(dialog.getByTestId("bulk-override")).toHaveText("Verifying farmers the registry did not match is an override and needs approval.");
  await dialog.getByLabel("Decision note").fill("Verified in bulk for the evening payouts.");
  await dialog.getByLabel("Reason", { exact: true }).fill("Payouts this evening.");
  await dialog.getByRole("button", { name: "Send for approval" }).click();

  const notice = page.getByTestId("sent-for-approval");
  await expect(notice).toContainText("Sent for approval AP-10020");
  await expect(notice.getByRole("link", { name: "Approvals" })).toHaveAttribute("href", /AP-10020/);
  expect(posts(sent).map((s) => s.body)).toEqual([{ decision: "VERIFIED", scope: "ALL_PENDING", note: "Verified in bulk for the evening payouts.", reason: "Payouts this evening." }]);
  // Nothing has run yet.
  await expect(page.getByTestId("bulk-never")).toBeVisible();
});

test("a pasted list or a CSV of grower numbers: counted once each, header left out, sent as growerNos", async ({ page }) => {
  const sent = await stub(page, { post: { status: 202, body: { approval: approval({ title: "Reject KYC for 3 farmers" }) } } });
  await page.goto("/token-console/kyc?kyc=PENDING");
  await page.getByRole("button", { name: "Decide for many" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reject").check();
  await expect(dialog.getByTestId("bulk-reject-approval")).toBeVisible();
  await dialog.getByLabel("The grower numbers listed").check();
  await dialog.getByLabel("Grower numbers", { exact: true }).fill("test000001, TEST000002\nTEST000001");
  await expect(dialog.getByTestId("bulk-grower-count")).toHaveText("2 grower numbers.");

  await dialog.getByLabel("Grower numbers file").setInputFiles({
    name: "growers.csv", mimeType: "text/csv", buffer: Buffer.from("grower_no\nTEST000003\nTEST000004\nTEST000003\n"),
  });
  await expect(dialog.getByTestId("bulk-grower-count")).toHaveText("2 grower numbers.");
  await dialog.getByLabel("Decision note").fill("Duplicate registrations.");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByTestId("sent-for-approval")).toContainText("AP-10020");
  expect(posts(sent).map((s) => s.body)).toEqual([{ decision: "REJECTED", scope: "GROWERS", note: "Duplicate registrations.", growerNos: ["TEST000003", "TEST000004"] }]);
});

test("an empty list is stopped before it is sent", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/token-console/kyc?kyc=PENDING");
  await page.getByRole("button", { name: "Decide for many" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("The grower numbers listed").check();
  await dialog.getByLabel("Decision note").fill("x");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(dialog.getByRole("alert")).toContainText("List at least one grower number");
  expect(posts(sent)).toHaveLength(0);
});

test("a request already waiting (409 APPROVAL_PENDING) links to it; one already running says so", async ({ page }) => {
  await stub(page, { post: { status: 409, body: envelope(409, "A bulk KYC decision is already waiting for approval: AP-10019.", "APPROVAL_PENDING") } });
  await page.goto("/token-console/kyc?kyc=PENDING");
  await page.getByRole("button", { name: "Decide for many" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Every farmer waiting for a decision").check();
  await dialog.getByLabel("Decision note").fill("x");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(dialog.getByTestId("approval-ref-link")).toHaveAttribute("href", /AP-10019/);

  await page.unroute(/\/omni\/api\/operator\//);
  await stub(page, { post: { status: 409, body: envelope(409, "A bulk KYC decision is already running.", "KYC_BULK_RUNNING") } });
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already running");
});

test("a 404 on POST is not available on this environment yet", async ({ page }) => {
  await stub(page, { post: { status: 404, body: envelope(404, "Not Found") } });
  await page.goto("/token-console/kyc?kyc=PENDING");
  await page.getByRole("button", { name: "Decide for many" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Decision note").fill("x");
  await dialog.getByRole("button", { name: "Verify now" }).click();
  await expect(dialog).toContainText("Not available on this environment yet");
});

test("an approved run shows who asked and who approved; a failed one its message", async ({ page }) => {
  await stub(page, { gets: [{ status: 200, body: bulk("FAILED", 4, { scope: "ALL_PENDING", approvedBy: "staff:checker@ktda.test", message: "The ledger refused the batch" }) }] });
  await page.goto("/token-console/kyc?kyc=PENDING");
  const state = page.getByTestId("bulk-state");
  await expect(state).toContainText("Failed");
  await expect(state).toContainText("Every farmer waiting for a decision");
  await expect(state).toContainText("asked by officer@ktda.test");
  await expect(state).toContainText("approved by staff:checker@ktda.test");
  await expect(page.getByTestId("bulk-message")).toHaveText("The ledger refused the batch");
});

test("someone who may not decide KYC sees the last run but cannot ask for one", async ({ page }) => {
  await page.route(/\/tok\/auth\/me$/, (route) => json(route, { email: STAFF.email, fullName: STAFF.fullName, roles: ["ACCOUNTANT"], admin: false }));
  await stub(page, { gets: [{ status: 200, body: bulk("COMPLETED", 9) }] });
  await page.goto("/token-console/kyc?kyc=PENDING");
  await expect(page.getByTestId("bulk-state")).toBeVisible();
  await expect(page.getByRole("button", { name: "Decide for many" })).toHaveCount(0);
});
