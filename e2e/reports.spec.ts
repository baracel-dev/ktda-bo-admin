import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* Reports (prototype 3.17), each built from omnichannel reads (lib/reports.ts),
 * with CSV, Excel and PDF exports from the rows on screen. Stubbed. */

type Obj = Record<string, unknown>;
const KTDA = "11111111-1111-4111-8111-111111111111";
const run = (n: number, over: Obj = {}): Obj => ({
  runId: `${n}0000000-0000-4000-8000-000000000000`, flow: "PAYMENT", institutionId: KTDA, currency: "KES", sourceName: `ktda-pay-${n}.csv`,
  status: "COMPLETED", totalRows: 10 * n, processedCount: 10 * n, skippedCount: 0, failureCount: 1, totalAmount: 1000 * n,
  startedAt: `2026-1${n % 2}-0${n}T07:00:00Z`, completedAt: `2026-1${n % 2}-0${n}T08:00:00Z`, message: null,
  period: `2026-1${n % 2}`, payableAmount: 900 * n, heldCount: 2, releasedBy: "staff:checker@ktda.test", releasedAt: `2026-1${n % 2}-0${n}T07:30:00Z`, ...over,
});
const farmer = (g: string, over: Obj = {}): Obj => ({
  growerNo: g, fullName: `Farmer ${g}`, phone: "+254700000211", factory: "Test Factory A", status: "FUNDED",
  registeredAt: "2026-11-01T08:00:00Z", activatedAt: "2026-11-02T08:00:00Z", lastFundedAt: "2026-11-03T08:00:00Z", customerId: null, clashReason: null,
  kyc: { status: "VERIFIED", identityResult: "MATCH", startedAt: "2026-11-02T08:00:00Z", decidedAt: "2026-11-04T08:00:00Z", note: "Checked." },
  onboarding: { channel: "BULK", agentNo: null, at: "2026-11-02T08:00:00Z" }, ...over,
});
const agent = (no: string, over: Obj = {}): Obj => ({
  agentNo: no, fullName: `Agent ${no}`, phone: "+254700000401", town: "Kericho", status: "ACTIVE",
  float: { balance: 1000, limit: 5000, low: false }, today: { transactions: 1 }, onboardedThisMonth: 3, commissionThisMonth: 60,
  suspension: null, createdAt: "2026-11-01T08:00:00Z", updatedAt: null, ...over,
});
const approval = (ref: string, status: string): Obj => ({
  id: ref, reference: ref, type: "AGENT_FLOAT_TOP_UP", title: `Top up ${ref}`, target: { kind: "AGENT", reference: "A-0001", name: "Agent A-0001" },
  changes: [], reason: null, payload: {}, status, maker: "ktda-operator", madeAt: "2026-11-07T10:00:00Z", checker: status === "PENDING" ? null : "ktda-operator",
  decidedAt: status === "PENDING" ? null : "2026-11-07T11:00:00Z", decisionNote: status === "REJECTED" ? "No bank reference." : null, appliedAt: null, error: null, checkerRoles: [],
});
const paged = (items: Obj[], total = items.length, page = 1, size = 100) => ({
  "X-Total-Count": String(total), "X-Page": String(page), "X-Size": String(size), "X-Total-Pages": String(Math.max(1, Math.ceil(total / size))),
});

