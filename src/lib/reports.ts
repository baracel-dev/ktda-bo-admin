/* The Reports page's reports (prototype 3.17): each built in the browser from
   omnichannel reads this back office already uses, which answer only for
   this institution. A report is columns and rows (what the table shows and
   the exports carry), with tiles and a chart where it has them. A read this
   environment's omnichannel does not have makes the report say "not
   available on this environment yet". */

import { omniCall, type Page } from "./omniApi";
import { bulkLoads, type BulkRun } from "./api.bulkLoad";
import { farmersApi, type FarmersQuery } from "./api.farmers";
import { agentsApi } from "./api.agents";
import { maybe } from "./api.merchants";
import {
  CHANNEL_LABEL, IDENTITY_LABEL, KYC_LABEL, STATE_LABEL, type Farmer, type FarmersSummary,
} from "./journeyContract";
import { AGENT_STATUS_LABEL, type Agent } from "./merchantsAgentsContract";
import { nairobiDate, nairobiDateTime, nairobiMonth, type Column, type Row } from "./reportExport";

export type ReportData = {
  columns: Column[];
  rows: Row[];
  /** A totals row under the table, and the last row of the exports. */
  totals?: Row;
  /** More rows exist than were read: the table holds the first ones. */
  capped?: boolean;
  /** Monthly bars: labels, and one value each per series. */
  chart?: { title: string; labels: string[]; series: { label: string; values: number[] }[] };
  tiles?: { label: string; value: string }[];
  /** A footnote under the table, carried into the Excel header. */
  note?: string;
};
export type Loaded = { available: true; data: ReportData } | { available: false };

/** Up to `maxPages` pages of `size`: enough for an export, said when capped. */
export async function readPages<T>(read: (page: number, size: number) => Promise<Page<T>>, maxPages = 10, size = 100): Promise<{ items: T[]; capped: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const p = await read(page, size);
    items.push(...p.items);
    if (page >= p.pages || p.items.length < size) return { items, capped: false };
  }
  return { items, capped: true };
}

const NOT_YET = "—";
const kes = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/* ---- 1. Payment runs ---- */

export async function paymentRuns(): Promise<Loaded> {
  const r = await maybe(bulkLoads.recent());
  if (!r.available) return { available: false };
  const runs = r.data.filter((x) => x.flow === "PAYMENT").sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const net = (x: BulkRun) => x.payableAmount ?? x.totalAmount ?? 0;
  const byMonth = new Map<string, number>();
  for (const x of runs) if (x.completedAt && (x.status === "COMPLETED" || x.status === "PARTIAL")) {
    const m = nairobiMonth(x.completedAt);
    byMonth.set(m, (byMonth.get(m) ?? 0) + net(x));
  }
  const months = [...byMonth.keys()].sort();
  return {
    available: true,
    data: {
      columns: [
        { key: "run", header: "Run" }, { key: "title", header: "Title" }, { key: "lines", header: "Lines", numeric: true },
        { key: "net", header: "Net KES", numeric: true }, { key: "deductions", header: "Deductions KES" },
        { key: "held", header: "Errors held", numeric: true }, { key: "status", header: "Status" },
        { key: "released", header: "Released by" }, { key: "releasedAt", header: "Released at" },
      ],
      rows: runs.map((x) => ({
        run: x.runId.slice(0, 8),
        title: [x.sourceName, x.period].filter(Boolean).join(" · "),
        lines: x.totalRows,
        net: kes(net(x)),
        // The runs do not carry deductions yet.
        deductions: NOT_YET,
        held: (x.heldCount ?? 0) + x.failureCount,
        status: x.status,
        released: x.releasedBy ?? "",
        releasedAt: nairobiDateTime(x.releasedAt),
      })),
      totals: {
        run: "Total", lines: runs.reduce((s, x) => s + x.totalRows, 0), net: kes(runs.reduce((s, x) => s + net(x), 0)),
        held: runs.reduce((s, x) => s + (x.heldCount ?? 0) + x.failureCount, 0),
      },
      chart: months.length ? { title: "Net paid by month (KES)", labels: months, series: [{ label: "Net paid (KES)", values: months.map((m) => kes(byMonth.get(m)) ?? 0) }] } : undefined,
    },
  };
}

/** A run that moved money: completed, or completed in part. */
const settled = (x: BulkRun) => !!x.completedAt && (x.status === "COMPLETED" || x.status === "PARTIAL");

/* ---- Pay to M-PESA runs (bulk-loads flow PAYOUT) ---- */

