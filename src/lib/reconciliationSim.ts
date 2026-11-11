/* Mock cash-in statement generator, for simulating a reconciliation run.

   Finance uploads a channel's statement on /reconciliation and omnichannel
   matches it against the period's paid money-in payments (see
   reconciliationContract.ts). There is no channel statement to hand on a demo
   environment, so this builds a plausible one FROM those cash-ins: it reads
   the period's paid money-in payments (what the Transactions "Collected" tile
   counts — a channel source, not a PAYOUT, status PAID), writes most of them
   back out as the statement so they MATCH by reference, and perturbs a few on
   purpose so the run also shows every exception:

     - MATCHED          a row carrying the payment's own reference and amount
     - AMOUNT_MISMATCH  the same reference, a different amount
     - STATEMENT_ONLY   an invented row no payment backs
     - LEDGER_ONLY      a payment left OFF the statement
     - skipped          two deliberately unreadable rows

   The file is in omnichannel's own template
   (transaction_reference,channel,phone,amount,currency,paid_at,account_reference,status),
   so it uploads through the normal flow. Nothing here moves money.

   Caveat worth saying out loud to whoever runs it: omnichannel reconciles the
   statement against EVERY paid cash-in in the uploaded period, not just the
   ones drawn on here. So if the period holds more cash-ins than `max`, the
   overflow all lands in LEDGER_ONLY — `inPeriod` vs `used` says by how much,
   and a tight period (≈`max` cash-ins) keeps the run mostly matched. */

import { omniApi, type CsvDownload, type CustomerTransactionEntry } from "./omniApi";

export type SimPeriod = { from?: string | null; to?: string | null };

/** What the generated file is designed to produce once uploaded. */
export type SimMix = { matched: number; amountMismatch: number; statementOnly: number; ledgerOnly: number; skipped: number };

export type SimResult = {
  download: CsvDownload;
  /** Cash-ins drawn on for the statement (capped at `max`). */
  used: number;
  /** All paid cash-ins the period holds, so the caller can warn about the
   *  LEDGER_ONLY overflow; null if the count could not be read. */
  inPeriod: number | null;
  /** Readable rows written to the file (excludes the omitted ledger-only). */
  statementLines: number;
  mix: SimMix;
};

const HEADER = "transaction_reference,channel,phone,amount,currency,paid_at,account_reference,status";

/** Shares of the drawn cash-ins turned into each exception; the rest match. */
const LEDGER_ONLY_SHARE = 0.05;
const MISMATCH_SHARE = 0.05;
const STATEMENT_ONLY_SHARE = 0.05;
const SKIPPED_ROWS = 2;

const PAGE_SIZE = 100;
/** A ceiling so a huge period cannot page forever while collecting `max`. */
const MAX_PAGES = 80;

/** The reference a channel statement carries and the ledger matches on: the
 *  provider's own receipt. Omnichannel's timeline keeps it in `detail`
 *  ("M-Pesa top-up… receipt SIMXWN9FMC"), while `reference` is the internal
 *  payment id ("topup:<uuid>") that would never appear on a real statement.
 *  Falls back to `reference` when no receipt is in the detail. */
function matchRef(e: CustomerTransactionEntry): string | null {
  const m = e.detail?.match(/receipt\s+([A-Za-z0-9]+)/i);
  return m ? m[1] : e.reference;
}

/** A paid money-in payment on a channel: what the statement is built from.
 *  Mirrors the Transactions "Collected" tile (kind ≠ PAYOUT, status PAID;
 *  note a top-up's `direction` is OUT, money leaving the customer, so it is
 *  not used) and needs a receipt to match on and an amount. PRODUCT movements
 *  are the wallet's own ledger, never on a channel statement, so they go. */
function isCashIn(e: CustomerTransactionEntry): boolean {
  return (
    e.status === "PAID" &&
    e.kind !== "PAYOUT" &&
    e.source !== "PRODUCT" &&
    !!matchRef(e) &&
    typeof e.amount === "number" &&
    e.amount > 0
  );
}

/** Pages the period's paid transactions, keeping cash-ins up to `max`. */
async function fetchCashIns(period: SimPeriod, max: number): Promise<CustomerTransactionEntry[]> {
  const query = { status: "PAID", from: period.from ?? undefined, to: period.to ?? undefined };
  const list: CustomerTransactionEntry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await omniApi.transactions(query, page, PAGE_SIZE);
    for (const e of res.items) if (isCashIn(e)) list.push(e);
    if (list.length >= max) return list.slice(0, max);
    if (res.items.length < PAGE_SIZE || page >= res.pages) break;
  }
  return list;
}

/** All paid cash-ins the period holds, for the LEDGER_ONLY overflow note. */
async function cashInCount(period: SimPeriod): Promise<number> {
  const totals = await omniApi.transactionTotals({ from: period.from ?? undefined, to: period.to ?? undefined });
  return totals.reduce((n, t) => n + (t.collected?.count ?? 0), 0);
}

/** `count` indices spread evenly across `[0, n)`, each landing on the next
 *  still-unclaimed slot so the exception marks never collide. */