async function stub(page: Page, opts: { runs?: Obj[] | null; farmers?: (q: URLSearchParams) => { items: Obj[]; total?: number }; summary?: Obj; agents?: Obj[] | null; approvalsMissing?: boolean } = {}) {
  const sent: { path: string; query: URLSearchParams }[] = [];
  await page.route(/\/omni\/api\/operator\//, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    sent.push({ path, query: url.searchParams });
    if (path === "/institutions") return json(route, [{ id: KTDA, name: "KTDA Holdings", localCurrency: "KES", country: "KE", status: "ACTIVE" }]);
    if (path === "/bulk-loads") return opts.runs === null ? json(route, envelope(404, "Not Found"), 404) : json(route, opts.runs ?? [run(1), run(2), run(3, { flow: "ACTIVATION" })]);
    if (path === "/farmers/summary") return json(route, opts.summary ?? { registered: 1, activated: 2, funded: 3, total: 6, clash: 0, kyc: { none: 1, pending: 2, verified: 3, rejected: 0 }, byChannel: { bulk: 5, agent: 1, staff: 0, app: 0, ussd: 0, unknown: 0 } });
    if (path === "/farmers") {
      const r = opts.farmers?.(url.searchParams) ?? { items: url.searchParams.get("kyc") === "REJECTED" ? [farmer("TEST000014", { kyc: { status: "REJECTED", identityResult: "MISMATCH", startedAt: null, decidedAt: "2026-11-05T08:00:00Z", note: "Name differs." } })] : [farmer("TEST000011"), farmer("TEST000012")] };
      return route.fulfill({ status: 200, contentType: "application/json", headers: paged(r.items, r.total, Number(url.searchParams.get("page")) || 1), body: JSON.stringify(r.items) });
    }
    if (path === "/agents") {
      if (opts.agents === null) return json(route, envelope(404, "Not Found"), 404);
      const items = opts.agents ?? [agent("A-0001"), agent("A-0002", { onboardedThisMonth: 5, commissionThisMonth: 100.5 })];
      return route.fulfill({ status: 200, contentType: "application/json", headers: paged(items), body: JSON.stringify(items) });
    }
    if (path === "/approvals") {
      if (opts.approvalsMissing) return json(route, envelope(404, "Not Found"), 404);
      const st = url.searchParams.get("status")!;
      const items = st === "APPROVED" ? [approval("AP-10001", st)] : st === "REJECTED" ? [approval("AP-10002", st)] : st === "PENDING" ? [approval("AP-10003", st)] : [];
      return route.fulfill({ status: 200, contentType: "application/json", headers: paged(items), body: JSON.stringify(items) });
    }
    return json(route, []);
  });
  return sent;
}

async function downloaded(page: Page, button: string): Promise<{ name: string; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the list matches the prototype, live ones and not-yet ones, and no demo data", async ({ page }) => {
  await stub(page);
  await page.goto("/reports");
  const list = page.getByTestId("report-list");
  for (const t of ["Payment runs", "Pay to M-PESA runs", "Transactions summary", "Farmer register", "Farmer KYC", "Agent commissions", "Approvals", "KYC decisions", "Merchant settlements", "Disputes and SLA", "Build your own"]) {
    await expect(list).toContainText(t);
  }
  await expect(page.getByTestId("demo-footer")).toHaveCount(0);
  for (const key of ["merchant-settlements", "disputes", "build"]) {
    await list.locator(`[data-report="${key}"]`).click();
    await expect(page.getByTestId("report-not-yet")).toContainText("Not yet available");
  }
});

test("payment runs: only payment runs, the columns, a totals row, the monthly chart, and the CSV", async ({ page }) => {
  await stub(page);
  await page.goto("/reports?report=payment-runs");
  const table = page.getByTestId("report-table");
  await expect(table.locator("thead th")).toHaveText(["Run", "Title", "Lines", "Net KES", "Deductions KES", "Errors held", "Status", "Released by", "Released at"]);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator("tbody tr").first()).toContainText("ktda-pay-1.csv · 2026-11");
  await expect(table.locator("tbody tr").nth(1)).toContainText("1,800");
  await expect(table.locator("tbody tr").first()).toContainText("—");
  await expect(page.getByTestId("report-totals")).toContainText("2,700");
  await expect(page.getByTestId("report-meta")).toContainText("2 rows · generated");
  await expect(page.getByTestId("report-chart")).toContainText("Net paid by month (KES)");
  const csv = await downloaded(page, "CSV");
  expect(csv.name).toMatch(/^payment-runs-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = csv.bytes.toString("utf8").replace(/^﻿/, "").trim().split("\r\n");
  expect(lines[0]).toBe("Run,Title,Lines,Net KES,Deductions KES,Errors held,Status,Released by,Released at");
  expect(lines).toHaveLength(1 + 2 + 1); // header, rows, totals
});

