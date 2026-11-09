/* Bulk onboarding and bulk payment (KTDA farmers), through omnichannel's
 * operator API at /omni/api/operator/bulk-loads.
 *
 * Both flows are file based and long running: upload the CSV (a RUNNING run,
 * HTTP 202), press Process to start the durable job, poll the run until it
 * leaves RUNNING, then read its reconciliation once.
 *
 * ONBOARDING (grower_no,national_id,full_name,msisdn) gives each farmer a
 * phone and PIN login, an omnichannel profile with a product link and an empty
 * wallet. PAYMENT (grower_no,amount_kes,payment_ref) credits those wallets; a
 * grower who was never onboarded is rejected, and payment_ref makes each row
 * safe to send twice. A PAYMENT upload is refused with 409 until an ONBOARDING
 * run has completed for the institution.
 *
 * PAYMENT also takes KTDA's SAP export (sapPaymentFile.ts) where omnichannel
 * has the SAP pay file (tokenization-omnichannel #98): it checks the file at
 * upload, sends only the WALLET lines that pass to the ledger, and reports
 * what it held (with rule codes) and what is paid by bank or SACCO instead,
 * with every such line in GET /{runId}/exceptions (CSV). There a PAYMENT run
 * is SUBMITTED at upload and starts only when a different operator releases
 * it (POST /{runId}/release; 403 MAKER_CHECKER for the uploader, 409
 * RELEASE_REQUIRED for /process). The same payment file twice is 409
 * DUPLICATE_FILE naming the earlier run; a file over the limit is 413
 * FILE_TOO_LARGE. All read from omnichannel's answers, never assumed: a run
 * without these fields is an older omnichannel, and the page keeps today's
 * one-step behaviour.
 *
 * PAYOUT ("Pay to M-PESA") takes the same file, upload, process and release
 * as PAYMENT; after its release each row draws the amount from the farmer's
 * wallet and pays it to their M-PESA through SasaPay. Its rows, one outcome
 * at a time, are JSON pages from /{runId}/rows (payoutRows); its
 * reconciliation counts what was sent, failed, refused and already paid.
 *
 * REGISTRATION and ACTIVATION are the farmer journey's flows
 * (journeyContract.ts): not on every environment yet, and said so plainly
 * where omnichannel refuses one. */
import { OmniApiError, omniCall, type CsvDownload, type Page } from "./omniApi";
import { formatKes, parseKes } from "./bulk-file";
import { institutionApi } from "./api.institution";
import { BULK_COLUMNS, COLUMNS, NEW_FLOWS, NOT_AVAILABLE, notBuiltYet, type BulkFlow, type OnboardingStatus } from "./journeyContract";

export { BULK_COLUMNS, type BulkFlow };
/** SUBMITTED: a PAYMENT run waiting for a second operator to release it
 *  (an omnichannel with maker-checker only). */
export type RunStatus = "SUBMITTED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";

export type BulkRun = {
  runId: string;
  flow: BulkFlow;
  institutionId: string;
  /** Not sent by omnichannel today; look the name up from the institutions. */
  institutionName?: string | null;
  currency: string;
  /** The uploaded file's name. */
  sourceName: string;
  status: RunStatus;
  totalRows: number;
  /** Wallets created (ONBOARDING), farmers registered (REGISTRATION), wallets
   *  opened (ACTIVATION) or credited (PAYMENT). */
  processedCount: number;
  /** Rows already applied by an earlier run. */
  skippedCount: number;
  /** Rows refused: bad data, or a payment for a grower not onboarded. */
  failureCount: number;
  /** Credited by this run (PAYMENT); 0 for ONBOARDING. */
  totalAmount: number;
  startedAt: string;
  completedAt: string | null;
  /** A summary with sample failures; always shown on PARTIAL and FAILED. */
  message: string | null;

  /* Maker-checker (PAYMENT, an omnichannel that has it). Absent on an older
     one: the run then starts on Process, as it always has. */
  /** Who uploaded it (omnichannel's subject, "staff:<email>"); null for a run without a named uploader. */
  submittedBy?: string | null;
  submittedAt?: string | null;
  /** Who released it; never submittedBy (omnichannel answers 403 MAKER_CHECKER). */
  releasedBy?: string | null;
  releasedAt?: string | null;
  /** SHA-256 of the uploaded bytes: the same file is not paid twice. */
  fileSha256?: string | null;

  /* A KTDA SAP pay file (fileFormat "SAP"): what omnichannel's checks found at
     upload. Null for any other file. Amounts in KES. */
  fileFormat?: string | null;
  /** The pay period, YYYY-MM. */
  period?: string | null;
  /** Lines that pass and are PayTo=WALLET: what the run sends to the wallets. */
  payableCount?: number | null;
  payableAmount?: number | null;
  /** Lines paid by BANK or SACCO: not paid to wallets by this run. */
  routedCount?: number | null;
  routedAmount?: number | null;
  /** Lines held by a check, never paid. */
  heldCount?: number | null;
  heldAmount?: number | null;
  /** Held lines per rule, "E01_MALFORMED=1,E03_DUPLICATE=2". */
  heldCodes?: string | null;
  /** Lines paid with a warning (W01 name differs), where omnichannel checks the register. */
  warningCount?: number | null;
  /** Checks omnichannel could not run on this file (E05_WALLET_MISMATCH, ...), comma separated. */
  checksNotRun?: string | null;
} & LedgerRefusals;

