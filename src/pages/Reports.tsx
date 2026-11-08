import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { Button, Card, ColumnChart, FilterBar, NotePanel, PageHeader, SearchInput, SelectFilter, Skeleton, StatCard } from "../ui";
import { useAsyncData } from "../lib/useAsyncData";
import { units } from "../lib/tokenConsole/format";
import { SourceError } from "../components/tokenconsole/ConsoleTable";
import {
  agentCommissions, approvals, farmerRegister, kycDecisions, paymentRuns,
  type Loaded, type RegisterFilters, type ReportData,
} from "../lib/reports";
import { download, fileStem, nairobiDateTime, toCsv, toXlsx, type Row } from "../lib/reportExport";
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
   for this institution (lib/reports.ts). Dates are Nairobi's. */

type ReportKey = "payment-runs" | "farmer-register" | "agent-commissions" | "approvals" | "kyc-decisions";
type Entry = { key: string; title: string; description: string; live: boolean };

const REPORTS: Entry[] = [
  { key: "payment-runs", title: "Payment runs", description: "Every run with lines, net paid, deductions and status.", live: true },
  { key: "transactions", title: "Transactions summary", description: "Wallet activity for the last 30 days, grouped the way you choose.", live: false },
  { key: "farmer-register", title: "Farmer register", description: "Every farmer with their stage, KYC and how they joined.", live: true },
  { key: "agent-commissions", title: "Agent commissions", description: "Month-to-date commission and onboardings per agent.", live: true },
  { key: "approvals", title: "Approvals", description: "Every request for a second person's approval, and its outcome.", live: true },
  { key: "kyc-decisions", title: "KYC decisions", description: "Every farmer verified or rejected, with the registry's answer.", live: true },
  { key: "merchant-settlements", title: "Merchant settlements", description: "Sales and settlement accounts for approved merchants, last 30 days.", live: false },
  { key: "disputes", title: "Disputes and SLA", description: "Every dispute with its age and outcome.", live: false },
  { key: "build", title: "Build your own", description: "Pick the transaction fields and filters you need. (REQ 5.8.3)", live: false },
];
const NOT_YET: Record<string, string> = {
  transactions: "Not yet available: no read across every farmer's wallet movements exists yet.",
  "merchant-settlements": "Not yet available: merchants and their sales live in the merchant service, which does not report them here yet.",
  disputes: "Not yet available: disputes are not built yet.",
  build: "Not yet available: the report builder (REQ 5.8.3) comes later.",
};

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const chosen = REPORTS.find((r) => r.key === params.get("report")) ?? REPORTS[0];
  const pick = (key: string) => setParams(() => new URLSearchParams({ report: key }), { replace: true });

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

const LOADERS: Record<Exclude<ReportKey, "farmer-register">, () => Promise<Loaded>> = {
  "payment-runs": paymentRuns,
  "agent-commissions": agentCommissions,
  approvals,
  "kyc-decisions": kycDecisions,
};

function LiveReport({ entry }: { entry: Entry }) {
  const [filters, setFilters] = useState<RegisterFilters>({});
  const [typed, setTyped] = useState("");
  const isRegister = entry.key === "farmer-register";
  useEffect(() => {
    if (!isRegister || (typed.trim() || undefined) === filters.q) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: typed.trim() || undefined })), 300);
    return () => clearTimeout(t);
  }, [typed, isRegister, filters.q]);

  const report = useAsyncData(() => (isRegister ? farmerRegister(filters) : LOADERS[entry.key as keyof typeof LOADERS]()));
  const { reload } = report;
  const filterKey = JSON.stringify(filters);
  useEffect(() => { if (isRegister) void reload(); }, [filterKey, isRegister, reload]);
  // Stamped when the rows arrive.
  const generatedAt = useMemo(() => new Date().toISOString(), [report.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-print-root data-testid="report">
      <h2 className="font-display text-lg font-semibold text-text">{entry.title}</h2>
      <p className="mb-3 text-[12.5px] text-text-soft">{entry.description}</p>

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

      {report.error ? <SourceError what={`the ${entry.title.toLowerCase()} report`} error={report.error} onRetry={report.reload} />
        : !report.data ? <Skeleton className="h-64" />
        : !report.data.available ? (
          <div data-testid="report-not-available">
            <NotePanel tone="info" title="Not available on this environment yet">Omnichannel here does not have what this report reads.</NotePanel>
          </div>
        ) : <ReportBody slug={entry.key} title={entry.title} data={report.data.data} generatedAt={generatedAt} />}
    </div>
  );
}

function ReportBody({ slug, title, data, generatedAt }: { slug: string; title: string; data: ReportData; generatedAt: string }) {
  const exportRows: Row[] = data.totals ? [...data.rows, data.totals] : data.rows;
  const stem = fileStem(slug);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-text-soft" data-testid="report-meta">
          {data.capped ? `First ${units(data.rows.length)} rows` : `${units(data.rows.length)} ${data.rows.length === 1 ? "row" : "rows"}`} · generated {nairobiDateTime(generatedAt)}
        </p>
        <div className="flex gap-2" data-no-print>
          <Button size="sm" variant="outline" onClick={() => download(`${stem}.csv`, toCsv(data.columns, exportRows), "text/csv;charset=utf-8")}>
            <FileDown size={14} /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => download(`${stem}.xlsx`, toXlsx(title, data.columns, exportRows) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer size={14} /> PDF
          </Button>
        </div>
      </div>
      {data.capped && <p className="mb-3 text-[12.5px] text-warning" data-testid="report-capped">More rows exist than a report reads at once; narrow the filters to see the rest.</p>}

      {data.tiles && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="report-tiles">
          {data.tiles.map((t) => <StatCard key={t.label} label={t.label} value={t.value} />)}
        </div>
      )}
      {data.chart && (
        <Card className="mb-4 p-4" data-testid="report-chart">
          <h3 className="mb-2 text-[13px] font-semibold text-text">{data.chart.title}</h3>
          <ColumnChart labels={data.chart.labels} series={[{ label: data.chart.title, values: data.chart.values }]} />
        </Card>
      )}

      {data.rows.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="report-empty">Nothing to report yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full text-[12.5px]" data-testid="report-table">
            <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
              <tr>{data.columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}>{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
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
    </>
  );
}

const fmt = (v: Row[string], numeric?: boolean) =>
  v === null || v === undefined || v === "" ? "—" : numeric && typeof v === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v) : String(v);
