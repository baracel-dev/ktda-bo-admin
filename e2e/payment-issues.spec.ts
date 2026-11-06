import { expect, test, type Page, type Request } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

const PAYOUT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRANSFER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const payment = (id: string, over: Record<string, unknown>) => ({
  id, direction: "OUT", status: "FAILED", method: "MPESA", phone: "+254700000000", amount: 1000, currency: "KES",
  reference: "WD-1", providerRef: null, failureReason: "Simulated failure", createdAt: "2026-10-18T08:00:00Z", completedAt: null, ...over,
});

const ISSUES = [
  { profileId: ALICE, kind: "PAYOUT_FAILED", why: "The payout was not made: Simulated failure.", payment: payment(PAYOUT, {}) },
  {
    profileId: BOB, kind: "TRANSFER_WAITING", why: "Reported 2 days ago under reference IC-ABCDEFGH and not matched yet.",
    payment: payment(TRANSFER, { direction: "IN", status: "PENDING", method: "BANK_TRANSFER", phone: null, amount: 50, currency: "USD", reference: "IC-ABCDEFGH" }),
  },
];

type Write = { path: string; body: unknown; subject?: string };

/** The queue over `issues`; `answer` decides each write (default: handled, leaves the queue). */
async function stubIssues(page: Page, answer?: (req: Request) => { status: number; body: unknown } | null, issues = ISSUES) {
  const state = { issues: [...issues], reads: 0, pages: new Set<string>(), writes: [] as Write[], truncated: false };
  // Paged as omnichannel pages it: `page` from 1, `size`, totals in headers.
  await page.route(/\/omni\/api\/operator\/payments\/issues(\?.*)?$/, (route) => {
    state.reads++;
    const url = new URL(route.request().url());
    const pageNo = Number(url.searchParams.get("page") ?? "1");
    state.pages.add(`${pageNo}/${url.searchParams.get("size")}`);
    const size = Number(url.searchParams.get("size") ?? "20");
    const items = state.issues.slice((pageNo - 1) * size, pageNo * size);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "X-Total-Count": String(state.issues.length), "X-Page": String(pageNo), "X-Size": String(size),
        "X-Total-Pages": String(Math.ceil(state.issues.length / size)),
        ...(state.truncated ? { "X-Truncated": "true" } : {}),
      },
      body: JSON.stringify(items),
    });
  });
  await page.route(/\/omni\/api\/operator\/payments\/[^/]+\/(retry|resolve|match|unmatched|confirm-sent|confirm-not-sent)$/, (route) => {
    const req = route.request();
    const [, id, action] = /payments\/([^/]+)\/([\w-]+)$/.exec(new URL(req.url()).pathname)!;
    state.writes.push({ path: `${id}/${action}`, body: req.postDataJSON(), subject: req.headers()["x-dev-subject"] });
    const custom = answer?.(req);
    if (custom) return json(route, custom.body, custom.status);
    state.issues = state.issues.filter((i) => i.payment.id !== id);
    return json(route, payment(id, { status: action === "retry" ? "PENDING" : "FAILED" }), action === "retry" ? 201 : 200);
  });
  await page.route(/\/omni\/api\/operator\/customers\/[^/]+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    if (id === ALICE) return json(route, { profileId: ALICE, legalName: "Alice Wanjiru", displayName: "Alice" });
    return json(route, envelope(404, "Not found"), 404);
  });
  return state;
}

