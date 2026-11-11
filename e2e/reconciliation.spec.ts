import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn, staffView, stubStaffMe } from "./stubs";

/* Cash-in reconciliation (omnichannel PR 150): the runs, uploading a
 * statement with an optional period, a run's counts and lines by outcome,
 * resolving an exception with a note, the two CSV downloads, and the
 * permission keys. PR 152: a note is proposed for a second person's
 * approval (202), one line or many under one note. Stubbed. */

type Obj = Record<string, unknown>;
const RUN_ID = "6f1c2a9e-0000-4c4c-8d8d-000000000001";
const run = (over: Obj = {}): Obj => ({
  id: RUN_ID, fileName: "mpesa-paybill-2026-11-03.csv", periodFrom: "2026-11-01T21:00:00Z", periodTo: "2026-11-03T21:00:00Z", currency: "KES",
  statementLines: 6, ledgerPayments: 6, matched: 4, ledgerOnly: 1, statementOnly: 1, amountMismatch: 1, resolved: 0, exceptionsOpen: 3, skippedLines: 2,
  statementAmount: 61250.0, ledgerAmount: 60750.0, runBy: "staff:finance@ktda.test", createdAt: "2026-11-04T06:30:00Z", ...over,
});
const statement = (ref: string, amount: number, over: Obj = {}): Obj => ({
  row: 2, reference: ref, channel: "MPESA", phone: "0712345678", amount, currency: "KES", paidAt: "2026-11-03T08:15:00Z", accountReference: "GN-104233", status: "Completed", ...over,
});
const ledger = (ref: string, amount: number, over: Obj = {}): Obj => ({
  paymentId: `p-${ref}`, reference: `KTD-${ref}`, providerRef: ref, method: "MPESA", phone: "2547****5678", amount, completedAt: "2026-11-03T08:15:20Z", ...over,
});
const line = (id: string, outcome: string, over: Obj = {}): Obj => ({ id, outcome, matchedBy: null, statement: null, ledger: null, note: null, resolvedBy: null, resolvedAt: null, ...over });
const LINES: Obj[] = [
  line("l-1", "MATCHED", { matchedBy: "REFERENCE", statement: statement("RCP1A2B3C", 5000), ledger: ledger("RCP1A2B3C", 5000) }),
  line("l-2", "MATCHED", { matchedBy: "PHONE_AMOUNT_TIME", statement: statement("RCP9Z8Y7X", 2500), ledger: ledger("RCPOTHER1", 2500) }),
  line("l-3", "LEDGER_ONLY", { ledger: ledger("RCPLEDGER", 1500) }),
  line("l-4", "STATEMENT_ONLY", { statement: statement("RCPSTMT01", 2000) }),
  line("l-5", "AMOUNT_MISMATCH", { matchedBy: "REFERENCE", statement: statement("RCPMISMAT", 1000), ledger: ledger("RCPMISMAT", 500) }),
];
const headers = (n: number, page = 1, size = 25) => ({ "X-Total-Count": String(n), "X-Page": String(page), "X-Size": String(size), "X-Total-Pages": String(Math.max(1, Math.ceil(n / size))) });

