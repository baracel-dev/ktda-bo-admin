import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, CircleAlert, Hourglass, RefreshCw } from "lucide-react";
import {
  Badge, Button, DataTable, DateRangeFilter, DEFAULT_PAGE_SIZE, FilterBar, GlassPanel, NotePanel, PageHeader, Pagination, SearchInput,
  SelectFilter, Skeleton, StatCard, Tabs, inDateRange,
} from "../../ui";
import { dateTime, label, money, shortId } from "../../lib/tokenConsole/format";
import {
  OmniApiError, omniApi,
  type CustomerTransactionEntry, type TransactionQuery, type TransactionTotal, type TransactionTotals,
} from "../../lib/omniApi";
import {
  PER_CUSTOMER, loadCustomerTransactions, totalsByCurrency,
  type CustomerTransaction, type TransactionsLoad, type TransactionsProgress,
} from "../../lib/tokenConsole/customerTransactions";
import { Code, SourceError } from "../../components/tokenconsole/ConsoleTable";
import { PaymentIssues } from "../../components/tokenconsole/PaymentIssues";
import { useAsyncData } from "../../lib/useAsyncData";

/* Customer transactions across everyone, from omnichannel, newest first: to
   answer "what failed today" or "who paid for this" without knowing whose it
   was. One customer's own list is on the Customer desk. Read only.

   Omnichannel's own list (GET /api/operator/transactions) is asked first: one
   paged, filtered read. An environment whose omnichannel predates it answers
   404, and the page then builds the list customer by customer instead. */

type Tone = "success" | "warning" | "danger" | "neutral";
const STATUS_TONE: Record<string, Tone> = { PAID: "success", SENT: "success", POSTED: "success", PENDING: "warning", FAILED: "danger" };

const SUBTITLE_TAIL = "Open a customer for their full history on the Customer desk.";

const sourceLabel = (source: string) => (source === "MPESA" ? "M-Pesa" : source === "PRODUCT" ? "Product" : label(source));

function sumText(rows: CustomerTransaction[]): string {
  const totals = totalsByCurrency(rows);
  return totals.length === 0 ? money(0, "KES") : totals.map((t) => money(t.amount, t.currency)).join(" · ");
}

type Row = CustomerTransactionEntry;
type Tile = { value: string; count: number };

function StatTiles({ collected, paidOut, failed, pending }: { collected: Tile; paidOut: Tile; failed: Tile; pending: Tile }) {
  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Collected" value={collected.value} hint={`${collected.count} M-Pesa payments paid`} icon={<ArrowDownLeft size={16} />} />
      <StatCard label="Paid out" value={paidOut.value} hint={`${paidOut.count} payouts sent`} icon={<ArrowUpRight size={16} />} />
      <StatCard label="Failed" value={failed.count} hint={failed.value} icon={<CircleAlert size={16} />} />
      <StatCard label="Pending" value={pending.count} hint={pending.value} icon={<Hourglass size={16} />} />
    </div>
  );
}

/** `footer` is the pager of the list omnichannel pages; without one the rows
 *  are all here and the table pages them itself. */
function TransactionsTable({ rows, emptyLabel, footer }: { rows: Row[]; emptyLabel: string; footer?: ReactNode }) {
  return (
    <GlassPanel className="p-1" sheen={false}>
      <DataTable<Row>
        paged={footer === undefined}
        footer={footer}
        rows={rows}
        emptyLabel={emptyLabel}
        columns={[
          { key: "when", header: "When", className: "whitespace-nowrap", render: (t) => <span className="tabular text-xs text-text-soft">{dateTime(t.occurredAt)}</span> },
          { key: "customer", header: "Customer", render: (t) => (
            <Link
              to={`/token-console/customers?id=${encodeURIComponent(t.profileId)}`}
              className="font-medium text-text hover:text-primary-600"
              title="Open on the Customer desk"
            >
              {t.customer ?? "Unnamed customer"}
            </Link>
          ) },
          { key: "what", header: "What", render: (t) => (
            <div>
              <div className="text-text">{t.label}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-faint">
                <span className="rounded border border-border px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide">{sourceLabel(t.source)}</span>
                {t.detail}
              </div>
            </div>
          ) },
          { key: "amount", header: "Amount", className: "tabular text-right whitespace-nowrap", render: (t) => t.amount === null || t.amount === undefined ? "—"
            : <span className={t.direction === "IN" ? "text-success" : "text-text"}>{t.direction === "OUT" ? "−" : "+"}{money(t.amount, t.currency)}</span> },
          { key: "status", header: "Status", className: "whitespace-nowrap", render: (t) => t.status ? <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{label(t.status)}</Badge> : "—" },
          { key: "ref", header: "Reference", className: "whitespace-nowrap", hideOnMobile: true, render: (t) => t.reference
            ? <span title={t.reference}><Code>{t.reference.length > 20 ? shortId(t.reference) : t.reference}</Code></span> : "—" },
        ]}
      />
    </GlassPanel>
  );
}

