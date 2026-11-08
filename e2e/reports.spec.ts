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
  for (const t of ["Payment runs", "Transactions summary", "Farmer register", "Agent commissions", "Approvals", "KYC decisions", "Merchant settlements", "Disputes and SLA", "Build your own"]) {
    await expect(list).toContainText(t);
  }
  await expect(page.getByTestId("demo-footer")).toHaveCount(0);
  for (const key of ["transactions", "merchant-settlements", "disputes", "build"]) {
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

test("the Excel export is a workbook with the header row and every row", async ({ page }) => {
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
  expect(sheet.match(/<row /g)).toHaveLength(1 + 2 + 1);
  expect(sheet).toContain("<v>160.5</v>");
});

test("PDF prints the report", async ({ page }) => {
  await stub(page);
  await page.goto("/reports?report=payment-runs");
  await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
  await page.getByRole("button", { name: "PDF" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.locator("[data-print-root]")).toHaveCount(1);
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

test("farmer register: past 10 pages of 100 it says first N rows", async ({ page }) => {
  await stub(page, {
    farmers: (q) => {
      const p = Number(q.get("page")) || 1;
      return { items: Array.from({ length: 100 }, (_, i) => farmer(`G${p}-${i}`)), total: 1500 };
    },
  });
  await page.goto("/reports?report=farmer-register");
  await expect(page.getByTestId("report-meta")).toContainText("First 1,000 rows");
  await expect(page.getByTestId("report-capped")).toBeVisible();
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
