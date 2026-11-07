import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn, STAFF } from "./stubs";

/* The KYC sweep on the KYC desk's Not started tab (KycSweep.tsx): POST /farmers/kyc/sweep starts KYC
 * for the backlog, GET reads the latest, polled while it runs. A 409
 * KYC_SWEEP_RUNNING shows the running one; a 404 on GET is "never run", on
 * POST "not available on this environment yet". Stubbed. */

type Obj = Record<string, unknown>;
const sweep = (status: string, started: number, notStarted: number, over: Obj = {}): Obj => ({
  id: "s1", status, total: 10, started, notStarted, requestedBy: "officer@ktda.test",
  startedAt: "2026-11-07T08:00:00Z", finishedAt: status === "RUNNING" ? null : "2026-11-07T08:05:00Z",
  message: status === "COMPLETED" ? "Started KYC for 8 farmers; 2 could not start." : null, ...over,
});
type Answer = { status: number; body: unknown };

/** `gets`: what GET answers before the POST (the first) and after it (the
 *  rest, one per poll, the last repeated). */
async function stub(page: Page, opts: { gets?: Answer[]; post?: Answer } = {}) {
  const sent: { method: string; path: string }[] = [];
  let posted = false;
  let g = 0;
  await page.route(/\/omni\/api\/operator\//, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/omni\/api\/operator/, "");
    sent.push({ method: req.method(), path });
    if (path === "/farmers/kyc/sweep") {
      if (req.method() === "POST") { posted = true; const a = opts.post ?? { status: 202, body: sweep("RUNNING", 0, 0) }; return json(route, a.body, a.status); }
      const gets = opts.gets ?? [{ status: 404, body: envelope(404, "No sweep") }];
      const after = gets.slice(1);
      const a = !posted || !after.length ? gets[0] : after[Math.min(g++, after.length - 1)];
      return json(route, a.body, a.status);
    }
    if (path === "/farmers") return json(route, []);
    if (path === "/farmers/summary") return json(route, { registered: 0, activated: 10, funded: 0, total: 10, kycPending: 0 });
    return json(route, []);
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("never run: says so, and the start is offered to a decider", async ({ page }) => {
  await stub(page);
  await page.goto("/token-console/kyc?kyc=NONE");
  await expect(page.getByTestId("sweep-never")).toHaveText("No sweep has run yet.");
  await expect(page.getByRole("button", { name: "Start KYC for all activated farmers" })).toBeEnabled();
});

test("start, poll while it runs, then show the outcome and refresh the farmers", async ({ page }) => {
  const sent = await stub(page, {
    gets: [
      { status: 404, body: envelope(404, "No sweep") },
      { status: 200, body: sweep("RUNNING", 4, 1) },
      { status: 200, body: sweep("COMPLETED", 8, 2) },
    ],
  });
  await page.goto("/token-console/kyc?kyc=NONE");
  await expect(page.getByTestId("sweep-never")).toBeVisible();
  await page.getByRole("button", { name: "Start KYC for all activated farmers" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start", exact: true }).click();
  const counts = page.getByTestId("sweep-counts");
  await expect(counts).toHaveText("Started 0 of 10, 0 not started.");
  await expect(page.getByRole("button", { name: "Running…" })).toBeDisabled();
  await expect(counts).toHaveText("Started 4 of 10, 1 not started.", { timeout: 8000 });
  await expect(counts).toHaveText("Started 8 of 10, 2 not started.", { timeout: 8000 });
  await expect(page.getByTestId("sweep-message")).toHaveText("Started KYC for 8 farmers; 2 could not start.");
  await expect(page.getByTestId("sweep-state")).toContainText("Finished");
  expect(sent.filter((s) => s.method === "POST").map((s) => s.path)).toEqual(["/farmers/kyc/sweep"]);
  // The list and the counts were read again once it ended.
  await expect.poll(() => sent.filter((s) => s.path === "/farmers/summary").length).toBeGreaterThan(1);
  await expect(page.getByRole("button", { name: "Start KYC for all activated farmers" })).toBeEnabled();
});

test("one already running (409) reads as such and shows that sweep", async ({ page }) => {
  await stub(page, {
    gets: [{ status: 404, body: envelope(404, "No sweep") }, { status: 200, body: sweep("RUNNING", 3, 0) }],
    post: { status: 409, body: envelope(409, "A KYC sweep is already running", "KYC_SWEEP_RUNNING") },
  });
  await page.goto("/token-console/kyc?kyc=NONE");
  await page.getByRole("button", { name: "Start KYC for all activated farmers" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("sweep-already-running")).toBeVisible();
  await expect(page.getByTestId("sweep-counts")).toHaveText("Started 3 of 10, 0 not started.");
});

test("the latest sweep stays on the page with its date", async ({ page }) => {
  await stub(page, { gets: [{ status: 200, body: sweep("COMPLETED", 8, 2) }] });
  await page.goto("/token-console/kyc?kyc=NONE");
  const state = page.getByTestId("sweep-state");
  await expect(state).toContainText("Finished");
  await expect(state).toContainText("Last run");
  await expect(state).toContainText("officer@ktda.test");
  await expect(page.getByTestId("sweep-message")).toBeVisible();
});

test("an interrupted or failed sweep says so", async ({ page }) => {
  await stub(page, { gets: [{ status: 200, body: sweep("FAILED", 2, 0, { message: "Registry unreachable" }) }] });
  await page.goto("/token-console/kyc?kyc=NONE");
  await expect(page.getByTestId("sweep-state")).toContainText("Failed");
  await expect(page.getByTestId("sweep-message")).toHaveText("Registry unreachable");
});

test("a 404 on POST is not available on this environment yet", async ({ page }) => {
  await stub(page, { post: { status: 404, body: envelope(404, "Not Found") } });
  await page.goto("/token-console/kyc?kyc=NONE");
  await page.getByRole("button", { name: "Start KYC for all activated farmers" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("sweep-not-available")).toContainText("Not available on this environment yet");
  await expect(page.getByTestId("sweep-never")).toBeVisible();
});

test("someone who may not decide KYC sees the last sweep but cannot start one", async ({ page }) => {
  await page.route(/\/tok\/auth\/me$/, (route) => json(route, { email: STAFF.email, fullName: STAFF.fullName, roles: ["ACCOUNTANT"], admin: false }));
  await stub(page, { gets: [{ status: 200, body: sweep("COMPLETED", 8, 2) }] });
  await page.goto("/token-console/kyc?kyc=NONE");
  await expect(page.getByTestId("sweep-state")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start KYC for all activated farmers" })).toHaveCount(0);
});
