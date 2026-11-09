import { useCallback, useEffect, useRef, useState } from "react";
import { READ_SIZE, type PagedReport, type ReportData } from "./reports";

/* Reads a PagedReport without waiting for every page: the first page of each
   stream (and the extra read) together, shown at once; then the rest of each
   stream, in order, in the background, a page at a time, until `cap` rows are
   read or there is nothing left. The report rebuilds as each page lands.
   Raising the cap carries on from where it stopped. Leaving the report (or a
   new `key`, as when filters change) stops the reading. */

export type ProgressiveState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; error: string }
  | {
    status: "ready";
    data: ReportData;
    /** Rows read so far, and how many there are in all (null when a list does not say). */
    loaded: number;
    total: number | null;
    /** Every page has been read. */
    done: boolean;
    /** A page is being read now. */
    reading: boolean;
    /** When the first page arrived. */
    firstAt: string;
  };

type Job = {
  cancelled: boolean;
  byStream: unknown[][];
  pages: number[];
  next: number[];
  totals: number[];
  extra: unknown;
  running: boolean;
  firstAt: string;
};

export const DEFAULT_CAP = 1000;

export function useProgressiveReport<T, X>(def: PagedReport<T, X>, key: string, cap: number) {
  const [state, setState] = useState<ProgressiveState>({ status: "loading" });
  /** Bumped by retry: reads the report again from the first page. */
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((a) => a + 1); }, []);
  const job = useRef<Job | null>(null);
  const capRef = useRef(cap);
  const defRef = useRef(def);
  // Before the effects below read them.
  useEffect(() => { capRef.current = cap; defRef.current = def; }, [cap, def]);

  const publish = useCallback((j: Job) => {
    if (j.cancelled) return;
    const items = j.byStream.flat() as T[];
    const done = j.next.every((n, i) => n > j.pages[i]);
    const known = j.totals.reduce((a, b) => a + b, 0);
    setState({
      status: "ready",
      data: defRef.current.build(items, j.extra as X | null),
      loaded: items.length,
      total: done ? items.length : Math.max(known, items.length),
      done,
      reading: j.running,
      firstAt: j.firstAt,
    });
  }, []);

  /** The rest of each stream, in order, up to the cap. */
  const carryOn = useCallback(async (j: Job) => {
    if (j.running) return;
    j.running = true;
    publish(j);
    try {
      for (let i = 0; i < j.pages.length; i++) {
        while (!j.cancelled && j.next[i] <= j.pages[i] && j.byStream.reduce((a, s) => a + s.length, 0) < capRef.current) {
          const p = await defRef.current.streams[i](j.next[i], READ_SIZE);
          if (j.cancelled) return;
          if (!p.available) throw new Error("The list stopped answering.");
          j.byStream[i].push(...p.data.items);
          j.pages[i] = p.data.pages;
          // A short page is the last one, whatever the headers said.
          j.next[i] = p.data.items.length < READ_SIZE ? j.pages[i] + 1 : j.next[i] + 1;
          publish(j);
        }
      }
    } catch (e) {
      if (!j.cancelled) setState({ status: "error", error: e instanceof Error ? e.message : "Could not read the report." });
      return;
    } finally {
      j.running = false;
    }
    publish(j);
  }, [publish]);

  useEffect(() => {
    const d = defRef.current;
    const j: Job = { cancelled: false, byStream: [], pages: [], next: [], totals: [], extra: null, running: false, firstAt: "" };
    job.current = j;
    // The rows already on show stay until the first page of the new reading lands.
    (async () => {
      try {
        const [extra, ...firsts] = await Promise.all([d.extra ? d.extra() : Promise.resolve(null), ...d.streams.map((s) => s(1, READ_SIZE))]);
        if (j.cancelled) return;
        if (firsts.some((f) => !f.available)) { setState({ status: "unavailable" }); return; }
        for (const f of firsts) {
          if (!f.available) continue;
          j.byStream.push([...f.data.items]);
          j.pages.push(f.data.pages);
          j.next.push(f.data.items.length < READ_SIZE ? f.data.pages + 1 : 2);
          j.totals.push(f.data.total);
        }
        j.extra = extra;
        j.firstAt = new Date().toISOString();
        publish(j);
        await carryOn(j);
      } catch (e) {
        if (!j.cancelled) setState({ status: "error", error: e instanceof Error ? e.message : "Could not read the report." });
      }
    })();
    return () => { j.cancelled = true; };
  }, [key, attempt, publish, carryOn]);

  // A higher cap carries on from where the reading stopped.
  useEffect(() => {
    const j = job.current;
    if (j && j.firstAt && !j.running && !j.cancelled) void carryOn(j);
  }, [cap, carryOn]);

  return { state, retry };
}