export async function payoutRuns(): Promise<Loaded> {
  const r = await maybe(bulkLoads.recent());
  if (!r.available) return { available: false };
  const runs = r.data.filter((x) => x.flow === "PAYOUT").sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const byMonth = new Map<string, number>();
  for (const x of runs) if (settled(x)) {
    const m = nairobiMonth(x.completedAt!);
    byMonth.set(m, (byMonth.get(m) ?? 0) + (x.totalAmount ?? 0));
  }
  const months = [...byMonth.keys()].sort();
  const sum = (f: (x: BulkRun) => number) => runs.reduce((s, x) => s + f(x), 0);
  return {
    available: true,
    data: {
      columns: [
        { key: "run", header: "Run" }, { key: "file", header: "File" }, { key: "rows", header: "Rows", numeric: true },
        { key: "sent", header: "Sent", numeric: true }, { key: "failed", header: "Failed + refused", numeric: true },
        { key: "already", header: "Already paid", numeric: true }, { key: "amount", header: "Amount paid out KES", numeric: true },
        { key: "status", header: "Status" }, { key: "released", header: "Released by" }, { key: "releasedAt", header: "Released at" },
      ],
      rows: runs.map((x) => ({
        run: x.runId.slice(0, 8), file: x.sourceName, rows: x.totalRows, sent: x.processedCount, failed: x.failureCount,
        already: x.skippedCount, amount: kes(x.totalAmount), status: x.status, released: x.releasedBy ?? "", releasedAt: nairobiDateTime(x.releasedAt),
      })),
      totals: {
        run: "Total", rows: sum((x) => x.totalRows), sent: sum((x) => x.processedCount), failed: sum((x) => x.failureCount),
        already: sum((x) => x.skippedCount), amount: kes(sum((x) => x.totalAmount ?? 0)),
      },
      chart: months.length ? { title: "Paid out to M-PESA by month (KES)", labels: months, series: [{ label: "Paid out (KES)", values: months.map((m) => kes(byMonth.get(m)) ?? 0) }] } : undefined,
    },
  };
}

/* ---- Transactions summary: money in and out by month, from the runs ---- */

export async function transactionsSummary(): Promise<Loaded> {
  const r = await maybe(bulkLoads.recent());
  if (!r.available) return { available: false };
  const months = new Map<string, { in: number; out: number }>();
  for (const x of r.data) {
    if (!settled(x) || (x.flow !== "PAYMENT" && x.flow !== "PAYOUT")) continue;
    const m = nairobiMonth(x.completedAt!);
    const v = months.get(m) ?? { in: 0, out: 0 };
    if (x.flow === "PAYMENT") v.in += x.totalAmount ?? 0;
    else v.out += x.totalAmount ?? 0;
    months.set(m, v);
  }
  const keys = [...months.keys()].sort();
  const totalIn = keys.reduce((s, m) => s + months.get(m)!.in, 0);
  const totalOut = keys.reduce((s, m) => s + months.get(m)!.out, 0);
  return {
    available: true,
    data: {
      columns: [
        { key: "month", header: "Month" }, { key: "in", header: "Credited to wallets KES", numeric: true },
        { key: "out", header: "Paid out to M-PESA KES", numeric: true }, { key: "net", header: "Net KES", numeric: true },
      ],
      rows: keys.map((m) => {
        const v = months.get(m)!;
        return { month: m, in: kes(v.in), out: kes(v.out), net: kes(v.in - v.out) };
      }),
      totals: { month: "Total", in: kes(totalIn), out: kes(totalOut), net: kes(totalIn - totalOut) },
      chart: keys.length ? {
        title: "Money in and out by month (KES)", labels: keys,
        series: [
          { label: "Credited to wallets", values: keys.map((m) => kes(months.get(m)!.in) ?? 0) },
          { label: "Paid out to M-PESA", values: keys.map((m) => kes(months.get(m)!.out) ?? 0) },
        ],
      } : undefined,
      note: "Counts batch runs (payment runs into wallets, and Pay to M-PESA runs), not individual withdrawals farmers make in the app.",
    },
  };
}

/* ---- 2. Farmer register ---- */

export type RegisterFilters = Pick<FarmersQuery, "state" | "kyc" | "channel" | "q">;

const farmerRow = (f: Farmer): Row => ({
  grower: f.growerNo,
  name: f.fullName ?? "",
  factory: f.factory ?? "",
  phone: f.phone ?? "",
  state: STATE_LABEL[f.status] ?? f.status,
  kyc: f.kyc ? KYC_LABEL[f.kyc.status] ?? f.kyc.status : "",
  registry: f.kyc?.identityResult ? IDENTITY_LABEL[f.kyc.identityResult] ?? f.kyc.identityResult : "",
  joined: f.onboarding?.channel ? CHANNEL_LABEL[f.onboarding.channel] ?? f.onboarding.channel : "",
  registered: nairobiDate(f.registeredAt),
  activated: nairobiDate(f.activatedAt),
  funded: nairobiDate(f.lastFundedAt),
});

