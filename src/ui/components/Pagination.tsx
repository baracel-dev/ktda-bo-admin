import { useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dropdown } from "./Dropdown";

export const PAGE_SIZES = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

const SIZE_OPTIONS = PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }));

/** The page numbers to offer: all of them when few, otherwise the first, the
 *  last and the ones around the current page, with gaps (null) between. */
function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const from = Math.max(2, Math.min(page - 1, pages - 4));
  const to = Math.min(pages - 1, Math.max(page + 1, 5));
  const middle = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return [1, ...(from > 2 ? [null] : []), ...middle, ...(to < pages - 1 ? [null] : []), pages];
}

const pageButton =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] tabular outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-500/50 disabled:pointer-events-none disabled:opacity-40";

/** Under a list: what is shown, rows per page, and the pages. Controlled, so
 *  it serves a list paged in the browser (usePagination) and one paged by its
 *  service alike. Renders nothing when the list fits the smallest page. */
export function Pagination({
  page, pageSize, total, onPage, onPageSize, disabled = false, className,
}: {
  /** From 1. */
  page: number;
  pageSize: number;
  /** Rows in the whole list, not on this page. */
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** While the next page is being fetched. */
  disabled?: boolean;
  className?: string;
}) {
  if (total <= PAGE_SIZES[0]) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  return (
    <nav aria-label="Pages" className={clsx("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12.5px] text-text-soft", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="tabular" role="status">{from}–{to} of {total}</span>
        <div className="flex items-center gap-2">
          <span className="text-text-faint">Rows per page</span>
          <Dropdown
            size="sm"
            placement="top"
            value={String(pageSize)}
            onChange={(v) => onPageSize(Number(v))}
            options={SIZE_OPTIONS}
            disabled={disabled}
            ariaLabel="Rows per page"
            className="w-[76px]"
          />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={clsx(pageButton, "text-text-soft hover:bg-surface-sunken")} disabled={disabled || current === 1}
          onClick={() => onPage(current - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <span className="tabular px-1 sm:hidden">Page {current} of {pages}</span>
        <div className="hidden items-center gap-1 sm:flex">
          {pageList(current, pages).map((p, i) => p === null ? (
            <span key={`gap-${i}`} className="px-1 text-text-faint" aria-hidden>…</span>
          ) : (
            <button key={p} type="button" disabled={disabled} onClick={() => onPage(p)}
              aria-label={`Page ${p}`} aria-current={p === current ? "page" : undefined}
              className={clsx(pageButton, p === current ? "bg-primary-600 font-semibold text-[var(--text-on-primary)]" : "text-text-soft hover:bg-surface-sunken")}>
              {p}
            </button>
          ))}
        </div>
        <button type="button" className={clsx(pageButton, "text-text-soft hover:bg-surface-sunken")} disabled={disabled || current === pages}
          onClick={() => onPage(current + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}

/** Pages a list held in the browser. A changed list (a filter, a new first
 *  row) starts again from page 1; a row leaving a later page does not. */
export function usePagination<T extends { id: string | number }>(rows: T[], enabled = true) {
  const [page, setPage] = useState(1);
  const [pageSize, setSize] = useState(DEFAULT_PAGE_SIZE);
  const first = rows[0]?.id;
  const [anchor, setAnchor] = useState(first);
  if (first !== anchor) {
    setAnchor(first);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  return {
    pageRows: enabled ? rows.slice((current - 1) * pageSize, current * pageSize) : rows,
    page: current,
    pageSize,
    setPage,
    /** Keeps the first row on show where it is. */
    setPageSize: (size: number) => {
      setPage(Math.floor(((current - 1) * pageSize) / size) + 1);
      setSize(size);
    },
  };
}