type Sent = { method: string; path: string; query: URLSearchParams; body: string | null };
/** `staged`: an omnichannel with maker-checker (PR 152): a resolve answers 202 with the request, and the lines wait. */
async function stub(page: Page, opts: { runs?: Obj[]; upload?: { status: number; body: unknown }; resolve?: { status: number; body: unknown }; missing?: boolean; lines?: Obj[]; total?: number; staged?: boolean } = {}) {
  const sent: Sent[] = [];
  let lines = opts.lines ?? LINES;
  let current = run();
  await page.route(/\/omni\/api\/operator\/reconciliation/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator\/reconciliation/, "");
    sent.push({ method: req.method(), path, query: url.searchParams, body: req.method() === "POST" ? req.postData() : null });
    if (opts.missing) return json(route, envelope(404, "Not Found"), 404);
    if (path === "/template.csv") {
      return route.fulfill({ status: 200, contentType: "text/csv", headers: { "Content-Disposition": 'attachment; filename="cash-in-statement-template.csv"' }, body: "transaction_reference,channel,phone,amount,currency,paid_at,account_reference,status\n" });
    }
    if (path.endsWith("/exceptions.csv")) {
      return route.fulfill({ status: 200, contentType: "text/csv", headers: { "Content-Disposition": `attachment; filename="reconciliation-${RUN_ID}-exceptions.csv"` }, body: "outcome,matched_by\nLEDGER_ONLY,\n" });
    }
    if (req.method() === "POST" && path === "/runs") {
      const a = opts.upload ?? { status: 201, body: run() };
      return json(route, a.body, a.status);
    }
    if (req.method() === "POST" && (path.endsWith("/resolve") || path.endsWith("/resolutions"))) {
      if (opts.resolve) return json(route, opts.resolve.body, opts.resolve.status);
      const body = JSON.parse(req.postData() ?? "{}") as Obj;
      const note = body.note;
      if (opts.staged) {
        const ids = path.endsWith("/resolutions") ? (body.lineIds as string[]) : [path.split("/")[4]!];
        const pendingApproval = { reference: "AP-10042", note, proposedBy: "staff:finance@ktda.test", proposedAt: "2026-11-04T07:00:00Z" };
        lines = lines.map((l) => (ids.includes(l.id as string) ? { ...l, pendingApproval } : l));
        return json(route, { approval: { id: "id-AP-10042", reference: "AP-10042", type: "RECONCILIATION_RESOLVE", status: "PENDING" } }, 202);
      }
      const lineId = path.split("/")[4]!;
      lines = lines.map((l) => (l.id === lineId ? { ...l, note, resolvedBy: "staff:finance@ktda.test", resolvedAt: "2026-11-04T07:00:00Z" } : l));
      current = run({ resolved: 1, exceptionsOpen: 2 });
      return json(route, lines.find((l) => l.id === lineId));
    }
    if (path === "/runs") return json(route, opts.runs ?? [run(), run({ id: "6f1c2a9e-0000-4c4c-8d8d-000000000009", fileName: "airtel-2026-11-02.csv", matched: 10, ledgerOnly: 0, statementOnly: 0, amountMismatch: 0, exceptionsOpen: 0, resolved: 0, skippedLines: 0 })]);
    if (path === `/runs/${RUN_ID}`) return json(route, current);
    if (path === `/runs/${RUN_ID}/lines`) {
      const outcome = url.searchParams.get("outcome");
      const items = outcome ? lines.filter((l) => l.outcome === outcome) : lines;
      const pg = Number(url.searchParams.get("page") ?? "1");
      return route.fulfill({ status: 200, contentType: "application/json", headers: headers(opts.total ?? items.length, pg), body: JSON.stringify(items) });
    }
    return json(route, envelope(404, "No such run"), 404);
  });
  return sent;
}

const STATEMENT = { name: "mpesa-paybill-2026-11-03.csv", mimeType: "text/csv", buffer: Buffer.from("transaction_reference,amount\nRCP1A2B3C,5000\n") };
const rowOf = (page: Page, id: string) => page.getByTestId("lines-table").locator(`tr[data-line="${id}"]`);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the runs, newest first: statement, period, who ran it, total and the outcome pills; live, in the Money menu", async ({ page }) => {
  await stub(page);
  await page.goto("/reconciliation");
  await expect(page.getByRole("heading", { name: "Reconciliation", level: 1 })).toBeVisible();
  const rows = page.getByTestId("runs-table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("mpesa-paybill-2026-11-03.csv");
  await expect(rows.nth(0)).toContainText("6 lines, 2 skipped");
  await expect(rows.nth(0)).toContainText("2 Nov 2026 – 3 Nov 2026");
  await expect(rows.nth(0)).toContainText("staff:finance@ktda.test");
  await expect(rows.nth(0)).toContainText("61,250.00");
  for (const pill of ["4 matched", "1 ledger only", "1 statement only", "1 mismatch", "3 open"]) await expect(rows.nth(0).getByTestId("run-pills")).toContainText(pill);
  await expect(rows.nth(1).getByTestId("run-pills")).not.toContainText("ledger only");
  await expect(page.getByTestId("demo-footer")).toHaveCount(0);
  await expect(page.locator("aside").first().getByRole("link", { name: "Reconciliation", exact: true })).toHaveAttribute("href", "/reconciliation");
  await rows.nth(0).click();
  await expect(page).toHaveURL(new RegExp(`/reconciliation/${RUN_ID}$`));
});