export async function farmerRegister(filters: RegisterFilters): Promise<Loaded> {
  const [summary, first] = await Promise.all([farmersApi.summary(), farmersApi.list({ ...filters, page: 1, size: 100 })]);
  if (!first.available) return { available: false };
  const rest = first.data.pages > 1
    ? await readPages(async (page, size) => {
      if (page === 1) return first.data;
      const p = await farmersApi.list({ ...filters, page, size });
      if (!p.available) throw new Error("The farmer list stopped answering.");
      return p.data;
    })
    : { items: first.data.items, capped: false };
  const s: FarmersSummary | null = summary.available ? summary.data : null;
  const tiles = s ? [
    { label: "Registered", value: String(s.registered) }, { label: "Activated", value: String(s.activated) },
    { label: "Funded", value: String(s.funded) }, ...(s.clash !== undefined ? [{ label: "Clash", value: String(s.clash) }] : []),
    ...(s.kyc ? [
      { label: "KYC not started", value: String(s.kyc.none) }, { label: "KYC to decide", value: String(s.kyc.pending) },
      { label: "KYC verified", value: String(s.kyc.verified) }, { label: "KYC rejected", value: String(s.kyc.rejected) },
    ] : []),
    ...(s.byChannel ? [
      { label: "Joined in bulk", value: String(s.byChannel.bulk) }, { label: "Joined via an agent", value: String(s.byChannel.agent) },
      { label: "Joined with staff", value: String(s.byChannel.staff) },
    ] : []),
  ] : undefined;
  return {
    available: true,
    data: {
      columns: [
        { key: "grower", header: "Grower no." }, { key: "name", header: "Name" }, { key: "factory", header: "Factory" }, { key: "phone", header: "Phone" },
        { key: "state", header: "Stage" }, { key: "kyc", header: "KYC" }, { key: "registry", header: "Registry answer" }, { key: "joined", header: "Joined via" },
        { key: "registered", header: "Registered" }, { key: "activated", header: "Activated" }, { key: "funded", header: "Last funded" },
      ],
      rows: rest.items.map(farmerRow),
      capped: rest.capped,
      tiles,
    },
  };
}

/* ---- 3. Agent commissions ---- */

export async function agentCommissions(): Promise<Loaded> {
  const first = await agentsApi.list({ page: 1, size: 100 });
  if (!first.available) return { available: false };
  const all = first.data.pages > 1
    ? await readPages(async (page, size) => {
      if (page === 1) return first.data;
      const p = await agentsApi.list({ page, size });
      if (!p.available) throw new Error("The agent list stopped answering.");
      return p.data;
    })
    : { items: first.data.items, capped: false };
  const agents: Agent[] = all.items;
  return {
    available: true,
    data: {
      columns: [
        { key: "agentNo", header: "Agent no." }, { key: "name", header: "Name" }, { key: "town", header: "Town" }, { key: "status", header: "Status" },
        { key: "balance", header: "Float balance KES", numeric: true }, { key: "limit", header: "Float limit KES", numeric: true },
        { key: "onboarded", header: "Onboarded this month", numeric: true }, { key: "commission", header: "Commission this month KES", numeric: true },
      ],
      rows: agents.map((a) => ({
        agentNo: a.agentNo, name: a.fullName, town: a.town ?? "", status: AGENT_STATUS_LABEL[a.status] ?? a.status,
        balance: kes(a.float.balance), limit: kes(a.float.limit), onboarded: a.onboardedThisMonth, commission: kes(a.commissionThisMonth),
      })),
      totals: {
        agentNo: "Total",
        balance: kes(agents.reduce((s, a) => s + a.float.balance, 0)),
        onboarded: agents.reduce((s, a) => s + a.onboardedThisMonth, 0),
        commission: kes(agents.reduce((s, a) => s + a.commissionThisMonth, 0)),
      },
      capped: all.capped,
    },
  };
}

/* ---- 4. Approvals (omnichannel's maker-checker queue) ---- */

type ApprovalRow = {
  reference: string; type: string; title: string; target: { kind: string; reference: string; name: string | null };
  maker: string; madeAt: string; checker: string | null; decidedAt: string | null; status: string; decisionNote: string | null; error: string | null;
};
const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "FAILED"] as const;

