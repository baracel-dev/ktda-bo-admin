import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { Button, Card, ChartLegend, ColumnChart, DateRangeFilter, FilterBar, NotePanel, PageHeader, SearchInput, Select, SelectFilter, Skeleton, StatCard } from "../ui";
import { useAsyncData } from "../lib/useAsyncData";
import { units } from "../lib/tokenConsole/format";
import { SourceError } from "../components/tokenconsole/ConsoleTable";
import {
  agentCommissions, approvals, farmerKyc, farmerRegister, kycDecisions, payoutRuns, paymentRuns, transactionsSummary,
  type Loaded, type PagedReport, type RegisterFilters, type ReportData,
} from "../lib/reports";
import { DEFAULT_CAP, useProgressiveReport } from "../lib/useProgressiveReport";
import { download, fileStem, nairobiDateTime, toCsv, toXlsx, type ExportHeader, type Row } from "../lib/reportExport";
import { institutionApi } from "../lib/api.institution";
import {
  hasPeriod, nairobiToday, periodFromParams, periodSlug, periodText, QUICK_PICKS, withPeriod, type Period,
} from "../lib/reportPeriod";
import { useAuth } from "../lib/auth";
import {
  CHANNEL_LABEL, FARMER_STATES, KYC_LABEL, KYC_STATUSES, ONBOARDING_CHANNELS, STATE_LABEL,
  type FarmerState, type KycStatus, type OnboardingChannel,
} from "../lib/journeyContract";

/* Reports (prototype 3.17): "Standard reports you can reshape and export.
   The data belongs to KTDA; exports carry no vendor lock-in" (REQ 5.8, 6.8).
   On the left the reports, each with a line on what it holds; on the right
   the one chosen (?report=), with "N rows · generated <date>", CSV, Excel and
   PDF exports made in the browser from the rows on screen, a chart where it
   has one, and the table. Every report reads omnichannel, which answers only
   for this institution (lib/reports.ts). Dates are Nairobi's. Every Excel
   export and the PDF carry a header: the institution, the report, when it was
   generated and by whom.

   Every live report but agent commissions (month to date) takes a period: a
   From and To day, Nairobi's, To included, in the URL as ?from=&to= next to
   ?report= (lib/reportPeriod.ts). It is named in the "N rows" line, the
   exports' header (the CSV's file name) and the empty state. */

type ReportKey = "payment-runs" | "payout-runs" | "transactions" | "farmer-register" | "farmer-kyc" | "agent-commissions" | "approvals" | "kyc-decisions";
type Entry = { key: string; title: string; description: string; live: boolean };