/** What the ledger refused of the lines it was sent (a grower with no wallet,
 *  say): accounting tokenization-project#52, passed on by omnichannel #98 on
 *  the run and the reconciliation. Refused lines are also in /exceptions as
 *  LEDGER_REFUSED. Absent on an older core; the page then reconciles as it
 *  always has. */
export type LedgerRefusals = {
  refusedCount?: number | null;
  /** KES. */
  refusedAmount?: number | null;
};

/** Which rows of a run the ledger refused, posted, or found already applied. */
export type RowOutcome = "REFUSED" | "POSTED" | "ALREADY_APPLIED";

/** A PAYOUT row's outcome: PLANNED before it is paid, SENT to M-PESA, FAILED
 *  at the provider (retried from the payments issues list), REFUSED (no
 *  funded wallet, or the wallet is short), ALREADY_PAID (its payment_ref was
 *  paid before). */
export type PayoutOutcome = "PLANNED" | "REFUSED" | "SENT" | "FAILED" | "ALREADY_PAID";
export const PAYOUT_OUTCOMES: PayoutOutcome[] = ["SENT", "FAILED", "REFUSED", "ALREADY_PAID", "PLANNED"];

/** One row of a PAYOUT run. */
export type PayoutRow = {
  row: number;
  growerNo: string;
  amount: number;
  currency: string;
  paymentRef: string;
  outcome: PayoutOutcome | string;
  /** Why it failed or was refused: for FAILED, the provider's own words. */
  message?: string | null;
  /** The M-PESA payment, once one was made. */
  paymentId?: string | null;
  at?: string | null;
};

/** A PAYOUT run's reconciliation. The exact field names follow from
 *  omnichannel's build, so it is typed loosely and the page shows what comes:
 *  counts and amounts for sent, failed, refused and already paid. */
export type PayoutReconciliation = Record<string, unknown>;

/** What a payout upload says on an omnichannel without PAYOUT. */
export const PAYOUT_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here does not pay out to M-PESA. It needs the omnichannel release with the PAYOUT flow.";

/** The ledger refused lines and reported them. */
export const hasRefusals = (r: LedgerRefusals | null | undefined) => r?.refusedCount != null;

/** A payment run from an omnichannel with maker-checker. (Every run there
 *  carries submittedBy; only a payment run is released.) */
export const hasApproval = (r: BulkRun) => (r.flow === "PAYMENT" || r.flow === "PAYOUT") && (r.status === "SUBMITTED" || "submittedBy" in r || "releasedBy" in r);

/** The run comes from an omnichannel that reads the SAP pay file. */
export const readsSapFiles = (r: BulkRun) => "fileFormat" in r;

/** "E01_MALFORMED=1,E03_DUPLICATE=2" as [code, count] pairs; [] for none. */
export function heldCodesOf(codes: string | null | undefined): [string, number][] {
  return (codes ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [code, n] = p.split("=");
    return [code.trim(), Number(n) || 0] as [string, number];
  });
}