async function openIssues(page: Page) {
  await page.goto("/token-console/transactions?tab=issues");
  await expect(page.getByRole("tab", { name: /Issues/ })).toHaveAttribute("aria-selected", "true");
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("each row offers the actions for its kind, with the customer's name", async ({ page }) => {
  await stubIssues(page);
  await openIssues(page);

  const payout = page.getByTestId(`issue-actions-${PAYOUT}`);
  await expect(payout.getByRole("button")).toHaveText(["Retry", "Resolve"]);
  const transfer = page.getByTestId(`issue-actions-${TRANSFER}`);
  // A transfer is matched or marked unmatched; omnichannel refuses to resolve one.
  await expect(transfer.getByRole("button")).toHaveText(["Match", "Unmatched"]);

  await expect(page.getByRole("link", { name: "Alice Wanjiru" })).toBeVisible();
  // A lookup that fails leaves the id rather than a blank.
  await expect(page.getByRole("link", { name: /^Customer dddddddd/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Issues/ })).toContainText("2");
});

test("resolve needs a note, sends it, and the queue is read again", async ({ page }) => {
  const state = await stubIssues(page);
  await openIssues(page);

  await page.getByTestId(`issue-actions-${PAYOUT}`).getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "Resolve" });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Note/).fill("   ");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Note/).fill("Paid by hand from the float");
  await submit.click();

  await expect(dialog).toBeHidden();
  expect(state.writes).toEqual([{ path: `${PAYOUT}/resolve`, body: { note: "Paid by hand from the float" }, subject: undefined }]);
  await expect(page.getByTestId(`issue-actions-${PAYOUT}`)).toHaveCount(0);
  expect(state.reads).toBeGreaterThan(1);
});

test("a refused retry is shown as it came and the queue is read again", async ({ page }) => {
  const message = "This payout was already handled by staff:brian@baracel.ae: Retried as 123";
  const state = await stubIssues(page, () => ({ status: 409, body: envelope(409, message) }));
  await openIssues(page);

  await page.getByTestId(`issue-actions-${PAYOUT}`).getByRole("button", { name: "Retry" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Retry payout" }).click();
  await expect(dialog).toContainText(message);
  expect(state.writes.map((w) => w.path)).toEqual([`${PAYOUT}/retry`]);
  await expect.poll(() => state.reads).toBeGreaterThan(1);
});

test("match sends the bank reference", async ({ page }) => {
  const state = await stubIssues(page);
  await openIssues(page);

  await page.getByTestId(`issue-actions-${TRANSFER}`).getByRole("button", { name: "Match", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Bank reference/).fill("FT2610200001");
  await dialog.getByRole("button", { name: "Match transfer" }).click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toEqual([{ path: `${TRANSFER}/match`, body: { bankReference: "FT2610200001" }, subject: undefined }]);
});

test("an empty queue says so", async ({ page }) => {
  const state = await stubIssues(page);
  state.issues = [];
  await openIssues(page);
  await expect(page.getByText("Nothing needs a person right now.")).toBeVisible();
});

test("every page of the queue is read, and the tab counts them all", async ({ page }) => {
  const state = await stubIssues(page);
  state.issues = Array.from({ length: 130 }, (_, i) => ({
    ...ISSUES[0],
    payment: payment(`eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, "0")}`, { createdAt: `2026-10-18T08:${String(i % 60).padStart(2, "0")}:00Z` }),
  }));
  await openIssues(page);
  await expect(page.getByText("130 payments need a person")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Issues/ })).toContainText("130");
  // No X-Truncated header: the list is whole.
  await expect(page.getByText("This list is cut short")).toHaveCount(0);
  // Two pages of 100; React's development double-mount may read them twice.
  expect([...state.pages].sort()).toEqual(["1/100", "2/100"]);
});

test("a 401 says to sign in again instead of the raw error", async ({ page }) => {
  const state = await stubIssues(page, () => ({ status: 401, body: envelope(401, "No authenticated subject") }));
  await openIssues(page);

  await page.getByTestId(`issue-actions-${PAYOUT}`).getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Note/).fill("Paid by hand");
  await dialog.getByRole("button", { name: "Resolve" }).click();
  await expect(dialog).toContainText("sign in again");
  await expect(dialog).not.toContainText("No authenticated subject");
  expect(state.writes).toHaveLength(1);
});

test("a queue cut at omnichannel's cap says the count is a minimum", async ({ page }) => {
  const state = await stubIssues(page);
  state.truncated = true;
  await openIssues(page);
  await expect(page.getByText("This list is cut short")).toBeVisible();
  await expect(page.getByText("At least 2 payments need a person")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Issues/ })).toContainText("cut");
});

/* PAYOUT_UNCONFIRMED (omnichannel #98): a payout the gateway took and never
   answered for. It may or may not have been paid, so it is confirmed sent
   (with the gateway's receipt) or not sent (with a note) after checking with
   the gateway; it is never retried first. */
