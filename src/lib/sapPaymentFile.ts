/* The browser's check of a payment file before it is sent: which format it is,
 * and for KTDA's SAP export the same line rules as the KTDA back office
 * (file-rules.ts + bulk-file.ts, copied verbatim). Pure and streaming: the
 * worker (sapPaymentCheck.worker.ts) feeds it one line at a time, so a 600,000
 * line file is never held as lines. Money is integer cents throughout.
 *
 * What the browser cannot check: the farmer register. The rules that need it
 * (E02 unknown grower, E05 wallet belongs to another grower, E06 suspended,
 * W01 name differs) run in omnichannel after upload, and the lines it holds
 * come back on the run. Every other rule (E01, E03, E04, E07, E08, E09) is
 * applied here exactly as the service applies it, so the expected total this
 * sends already leaves out the lines those rules hold.
 *
 * Omnichannel's SAP pay file (tokenization-omnichannel #98) makes the same six
 * checks at upload and sends only the passing PayTo=WALLET lines to the
 * ledger; BANK and SACCO lines are paid elsewhere, not to wallets by this run.
 * This check splits the file the same way: to wallets, routed, held. */
import { CHECK_TEXT, Summary, checkLine, compareControl, csvCell, formatKes, parseKes, type CheckCode, type CheckedLine, type ControlCheck, type ControlSheet, type FileSummary, type RegisterEntry } from "./bulk-file";
import { MAX_LINES, headerFor, parseErrorLine, parseLine, toCanonicalCsv, type HeaderMap } from "./file-rules";

/** SAP: KTDA's 16-column export. SIMPLE: the accounting file omnichannel has
 *  always taken (grower_no,amount_kes,payment_ref). */
export type PaymentFormat = "SAP" | "SIMPLE";

export const SIMPLE_COLUMNS = ["grower_no", "amount_kes", "payment_ref"] as const;

/** The rules that need the farmer register, so only omnichannel applies them. */
export const REGISTER_CODES: readonly CheckCode[] = ["E02_UNKNOWN_GROWER", "E05_WALLET_MISMATCH", "E06_WALLET_SUSPENDED", "W01_NAME_DIFFERS"];

/** Which payment file a first line belongs to, or null for neither. */
export function paymentFormatOf(firstLine: string): PaymentFormat | null {
  const cells = firstLine.replace(/^﻿/, "").split(",").map((c) => c.trim().toLowerCase());
  if (SIMPLE_COLUMNS.every((c) => cells.includes(c))) return "SIMPLE";
  return headerFor(firstLine).ok ? "SAP" : null;
}

/** Why a first line is neither file, in words an operator can act on. */
export function formatProblem(firstLine: string): string {
  const h = headerFor(firstLine);
  const sap = h.ok ? "" : h.message;
  return `${sap} Or send the accounting file with the header ${SIMPLE_COLUMNS.join(",")}.`.trim();
}

/* The register stand-in: the line's own grower, wallet and name, always
 * active. With it checkLine applies every rule that does not need the
 * register and passes the ones that do (omnichannel applies those). */
const asItsOwnRegister = (line: { name: string; walletId: string; factoryCode: string }) =>
  (): RegisterEntry => ({ name: line.name, walletId: line.walletId, status: "active", factoryCode: line.factoryCode });

/** Exception report columns: omnichannel's own (GET /{runId}/exceptions), so both reports read alike. */
export const EXCEPTION_HEADER = "line_no,grower_no,name,pay_to,amount_kes,code,reason";

/** A held line, or a line paid by BANK or SACCO (code ROUTED_BANK, ROUTED_SACCO), as omnichannel writes it. */
const exceptionRow = (l: CheckedLine) => {
  const held = l.check === "error";
  return [l.lineNo, l.grower, l.name, l.payTo, formatKes(l.amount), held ? l.code : `ROUTED_${l.payTo}`, held ? l.reason : `Paid by ${l.payTo}, not to the wallet`].map(csvCell).join(",");
};

/** A line the checks pass, paid by bank or SACCO rather than to the wallet. */
const isRouted = (l: CheckedLine) => l.check !== "error" && l.payTo !== "WALLET";

/** How many exception lines are kept for the on-screen table; the CSV keeps up to MAX_EXCEPTION_ROWS. */
export const PREVIEW_EXCEPTIONS = 200;
export const MAX_EXCEPTION_ROWS = 100_000;

export type SapCheckResult = {
  lines: number;
  /** Totals in cents, per factory and per rule code, exactly as the service sums them. */
  summary: FileSummary;
  /** Net of the lines this check holds (errors), in cents. */
  heldCents: number;
  heldCount: number;
  /** Lines that pass but are paid by BANK or SACCO: not paid to wallets by this run. */
  routedCents: number;
  routedCount: number;
  warningCount: number;
  /** What the run should credit to wallets: the WALLET lines that pass, in cents. */
  expectedCents: number;
  expectedCount: number;
  /** The first held and routed lines, for the on-screen table. */
  preview: CheckedLine[];
  exceptionsTotal: number;
  /** The exception report, header included; capped at MAX_EXCEPTION_ROWS lines. */
  exceptionsCsv: string;
  exceptionsTruncated: boolean;
  /** Header cells that matched no column; read past. */
  extras: string[];
};