/** The earlier run a "same file" 409 names, when its message carries the id. */
export function earlierRunIn(message: string | null | undefined): string | null {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(message ?? "")?.[0] ?? null;
}

/** The proof panel. An ONBOARDING run has the same shape with amounts 0. */
export type BulkReconciliation = {
  runId: string;
  flow: BulkFlow;
  institutionId: string;
  institutionName: string | null;
  status: RunStatus;
  /** Wallets the institution holds in the run's currency. */
  walletCount: number;
  processedCount: number;
  skippedCount: number;
  failureCount: number;
  creditedTotal: number;
  depositDebitTotal: number;
  depositCreditTotal: number;
  doubleEntryBalanced: boolean;
  /** The file's grand total, when it was passed. */
  expectedTotal: number | null;
  /** creditedTotal equals expectedTotal to the cent; null without one. */
  matchesExpected: boolean | null;

  /* A SAP pay file's checks, as on the run (null for any other file). */
  fileFormat?: string | null;
  payableCount?: number | null;
  payableAmount?: number | null;
  routedCount?: number | null;
  routedAmount?: number | null;
  heldCount?: number | null;
  heldAmount?: number | null;
  heldCodes?: string | null;
  warningCount?: number | null;
  checksNotRun?: string | null;
  /* With refusedCount/refusedAmount (LedgerRefusals) the core's matchesExpected
     is posted + already applied + refused == expected; without them, as before. */
  /** The ledger's match rule in words, when it states one. */
  matchRule?: string | null;
} & LedgerRefusals;

/** Payments at or over this need approval, so the backend refuses them here. */
export const MAX_PAYMENT_KES = 1_000_000;

/** The largest upload this site passes on: the UAT nginx's limit for the
 *  upload path (deploy/nginx/ktda-bo-admin.conf). Omnichannel's own is larger
 *  (200 MB). A 600,000-line SAP file is about 85 MB. */
export const MAX_UPLOAD_MB = 100;
const TOO_LARGE = `The file is over the ${MAX_UPLOAD_MB} MB this site accepts. Split it by factory and send each part.`;

/** Omnichannel's error codes this page acts on. */
export const ERR = {
  MAKER_CHECKER: "MAKER_CHECKER",
  DUPLICATE_FILE: "DUPLICATE_FILE",
  RELEASE_REQUIRED: "RELEASE_REQUIRED",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
} as const;

const BASE = "/bulk-loads";
const runPath = (runId: string) => `${BASE}/${encodeURIComponent(runId)}`;

export type { OmniInstitution } from "./api.institution";

/** Omnichannel refuses (403, with no code) an upload or onboarding check for
 *  an institution that is not this back office's own. The page only ever sends
 *  the one omnichannel named, so this means the configuration changed under it. */
const NOT_OURS = "Omnichannel refused this: the institution is not this back office's. Reload the page and try again.";
function plainForbidden<T>(call: Promise<T>): Promise<T> {
  return call.catch((e: unknown) => {
    if (e instanceof OmniApiError && e.status === 403 && !e.code) throw new OmniApiError(403, NOT_OURS);
    throw e;
  });
}