function spread(scen: string[], label: string, count: number): void {
  const n = scen.length;
  if (count <= 0 || n === 0) return;
  const step = n / count;
  for (let k = 0; k < count; k++) {
    let i = Math.min(n - 1, Math.floor(k * step));
    for (let tries = 0; tries < n && scen[i] !== "MATCHED"; tries++) i = (i + 1) % n;
    if (scen[i] === "MATCHED") scen[i] = label;
  }
}

const csvCell = (v: string | number | null): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const kes = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
/** A plausible, synthetic 07######## — not used for matching (reference wins). */
const phoneFor = (seed: string): string => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `07${String(h % 100_000_000).padStart(8, "0")}`;
};

type Cols = { reference: string; channel: string; phone: string; amount: string; currency: string; paidAt: string; account: string; status: string };
const toRow = (c: Cols): string =>
  [c.reference, c.channel, c.phone, c.amount, c.currency, c.paidAt, c.account, c.status].map(csvCell).join(",");

const rowOf = (e: CustomerTransactionEntry, amount: number): Cols => ({
  reference: matchRef(e) ?? "",
  channel: e.source ?? "MPESA",
  phone: phoneFor(e.id),
  amount: kes(amount),
  currency: e.currency ?? "KES",
  paidAt: e.occurredAt,
  account: e.customer ?? e.profileId ?? "",
  status: "Completed",
});

/** Visibly different from the payment, and still positive. */
const mismatchAmount = (a: number): number => {
  const delta = Math.max(1, Math.round(a * 0.1));
  return a > delta ? a - delta : a + delta;
};

function buildCsv(cashIns: CustomerTransactionEntry[], period: SimPeriod): { csv: string; mix: SimMix; statementLines: number } {
  const n = cashIns.length;
  const scen = new Array<string>(n).fill("MATCHED");
  spread(scen, "LEDGER_ONLY", Math.round(n * LEDGER_ONLY_SHARE));
  spread(scen, "AMOUNT_MISMATCH", Math.round(n * MISMATCH_SHARE));

  const currency = cashIns.find((e) => e.currency)?.currency ?? "KES";
  const anchor = period.from ?? period.to ?? cashIns[0]?.occurredAt ?? new Date().toISOString();

  const rows: string[] = [];
  const mix: SimMix = { matched: 0, amountMismatch: 0, statementOnly: 0, ledgerOnly: 0, skipped: SKIPPED_ROWS };
  cashIns.forEach((e, i) => {
    if (scen[i] === "LEDGER_ONLY") { mix.ledgerOnly++; return; } // left off the statement on purpose
    if (scen[i] === "AMOUNT_MISMATCH") { rows.push(toRow(rowOf(e, mismatchAmount(e.amount!)))); mix.amountMismatch++; return; }
    rows.push(toRow(rowOf(e, e.amount!)));
    mix.matched++;
  });

  // Invented rows no payment backs → STATEMENT_ONLY, scattered through the file.
  const nStatementOnly = Math.round(n * STATEMENT_ONLY_SHARE);
  const gap = Math.max(1, Math.floor((rows.length + 1) / (nStatementOnly + 1)));
  for (let k = 0; k < nStatementOnly; k++) {
    const at = Math.min(rows.length, (k + 1) * gap);
    rows.splice(at, 0, toRow({
      reference: `SIMUL-SO-${String(k + 1).padStart(5, "0")}`,
      channel: cashIns[k % Math.max(1, n)]?.source ?? "MPESA",
      phone: phoneFor(`so-${k}`),
      amount: kes(100 + ((k * 137) % 4900)),
      currency,
      paidAt: anchor,
      account: "",
      status: "Completed",
    }));
    mix.statementOnly++;
  }

  const statementLines = rows.length;

  // Two deliberately unreadable rows → the run's skipped count.
  rows.push(toRow({ reference: "SIMUL-BAD-1", channel: "MPESA", phone: phoneFor("bad1"), amount: "N/A", currency, paidAt: anchor, account: "", status: "Completed" }));
  rows.push(toRow({ reference: "SIMUL-BAD-2", channel: "MPESA", phone: phoneFor("bad2"), amount: "not-a-number", currency, paidAt: "not-a-date", account: "", status: "Completed" }));

  return { csv: `${HEADER}\n${rows.join("\n")}\n`, mix, statementLines };
}

/** A yyyy-MM-dd stamp in Nairobi, for the file name. */
function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

/** Reads the period's paid cash-ins and returns a statement CSV built from
 *  them, designed to exercise every reconciliation outcome. Throws if the
 *  period holds no cash-ins to build from. */
export async function generateMockStatement(period: SimPeriod, max = 500): Promise<SimResult> {
  const inPeriod = await cashInCount(period).catch(() => null);
  const cashIns = await fetchCashIns(period, max);
  if (cashIns.length === 0) throw new Error("No paid cash-ins in this period to build a statement from. Widen the dates, or leave them blank.");

  const { csv, mix, statementLines } = buildCsv(cashIns, period);
  const blob = new Blob([csv], { type: "text/csv" });
  return {
    download: { filename: `mock-reconciliation-statement-${today()}.csv`, blob },
    used: cashIns.length,
    inPeriod,
    statementLines,
    mix,
  };
}