export class SapFileChecker {
  private map: HeaderMap | null = null;
  private physical = 0;
  private lines = 0;
  private readonly seen = new Map<string, number>();
  private readonly sum = new Summary();
  // Held lines first on screen: they are what someone has to fix.
  private readonly heldPreview: CheckedLine[] = [];
  private readonly routedPreview: CheckedLine[] = [];
  private readonly rows: string[] = [EXCEPTION_HEADER];
  private exceptionsTotal = 0;
  private routedCents = 0;
  private routedCount = 0;

  /** One physical line of the file, header first. Throws with an operator-facing message when the file can't be checked. */
  feed(raw: string): void {
    this.physical++;
    if (!this.map) {
      const h = headerFor(raw);
      if (!h.ok) throw new Error(h.message);
      this.map = h.map;
      return;
    }
    if (raw.trim() === "") return;
    this.lines++;
    if (this.lines > MAX_LINES) throw new Error(`The file has more than ${MAX_LINES.toLocaleString("en-KE")} lines. Split it by factory and send each part.`);
    const p = parseLine(raw, this.physical, this.map);
    const checked = p.ok
      ? checkLine(toCanonicalCsv(p.line), this.physical, asItsOwnRegister(p.line), this.seen)
      : parseErrorLine(p.error, raw);
    // The run's own numbering, as the service keeps it: the Nth payment line.
    checked.lineNo = this.lines;
    this.sum.add(checked);
    const routed = isRouted(checked);
    if (routed) {
      this.routedCount++;
      this.routedCents += checked.amount;
    }
    if (checked.check === "error" || routed) {
      this.exceptionsTotal++;
      const list = routed ? this.routedPreview : this.heldPreview;
      if (list.length < PREVIEW_EXCEPTIONS) list.push(checked);
      if (this.rows.length <= MAX_EXCEPTION_ROWS) this.rows.push(exceptionRow(checked));
    }
  }

  get lineCount() {
    return this.lines;
  }

  result(): SapCheckResult {
    if (!this.map) throw new Error("The file is empty.");
    if (!this.lines) throw new Error("The file has a header but no payment lines.");
    const summary = this.sum.result();
    return {
      lines: this.lines,
      summary,
      heldCents: summary.heldNet,
      heldCount: summary.errors,
      routedCents: this.routedCents,
      routedCount: this.routedCount,
      warningCount: summary.warnings,
      expectedCents: summary.net - summary.heldNet - this.routedCents,
      expectedCount: this.lines - summary.errors - this.routedCount,
      preview: [...this.heldPreview, ...this.routedPreview].slice(0, PREVIEW_EXCEPTIONS),
      exceptionsTotal: this.exceptionsTotal,
      exceptionsCsv: `${this.rows.join("\n")}\n`,
      exceptionsTruncated: this.exceptionsTotal > MAX_EXCEPTION_ROWS,
      extras: this.map.extras,
    };
  }
}

/* ---- The control sheet SAP sends with the file (<file>.control.json) ---- */

export type ControlResult = { sheet: ControlSheet; check: ControlCheck; sameName: boolean; shaChecked: boolean };

/** Reads a control sheet's text; throws with what is wrong with it. */
export function parseControlSheet(text: string): ControlSheet {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The control sheet isn't valid JSON.");
  }
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof c.file !== "string") missing.push("file");
  if (typeof c.rows !== "number" || !Number.isSafeInteger(c.rows) || c.rows < 0) missing.push("rows");
  if (typeof c.totalAmountKES !== "string" || parseKes(c.totalAmountKES) === null) missing.push("totalAmountKES");
  if (typeof c.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(c.sha256)) missing.push("sha256");
  if (missing.length) throw new Error(`The control sheet is missing or has an unreadable ${missing.join(", ")}.`);
  return {
    file: c.file as string,
    rows: c.rows as number,
    totalAmountKES: c.totalAmountKES as string,
    sha256: c.sha256 as string,
    ...(typeof c.paymentType === "string" ? { paymentType: c.paymentType } : {}),
    ...(typeof c.period === "string" ? { period: c.period } : {}),
  };
}

/** The file against its control sheet: line count, the file's whole net (held lines included, as SAP totals it) and checksum. */
export function checkControl(sheet: ControlSheet, fileName: string, result: Pick<SapCheckResult, "lines" | "summary">, sha256: string | null): ControlResult {
  const check = compareControl(sheet, { rows: result.lines, totalCents: result.summary.net, sha256: sha256 ?? "" });
  // No digest on an insecure page: the checksum is "not checked", not "wrong".
  return { sheet, check: sha256 ? check : { ...check, sha256: true }, sameName: sheet.file === fileName, shaChecked: !!sha256 };
}

export const controlOk = (c: ControlResult) => c.check.rows && c.check.total && c.check.sha256;

/* ---- The pay period ---- */

/** omnichannel's own rule (SapPayFile.period): a year 20xx and a month, as
 *  KTDA_GL_2026_10_600000.csv carries 2026-10. */
const PERIOD_IN_NAME = /(20\d{2})[_-]?(0[1-9]|1[0-2])(?!\d)/;
export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The pay period a file name carries (YYYY-MM), or null. */
export function periodFromName(name: string): string | null {
  const m = PERIOD_IN_NAME.exec(name);
  return m ? `${m[1]}-${m[2]}` : null;
}

export { CHECK_TEXT, formatKes, type CheckCode, type CheckedLine, type ControlSheet };