test("the Excel export is a workbook: who and when first, then the header row and every row", async ({ page }) => {
  await stub(page);
  await page.goto("/reports?report=agent-commissions");
  await expect(page.getByTestId("report-table").locator("tbody tr")).toHaveCount(2);
  const x = await downloaded(page, "Excel");
  expect(x.name).toMatch(/^agent-commissions-.*\.xlsx$/);
  expect(x.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  const text = x.bytes.toString("utf8");
  expect(text).toContain("xl/worksheets/sheet1.xml");
  const sheet = text.slice(text.indexOf("<sheetData>"), text.indexOf("</sheetData>"));
  for (const h of ["Agent no.", "Name", "Town", "Status", "Float balance KES", "Float limit KES", "Onboarded this month", "Commission this month KES"]) expect(sheet).toContain(`>${h}<`);
  // Institution, report, generated at, generated by; a blank row; the table.
  expect(sheet.match(/<row /g)).toHaveLength(4 + 1 + 2 + 1);
  for (const v of ["Institution", "KTDA Holdings", "Report", "Agent commissions", "Generated at", "(Nairobi)", "Generated by", "Amina Ops"]) expect(sheet).toContain(v);
  expect(sheet).toContain('<row r="6">');
  expect(sheet).toContain('<c r="A6" t="inlineStr" s="1"><is><t xml:space="preserve">Agent no.</t>');
  expect(sheet).toContain("<v>160.5</v>");
});

test("PDF prints the report, with a header and a page title naming the institution and the report", async ({ page }) => {
  await stub(page);
  await page.goto("/reports?report=payment-runs");
  await expect(page.getByTestId("report-table")).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { printed: string[] };
    w.printed = [];
    window.print = () => { w.printed.push(document.title); };
  });
  const before = await page.title();
  await page.getByRole("button", { name: "PDF" }).click();
  const titles = await page.evaluate(() => (window as unknown as { printed: string[] }).printed);
  expect(titles).toHaveLength(1);
  expect(titles[0]).toMatch(/^KTDA Holdings · Payment runs · \d{2} \w{3} \d{4}, \d{2}:\d{2}$/);
  expect(await page.title()).toBe(before);
  await expect(page.locator("[data-print-root]")).toHaveCount(1);
  // Hidden on screen, shown in print.
  const header = page.getByTestId("print-header");
  await expect(header).toBeHidden();
  await page.emulateMedia({ media: "print" });
  await expect(header).toBeVisible();
  await expect(header).toContainText("KTDA Holdings");
  await expect(header.getByRole("heading", { name: "Payment runs" })).toBeVisible();
  // The report itself prints, and the rest of the page does not.
  await expect(page.getByTestId("report-table")).toBeVisible();
  await expect(page.getByTestId("report-list")).toBeHidden();
  await expect(header).toContainText("by Amina Ops");
});

test("Pay to M-PESA runs: only payout runs, the columns, totals and the monthly bars", async ({ page }) => {
  await stub(page, {
    runs: [
      run(1),
      run(2, { flow: "PAYOUT", sourceName: "payout-2.csv", processedCount: 18, failureCount: 2, skippedCount: 1, totalAmount: 1800 }),
      run(4, { flow: "PAYOUT", sourceName: "payout-4.csv", status: "PARTIAL", totalRows: 5, processedCount: 4, failureCount: 1, skippedCount: 0, totalAmount: 400.5 }),
    ],
  });
  await page.goto("/reports?report=payout-runs");
  const table = page.getByTestId("report-table");
  await expect(table.locator("thead th")).toHaveText(["Run", "File", "Rows", "Sent", "Failed + refused", "Already paid", "Amount paid out KES", "Status", "Released by", "Released at"]);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator("tbody tr").first()).toContainText("payout-4.csv");
  await expect(table).not.toContainText("ktda-pay-1.csv");
  const totals = page.getByTestId("report-totals");
  await expect(totals).toContainText("22");
  await expect(totals).toContainText("2,200.5");
  await expect(page.getByTestId("report-chart")).toContainText("Paid out to M-PESA by month (KES)");
});

