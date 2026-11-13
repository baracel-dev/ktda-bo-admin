import { useMemo } from "react";
import {
  PageHeader, Badge, DataTable, Skeleton, GlassPanel, GlassStat, StatRail, NotePanel, SectionTitle,
  formatDateTime, type Column,
} from "../../ui";
import { Scale, Users, Boxes, GitCompareArrows } from "lucide-react";
import { tokenConsole, tokenConsolePages } from "../../lib/api";
import type { LedgerEntryView, ReconciliationResult } from "../../lib/tokenConsole/types.gen";
import { useAsyncData } from "../../lib/useAsyncData";
import { booksByCurrency, outOfBalance } from "../../lib/tokenConsole/books";
import { money } from "../../lib/tokenConsole/format";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";

const RECENT_POSTINGS = 8;

type JournalRow = LedgerEntryView & { id: string };
type ReconRow = ReconciliationResult & { id: string };

/** Baracel Unyt overview — the books, the register, and whether the
 * unit ledger still agrees with the general ledger.
 *
 * Reads CardinalForge's accounting service through CORE's gateway. Each
 * source loads on its own, so an outage in one (reconciliation calls the
 * tokenization module behind the accounting service) does not blank the
 * rest of the page. */
export default function TokenConsoleOverview() {
  const tb = useAsyncData(tokenConsole.trialBalance);
  const recon = useAsyncData(tokenConsole.reconciliation);
  // The register is far too big to read whole for a number; the engine counts it.
  const summary = useAsyncData(tokenConsolePages.consoleSummary);
  const products = useAsyncData(tokenConsole.products);
  const journals = useAsyncData(tokenConsole.journals);

  const books = useMemo(() => booksByCurrency(tb.data ?? []), [tb.data]);
  const unbalanced = books.filter(outOfBalance);
  const breaks: ReconRow[] = useMemo(
    () => (recon.data ?? [])
      .filter((r) => r.matched === false)
      .map((r, i) => ({ ...r, id: r.productId ?? `break-${i}` })),
    [recon.data],
  );
  const recent: JournalRow[] = useMemo(
    () => [...(journals.data ?? [])]
      // Parsed, not string-compared: "…:05Z" and "…:05.120Z" are the same
      // second but sort the wrong way round as text.
      .sort((a, b) => (Date.parse(b.occurredAt ?? "") || 0) - (Date.parse(a.occurredAt ?? "") || 0))
      .slice(0, RECENT_POSTINGS)
      .map((j, i) => ({ ...j, id: j.journalId ?? `journal-${i}` })),
    [journals.data],
  );

  const firstLoad = tb.loading && !tb.data && recon.loading && summary.loading && products.loading && journals.loading;
  if (firstLoad) return <Skeleton className="h-96" />;

  const booksValue = tb.error ? "—"
    : tb.loading ? "…"
    : books.length === 0 ? "No accounts"
    : unbalanced.length === 0 ? "Balanced"
    : `${unbalanced.length} out`;
  const booksTone = tb.error || tb.loading || books.length === 0 ? "neutral" : unbalanced.length ? "danger" : "success";

  const count = (s: { data: unknown[] | null; loading: boolean; error: string | null }) =>
    s.error ? "—" : s.loading ? "…" : (s.data?.length ?? 0).toLocaleString();

  const journalColumns: Column<JournalRow>[] = [
    { key: "event", header: "Event", render: (r) => (
      <div>
        <div className="text-text font-medium">{r.eventType ?? "—"}</div>
        <div className="text-xs text-text-soft mt-0.5 max-w-sm leading-snug">{r.description ?? ""}</div>
      </div>
    ) },
    { key: "product", header: "Product", render: (r) => <span className="text-xs text-text-soft tabular">{r.productId ?? "—"}</span>, hideOnMobile: true },
    { key: "amount", header: "Amount", className: "whitespace-nowrap text-right", render: (r) => (
      <span className="tabular text-text">{money(r.amount ?? 0, r.currency ?? "")}</span>
    ) },
    { key: "status", header: "Status", className: "whitespace-nowrap", render: (r) => (
      <Badge tone={r.status === "POSTED" ? "success" : r.status === "PENDING_APPROVAL" ? "warning" : "neutral"}>
        {r.status === "PENDING_APPROVAL" ? "Pending approval" : r.status === "POSTED" ? "Posted" : r.status === "INITIATED" ? "Initiated" : "—"}
      </Badge>
    ) },
    { key: "occurred", header: "Occurred", render: (r) => (
      <span className="tabular text-xs text-text-soft">{r.occurredAt ? formatDateTime(r.occurredAt) : "—"}</span>
    ), hideOnMobile: true },
  ];

  const breakColumns: Column<ReconRow>[] = [
    { key: "product", header: "Product", render: (r) => <span className="text-text font-medium tabular">{r.productId ?? "—"}</span> },
    { key: "units", header: "Unit ledger value", className: "text-right", render: (r) => <span className="tabular">{(r.unitLedgerValue ?? 0).toLocaleString()}</span> },
    { key: "gl", header: "GL principal", className: "text-right", render: (r) => <span className="tabular">{(r.glPrincipal ?? 0).toLocaleString()}</span> },
    { key: "diff", header: "Difference", className: "text-right", render: (r) => <span className="tabular text-danger">{(r.difference ?? 0).toLocaleString()}</span> },
    { key: "note", header: "Note", render: (r) => <span className="text-xs text-text-soft">{r.note ?? "—"}</span>, hideOnMobile: true },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Baracel Unyt"
        title="Overview"
        subtitle="The books, the register, and whether the unit ledger still agrees with them."
      />

      <StatRail columns={4} className="mb-5">
        <GlassStat label="Books" value={booksValue} icon={<Scale size={17} />} tone={booksTone}
          hint={tb.error ? "the trial balance could not be read"
            : tb.loading ? undefined
            : books.length === 0 ? "nothing has been posted yet"
            : books.length > 1 ? `checked per currency (${books.map((b) => b.currency).join(", ")})`
            : "trial balance sums to zero"} />
        {/* No reconciliation rows means nothing was checked, not that
            everything matched, so it is not shown as a pass. */}
        <GlassStat label="Unreconciled products" value={recon.error ? "—" : recon.loading ? "…" : breaks.length}
          icon={<GitCompareArrows size={17} />}
          tone={recon.error || recon.loading || !recon.data?.length ? "neutral" : breaks.length ? "warning" : "success"}
          hint={!recon.error && !recon.loading && !recon.data?.length ? "no products to reconcile yet" : "unit ledger vs general ledger"} />
        <GlassStat label="Investors" value={summary.error ? "—" : summary.loading ? "…" : (summary.data?.investors?.total ?? 0).toLocaleString()} icon={<Users size={17} />} tone="primary" emphasis={false} hint="on the register" />
        <GlassStat label="Products" value={count(products)} icon={<Boxes size={17} />} tone="primary" emphasis={false} hint="share classes defined" />
      </StatRail>

      {tb.error && <SourceError what="the trial balance" error={tb.error} onRetry={tb.reload} />}
      {recon.error && <SourceError what="reconciliation" error={recon.error} onRetry={recon.reload} />}
      {summary.error && <SourceError what="the register totals" error={summary.error} onRetry={summary.reload} />}
      {products.error && <SourceError what="products" error={products.error} onRetry={products.reload} />}

      {unbalanced.length > 0 && (
        <NotePanel tone="danger" className="mb-5" title="The books do not balance">
          {unbalanced.map((b) => `${b.currency || "No currency"} is out by ${money(b.balance, b.currency)}`).join("; ")}.
          Every posting is a balanced pair, so a non-zero trial balance means something was written that should not
          have been. Stop posting in that currency until Finance has found the entry.
        </NotePanel>
      )}

      {books.length > 0 && (
        <>
          <SectionTitle title="Books by currency" description="Total debits and credits across every account, per currency." />
          <GlassPanel className="p-1 mb-5" sheen={false}>
            <DataTable
              rows={books.map((b) => ({ ...b, id: b.currency || "none" }))}
              emptyLabel="No accounts yet"
              columns={[
                { key: "currency", header: "Currency", render: (b) => <span className="text-text font-medium">{b.currency || "—"}</span> },
                { key: "debit", header: "Total debits", className: "text-right", render: (b) => <span className="tabular">{money(b.debit, b.currency)}</span> },
                { key: "credit", header: "Total credits", className: "text-right", render: (b) => <span className="tabular">{money(b.credit, b.currency)}</span> },
                { key: "state", header: "State", render: (b) => outOfBalance(b)
                  ? <Badge tone="danger" className="whitespace-nowrap">Out by {money(b.balance, b.currency)}</Badge>
                  : <Badge tone="success">Balanced</Badge> },
              ]}
            />
          </GlassPanel>
        </>
      )}

      {breaks.length > 0 && (
        <>
          <SectionTitle title="Reconciliation breaks" description="Products where the value of units outstanding does not equal the principal the general ledger holds." />
          <GlassPanel className="p-1 mb-5" sheen={false}>
            <DataTable columns={breakColumns} rows={breaks} emptyLabel="No breaks" />
          </GlassPanel>
        </>
      )}

      <SectionTitle title="Recent postings" description={`The ${RECENT_POSTINGS} newest journal entries.`} />
      {journals.error ? (
        <SourceError what="journal entries" error={journals.error} onRetry={journals.reload} />
      ) : journals.loading && !journals.data ? (
        <Skeleton className="h-48" />
      ) : (
        <GlassPanel className="p-1" sheen={false}>
          <DataTable columns={journalColumns} rows={recent} emptyLabel="Nothing posted yet" />
        </GlassPanel>
      )}
    </div>
  );
}
