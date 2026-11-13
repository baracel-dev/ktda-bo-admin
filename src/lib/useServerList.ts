import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "./tokApi";

/** Page sizes a list its service pages offers (the engine caps a page at 100). */
export const SERVER_PAGE_SIZES = [20, 50, 100];
const DEFAULT_SIZE = SERVER_PAGE_SIZES[0];
/** How long typing waits before it asks the service. */
export const SEARCH_DEBOUNCE_MS = 300;

export type ListRequest<F> = { page: number; size: number; q: string; filters: F };

/** What ConsoleTable needs to draw the pager of a server-paged list. */
export type ServerPaging = {
  page: number;
  pageSize: number;
  total: number;
  /** A page is on its way; the rows on show are the previous page's. */
  loading: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  sizes: number[];
};

/**
 * One list its service filters, sorts and pages: the page on show, the search
 * (debounced) and filters it was asked with, and its loading and error state.
 *
 * - A new search or filter starts again from page 1.
 * - The rows on show stay while the next page loads (no flash of empty); only
 *   the first load has no rows.
 * - Only the latest request lands: an older answer arriving late is dropped.
 * - `reload` re-reads the current page — after a write, say.
 *
 * `filters` is compared by value (JSON), so an inline object literal is fine.
 * With `enabled` false nothing is asked and the list is empty, not loading.
 */
export function useServerList<T, F = Record<string, never>>(
  fetchPage: (req: ListRequest<F>) => Promise<Page<T>>,
  params: { q?: string; filters?: F; enabled?: boolean; pageSize?: number } = {},
) {
  const enabled = params.enabled ?? true;
  const typed = (params.q ?? "").trim();
  const [q, setQ] = useState(typed);
  useEffect(() => {
    if (typed === q) return;
    const t = setTimeout(() => setQ(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [typed, q]);

  const filtersKey = JSON.stringify(params.filters ?? {});
  const filtersRef = useRef(params.filters);
  filtersRef.current = params.filters;
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(params.pageSize ?? DEFAULT_SIZE);
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // A new question goes back to page 1 in the same render, so the old page
  // number is never sent with the new search.
  const queryKey = `${q}\u0000${filtersKey}`;
  const [lastKey, setLastKey] = useState(queryKey);
  if (queryKey !== lastKey) {
    setLastKey(queryKey);
    setPage(1);
  }

  useEffect(() => {
    // Set when a newer request (or an unmount) replaces this one: its answer is then dropped.
    let stale = false;
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchRef.current({ page, size: pageSize, q, filters: filtersRef.current as F }).then(
      (result) => {
        if (stale) return;
        // A page past the end (rows went away since it was offered): show the last one instead.
        const last = Math.max(1, Math.ceil(result.total / pageSize));
        if (result.items.length === 0 && result.total > 0 && page > last) {
          setPage(last);
          return;
        }
        setData(result);
        setLoading(false);
      },
      (e: unknown) => {
        if (stale) return;
        setError(e instanceof Error ? e.message : "This list could not be loaded.");
        setLoading(false);
      },
    );
    return () => {
      stale = true;
    };
    // queryKey stands for q and the filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryKey, page, pageSize, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const changePageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const rows = enabled ? data?.items ?? null : [];
  const total = enabled ? data?.total ?? 0 : 0;
  const filtered = q !== "" || Object.values((params.filters ?? {}) as Record<string, unknown>)
    .some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ""));

  return {
    rows,
    total,
    page,
    pageSize,
    loading,
    error,
    reload,
    /** The search as it was last sent (trimmed, after the debounce). */
    q,
    /** A search or a filter narrows the list: an empty one is "no match", not "none yet". */
    filtered,
    /** For ConsoleTable's `source`. */
    source: { data: rows, loading, error, reload },
    /** For ConsoleTable's `paging`. */
    paging: {
      page, pageSize, total, loading, sizes: SERVER_PAGE_SIZES,
      onPage: setPage,
      onPageSize: changePageSize,
    } satisfies ServerPaging,
  };
}