const REPORTS: Entry[] = [
  { key: "payment-runs", title: "Payment runs", description: "Every run with lines, net paid, deductions and status.", live: true },
  { key: "payout-runs", title: "Pay to M-PESA runs", description: "Every run paying farmers from their wallets to M-PESA: sent, failed and paid out.", live: true },
  { key: "transactions", title: "Transactions summary", description: "Money credited into wallets and paid out to M-PESA, by month.", live: true },
  { key: "farmer-register", title: "Farmer register", description: "Every farmer with their stage, KYC and how they joined.", live: true },
  { key: "farmer-kyc", title: "Farmer KYC", description: "Every farmer by KYC status, with the registry's answer and the dates.", live: true },
  { key: "agent-commissions", title: "Agent commissions", description: "Month-to-date commission and onboardings per agent.", live: true },
  { key: "approvals", title: "Approvals", description: "Every request for a second person's approval, and its outcome.", live: true },
  { key: "kyc-decisions", title: "KYC decisions", description: "Every farmer verified or rejected, with the registry's answer.", live: true },
  { key: "merchant-settlements", title: "Merchant settlements", description: "Sales and settlement accounts for approved merchants, last 30 days.", live: false },
  { key: "disputes", title: "Disputes and SLA", description: "Every dispute with its age and outcome.", live: false },
  { key: "build", title: "Build your own", description: "Pick the transaction fields and filters you need. (REQ 5.8.3)", live: false },
];
const NOT_YET: Record<string, string> = {
  "merchant-settlements": "Not yet available: merchants and their sales live in the merchant service, which does not report them here yet.",
  disputes: "Not yet available: disputes are not built yet.",
  build: "Not yet available: the report builder (REQ 5.8.3) comes later.",
};

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const chosen = REPORTS.find((r) => r.key === params.get("report")) ?? REPORTS[0];
  // The period stays when another report is picked.
  const pick = (key: string) => setParams((cur) => withPeriod(new URLSearchParams({ report: key }), periodFromParams(cur)), { replace: true });

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="Reports"
        subtitle="Standard reports you can reshape and export. The data belongs to KTDA; exports carry no vendor lock-in."
      />
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Reports" data-no-print>
          <ul className="flex flex-col gap-1" data-testid="report-list">
            {REPORTS.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => pick(r.key)}
                  aria-current={r.key === chosen.key ? "page" : undefined}
                  className={`w-full rounded-[var(--radius-lg)] border px-3 py-2 text-left transition-colors ${r.key === chosen.key ? "border-primary-300 bg-primary-50" : "border-transparent hover:bg-surface-sunken"}`}
                  data-report={r.key}
                >
                  <span className="block text-[13px] font-semibold text-text">{r.title}{!r.live && <span className="ml-1 font-normal text-text-faint">· not yet</span>}</span>
                  <span className="mt-0.5 block text-[12px] text-text-soft">{r.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section className="min-w-0" aria-label={chosen.title}>
          {chosen.live ? <LiveReport key={chosen.key} entry={chosen} /> : (
            <div data-testid="report-not-yet">
              <h2 className="mb-2 font-display text-lg font-semibold text-text">{chosen.title}</h2>
              <NotePanel tone="info">{NOT_YET[chosen.key]}</NotePanel>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Reports read in one go. */
const ONCE: Partial<Record<ReportKey, (p: Period) => Promise<Loaded>>> = {
  "payment-runs": paymentRuns,
  "payout-runs": payoutRuns,
  transactions: transactionsSummary,
};
/** A paged report with its row and extra types forgotten: the view only passes them through. */
type AnyPaged = PagedReport<unknown, unknown>;
const erase = <T, X>(d: PagedReport<T, X>) => d as unknown as AnyPaged;
/** Reports read a page at a time: the first page shows at once (useProgressiveReport). */
const PAGED: Partial<Record<ReportKey, (p: Period) => AnyPaged>> = {
  "farmer-kyc": (p) => erase(farmerKyc(p)),
  "agent-commissions": () => erase(agentCommissions),
  approvals: (p) => erase(approvals(p)),
  "kyc-decisions": (p) => erase(kycDecisions(p)),
};
/** Which date each report's period is on; a report not here takes none. */
const PERIOD_BASIS: Partial<Record<ReportKey, string>> = {
  "payment-runs": "Runs released in the period, or started in it where not released yet.",
  "payout-runs": "Runs released in the period, or started in it where not released yet.",
  transactions: "Runs completed in the period.",
  "farmer-register": "Farmers registered in the period.",
  "farmer-kyc": "Farmers registered in the period.",
  approvals: "Requests made in the period.",
  "kyc-decisions": "Decisions made in the period.",
};

type Context = { institution: string | null; by: string | null };

function LiveReport({ entry }: { entry: Entry }) {
  const { user } = useAuth();
  const own = useAsyncData(() => institutionApi.own());
  const ctx: Context = { institution: own.data?.length === 1 ? own.data[0].name ?? null : null, by: user?.name ?? null };
  const [filters, setFilters] = useState<RegisterFilters>({});
  const [typed, setTyped] = useState("");
  const key = entry.key as ReportKey;
  const isRegister = key === "farmer-register";
  const [params, setParams] = useSearchParams();
  const urlPeriod = periodFromParams(params);
  const periodKey = `${urlPeriod.from}|${urlPeriod.to}`;
  const basis = PERIOD_BASIS[key];
  // Agent commissions are month to date: no period.
  const period: Period = useMemo(() => (basis ? urlPeriod : { from: "", to: "" }), [periodKey, basis]); // eslint-disable-line react-hooks/exhaustive-deps
  // The URL as last set: React Router's own updater sees the params of the last render, so two
  // quick edits (From, then To) would otherwise undo each other.
  const latest = useRef(params);
  latest.current = params;
  const setPeriod = (p: Period) => {
    latest.current = withPeriod(latest.current, p);
    setParams(latest.current, { replace: true });
  };
  // One day typed changes that day only.
  const changeRange = (r: Period) => {
    if (r.from !== period.from && r.to !== period.to) return setPeriod(r);
    const k = r.from !== period.from ? "from" : "to";
    setPeriod({ ...periodFromParams(latest.current), [k]: r[k] });
  };
  useEffect(() => {
    if (!isRegister || (typed.trim() || undefined) === filters.q) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: typed.trim() || undefined })), 300);
    return () => clearTimeout(t);
  }, [typed, isRegister, filters.q]);
  const filterKey = JSON.stringify(filters);
  const registerDef = useMemo(() => farmerRegister(filters, period), [filterKey, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const pagedDef = useMemo(() => PAGED[key]?.(period), [key, period]);
  const today = nairobiToday();

  return (
    <div data-print-root data-testid="report">
      <h2 className="font-display text-lg font-semibold text-text">{entry.title}</h2>
      <p className="mb-3 text-[12.5px] text-text-soft">{entry.description}</p>

      {basis ? (
        <div data-no-print>
          <FilterBar className="mb-1">
            <div data-testid="report-period"><DateRangeFilter from={period.from} to={period.to} onChange={changeRange} /></div>
            {QUICK_PICKS.map((q) => {
              const p = q.period(today);
              const on = p.from === period.from && p.to === period.to;
              return (
                <Button key={q.key} size="sm" variant={on ? "primary" : "outline"} aria-pressed={on} data-pick={q.key} onClick={() => setPeriod(p)}>{q.label}</Button>
              );
            })}
          </FilterBar>
          <p className="mb-3 text-[12px] text-text-soft" data-testid="period-basis">{hasPeriod(period) ? basis : `Any date. ${basis.replace("in the period", "in a period")} when one is chosen.`}</p>
        </div>
      ) : key === "agent-commissions" ? (
        <p className="mb-3 text-[12px] text-text-soft" data-no-print data-testid="period-basis">Month to date: a period does not apply to this report.</p>
      ) : null}

      {isRegister && (
        <div data-no-print>
          <FilterBar>
            <SearchInput value={typed} onChange={setTyped} placeholder="Grower number, name or phone" className="w-64" />
            <SelectFilter value={filters.state ?? "all"} onChange={(v) => setFilters((f) => ({ ...f, state: v === "all" ? null : (v as FarmerState) }))}
              options={FARMER_STATES.map((s) => ({ value: s, label: STATE_LABEL[s] }))} allLabel="Any stage" />
            <SelectFilter value={filters.kyc ?? "all"} onChange={(v) => setFilters((f) => ({ ...f, kyc: v === "all" ? null : (v as KycStatus) }))}
              options={KYC_STATUSES.map((s) => ({ value: s, label: `KYC: ${KYC_LABEL[s].toLowerCase()}` }))} allLabel="Any KYC" />
            <SelectFilter value={filters.channel ?? "all"} onChange={(v) => setFilters((f) => ({ ...f, channel: v === "all" ? null : (v as OnboardingChannel) }))}
              options={ONBOARDING_CHANNELS.map((c) => ({ value: c, label: `Joined via ${CHANNEL_LABEL[c].toLowerCase()}` }))} allLabel="Any way of joining" />
          </FilterBar>
        </div>
      )}

      {isRegister ? <PagedView def={erase(registerDef)} runKey={`farmer-register:${filterKey}:${periodKey}`} entry={entry} ctx={ctx} period={period} />
        : pagedDef ? <PagedView def={pagedDef} runKey={`${key}:${basis ? periodKey : ""}`} entry={entry} ctx={ctx} period={period} />
        : <OnceView key={periodKey} load={() => ONCE[key]!(period)} entry={entry} ctx={ctx} period={period} />}
    </div>
  );
}

const NotAvailable = () => (
  <div data-testid="report-not-available">
    <NotePanel tone="info" title="Not available on this environment yet">Omnichannel here does not have what this report reads.</NotePanel>
  </div>
);

function OnceView({ load, entry, ctx, period }: { load: () => Promise<Loaded>; entry: Entry; ctx: Context; period: Period }) {
  const report = useAsyncData(load);
  // Stamped when the rows arrive.
  const generatedAt = useMemo(() => new Date().toISOString(), [report.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (report.error) return <SourceError what={`the ${entry.title.toLowerCase()} report`} error={report.error} onRetry={report.reload} />;
  if (!report.data) return <Skeleton className="h-64" />;
  if (!report.data.available) return <NotAvailable />;
  return <ReportBody slug={entry.key} title={entry.title} data={report.data.data} generatedAt={generatedAt} period={period} {...ctx} />;
}

/** How many rows a paged report reads at most: the page's own setting. */
const CAPS = [1000, 5000, 20000];

function PagedView({ def, runKey, entry, ctx, period }: { def: AnyPaged; runKey: string; entry: Entry; ctx: Context; period: Period }) {
  const [cap, setCap] = useState(DEFAULT_CAP);
  const { state, retry } = useProgressiveReport(def, runKey, cap);
  if (state.status === "error") return <SourceError what={`the ${entry.title.toLowerCase()} report`} error={state.error} onRetry={retry} />;
  if (state.status === "loading") return <Skeleton className="h-64" />;
  if (state.status === "unavailable") return <NotAvailable />;
  return (
    <ReportBody
      slug={entry.key} title={entry.title} data={state.data} generatedAt={state.firstAt} period={period} {...ctx}
      progress={{ loaded: state.loaded, total: state.total, done: state.done, reading: state.reading, unit: def.unit, cap, setCap }}
    />
  );
}

type Progress = { loaded: number; total: number | null; done: boolean; reading: boolean; unit: string; cap: number; setCap: (n: number) => void };

/** The table's own pages: never every row at once. */
const TABLE_SIZES = [50, 100, 200, 500];

function ReportBody({ slug, title, data, generatedAt, period, institution, by, progress }: {
  slug: string; title: string; data: ReportData; generatedAt: string; period: Period; institution: string | null; by: string | null; progress?: Progress;
}) {
  const exportRows: Row[] = data.totals ? [...data.rows, data.totals] : data.rows;
  const partial = !!progress && !progress.done;
  const of = progress?.total ?? null;
  const [size, setSize] = useState(200);
  const [tablePage, setTablePage] = useState(1);
  const pages = Math.max(1, Math.ceil(data.rows.length / size));
  const current = Math.min(tablePage, pages);
  const from = (current - 1) * size;
  const shown = data.rows.slice(from, from + size);
  const when = periodText(period);
  // Rows kept by the period out of those read: what "First N of M" counts is the reads.
  const filtered = !!when && partial;
  const stem = [fileStem(slug), periodSlug(period)].filter(Boolean).join("-");
  const header: ExportHeader = [
    ["Institution", institution ?? "This institution"],
    ["Report", title],
    ...(when ? [["Period", `${when} (Nairobi, both days included)`] as [string, string]] : []),
    ["Generated at", `${nairobiDateTime(generatedAt)} (Nairobi)`],
    ["Generated by", by ?? ""],
    ...(partial ? [["Rows", `First ${units(data.rows.length)}${of != null ? ` of ${units(of)}` : ""} rows`] as [string, string]] : []),
    ...(data.note ? [["Note", data.note] as [string, string]] : []),
  ];
  // The PDF's title (and the file name a browser suggests for it).
  const print = () => {
    const before = document.title;
    document.title = `${institution ?? "KTDA"} · ${title} · ${nairobiDateTime(generatedAt)}`;
    window.print();
    document.title = before;
  };
  return (
    <>
      <div className="mb-4 border-b border-black pb-2" data-print-only data-testid="print-header">
        <p className="text-[11px]">{institution ?? "This institution"}</p>
        <h1 className="text-lg font-semibold">{title}</h1>
        {when && <p className="text-[11px]" data-testid="print-period">Period {when} (Nairobi)</p>}
        <p className="text-[11px]">Generated {nairobiDateTime(generatedAt)} (Nairobi){by ? ` by ${by}` : ""}</p>
        {(partial || pages > 1) && (
          <p className="text-[11px]" data-testid="print-rows">Rows {units(from + 1)}–{units(from + shown.length)} of {units(data.rows.length)}{partial && of != null ? ` loaded (${units(of)} in all)` : ""}</p>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-text-soft" data-testid="report-meta">
          {filtered ? `${units(data.rows.length)} ${data.rows.length === 1 ? "row" : "rows"} in the period, from the first ${units(progress!.loaded)}${of != null ? ` of ${units(of)}` : ""} read`
            : partial ? `First ${units(data.rows.length)}${of != null ? ` of ${units(of)}` : ""} rows`
            : `${units(data.rows.length)} ${data.rows.length === 1 ? "row" : "rows"}`}
          {when ? ` · ${when}` : ""} · generated {nairobiDateTime(generatedAt)}
        </p>
        <div className="flex gap-2" data-no-print>
          <Button size="sm" variant="outline" onClick={() => download(`${stem}.csv`, toCsv(data.columns, exportRows), "text/csv;charset=utf-8")}>
            <FileDown size={14} /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => download(`${stem}.xlsx`, toXlsx(title, data.columns, exportRows, header) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
          <Button size="sm" variant="outline" onClick={print}>
            <Printer size={14} /> PDF
          </Button>
        </div>
      </div>
      {progress && <LoadProgress progress={progress} />}

      {data.tiles && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="report-tiles">
          {data.tiles.map((t) => <StatCard key={t.label} label={t.label} value={t.value} />)}
        </div>
      )}
      {data.chart && (
        <Card className="mb-4 p-4" data-testid="report-chart">
          <h3 className="mb-2 text-[13px] font-semibold text-text">{data.chart.title}</h3>
          {data.chart.series.length > 1 && <ChartLegend className="mb-2" items={data.chart.series.map((s, i) => ({ label: s.label, colorIndex: i }))} />}
          <ColumnChart labels={data.chart.labels} series={data.chart.series.map((s, i) => ({ ...s, colorIndex: i }))} />
        </Card>
      )}

      {data.rows.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="report-empty">{when ? `Nothing in the period (${when})${partial ? " among the rows read so far" : ""}.` : "Nothing to report yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full text-[12.5px]" data-testid="report-table">
            <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
              <tr>{data.columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}>{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={from + i} className="border-t border-border/60">
                  {data.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right tabular" : ""}`}>{fmt(r[c.key], c.numeric)}</td>)}
                </tr>
              ))}
            </tbody>
            {data.totals && (
              <tfoot>
                <tr className="border-t border-border bg-surface-sunken font-semibold" data-testid="report-totals">
                  {data.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right tabular" : ""}`}>{fmt(data.totals![c.key], c.numeric)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {data.rows.length > TABLE_SIZES[0] && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-text-soft" data-no-print data-testid="report-pager">
          <span data-testid="report-showing">
            Showing {units(from + 1)}–{units(from + shown.length)} of {units(data.rows.length)}{partial && of != null ? ` loaded (${units(of)} in all)` : ""}
          </span>
          <div className="flex items-center gap-2">
            <Select aria-label="Rows per page" value={String(size)} onChange={(e) => { setSize(Number(e.target.value)); setTablePage(1); }} className="w-24">
              {TABLE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setTablePage(current - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={current >= pages} onClick={() => setTablePage(current + 1)}>Next</Button>
          </div>
        </div>
      )}
      {data.note && <p className="mt-2 text-[12px] text-text-soft" data-testid="report-note">{data.note}</p>}
    </>
  );
}

const fmt = (v: Row[string], numeric?: boolean) =>
  v === null || v === undefined || v === "" ? "—" : numeric && typeof v === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v) : String(v);

/** "Loaded 300 of 10,015 farmers…", and how many to read. */
function LoadProgress({ progress: p }: { progress: Progress }) {
  if (p.done) return null;
  const all = p.total ?? Infinity;
  const stopped = !p.reading;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-[12.5px]" data-no-print data-testid="report-progress">
      <span className={stopped ? "text-warning" : "text-text-soft"}>
        Loaded {units(p.loaded)}{p.total != null ? ` of ${units(p.total)}` : ""} {p.unit}{p.reading ? "…" : `. Stopped at ${units(p.cap)}; the table and exports hold these.`}
      </span>
      <label className="flex items-center gap-2 text-text-soft">
        Read up to
        <Select aria-label="Read up to" value={String(CAPS.includes(p.cap) ? p.cap : "all")} onChange={(e) => p.setCap(e.target.value === "all" ? Number.MAX_SAFE_INTEGER : Number(e.target.value))} className="w-28">
          {CAPS.filter((n) => n < all).map((n) => <option key={n} value={n}>{units(n)}</option>)}
          <option value="all">All</option>
        </Select>
      </label>
      {stopped && <Button size="sm" variant="outline" onClick={() => p.setCap(Number.MAX_SAFE_INTEGER)}>Load all{p.total != null ? ` ${units(p.total)}` : ""}</Button>}
    </div>
  );
}