test("Download template saves omnichannel's CSV under its own name", async ({ page }) => {
  await stub(page);
  await page.goto("/reconciliation");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download template" }).click();
  expect((await download).suggestedFilename()).toBe("cash-in-statement-template.csv");
});

test("upload with a period: the file, and the days as Nairobi midnights (the last day included), then the run opens", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/reconciliation");
  await page.getByRole("button", { name: "Upload statement" }).click();
  await expect(page.getByTestId("period-hint")).toContainText("The period bounds the payments recorded here");
  await page.getByLabel("Statement (CSV)").setInputFiles(STATEMENT);
  await page.getByLabel("From").fill("2026-11-03");
  await page.getByLabel("To").fill("2026-11-05");
  await page.getByRole("button", { name: "Reconcile" }).click();
  await expect(page).toHaveURL(new RegExp(`/reconciliation/${RUN_ID}$`));
  const body = sent.find((s) => s.method === "POST" && s.path === "/runs")!.body!;
  expect(body).toContain('filename="mpesa-paybill-2026-11-03.csv"');
  expect(body).toMatch(/name="from"\r\n\r\n2026-11-02T21:00:00\.000Z/);
  expect(body).toMatch(/name="to"\r\n\r\n2026-11-05T21:00:00\.000Z/);
});

test("upload without a period sends none; a 400 shows omnichannel's message; a 403 STAFF_FORBIDDEN reads as a permission message", async ({ page }) => {
  let answer = { status: 400, body: envelope(400, "Row 3: amount is not a number") };
  const sent: { body: string | null }[] = [];
  await stub(page);
  await page.route(/\/omni\/api\/operator\/reconciliation\/runs$/, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push({ body: route.request().postData() });
    return json(route, answer.body, answer.status);
  });
  await page.goto("/reconciliation");
  await page.getByRole("button", { name: "Upload statement" }).click();
  await page.getByLabel("Statement (CSV)").setInputFiles(STATEMENT);
  await page.getByRole("button", { name: "Reconcile" }).click();
  await expect(page.getByRole("dialog")).toContainText("Row 3: amount is not a number");
  expect(sent[0]!.body).not.toContain('name="from"');
  expect(sent[0]!.body).not.toContain('name="to"');
  answer = { status: 403, body: envelope(403, "Needs act:reconciliation.run", "STAFF_FORBIDDEN") };
  await page.getByRole("button", { name: "Reconcile" }).click();
  await expect(page.getByRole("dialog")).toContainText("You do not have permission to run reconciliations.");
});

