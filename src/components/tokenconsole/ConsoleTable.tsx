import clsx from "clsx";
import { Badge, Button, DataTable, GlassPanel, NotePanel, Pagination, SectionTitle, Skeleton, type Column } from "../../ui";
import type { ServerPaging } from "../../lib/useServerList";
import type { ReactNode } from "react";
import { label, toneFor } from "../../lib/tokenConsole/format";

/** What useAsyncData returns, narrowed to what a table needs. */
export type Source<T> = {
  data: T[] | null;
  loading: boolean;
  error: string | null;
  reload: () => void | Promise<void>;
};

export type Row<T> = T & { id: string };

export function SourceError({ what, error, onRetry, className = "mb-4" }: {
  what: string;
  error: string;
  onRetry: () => void | Promise<void>;
  className?: string;
}) {
  return (
    <NotePanel tone="danger" className={className} title={`Could not load ${what}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{error}</span>
        <Button size="sm" variant="outline" onClick={() => void onRetry()}>Retry</Button>
      </div>
    </NotePanel>
  );
}

/** A status straight from the accounting service, coloured by toneFor. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-text-faint">—</span>;
  return <Badge tone={toneFor(status)} className="whitespace-nowrap">{label(status)}</Badge>;
}

/** Monospace identifier, the way ids and codes read in every console table. */
export function Code({ children }: { children: ReactNode }) {
  return <span className="tabular text-xs text-text-soft break-all">{children ?? "—"}</span>;
}

/** DataTable needs a unique `id` per row. The service's own key is used when
 * it is present and unique; otherwise the row's position stands in, so a
 * missing or repeated key can never collapse two rows into one. */
function withIds<T>(rows: T[], rowId: (row: T) => string | null | undefined): Row<T>[] {
  const seen = new Set<string>();
  return rows.map((r, i) => {
    const key = rowId(r);
    const id = key && !seen.has(key) ? key : `row-${i}`;
    seen.add(id);
    return { ...r, id };
  });
}

/**
 * One accounting-service list: a title, its loading, error and empty states,
 * and the table, a page at a time. Every console page is built from these, so a failing
 * source shows its own error and retry without blanking the rest of the page.
 */
export function ConsoleTable<T extends object>({
  title, description, actions, what, source, rows, newest, rowId, columns, emptyLabel, onRowClick, selectedId, paging, toolbar,
  className = "mb-6",
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Used in the error message: "Could not load <what>". */
  what: string;
  source: Source<T>;
  /** Rows to show when the page filters the source; defaults to all of it. */
  rows?: T[];
  /** The date that puts the newest row first. Left out for a list that has
   *  none, or whose page has already ordered it. */
  newest?: (row: T) => string | null | undefined;
  rowId: (row: T) => string | null | undefined;
  columns: Column<Row<T>>[];
  emptyLabel: string;
  onRowClick?: (row: Row<T>) => void;
  /** Highlights the row whose rowId matches — master-detail lists. */
  selectedId?: string | null;
  /** A list its service pages (useServerList): the rows are one page, the
   *  pager asks for the next. Leave out `newest` with it — sorting in the
   *  browser would reorder just the page on show. */
  paging?: ServerPaging;
  /** Search and filters, between the title and the table; they stay put while
   *  the list loads or fails, so a search that failed can be changed. */
  toolbar?: ReactNode;
  className?: string;
}) {
  const refreshing = !!paging?.loading && !!source.data;
  return (
    <section className={className}>
      {title && <SectionTitle title={title} description={description} actions={actions} />}
      {toolbar}
      {source.error ? (
        <SourceError what={what} error={source.error} onRetry={source.reload} className="" />
      ) : source.loading && !source.data ? (
        <Skeleton className="h-40" />
      ) : (
        <GlassPanel className="p-1" sheen={false}>
          {/* The page on show stays while the next one loads, dimmed, so nothing flashes empty. */}
          <div aria-busy={refreshing || undefined} className={clsx("transition-opacity duration-150", refreshing && "opacity-60")}>
            <DataTable
              columns={columns}
              rows={withIds(rows ?? source.data ?? [], rowId)}
              newest={paging ? undefined : newest}
              emptyLabel={emptyLabel}
              onRowClick={onRowClick}
              selectedId={selectedId}
              paged={!paging}
              footer={paging && (
                <Pagination
                  className="px-3 pt-3 pb-2"
                  page={paging.page}
                  pageSize={paging.pageSize}
                  total={paging.total}
                  disabled={paging.loading}
                  onPage={paging.onPage}
                  onPageSize={paging.onPageSize}
                />
              )}
            />
          </div>
        </GlassPanel>
      )}
    </section>
  );
}
