/* Cash-in reconciliation (omnichannel /api/operator/reconciliation, PR 150).
   Finance uploads a channel's statement in omnichannel's own CSV template;
   omnichannel matches it against the period's paid money-in payments, by
   reference first and then by phone, amount and time, and answers a run with
   its counts. Each line has a statement side, a ledger side, or both. The
   three outcomes other than MATCHED are exceptions, resolved with a note
   (what was found, what was done). Nothing here moves money.

   Reading needs page:reconciliation; uploading and resolving need
   act:reconciliation.run (Finance and Administrator by default), which the
   server enforces too: 403 STAFF_FORBIDDEN. */

export type ReconciliationOutcome = "MATCHED" | "LEDGER_ONLY" | "STATEMENT_ONLY" | "AMOUNT_MISMATCH";
export const OUTCOMES: ReconciliationOutcome[] = ["MATCHED", "LEDGER_ONLY", "STATEMENT_ONLY", "AMOUNT_MISMATCH"];
export const OUTCOME_LABEL: Record<ReconciliationOutcome, string> = {
  MATCHED: "Matched", LEDGER_ONLY: "Ledger only", STATEMENT_ONLY: "Statement only", AMOUNT_MISMATCH: "Amount mismatch",
};
export const OUTCOME_TONE: Record<ReconciliationOutcome, "success" | "warning" | "danger"> = {
  MATCHED: "success", LEDGER_ONLY: "warning", STATEMENT_ONLY: "danger", AMOUNT_MISMATCH: "danger",
};
/** What each exception means, for the tab and the resolve dialog. */
export const OUTCOME_MEANS: Record<Exclude<ReconciliationOutcome, "MATCHED">, string> = {
  LEDGER_ONLY: "Recorded here as paid, but the channel's statement does not carry it.",
  STATEMENT_ONLY: "The channel collected it, but it was never recorded here as paid.",
  AMOUNT_MISMATCH: "The same transaction on both sides, with different amounts.",
};
export const MATCHED_BY_LABEL: Record<string, string> = { REFERENCE: "Reference", PHONE_AMOUNT_TIME: "Phone, amount and time" };

export type ReconciliationRun = {
  id: string;
  fileName: string | null;
  periodFrom: string | null;
  /** Exclusive. */
  periodTo: string | null;
  currency: string;
  statementLines: number;
  ledgerPayments: number;
  matched: number;
  ledgerOnly: number;
  statementOnly: number;
  amountMismatch: number;
  resolved: number;
  exceptionsOpen: number;
  skippedLines: number;
  statementAmount: number;
  ledgerAmount: number;
  runBy: string | null;
  createdAt: string;
};

export type StatementSide = {
  row: number | null; reference: string | null; channel: string | null; phone: string | null; amount: number | null;
  currency: string | null; paidAt: string | null; accountReference: string | null; status: string | null;
};
/** The phone comes masked (first digits, four stars, last four). */
export type LedgerSide = {
  paymentId: string; reference: string | null; providerRef: string | null; method: string | null; phone: string | null;
  amount: number | null; completedAt: string | null;
};

export type ReconciliationLine = {
  id: string;
  outcome: ReconciliationOutcome;
  matchedBy: string | null;
  statement: StatementSide | null;
  ledger: LedgerSide | null;
  note: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

export const RECONCILIATION_PATH = "/reconciliation";
export const NOTE_MAX = 300;
export const FORBIDDEN_MESSAGE = "You do not have permission to run reconciliations.";
export const NOT_AVAILABLE = "Not available on this environment yet: omnichannel here has no reconciliation.";

export const runLink = (id: string) => `/reconciliation/${encodeURIComponent(id)}`;

/** A day picked as yyyy-MM-dd, at midnight in Nairobi (UTC+3, no daylight saving), as an instant. */
export function nairobiMidnight(day: string, plusDays = 0): string {
  const d = new Date(`${day}T00:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString();
}