test("Transactions summary: per Nairobi month, credited in, paid out, net, two series and the footnote", async ({ page }) => {
  await stub(page, {
    runs: [
      run(1, { totalAmount: 5000, completedAt: "2026-11-01T08:00:00Z" }),
      // 22:30 UTC on 31 Oct is 01:30 on 1 Nov in Nairobi.
      run(2, { flow: "PAYOUT", totalAmount: 1200, completedAt: "2026-10-31T22:30:00Z" }),
      run(3, { totalAmount: 3000, completedAt: "2026-10-15T08:00:00Z" }),
      // Not counted: still running, or another flow.
      run(5, { status: "RUNNING", completedAt: null, totalAmount: 9999 }),
      run(6, { flow: "ACTIVATION", totalAmount: 7777 }),
    ],
  });
  await page.goto("/reports?report=transactions");
  const table = page.getByTestId("report-table");
  await expect(table.locator("thead th")).toHaveText(["Month", "Credited to wallets KES", "Paid out to M-PESA KES", "Net KES"]);
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText(/2026-10\s*3,000\s*0\s*3,000/);
  await expect(rows.nth(1)).toHaveText(/2026-11\s*5,000\s*1,200\s*3,800/);
  await expect(page.getByTestId("report-totals")).toHaveText(/Total\s*8,000\s*1,200\s*6,800/);
  const chart = page.getByTestId("report-chart");
  await expect(chart).toContainText("Credited to wallets");
  await expect(chart).toContainText("Paid out to M-PESA");
  await expect(page.getByTestId("report-note")).toContainText("not individual withdrawals");
  await expect(page.getByTestId("report-list").locator('[data-report="transactions"]')).not.toContainText("not yet");

  const x = await downloaded(page, "Excel");
  const sheet = x.bytes.toString("utf8");
  expect(sheet).toContain("not individual withdrawals");
});

test("Farmer KYC: every status read, the columns, and tiles from the summary", async ({ page }) => {
  const sent = await stub(page, {
    farmers: (q) => {
      const k = q.get("kyc");
      if (k === "PENDING") return { items: [farmer("TEST000021", { kyc: { status: "PENDING", identityResult: "MATCH", startedAt: "2026-11-08T08:00:00Z", decidedAt: null, note: null } })] };
      if (k === "VERIFIED") return { items: [farmer("TEST000022")] };
      if (k === "REJECTED") return { items: [] };
      return { items: [farmer("TEST000023", { kyc: null })] };
    },
  });
  await page.goto("/reports?report=farmer-kyc");
  const table = page.getByTestId("report-table");
  await expect(table.locator("thead th")).toHaveText(["Grower no.", "Name", "KYC status", "Registry answer", "Started", "Decided", "Note"]);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("tbody tr").nth(0)).toContainText("TEST000021");
  await expect(table.locator("tbody tr").nth(2)).toContainText("TEST000023");
  const tiles = page.getByTestId("report-tiles");
  for (const t of ["To decide", "Verified", "Rejected", "Not started"]) await expect(tiles).toContainText(t);
  const kycs = sent.filter((x) => x.path === "/farmers").map((x) => x.query.get("kyc"));
  expect(kycs).toEqual(expect.arrayContaining(["PENDING", "VERIFIED", "REJECTED", "NONE"]));
});

test("farmer register: tiles from the summary, the rows, and the filters sent to omnichannel", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/reports?report=farmer-register");
  const tiles = page.getByTestId("report-tiles");
  await expect(tiles).toContainText("Funded3");
  await expect(tiles).toContainText("KYC to decide2");
  await expect(tiles).toContainText("Joined in bulk5");
  const table = page.getByTestId("report-table");
  await expect(table.locator("thead th")).toHaveText(["Grower no.", "Name", "Factory", "Phone", "Stage", "KYC", "Registry answer", "Joined via", "Registered", "Activated", "Last funded"]);
  await expect(table.locator("tbody tr").first()).toContainText("Bulk (factory file)");
  await expect(table.locator("tbody tr").first()).toContainText("01 Nov 2026");
  await page.getByRole("button", { name: "Any KYC" }).click();
  await page.getByRole("option", { name: "KYC: to decide" }).click();
  await expect.poll(() => sent.some((s) => s.path === "/farmers" && s.query.get("kyc") === "PENDING" && s.query.get("size") === "100")).toBe(true);
});