function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" disabled={loading} onClick={onClick}>
      <RefreshCw size={14} className={loading ? "animate-spin" : undefined} /> {loading ? "Loading…" : "Refresh"}
    </Button>
  );
}

const STATUS_OPTIONS = ["PENDING", "PAID", "SENT", "FAILED"].map((v) => ({ value: v, label: label(v) }));
const KIND_OPTIONS = [
  { value: "PAYMENT", label: "Investment payment" },
  { value: "TOP_UP", label: "Top-up" },
  { value: "PAYOUT", label: "Payout" },
];

/** The start of a local calendar day (yyyy-mm-dd), `plusDays` later, as an instant. */
function dayStart(day: string, plusDays = 0): string | undefined {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setDate(d.getDate() + plusDays);
  return d.toISOString();
}

const tile = (totals: TransactionTotals[], pick: (t: TransactionTotals) => TransactionTotal): Tile => ({
  value: totals.length === 0 ? money(0, "KES") : totals.map((t) => money(pick(t).amount, t.currency)).join(" · "),
  count: totals.reduce((n, t) => n + pick(t).count, 0),
});

/** Whether the list itself is missing here, rather than failing. */
const notServed = (e: unknown) => e instanceof OmniApiError && (e.status === 404 || e.status === 405);

/** Omnichannel's own list: filtered and paged there, totals from its summary. */
function ServerTransactions({ onNotServed, tabs }: { onNotServed: () => void; tabs: ReactNode }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });

  // Typing does not ask the server on every key.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo<TransactionQuery>(() => ({
    q: term || undefined,
    kind: kind === "all" ? undefined : kind,
    status: status === "all" ? undefined : status,
    from: range.from ? dayStart(range.from) : undefined,
    // `to` is exclusive there and the day picked is included here.
    to: range.to ? dayStart(range.to, 1) : undefined,
  }), [term, kind, status, range]);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const sizeRef = useRef(pageSize);
  sizeRef.current = pageSize;
  const [totals, setTotals] = useState<TransactionTotals[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const fetchPage = useCallback(async (which: number, fresh: boolean, size = sizeRef.current) => {
    const mine = ++run.current;
    const stale = () => run.current !== mine;
    setLoading(true);
    setError(null);
    try {
      const [list, sums] = await Promise.all([
        omniApi.transactions(query, which, size),
        // The totals cover the whole result, so only a new search re-reads them.
        fresh ? omniApi.transactionTotals(query) : Promise.resolve(null),
      ]);
      if (stale()) return;
      setRows(list.items);
      setTotal(list.total);
      setPage(list.page);
      setPageSize(size);
      if (sums) setTotals(sums);
    } catch (e) {
      if (stale()) return;
      if (notServed(e)) onNotServed();
      else setError(e instanceof Error ? e.message : "The transactions could not be loaded.");
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [query, onNotServed]);

  const cancel = useCallback(() => { run.current++; }, []);
  useEffect(() => {
    void fetchPage(1, true);
    return cancel;
  }, [fetchPage, cancel]);

  const filtered = Object.values(query).some(Boolean);

  return (
    <div>
      <PageHeader
        eyebrow="Baracel Unyt"
        title="Transactions"
        subtitle={`Every customer's M-Pesa payments, top-ups and payouts, newest first. ${SUBTITLE_TAIL}`}
        actions={<RefreshButton loading={loading} onClick={() => void fetchPage(1, true)} />}
      />
      {tabs}

      {totals && (
        <StatTiles
          collected={tile(totals, (t) => t.collected)}
          paidOut={tile(totals, (t) => t.paidOut)}
          failed={tile(totals, (t) => t.failed)}
          pending={tile(totals, (t) => t.pending)}
        />
      )}

      <FilterBar>
        <SearchInput value={q} onChange={setQ} placeholder="Customer, reference or receipt…" className="w-full sm:w-72" />
        <SelectFilter value={kind} onChange={setKind} options={KIND_OPTIONS} allLabel="All types" />
        <SelectFilter value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="All statuses" />
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
      </FilterBar>

      {error && <SourceError what="transactions" error={error} onRetry={() => fetchPage(1, true)} />}

      {!rows && loading && !error && <Skeleton className="h-64" />}

      {rows && (
        <>
          <p className="mb-2 text-[12.5px] text-text-faint" role="status">
            {total} {total === 1 ? "transaction" : "transactions"}{filtered && " match · the figures above follow the filters"}
          </p>
          <TransactionsTable
            rows={rows}
            emptyLabel={filtered ? "No transaction matches those filters" : "No customer has paid yet"}
            footer={
              // More rows than were asked for: this omnichannel sent the whole list, so there is nothing to page.
              rows.length > pageSize ? null : (
                <Pagination
                  className="px-3 pt-3 pb-2"
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  disabled={loading}
                  onPage={(p) => void fetchPage(p, false)}
                  onPageSize={(n) => void fetchPage(1, false, n)}
                />
              )
            }
          />
          <p className="mt-6 max-w-3xl text-xs leading-relaxed text-text-faint">
            Amounts are signed from the customer's side: − is money leaving them, + is money reaching them. Investments and
            redemptions inside the product are not listed here; they are on each customer's timeline on the Customer desk.
            Omnichannel records each time this list is read against you.
          </p>
        </>
      )}
    </div>
  );
}

export default function TokenConsoleTransactions() {
  const [served, setServed] = useState(true);
  const fallBack = useCallback(() => setServed(false), []);
  // The tab lives in the address, so a refresh or a shared link keeps it.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "issues" ? "issues" : "all";
  // Read here, not in the tab, so the strip can say how many are waiting.
  const issues = useAsyncData(omniApi.paymentIssues);
  const tabs = (
    <Tabs
      className="mb-5"
      active={tab}
      onChange={(k) => setParams(k === "issues" ? { tab: "issues" } : {}, { replace: true })}
      tabs={[
        { key: "all", label: "All transactions" },
        // A cut list is a minimum; the tab's count is a number, so the Issues tab itself says so.
        { key: "issues", label: issues.data?.truncated ? "Issues (cut)" : "Issues", count: issues.data?.items.length },
      ]}
    />
  );
  if (tab === "issues") {
    return (
      <div>
        <PageHeader
          eyebrow="Baracel Unyt"
          title="Transactions"
          subtitle="Payments that need a person: payouts the provider refused, payouts the gateway never answered for, and bank transfers still unmatched. Oldest first."
          actions={<RefreshButton loading={issues.loading} onClick={() => void issues.reload()} />}
        />
        {tabs}
        <PaymentIssues source={issues} />
      </div>
    );
  }
  return served ? <ServerTransactions onNotServed={fallBack} tabs={tabs} /> : <FanOutTransactions tabs={tabs} />;
}

/** The list built customer by customer, for an omnichannel that has no
 *  list of its own yet: who the customers are from the KYC desk's
 *  applications, then each one's timeline. Slower, and one audited lookup
 *  per customer; kept until every environment serves the list. */
function FanOutTransactions({ tabs }: { tabs: ReactNode }) {
  const [load, setLoad] = useState<TransactionsLoad | null>(null);
  const [progress, setProgress] = useState<TransactionsProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++run.current;
    const stale = () => run.current !== mine;
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const result = await loadCustomerTransactions((p) => { if (!stale()) setProgress(p); }, stale);
      if (!stale()) setLoad(result);
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : "The transactions could not be loaded.");
    } finally {
      if (!stale()) setLoading(false);
    }
  }, []);

  // Leaving the page stops the remaining customer reads.
  const cancel = useCallback(() => { run.current++; }, []);
  useEffect(() => {
    void reload();
    return cancel;
  }, [reload, cancel]);

  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });

  const all = useMemo(() => load?.rows ?? [], [load]);
  const options = useMemo(() => {
    const distinct = (pick: (r: CustomerTransaction) => string | null) =>
      [...new Set(all.map(pick).filter((v): v is string => !!v))].sort();
    return {
      sources: distinct((r) => r.source).map((v) => ({ value: v, label: sourceLabel(v) })),
      kinds: distinct((r) => r.kind).map((v) => ({ value: v, label: label(v) })),
      statuses: distinct((r) => r.status).map((v) => ({ value: v, label: label(v) })),
    };
  }, [all]);

  const term = q.trim().toLowerCase();
  const rows = useMemo(
    () => all.filter((r) =>
      (source === "all" || r.source === source)
      && (kind === "all" || r.kind === kind)
      && (status === "all" || r.status === status)
      && inDateRange(r.occurredAt, range.from, range.to)
      && (!term || [r.customer, r.reference, r.detail, r.label, r.profileId].some((v) => (v ?? "").toLowerCase().includes(term)))),
    [all, source, kind, status, range, term],
  );

  const stats = useMemo(() => {
    const mpesa = rows.filter((r) => r.source === "MPESA");
    return {
      collected: mpesa.filter((r) => r.kind !== "PAYOUT" && r.status === "PAID"),
      paidOut: mpesa.filter((r) => r.kind === "PAYOUT" && r.status === "SENT"),
      failed: rows.filter((r) => r.status === "FAILED"),
      pending: rows.filter((r) => r.status === "PENDING"),
    };
  }, [rows]);

  const filtered = rows.length !== all.length;
  const first = loading && !load;

  return (
    <div>
      <PageHeader
        eyebrow="Baracel Unyt"
        title="Transactions"
        subtitle="Every customer's M-Pesa payments and payouts, and the investments and redemptions they made, newest first. Open a customer for their full history on the Customer desk."
        actions={
          <RefreshButton loading={loading} onClick={() => void reload()} />
        }
      />
      {tabs}

      {error && <SourceError what="transactions" error={error} onRetry={reload} />}

      {first && !error && (
        <>
          <p className="mb-3 text-sm text-text-soft" role="status">
            {progress && progress.customers > 0
              ? `Reading ${progress.done} of ${progress.customers} customers…`
              : "Finding customers…"}
          </p>
          <Skeleton className="h-64" />
        </>
      )}

      {load && (
        <>
          {load.failed > 0 && (
            <NotePanel tone="warning" className="mb-4" title="Some customers are missing">
              {load.failed} of {load.customers} customers could not be read, so their transactions are not in this list. Refresh to try again.
            </NotePanel>
          )}

          <StatTiles
            collected={{ value: sumText(stats.collected), count: stats.collected.length }}
            paidOut={{ value: sumText(stats.paidOut), count: stats.paidOut.length }}
            failed={{ value: sumText(stats.failed), count: stats.failed.length }}
            pending={{ value: sumText(stats.pending), count: stats.pending.length }}
          />

          <FilterBar>
            <SearchInput value={q} onChange={setQ} placeholder="Customer, reference or receipt…" className="w-full sm:w-72" />
            <SelectFilter value={source} onChange={setSource} options={options.sources} allLabel="All sources" />
            <SelectFilter value={kind} onChange={setKind} options={options.kinds} allLabel="All types" />
            <SelectFilter value={status} onChange={setStatus} options={options.statuses} allLabel="All statuses" />
            <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
          </FilterBar>

          <p className="mb-2 text-[12.5px] text-text-faint">
            {filtered ? `${rows.length} of ${all.length} transactions` : `${all.length} transactions`} across {load.customers} customers
            {filtered && " · the figures above follow the filters"}
          </p>

          <TransactionsTable
            rows={rows}
            emptyLabel={all.length === 0 ? "No customer has paid or invested yet" : "No transaction matches those filters"}
          />


          <p className="mt-6 max-w-3xl text-xs leading-relaxed text-text-faint">
            Amounts are signed from the customer's side: − is money leaving them, + is money reaching them. The list covers
            customers who applied in the app; someone staff onboarded and linked by code is on the Customer desk only.
            {load.truncated > 0 && ` ${load.truncated} ${load.truncated === 1 ? "customer has" : "customers have"} more than ${PER_CUSTOMER} entries; only their latest ${PER_CUSTOMER} are here.`}
            {" "}Each load reads every customer's history, and omnichannel records each read against you.
          </p>
        </>
      )}
    </div>
  );
}