const UNCONFIRMED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UNCONFIRMED_ISSUE = {
  profileId: ALICE, kind: "PAYOUT_UNCONFIRMED",
  why: "Sent to the payment gateway 45 minutes ago and no answer since. Check with the gateway, then confirm it sent (with the receipt) or not sent; do not retry it before.",
  payment: payment(UNCONFIRMED, { status: "PENDING", reference: "WD-9", providerRef: "PGW-REQ-77", failureReason: null, promptInApp: false }),
};

test("an unconfirmed payout says it may or may not have been paid, offers the two confirmations and no Retry", async ({ page }) => {
  await stubIssues(page, undefined, [...ISSUES, UNCONFIRMED_ISSUE]);
  await openIssues(page);
  const actions = page.getByTestId(`issue-actions-${UNCONFIRMED}`);
  await expect(actions.getByRole("button")).toHaveText(["Confirm sent", "Confirm not sent"]);
  await expect(actions.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByTestId(`unconfirmed-${UNCONFIRMED}`).filter({ visible: true })).toHaveText("May or may not have been paid: check with the gateway first.");
  await expect(page.getByText("Payout unconfirmed").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("do not retry it before.").filter({ visible: true })).toBeVisible();
});

test("confirm sent needs the gateway's receipt, is confirmed in a dialog, and the queue is read again", async ({ page }) => {
  const state = await stubIssues(page, undefined, [UNCONFIRMED_ISSUE]);
  await openIssues(page);
  await page.getByTestId(`issue-actions-${UNCONFIRMED}`).getByRole("button", { name: "Confirm sent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Only once the gateway has told you it paid KES 1,000.00 to +254700000000");
  const submit = dialog.getByRole("button", { name: "Confirm sent" });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Gateway receipt/).fill("  ");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Gateway receipt/).fill("UJUO9B9NYK");
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toEqual([{ path: `${UNCONFIRMED}/confirm-sent`, body: { receipt: "UJUO9B9NYK" }, subject: undefined }]);
  await expect(page.getByTestId(`issue-actions-${UNCONFIRMED}`)).toHaveCount(0);
  expect(state.reads).toBeGreaterThan(1);
});

test("confirm not sent needs a note; the payout comes back as a failed one to retry or resolve", async ({ page }) => {
  const state = await stubIssues(page, undefined, [UNCONFIRMED_ISSUE]);
  // Once confirmed not sent, omnichannel lists it again as a PAYOUT_FAILED.
  await page.route(/\/omni\/api\/operator\/payments\/[^/]+\/confirm-not-sent$/, (route) => {
    state.writes.push({ path: `${UNCONFIRMED}/confirm-not-sent`, body: route.request().postDataJSON() });
    state.issues = [{ ...UNCONFIRMED_ISSUE, kind: "PAYOUT_FAILED", why: "The payout was not made: confirmed not sent with the gateway.", payment: { ...UNCONFIRMED_ISSUE.payment, status: "FAILED" } }];
    return json(route, { ...UNCONFIRMED_ISSUE.payment, status: "FAILED" });
  });
  await openIssues(page);
  await page.getByTestId(`issue-actions-${UNCONFIRMED}`).getByRole("button", { name: "Confirm not sent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("comes back on this queue as a failed payout");
  const submit = dialog.getByRole("button", { name: "Confirm not sent" });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Note/).fill("PGW support: no transaction under this key");
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toEqual([{ path: `${UNCONFIRMED}/confirm-not-sent`, body: { note: "PGW support: no transaction under this key" } }]);
  await expect(page.getByTestId(`issue-actions-${UNCONFIRMED}`).getByRole("button")).toHaveText(["Retry", "Resolve"]);
});

test("a confirmation refused because the payout is no longer pending (409) is shown as it came", async ({ page }) => {
  const message = "This payout is no longer pending: the gateway answered (SENT).";
  await stubIssues(page, () => ({ status: 409, body: envelope(409, message) }), [UNCONFIRMED_ISSUE]);
  await openIssues(page);
  await page.getByTestId(`issue-actions-${UNCONFIRMED}`).getByRole("button", { name: "Confirm sent" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Gateway receipt/).fill("UJUO9B9NYK");
  await dialog.getByRole("button", { name: "Confirm sent" }).click();
  await expect(dialog).toContainText(message);
});