test("a run: the tiles, tabs by outcome with their counts, and both sides of each line (a dash where one is missing)", async ({ page }) => {
  const sent = await stub(page);
  await page.goto(`/reconciliation/${RUN_ID}`);
  const tiles = page.getByTestId("run-tiles");
  await expect(tiles).toContainText("Statement lines6");
  await expect(tiles).toContainText("61,250.00");
  await expect(tiles).toContainText("Ledger payments6");
  await expect(tiles).toContainText("60,750.00");
  await expect(tiles).toContainText("Matched4");
  await expect(tiles).toContainText("Exceptions open3");
  await expect(tiles).toContainText("0 resolved");
  await expect(page.getByTestId("skipped")).toContainText("2 statement lines could not be read");
  for (const [name, n] of [["All", 7], ["Matched", 4], ["Ledger only", 1], ["Statement only", 1], ["Amount mismatch", 1]] as const) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${name}\\s*${n}$`) })).toBeVisible();
  }
  await expect(page.getByTestId("lines-table").locator("tbody tr")).toHaveCount(5);
  await expect(rowOf(page, "l-2")).toContainText("Phone, amount and time");
  await expect(rowOf(page, "l-3").getByTestId("statement-ref")).toHaveText("—");
  await expect(rowOf(page, "l-3")).toContainText("KTD-RCPLEDGER");
  await expect(rowOf(page, "l-4").getByTestId("ledger-ref")).toHaveText("—");
  await expect(rowOf(page, "l-5")).toContainText("1,000.00");
  await expect(rowOf(page, "l-5")).toContainText("500.00");
  await page.getByRole("tab", { name: /^Ledger only/ }).click();
  await expect(page).toHaveURL(/outcome=LEDGER_ONLY/);
  await expect.poll(() => sent.some((s) => s.path.endsWith("/lines") && s.query.get("outcome") === "LEDGER_ONLY")).toBe(true);
  await expect(page.getByTestId("lines-table").locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("main")).toContainText("Recorded here as paid, but the channel's statement does not carry it.");
});

test("the lines page through the X-Total-Count headers", async ({ page }) => {
  const sent = await stub(page, { total: 60 });
  await page.goto(`/reconciliation/${RUN_ID}`);
  await expect(page.getByText("60 lines · page 1 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect.poll(() => sent.some((s) => s.path.endsWith("/lines") && s.query.get("page") === "2" && s.query.get("size") === "25")).toBe(true);
});

test("before maker-checker: resolve an exception with a required note; it then shows the note, who and when, and can be noted again", async ({ page }) => {
  const sent = await stub(page);
  await page.goto(`/reconciliation/${RUN_ID}`);
  await expect(rowOf(page, "l-1").getByRole("button")).toHaveCount(0);
  await rowOf(page, "l-4").getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Resolve RCPSTMT01");
  await expect(dialog).toContainText("The channel collected it, but it was never recorded here as paid.");
  await expect(dialog.getByRole("button", { name: "Send for approval" })).toBeDisabled();
  await dialog.getByLabel("Note").fill("Callback lost; credited by hand, journal J-2211.");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Noted.")).toBeVisible();
  const post = sent.find((s) => s.method === "POST" && s.path.endsWith("/resolve"))!;
  expect(post.path).toBe(`/runs/${RUN_ID}/lines/l-4/resolve`);
  expect(JSON.parse(post.body!)).toEqual({ note: "Callback lost; credited by hand, journal J-2211." });
  await expect(rowOf(page, "l-4").getByTestId("line-note")).toContainText("Callback lost; credited by hand, journal J-2211.");
  await expect(rowOf(page, "l-4").getByTestId("line-note")).toContainText("staff:finance@ktda.test");
  await expect(rowOf(page, "l-4").getByRole("button", { name: "Add a note" })).toBeVisible();
  await expect(page.getByTestId("run-tiles")).toContainText("1 resolved");
});

test("a resolve refused for want of the key reads as a permission message", async ({ page }) => {
  await stub(page, { resolve: { status: 403, body: envelope(403, "Needs act:reconciliation.run", "STAFF_FORBIDDEN") } });
  await page.goto(`/reconciliation/${RUN_ID}`);
  await rowOf(page, "l-3").getByRole("button", { name: "Resolve" }).click();
  await page.getByRole("dialog").getByLabel("Note").fill("Checked.");
  await page.getByRole("dialog").getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByRole("dialog")).toContainText("You do not have permission to run reconciliations.");
});

test("Export exceptions saves the run's exceptions CSV", async ({ page }) => {
  await stub(page);
  await page.goto(`/reconciliation/${RUN_ID}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export exceptions" }).click();
  expect((await download).suggestedFilename()).toBe(`reconciliation-${RUN_ID}-exceptions.csv`);
});

test("page:reconciliation without act:reconciliation.run reads, but has no Upload or Resolve", async ({ page }) => {
  await stubStaffMe(page, staffView({ roles: ["READ_ONLY"], permissions: ["page:reconciliation"] }));
  await stub(page);
  await page.goto("/reconciliation");
  await expect(page.getByTestId("runs-table")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download template" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload statement" })).toHaveCount(0);
  await page.goto(`/reconciliation/${RUN_ID}`);
  await expect(page.getByTestId("lines-table")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0);
});