export async function approvals(): Promise<Loaded> {
  const lists = await Promise.all(APPROVAL_STATUSES.map((status) =>
    maybe(readPages((page, size) => omniCall.page<ApprovalRow>(`/approvals?status=${status}`, page, size)))));
  if (lists.some((l) => !l.available)) return { available: false };
  const items = lists.flatMap((l) => (l.available ? l.data.items : [])).sort((a, b) => b.madeAt.localeCompare(a.madeAt));
  return {
    available: true,
    data: {
      columns: [
        { key: "reference", header: "Reference" }, { key: "type", header: "Type" }, { key: "title", header: "Title" }, { key: "target", header: "Target" },
        { key: "maker", header: "Maker" }, { key: "madeAt", header: "Made at" }, { key: "checker", header: "Checker" }, { key: "decidedAt", header: "Decided at" },
        { key: "status", header: "Status" }, { key: "note", header: "Note" },
      ],
      rows: items.map((a) => ({
        reference: a.reference, type: a.type, title: a.title,
        target: `${a.target.kind} ${a.target.reference}${a.target.name ? ` (${a.target.name})` : ""}`,
        maker: a.maker, madeAt: nairobiDateTime(a.madeAt), checker: a.checker ?? "", decidedAt: nairobiDateTime(a.decidedAt),
        status: a.status, note: a.decisionNote ?? a.error ?? "",
      })),
      capped: lists.some((l) => l.available && l.data.capped),
    },
  };
}

/* ---- Farmer KYC: every farmer by KYC status ---- */

const KYC_REPORT_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "NONE"] as const;

export async function farmerKyc(): Promise<Loaded> {
  const read = (kyc: (typeof KYC_REPORT_STATUSES)[number]) => readPages(async (page, size) => {
    const p = await farmersApi.list({ kyc, page, size });
    if (!p.available) throw Object.assign(new Error("not available"), { notAvailable: true });
    return p.data;
  });
  let lists: Awaited<ReturnType<typeof read>>[];
  let summary: Awaited<ReturnType<typeof farmersApi.summary>>;
  try {
    [summary, lists] = await Promise.all([farmersApi.summary(), Promise.all(KYC_REPORT_STATUSES.map(read))]);
  } catch (e) {
    if ((e as { notAvailable?: boolean }).notAvailable) return { available: false };
    throw e;
  }
  const k = summary.available ? summary.data.kyc : undefined;
  return {
    available: true,
    data: {
      columns: [
        { key: "grower", header: "Grower no." }, { key: "name", header: "Name" }, { key: "kyc", header: "KYC status" },
        { key: "registry", header: "Registry answer" }, { key: "started", header: "Started" }, { key: "decided", header: "Decided" },
        { key: "note", header: "Note" },
      ],
      rows: lists.flatMap((l) => l.items).map((f) => ({
        grower: f.growerNo, name: f.fullName ?? "",
        kyc: f.kyc ? KYC_LABEL[f.kyc.status] ?? f.kyc.status : KYC_LABEL.NONE,
        registry: f.kyc?.identityResult ? IDENTITY_LABEL[f.kyc.identityResult] ?? f.kyc.identityResult : "",
        started: nairobiDateTime(f.kyc?.startedAt), decided: nairobiDateTime(f.kyc?.decidedAt), note: f.kyc?.note ?? "",
      })),
      capped: lists.some((l) => l.capped),
      tiles: k ? [
        { label: "To decide", value: String(k.pending) }, { label: "Verified", value: String(k.verified) },
        { label: "Rejected", value: String(k.rejected) }, { label: "Not started", value: String(k.none) },
      ] : undefined,
    },
  };
}

/* ---- 5. KYC decisions ---- */

export async function kycDecisions(): Promise<Loaded> {
  const read = (kyc: "VERIFIED" | "REJECTED") => readPages(async (page, size) => {
    const p = await farmersApi.list({ kyc, page, size });
    if (!p.available) throw Object.assign(new Error("not available"), { notAvailable: true });
    return p.data;
  });
  let verified, rejected;
  try {
    [verified, rejected] = await Promise.all([read("VERIFIED"), read("REJECTED")]);
  } catch (e) {
    if ((e as { notAvailable?: boolean }).notAvailable) return { available: false };
    throw e;
  }
  const farmers = [...verified.items, ...rejected.items].filter((f) => f.kyc)
    .sort((a, b) => (b.kyc?.decidedAt ?? "").localeCompare(a.kyc?.decidedAt ?? ""));
  return {
    available: true,
    data: {
      columns: [
        { key: "grower", header: "Grower no." }, { key: "name", header: "Name" }, { key: "decision", header: "Decision" },
        { key: "registry", header: "Registry answer" }, { key: "decidedAt", header: "Decided at" }, { key: "note", header: "Note" },
      ],
      rows: farmers.map((f) => ({
        grower: f.growerNo, name: f.fullName ?? "", decision: KYC_LABEL[f.kyc!.status] ?? f.kyc!.status,
        registry: f.kyc!.identityResult ? IDENTITY_LABEL[f.kyc!.identityResult] ?? f.kyc!.identityResult : "",
        decidedAt: nairobiDateTime(f.kyc!.decidedAt), note: f.kyc!.note ?? "",
      })),
      capped: verified.capped || rejected.capped,
    },
  };
}
