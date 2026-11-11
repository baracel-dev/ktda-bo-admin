/* The Reports page's period: a From and To day, Nairobi's, both included,
   kept in the URL (?from=YYYY-MM-DD&to=YYYY-MM-DD). Either may be blank
   (open-ended). Omnichannel's lists take `from` and `to` as instants with
   `to` exclusive, so To goes as the next day's Nairobi midnight. An
   omnichannel that does not know the params ignores them; each report also
   keeps only the rows whose own date falls in the period, so what is on
   screen respects it either way. */

import { nairobiMidnight } from "./reconciliationContract";

export type Period = { from: string; to: string };
export const NO_PERIOD: Period = { from: "", to: "" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const valid = (s: string | null): string => (s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : "");

/** The period in the URL; a malformed day is left out, and a pair the wrong way round is swapped. */
export function periodFromParams(params: URLSearchParams): Period {
  const from = valid(params.get("from"));
  const to = valid(params.get("to"));
  return from && to && to < from ? { from: to, to: from } : { from, to };
}

/** `params` with the period set (blank days removed). */
export function withPeriod(params: URLSearchParams, p: Period): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of ["from", "to"] as const) {
    if (p[k]) next.set(k, p[k]);
    else next.delete(k);
  }
  return next;
}

export const hasPeriod = (p: Period) => !!(p.from || p.to);

/** The instants omnichannel takes: From's midnight, and the midnight after To (exclusive). */
export function periodBounds(p: Period): { from: string | null; to: string | null } {
  return { from: p.from ? nairobiMidnight(p.from) : null, to: p.to ? nairobiMidnight(p.to, 1) : null };
}

/** The query for a list: `from` and `to`, or only `to` where the list's own
 *  date comes before the report's (a run started before the period may be
 *  released in it), so the server never leaves out a row the report keeps. */
export function periodQuery(p: Period, onlyTo = false): URLSearchParams {
  const b = periodBounds(p);
  const q = new URLSearchParams();
  if (b.from && !onlyTo) q.set("from", b.from);
  if (b.to) q.set("to", b.to);
  return q;
}

/** Whether a moment falls in the period. A row with no date is kept only when there is no period. */
export function inPeriod(iso: string | null | undefined, p: Period): boolean {
  if (!hasPeriod(p)) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const b = periodBounds(p);
  return (!b.from || t >= Date.parse(b.from)) && (!b.to || t < Date.parse(b.to));
}

const label = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`));

/** "1 Nov 2026 – 30 Nov 2026", "From 1 Nov 2026", "Up to 30 Nov 2026", or "" with no period. */
export function periodText(p: Period): string {
  if (p.from && p.to) return p.from === p.to ? label(p.from) : `${label(p.from)} – ${label(p.to)}`;
  if (p.from) return `From ${label(p.from)}`;
  if (p.to) return `Up to ${label(p.to)}`;
  return "";
}

/** "2026-11-01_2026-11-30" for file names; "" with no period. */
export function periodSlug(p: Period): string {
  return hasPeriod(p) ? `${p.from || "start"}_${p.to || "now"}` : "";
}

/* ---- Quick picks, by today's date in Nairobi ---- */

export const nairobiToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(now);

const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export type QuickPick = { key: string; label: string; period: (today: string) => Period };
export const QUICK_PICKS: QuickPick[] = [
  { key: "this-month", label: "This month", period: (t) => ({ from: `${t.slice(0, 8)}01`, to: t }) },
  {
    key: "last-month", label: "Last month",
    period: (t) => {
      const last = shift(`${t.slice(0, 8)}01`, -1);
      return { from: `${last.slice(0, 8)}01`, to: last };
    },
  },
  { key: "last-30", label: "Last 30 days", period: (t) => ({ from: shift(t, -29), to: t }) },
];