export const bulkLoads = {
  /** The institution this back office works for. Omnichannel answers only
   *  the caller's own, which the proxy sets from configuration; the browser
   *  never names it. */
  ownInstitution: institutionApi.own,
  /** Stores the file and returns the run (202): RUNNING, or SUBMITTED for a
   *  PAYMENT file where omnichannel has maker-checker. 409 for a PAYMENT file
   *  before onboarding has completed, or the same file again (DUPLICATE_FILE,
   *  naming the earlier run); 400 for an empty or unreadable file (BAD_FILE);
   *  413 over the size limit. `period` (YYYY-MM) is a SAP pay file's period. */
  upload: (flow: BulkFlow, institutionId: string, file: File, institutionName?: string | null, currency = "KES", period?: string | null) => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("flow", flow);
    form.append("institutionId", institutionId);
    // Optional: omnichannel keeps its own copy of the institution, made on the
    // first upload, and names it from this field.
    if (institutionName) form.append("institutionName", institutionName);
    form.append("currency", currency);
    if (period) form.append("period", period);
    const sent = plainForbidden(omniCall.post<BulkRun>(`${BASE}/upload`, form)).catch((e: unknown) => {
      // nginx answers its own 413 as an HTML page; omnichannel's names its limit.
      if (e instanceof OmniApiError && e.status === 413) {
        throw new OmniApiError(413, e.code === ERR.FILE_TOO_LARGE ? `${e.message.replace(/\.?$/, ".")} Split the file by factory and send each part.` : TOO_LARGE, e.field, e.code);
      }
      throw e;
    });
    // A flow this omnichannel does not have yet says so; nothing is retried
    // under another flow.
    return NEW_FLOWS.has(flow)
      ? sent.catch((e: unknown) => {
        if (e instanceof OmniApiError && notBuiltYet(e.status, e.message)) throw new OmniApiError(e.status, flow === "PAYOUT" ? PAYOUT_NOT_AVAILABLE : NOT_AVAILABLE);
        throw e;
      })
      : sent;
  },
  /** Starts the durable job for an uploaded run. A PAYMENT run where
   *  omnichannel has maker-checker starts on its release instead (409
   *  RELEASE_REQUIRED): the run is read again, and waits as it is. */
  process: (runId: string) => omniCall.post<BulkRun>(`${runPath(runId)}/process`, {}).catch((e: unknown) => {
    if (e instanceof OmniApiError && e.code === ERR.RELEASE_REQUIRED) return omniCall.get<BulkRun>(runPath(runId));
    throw e;
  }),
  /** A second operator's release of a SUBMITTED payment run, which starts it.
   *  403 MAKER_CHECKER for the operator who uploaded it; 409 when it is not
   *  waiting for release. */
  release: (runId: string) => omniCall.post<BulkRun>(`${runPath(runId)}/release`, {}),
  /** A SAP pay file's exception report (CSV): every line held, with its rule
   *  code and reason, or paid by BANK or SACCO. 409 for any other run. */
  exceptions: (runId: string): Promise<CsvDownload> => omniCall.download(`${runPath(runId)}/exceptions`, `${runId}-exceptions.csv`),
  /** The run's ledger rows with one outcome, streamed as CSV (lineNo,
   *  grower_no, payment_ref, amount, outcome, reason): omnichannel's
   *  GET /bulk-loads/{runId}/rows?outcome= with Accept: text/csv (JSON pages
   *  otherwise). 404 when the run has not reached the ledger, or the core
   *  keeps no per-line results; 400 for another outcome. */
  rows: (runId: string, outcome: RowOutcome): Promise<CsvDownload> =>
    omniCall.download(`${runPath(runId)}/rows?outcome=${outcome}`, `${runId}-${outcome.toLowerCase()}.csv`, "text/csv").catch((e: unknown) => {
      if (e instanceof OmniApiError && (e.status === 404 || e.status === 405 || e.status === 501)) {
        throw new OmniApiError(e.status, "The ledger's line results are not available for this run: it has not reached the ledger, or this environment's accounting keeps counts only. The counts above are still the ledger's.");
      }
      throw e;
    }),
  /** One page of a PAYOUT run's rows with one outcome (X-Total-* headers). */
  payoutRows: (runId: string, outcome: PayoutOutcome, page: number, size = 50): Promise<Page<PayoutRow>> =>
    omniCall.page<PayoutRow>(`${runPath(runId)}/rows?outcome=${outcome}`, page, size),
  /** A PAYOUT run's reconciliation, as omnichannel words it. */
  payoutReconciliation: (runId: string) => omniCall.get<PayoutReconciliation>(`${runPath(runId)}/reconciliation`),
  run: (runId: string) => omniCall.get<BulkRun>(runPath(runId)),
  /** The latest 50 runs, every institution and flow, newest first. */
  recent: () => omniCall.list<BulkRun>(BASE),
  /** `expectedCents` is what the run should have credited, in cents. */
  reconciliation: (runId: string, expectedCents?: number | null) =>
    omniCall.get<BulkReconciliation>(
      `${runPath(runId)}/reconciliation${expectedCents != null ? `?expectedTotal=${formatKes(expectedCents)}` : ""}`,
    ),
  /** Whether payments (any farmer has a wallet) and step 2 (anyone is
   *  registered) are open for the institution. */
  onboardingStatus: (institutionId: string) =>
    plainForbidden(omniCall.get<OnboardingStatus>(`${BASE}/onboarding-status?institutionId=${encodeURIComponent(institutionId)}`)),
};