test("farmer register: it stops at 1,000 by default, says first N of M, and Load all reads the rest", async ({ page }) => {
  const sent = await stub(page, {
    farmers: (q) => {
      const p = Number(q.get("page")) || 1;
      return { items: Array.from({ length: p <= 14 ? 100 : 75 }, (_, i) => farmer(`G${p}-${i}`)), total: 1475 };
    },
  });
  await page.goto("/reports?report=farmer-register");
  await expect(page.getByTestId("report-meta")).toContainText("First 1,000 of 1,475 rows");
  const progress = page.getByTestId("report-progress");
  await expect(progress).toContainText("Loaded 1,000 of 1,475 farmers. Stopped at 1,000");
  expect(Math.max(...sent.filter((x) => x.path === "/farmers").map((x) => Number(x.query.get("page"))))).toBe(10);

  await progress.getByRole("button", { name: "Load all 1,475" }).click();
  await expect(page.getByTestId("report-meta")).toContainText("1,475 rows");
  await expect(page.getByTestId("report-progress")).toHaveCount(0);
  expect(Math.max(...sent.filter((x) => x.path === "/farmers").map((x) => Number(x.query.get("page"))))).toBe(15);
});

/** Farmers paged 100 at a time out of `total`; pages after the first wait for `release()`. */
async function slowFarmers(page: Page, total: number) {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((r) => { open = r; });
  const pages: number[] = [];
  await page.route(/\/omni\/api\/operator\/farmers(\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const p = Number(url.searchParams.get("page")) || 1;
    pages.push(p);
    if (p > 1) await gate;
    const n = Math.max(0, Math.min(100, total - (p - 1) * 100));
    const items = Array.from({ length: n }, (_, i) => farmer(`G${String((p - 1) * 100 + i + 1).padStart(5, "0")}`));
    try {
      await route.fulfill({ status: 200, contentType: "application/json", headers: paged(items, total, p), body: JSON.stringify(items) });
    } catch { /* the page went away */ }
  });
  return { release: () => open(), pages };
}

test("the first page shows with its tiles before the rest has loaded, then the table grows", async ({ page }) => {
  await stub(page);
  const slow = await slowFarmers(page, 450);
  await page.goto("/reports?report=farmer-register");
  await expect(page.getByTestId("report-meta")).toContainText("First 100 of 450 rows");
  await expect(page.getByTestId("report-tiles")).toContainText("Registered");
  await expect(page.getByTestId("report-progress")).toContainText("Loaded 100 of 450 farmers…");
  await expect(page.getByTestId("report-table").locator("tbody tr")).toHaveCount(100);
  slow.release();
  await expect(page.getByTestId("report-meta")).toContainText("450 rows");
  await expect(page.getByTestId("report-progress")).toHaveCount(0);
});

test("the table is paged over the rows loaded: 200 a page by default, a choice of size, Previous and Next", async ({ page }) => {
  await stub(page);
  const slow = await slowFarmers(page, 450);
  slow.release();
  await page.goto("/reports?report=farmer-register");
  await expect(page.getByTestId("report-meta")).toContainText("450 rows");
  const rows = page.getByTestId("report-table").locator("tbody tr");
  await expect(rows).toHaveCount(200);
  const pager = page.getByTestId("report-pager");
  await expect(pager.getByTestId("report-showing")).toHaveText("Showing 1–200 of 450");
  await pager.getByRole("button", { name: "Next" }).click();
  await expect(pager.getByTestId("report-showing")).toHaveText("Showing 201–400 of 450");
  await expect(rows.first()).toContainText("G00201");
  await pager.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(50);
  await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
  await pager.getByLabel("Rows per page").selectOption("50");
  await expect(rows).toHaveCount(50);
  await expect(pager.getByTestId("report-showing")).toHaveText("Showing 1–50 of 450");
  await expect(pager.getByRole("button", { name: "Previous" })).toBeDisabled();
  // The exports still carry every row loaded, not just the page shown.
  const csv = await downloaded(page, "CSV");
  expect(csv.bytes.toString("utf8").trim().split("\r\n")).toHaveLength(1 + 450);
});