test("without page:reconciliation the menu has no entry and the route refuses", async ({ page }) => {
  await stubStaffMe(page, staffView({ roles: ["COMPLIANCE"], permissions: ["page:kyc", "page:farmers"] }));
  await stub(page);
  await page.goto("/reconciliation");
  await expect(page.getByTestId("access-denied")).toBeVisible();
  await expect(page.locator("aside").first().getByRole("link", { name: "Reconciliation", exact: true })).toHaveCount(0);
});

test("a run that is not this institution's, and an omnichannel without reconciliation", async ({ page }) => {
  await stub(page);
  await page.goto("/reconciliation/6f1c2a9e-0000-4c4c-8d8d-00000000dead");
  await expect(page.getByTestId("run-not-found")).toBeVisible();
  await page.unroute(/\/omni\/api\/operator\/reconciliation/);
  await stub(page, { missing: true });
  await page.goto("/reconciliation");
  await expect(page.getByTestId("not-available")).toContainText("no cash-in reconciliation");
  await expect(page.getByRole("button", { name: "Upload statement" })).toHaveCount(0);
});

/* ---- Maker-checker (PR 152) ---- */

const pick = (page: Page, id: string) => rowOf(page, id).getByTestId("line-pick");

test("a resolve is sent for approval: 202 names the request, and the line waits with the proposed note and no Resolve", async ({ page }) => {
  const sent = await stub(page, { staged: true });
  await page.goto(`/reconciliation/${RUN_ID}`);
  await expect(page.getByTestId("run-tiles")).toContainText("open until a resolution is approved");
  await rowOf(page, "l-4").getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("A second person approves it");
  await expect(dialog).toContainText("The line stays open, and counted in exceptions open, until someone other than you approves it.");
  await dialog.getByLabel("Note").fill("Callback lost; credited by hand, journal J-2211.");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Sent for approval as AP-10042. The line stays open until a second person approves.")).toBeVisible();
  expect(sent.filter((s) => s.method === "POST").map((s) => s.path)).toEqual([`/runs/${RUN_ID}/lines/l-4/resolve`]);

  const waiting = rowOf(page, "l-4").getByTestId("line-pending");
  await expect(waiting).toContainText("Awaiting approval AP-10042");
  await expect(waiting).toContainText("Callback lost; credited by hand, journal J-2211.");
  await expect(waiting).toContainText("Proposed by staff:finance@ktda.test");
  await expect(waiting.getByRole("link")).toHaveAttribute("href", "/approvals?open=AP-10042");
  await expect(rowOf(page, "l-4").getByRole("button")).toHaveCount(0);
  await expect(pick(page, "l-4")).toHaveCount(0);
  // Still open until approved.
  await expect(page.getByTestId("run-tiles")).toContainText("3");
});

test("a line already waiting: 409 APPROVAL_PENDING shows the request it waits in", async ({ page }) => {
  await stub(page, { resolve: { status: 409, body: envelope(409, "Line RCPLEDGER is already waiting for approval in AP-10041", "APPROVAL_PENDING") } });
  await page.goto(`/reconciliation/${RUN_ID}`);
  await rowOf(page, "l-3").getByRole("button", { name: "Resolve" }).click();
  await page.getByRole("dialog").getByLabel("Note").fill("Checked.");
  await page.getByRole("dialog").getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByRole("dialog")).toContainText("already waiting for approval in AP-10041");
});