/* A light read of the file before it is sent: the backend validates every
 * row, this only catches the wrong file (no header, wrong columns, no rows)
 * and, for a payment file, adds up the amounts so the reconciliation can
 * check the credited total against the file's own. */

export type FileSummary = {
  rows: number;
  /** Sum of amount_kes, to the cent; null for an onboarding file or when an
   *  amount does not parse (the backend reports those rows). */
  total: number | null;
  /** Why the file cannot be sent; null when it can. */
  problem: string | null;
  /** Rows the backend will refuse, as a heads-up (amount too large). */
  warnings: string[];
  /** PAYMENT: what the run should credit, in cents: the rows that pass the
   *  checks the backend applies (a KES amount above zero and under the
   *  approval threshold, a payment_ref not already earlier in the file).
   *  Null for other flows. */
  expectedCents?: number | null;
};

export function summariseCsv(flow: BulkFlow, text: string): FileSummary {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const { required, byName } = COLUMNS[flow];
  if (lines.length === 0) return { rows: 0, total: null, problem: "The file is empty.", warnings: [] };
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) {
    // Omnichannel would take the file and fail the run on Process; say it now.
    const problem = byName
      ? `The file's header row has no ${missing.join(", ")} column${missing.length === 1 ? "" : "s"}. It needs ${required.join(", ")}.`
      : `The header must have ${BULK_COLUMNS[flow].join(",")}. Missing: ${missing.join(", ")}.`;
    return { rows: 0, total: null, problem, warnings: [] };
  }
  const rows = lines.length - 1;
  if (rows === 0) return { rows: 0, total: null, problem: "The file has a header but no rows.", warnings: [] };
  if (flow === "ACTIVATION") {
    const at = header.indexOf("date_of_birth");
    const bad = at < 0 ? 0 : lines.slice(1).filter((l) => {
      const v = l.split(",")[at]?.trim() ?? "";
      return v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v);
    }).length;
    const warnings = bad ? [`${bad.toLocaleString()} row${bad === 1 ? "" : "s"} with a date_of_birth not in YYYY-MM-DD form will fail.`] : [];
    return { rows, total: null, problem: null, warnings };
  }
  if (flow !== "PAYMENT" && flow !== "PAYOUT") return { rows, total: null, problem: null, warnings: [] };

  const at = header.indexOf("amount_kes");
  const refAt = header.indexOf("payment_ref");
  let cents = 0;
  let parsed = true;
  let tooLarge = 0;
  // Integer cents, no floats: only rows that will be credited count.
  let expected = 0;
  let refused = 0;
  const refs = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const raw = cells[at]?.trim() ?? "";
    const ref = cells[refAt]?.trim() ?? "";
    const amount = Number(raw);
    const exact = parseKes(raw);
    const repeat = ref !== "" && refs.has(ref);
    if (ref !== "") refs.add(ref);
    if (exact !== null && exact > 0 && exact < MAX_PAYMENT_KES * 100 && ref !== "" && !repeat) expected += exact;
    else refused++;
    if (raw === "" || !Number.isFinite(amount)) {
      parsed = false;
      continue;
    }
    if (amount >= MAX_PAYMENT_KES) tooLarge++;
    cents += Math.round(amount * 100);
  }
  const warnings = tooLarge
    ? [`${tooLarge.toLocaleString()} row${tooLarge === 1 ? "" : "s"} at or over KES ${MAX_PAYMENT_KES.toLocaleString()} will be refused.`]
    : [];
  if (refused > tooLarge) {
    const other = refused - tooLarge;
    warnings.push(`${other.toLocaleString()} row${other === 1 ? "" : "s"} without a KES amount above zero or a payment_ref of their own will not be ${flow === "PAYOUT" ? "paid" : "credited"}.`);
  }
  return { rows, total: parsed ? cents / 100 : null, problem: null, warnings, expectedCents: expected };
}