test("an export while rows are still loading says first N of M in its header", async ({ page }) => {
  await stub(page);
  await slowFarmers(page, 450);
  await page.goto("/reports?report=farmer-register");
  await expect(page.getByTestId("report-progress")).toContainText("Loaded 100 of 450 farmers…");
  const x = await downloaded(page, "Excel");
  const sheet = x.bytes.toString("utf8");
  expect(sheet).toContain("First 100 of 450 rows");
  expect(sheet.match(/<row /g)).toHaveLength(5 + 1 + 100); // institution, report, at, by, rows; the header row; the rows
});

test("leaving a report stops its reading", async ({ page }) => {
  await stub(page);
  const slow = await slowFarmers(page, 2000);
  await page.goto("/reports?report=farmer-register");
  await expect(page.getByTestId("report-progress")).toContainText("Loaded 100 of 2,000 farmers…");
  await page.getByTestId("report-list").locator('[data-report="payment-runs"]').click();
  await expect(page.getByTestId("report-table")).toContainText("ktda-pay-1.csv");
  slow.release();
  // The page in flight lands; nothing after it is asked for.
  await page.waitForTimeout(500);
  expect(Math.max(...slow.pages)).toBe(2);
});

test("other multi-page reports show their first page at once too (KYC decisions)", async ({ page }) => {
  await stub(page);
  let open: () => void = () => undefined;
  const gate = new Promise<void>((r) => { open = r; });
  await page.route(/\/omni\/api\/operator\/farmers(\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const p = Number(url.searchParams.get("page")) || 1;
    if (p > 1) await gate;
    const kyc = url.searchParams.get("kyc");
    const items = Array.from({ length: p === 1 ? 100 : 20 }, (_, i) => farmer(`${kyc}-${p}-${i}`, { kyc: { status: kyc, identityResult: "MATCH", startedAt: null, decidedAt: "2026-11-04T08:00:00Z", note: null } }));
    try {
      await route.fulfill({ status: 200, contentType: "application/json", headers: paged(items, 120, p), body: JSON.stringify(items) });
    } catch { /* gone */ }
  });
  await page.goto("/reports?report=kyc-decisions");
  await expect(page.getByTestId("report-progress")).toContainText("Loaded 200 of 240 farmers…");
  await expect(page.getByTestId("report-table").locator("tbody tr")).toHaveCount(200);
  open();
  await expect(page.getByTestId("report-meta")).toContainText("240 rows");
});

test("agent commissions: the columns and a totals row", async ({ page }) => {
  await stub(page);
  await page.goto("/reports?report=agent-commissions");
  await expect(page.getByTestId("report-totals")).toContainText("Total");
  await expect(page.getByTestId("report-totals")).toContainText("8");
  await expect(page.getByTestId("report-totals")).toContainText("160.5");
});

test("approvals: every outcome read, newest first; not available without the queue", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/reports?report=approvals");
  const table = page.getByTestId("report-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table).toContainText("No bank reference.");
  for (const st of ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "FAILED"]) expect(sent.some((s) => s.path === "/approvals" && s.query.get("status") === st)).toBe(true);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await signIn(page);
  await stub(page, { approvalsMissing: true });
  await page.reload();
  await expect(page.getByTestId("report-not-available")).toBeVisible();
});

test("KYC decisions: verified and rejected farmers with the registry's answer", async ({ page }) => {
  const sent = await stub(page);
  await page.goto("/reports?report=kyc-decisions");
  const table = page.getByTestId("report-table");
  await expect(table.locator("thead th")).toHaveText(["Grower no.", "Name", "Decision", "Registry answer", "Decided at", "Note"]);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table).toContainText("Differs from the registry");
  await expect(table).toContainText("Name differs.");
  expect(sent.some((s) => s.query.get("kyc") === "VERIFIED")).toBe(true);
  expect(sent.some((s) => s.query.get("kyc") === "REJECTED")).toBe(true);
});

test("an omnichannel without the runs or the agents says so", async ({ page }) => {
  await stub(page, { runs: null, agents: null });
  await page.goto("/reports?report=payment-runs");
  await expect(page.getByTestId("report-not-available")).toBeVisible();
  await page.getByTestId("report-list").locator('[data-report="agent-commissions"]').click();
  await expect(page.getByTestId("report-not-available")).toBeVisible();
});