test("a resolved line names who proposed and who approved, with the request; checkboxes only on open exceptions", async ({ page }) => {
  await stub(page, {
    lines: [
      ...LINES.slice(0, 3),
      line("l-4", "STATEMENT_ONLY", {
        statement: statement("RCPSTMT01", 2000), note: "Credited by hand.", resolvedBy: "staff:finance@ktda.test", resolvedAt: "2026-11-04T07:00:00Z",
        approvedBy: "staff:admin@ktda.test", approvalReference: "AP-10039", pendingApproval: null,
      }),
      line("l-5", "AMOUNT_MISMATCH", {
        statement: statement("RCPMISMAT", 1000), ledger: ledger("RCPMISMAT", 500),
        pendingApproval: { reference: "AP-10040", note: "Fee taken by the channel.", proposedBy: "staff:finance@ktda.test", proposedAt: "2026-11-04T07:10:00Z" },
      }),
    ],
  });
  await page.goto(`/reconciliation/${RUN_ID}`);
  const note = rowOf(page, "l-4").getByTestId("line-note");
  await expect(note).toContainText("Resolved by staff:finance@ktda.test, approved by staff:admin@ktda.test · AP-10039");
  await expect(note.getByTestId("line-approval")).toHaveAttribute("href", "/approvals?open=AP-10039");
  await expect(rowOf(page, "l-4").getByRole("button", { name: "Add a note" })).toBeVisible();
  await expect(rowOf(page, "l-5").getByTestId("line-pending")).toContainText("Awaiting approval AP-10040");
  await expect(rowOf(page, "l-5").getByRole("button")).toHaveCount(0);
  for (const id of ["l-1", "l-2", "l-4", "l-5"]) await expect(pick(page, id)).toHaveCount(0);
  await expect(pick(page, "l-3")).toBeVisible();
});

test("resolve selected: tick across tabs, one note, one POST /resolutions; the lines then wait", async ({ page }) => {
  const sent = await stub(page, { staged: true });
  await page.goto(`/reconciliation/${RUN_ID}`);
  await pick(page, "l-3").check();
  await pick(page, "l-5").check();
  await expect(page.getByTestId("selected-count")).toHaveText("2 selected");
  await page.getByRole("tab", { name: /Statement only/ }).click();
  await pick(page, "l-4").check();
  await expect(page.getByTestId("selected-count")).toHaveText("3 selected");
  await page.getByTestId("selection-bar").getByRole("button", { name: "Resolve selected" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Resolve 3 exceptions");
  await expect(dialog).toContainText("The lines stay open");
  await dialog.getByLabel("Note").fill("Settled with the channel, ticket 88.");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Sent for approval as AP-10042. The lines stay open until a second person approves.")).toBeVisible();
  const post = sent.find((s) => s.method === "POST")!;
  expect(post.path).toBe(`/runs/${RUN_ID}/resolutions`);
  expect(JSON.parse(post.body!)).toEqual({ lineIds: ["l-3", "l-5", "l-4"], note: "Settled with the channel, ticket 88." });
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  await expect(rowOf(page, "l-4").getByTestId("line-pending")).toContainText("AP-10042");
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(rowOf(page, "l-3").getByTestId("line-pending")).toContainText("AP-10042");
  await expect(page.getByLabel("Select the open exceptions on this page")).toBeDisabled();
});

test("the page's tick-all takes the open exceptions on it, at most 200; Clear drops them", async ({ page }) => {
  const many = Array.from({ length: 205 }, (_, i) => line(`x-${i}`, "LEDGER_ONLY", { ledger: ledger(`RCPL${String(i).padStart(5, "0")}`, 100) }));
  await stub(page, { lines: [LINES[0]!, ...many] });
  await page.goto(`/reconciliation/${RUN_ID}`);
  await page.getByLabel("Select the open exceptions on this page").check();
  await expect(page.getByTestId("selected-count")).toHaveText("200 selected");
  await expect(page.getByTestId("selection-full")).toHaveText("At most 200 under one note.");
  await expect(pick(page, "x-199")).toBeChecked();
  await expect(pick(page, "x-200")).not.toBeChecked();
  await expect(pick(page, "x-200")).toBeDisabled();
  await page.getByTestId("selection-bar").getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  await expect(pick(page, "x-200")).toBeEnabled();
});

test("without act:reconciliation.run there are no checkboxes", async ({ page }) => {
  await stubStaffMe(page, staffView({ permissions: ["page:reconciliation"] }));
  await stub(page);
  await page.goto(`/reconciliation/${RUN_ID}`);
  await expect(rowOf(page, "l-3")).toBeVisible();
  await expect(page.getByTestId("line-pick")).toHaveCount(0);
  await expect(page.getByLabel("Select the open exceptions on this page")).toHaveCount(0);
});
