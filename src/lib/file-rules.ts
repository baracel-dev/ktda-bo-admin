/* COPIED VERBATIM from baracel/ktda apps/backoffice-web/src/lib/file-rules.ts (KTDA back office), so this
 * back office checks a SAP payment file by exactly the same rules. Do not edit here: change it there and copy
 * it again (everything below this comment is byte-identical to the source). */
/**
 * Header rules for the SAP payment file, and the per-line parse that turns any accepted column layout into the
 * canonical 16-column record that the line checks (bulk-file.ts, E01–E09/W01) are written against.
 *
 * ONE place for the file contract. The back-office worker (file-parser.worker.ts) and the proof script
 * (ktda/core/scripts/e2e-600k.mjs) both import this file, so the browser and the evidence run read a file identically.
 * Pure: no imports beyond bulk-file.ts, no I/O, no floating-point money (cents are integers from parseKes).
 *
 * What the header rules allow:
 * - columns in any order, matched by name, case-insensitive, ignoring spaces, underscores and punctuation
 *   ("Wallet ID", "wallet_id" and "WalletID" are the same column); aliases per column below;
 * - a UTF-8 BOM, CRLF or LF line ends, quoted fields with doubled quotes (a name may contain a comma);
 * - extra columns (kept out of the record, listed in `extras`);
 * - deductions either as one Deductions column or as the SAP export's LoanKES/InputsKES/AdvanceKES split
 *   (if both are present they must agree, else the line is E01);
 * - IDNo is read when present and sent to the server, but not required: KTDA's current SAP export has no ID column.
 * What it refuses: a missing required column, a column named twice, a quoted field spanning lines.
 */
import { CHECK_TEXT, COLUMNS, checkLine, csvCell, formatKes, parseKes, splitCsv, type CheckedLine, type RegisterLookup } from "./bulk-file";

export type ColumnKey = "lineNo" | "grower" | "name" | "walletId" | "phone" | "idNo" | "factory" | "factoryName" | "centre" | "kg" | "rate" | "gross" | "deductions" | "loan" | "inputs" | "advance" | "amount" | "payTo";
export type ColumnType = "int" | "text" | "money" | "signedMoney" | "payTo";

export type ColumnRule = {
  key: ColumnKey;
  /** The canonical header name, as KTDA's specification writes it. */
  label: string;
  /** Other header names this column may carry (compared normalised: lower case, letters and digits only). */
  aliases: readonly string[];
  required: boolean;
  type: ColumnType;
  /** Longest value accepted for text columns; longer is a parse error, not a silent truncation. */
  maxLength?: number;
};

/** The file contract. Order here is the order of the canonical record; order in the file doesn't matter. */
export const COLUMN_RULES: readonly ColumnRule[] = [
  { key: "lineNo", label: "LineNo", aliases: ["Line", "LineNumber", "No", "Seq"], required: true, type: "int" },
  { key: "grower", label: "GNo", aliases: ["Grower", "GrowerNo", "GrowerNumber", "GrowerID"], required: true, type: "text", maxLength: 20 },
  { key: "name", label: "Name", aliases: ["GrowerName", "FarmerName", "Farmer"], required: true, type: "text", maxLength: 120 },
  { key: "walletId", label: "WalletID", aliases: ["Wallet", "WalletNo", "WalletNumber"], required: true, type: "text", maxLength: 20 },
  { key: "phone", label: "Phone", aliases: ["PhoneNo", "PhoneNumber", "Mobile", "MSISDN"], required: true, type: "text", maxLength: 20 },
  { key: "idNo", label: "IDNo", aliases: ["ID", "IDNumber", "NationalID", "NationalIDNo"], required: false, type: "text", maxLength: 20 },
  { key: "factory", label: "Factory", aliases: ["FactoryCode", "Fac", "FactoryID"], required: true, type: "text", maxLength: 8 },
  { key: "factoryName", label: "FactoryName", aliases: [], required: false, type: "text", maxLength: 80 },
  { key: "centre", label: "Centre", aliases: ["BuyingCentre", "BuyingCenter", "Center", "BC"], required: true, type: "text", maxLength: 80 },
  { key: "kg", label: "Kg", aliases: ["KgDelivered", "Kgs", "Weight", "KgsDelivered"], required: true, type: "int" },
  { key: "rate", label: "Rate", aliases: ["RateKES", "RatePerKg", "Price"], required: true, type: "money" },
  { key: "gross", label: "Gross", aliases: ["GrossKES", "GrossPay", "GrossAmount"], required: true, type: "money" },
  // Required as a group: Deductions, or the three parts the SAP export carries. See headerFor().
  { key: "deductions", label: "Deductions", aliases: ["DeductionsKES", "TotalDeductions", "Deduction"], required: false, type: "money" },
  { key: "loan", label: "LoanKES", aliases: ["Loan", "SaccoLoan", "LoanRecovery"], required: false, type: "money" },
  { key: "inputs", label: "InputsKES", aliases: ["Inputs", "InputRecovery", "Fertiliser", "Fertilizer"], required: false, type: "money" },
  { key: "advance", label: "AdvanceKES", aliases: ["Advance", "AdvanceRecovery"], required: false, type: "money" },
  { key: "amount", label: "Amount", aliases: ["NetKES", "Net", "NetPay", "AmountKES", "NetAmount"], required: true, type: "signedMoney" },
  { key: "payTo", label: "PayTo", aliases: ["Payout", "PayoutTo", "PayoutType", "Destination"], required: true, type: "payTo" },
] as const;

const RULE_BY_KEY = Object.fromEntries(COLUMN_RULES.map((r) => [r.key, r])) as Record<ColumnKey, ColumnRule>;

export const REQUIRED_LABELS =COLUMN_RULES.filter((r) => r.required).map((r) => r.label).concat("Deductions (or LoanKES, InputsKES and AdvanceKES)");

/** Lines uploaded per request. The server's `ktda.runs.upload-page-lines` must agree. */
export const PAGE_LINES = 20_000;
/** Largest file accepted, as the bulk payment service has it. */
export const MAX_LINES = 700_000;
/** Lines longer than this can't be a real record; stops a binary file from being read as one giant line. */
export const MAX_LINE_CHARS = 4_000;

/** "Wallet ID" → "walletid": the comparison form for header names. Strips a BOM, quotes and anything non-alphanumeric. */
export const normalizeHeaderCell = (s: string) => s.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const BY_NORMALISED: ReadonlyMap<string, ColumnKey> = (() => {
  const m = new Map<string, ColumnKey>();
  for (const r of COLUMN_RULES) for (const n of [r.label, ...r.aliases]) m.set(normalizeHeaderCell(n), r.key);
  return m;
})();

export type HeaderMap = {
  /** Column index in the file for each recognised key. */
  index: Partial<Record<ColumnKey, number>>;
  /** The header cells as read (trimmed), for the server's record of what was uploaded. */
  columns: string[];
  /** Header cells that matched no rule; read past, never an error. */
  extras: string[];
  /** How deductions are carried in this file. */
  deductions: "column" | "parts" | "both";
};

export type HeaderResult = { ok: true; map: HeaderMap } | { ok: false; message: string; missing: string[]; duplicates: string[] };

/** Reads the first line of the file. Order-insensitive, alias-aware; a missing required column names what's missing. */
export function headerFor(line: string): HeaderResult {
  const cells = splitCsv(line.replace(/^﻿/, "").replace(/\r$/, "")).map((c) => c.trim());
  const index: Partial<Record<ColumnKey, number>> = {};
  const extras: string[] = [];
  const duplicates: string[] = [];
  cells.forEach((cell, i) => {
    const key = BY_NORMALISED.get(normalizeHeaderCell(cell));
    if (!key) {
      if (cell !== "") extras.push(cell);
      return;
    }
    if (index[key] !== undefined) duplicates.push(cell);
    else index[key] = i;
  });
  const missing = COLUMN_RULES.filter((r) => r.required && index[r.key] === undefined).map((r) => r.label);
  const hasParts = index.loan !== undefined && index.inputs !== undefined && index.advance !== undefined;
  const hasColumn = index.deductions !== undefined;
  if (!hasParts && !hasColumn) missing.push("Deductions (or LoanKES, InputsKES and AdvanceKES)");
  if (cells.every((c) => c === "")) return { ok: false, message: "The file is empty.", missing, duplicates };
  if (missing.length || duplicates.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
    if (duplicates.length) parts.push(`column${duplicates.length === 1 ? "" : "s"} named twice: ${duplicates.join(", ")}`);
    return { ok: false, message: `This isn't a KTDA payment file (${parts.join("; ")}). The first line must name the columns: ${REQUIRED_LABELS.join(", ")}.`, missing, duplicates };
  }
  return { ok: true, map: { index, columns: cells, extras, deductions: hasParts && hasColumn ? "both" : hasColumn ? "column" : "parts" } };
}

/** One data line, typed. Money is integer cents; `amount` may be negative (the checks then hold it, E09). */
export type ParsedLine = {
  lineNo: number;
  grower: string;
  name: string;
  walletId: string;
  phone: string;
  idNo: string;
  factoryCode: string;
  factoryName: string;
  centre: string;
  kg: number;
  rate: number;
  gross: number;
  loan: number;
  inputs: number;
  advance: number;
  deductions: number;
  amount: number;
  payTo: string;
};

export type ParseError = { physicalLine: number; lineNo: number | null; column: string | null; message: string };
export type ParseResult = { ok: true; line: ParsedLine } | { ok: false; error: ParseError };

const INT = /^(0|[1-9]\d{0,14})$/;

function cell(cells: string[], i: number | undefined): string {
  return i === undefined ? "" : (cells[i] ?? "").trim();
}

/** Parses one data line against the header map. Type errors say which column and which physical line. */
export function parseLine(raw: string, physicalLine: number, map: HeaderMap): ParseResult {
  const cells = splitCsv(raw.replace(/\r$/, ""));
  const fail = (column: string | null, message: string, lineNo: number | null = null): ParseResult => ({ ok: false, error: { physicalLine, lineNo, column, message } });
  if (cells.length !== map.columns.length) return fail(null, `${cells.length} columns, expected ${map.columns.length}`);
  const ix = map.index;
  const text = (key: ColumnKey): string | null => {
    const v = cell(cells, ix[key]);
    const rule = RULE_BY_KEY[key];
    return rule.maxLength !== undefined && v.length > rule.maxLength ? null : v;
  };
  const lineNoRaw = cell(cells, ix.lineNo);
  if (!INT.test(lineNoRaw) || Number(lineNoRaw) <= 0) return fail("LineNo", "LineNo isn't a whole number above zero");
  const lineNo = Number(lineNoRaw);
  const money = (key: ColumnKey, label: string): number | ParseResult => {
    const v = cell(cells, ix[key]);
    if (ix[key] === undefined) return 0;
    const c = parseKes(v);
    return c === null ? fail(label, `${label} "${v}" isn't a KES amount (digits with up to two decimals)`, lineNo) : c;
  };
  for (const key of ["grower", "name", "walletId", "phone", "idNo", "factory", "factoryName", "centre"] as const) {
    if (text(key) === null) return fail(RULE_BY_KEY[key].label, `${RULE_BY_KEY[key].label} is longer than ${RULE_BY_KEY[key].maxLength} characters`, lineNo);
  }
  const kgRaw = cell(cells, ix.kg);
  if (!INT.test(kgRaw)) return fail("Kg", `Kg "${kgRaw}" isn't a whole number`, lineNo);
  const rate = money("rate", "Rate");
  if (typeof rate !== "number") return rate;
  const gross = money("gross", "Gross");
  if (typeof gross !== "number") return gross;
  const loan = money("loan", "LoanKES");
  if (typeof loan !== "number") return loan;
  const inputs = money("inputs", "InputsKES");
  if (typeof inputs !== "number") return inputs;
  const advance = money("advance", "AdvanceKES");
  if (typeof advance !== "number") return advance;
  const dedCol = money("deductions", "Deductions");
  if (typeof dedCol !== "number") return dedCol;
  const parts = loan + inputs + advance;
  if (map.deductions === "both" && dedCol !== parts) return fail("Deductions", `Deductions ${formatKes(dedCol)} isn't LoanKES + InputsKES + AdvanceKES (${formatKes(parts)})`, lineNo);
  const deductions = map.deductions === "parts" ? parts : dedCol;
  const amountRaw = cell(cells, ix.amount);
  const neg = amountRaw.startsWith("-");
  const amountAbs = parseKes(neg ? amountRaw.slice(1) : amountRaw);
  if (amountAbs === null) return fail("Amount", `Amount "${amountRaw}" isn't a KES amount`, lineNo);
  const payTo = cell(cells, ix.payTo).toUpperCase();
  if (payTo !== "WALLET" && payTo !== "BANK" && payTo !== "SACCO") return fail("PayTo", `PayTo "${cell(cells, ix.payTo)}" must be WALLET, BANK or SACCO`, lineNo);
  return {
    ok: true,
    line: {
      lineNo,
      grower: text("grower")!.toUpperCase(),
      name: text("name")!,
      walletId: text("walletId")!.toUpperCase(),
      phone: text("phone")!,
      idNo: text("idNo")!,
      factoryCode: text("factory")!.toUpperCase(),
      factoryName: text("factoryName")!,
      centre: text("centre")!,
      kg: Number(kgRaw),
      rate,
      gross,
      loan: map.deductions === "column" ? deductions : loan,
      inputs: map.deductions === "column" ? 0 : inputs,
      advance: map.deductions === "column" ? 0 : advance,
      deductions,
      amount: neg ? -amountAbs : amountAbs,
      payTo,
    },
  };
}

/**
 * The canonical 16-column record (bulk-file.ts COLUMNS order) for a parsed line, so the service's own checkLine can
 * judge it unchanged. A file with one Deductions column carries it in LoanKES; the arithmetic check is the same.
 */
export function toCanonicalCsv(l: ParsedLine): string {
  const row: (string | number)[] = [l.lineNo, l.grower, l.name, l.walletId, l.phone, l.factoryCode, l.factoryName, l.centre, l.kg, formatKes(l.rate), formatKes(l.gross), formatKes(l.loan), formatKes(l.inputs), formatKes(l.advance), formatKes(l.amount), l.payTo];
  if (row.length !== COLUMNS.length) throw new Error("canonical record width drifted from bulk-file COLUMNS");
  return row.map(csvCell).join(",");
}

/** A parse error as a held line (E01), so it counts and reports like every other exception. */
export function parseErrorLine(e: ParseError, raw: string): CheckedLine {
  const cols = splitCsv(raw.replace(/\r$/, ""));
  return {
    lineNo: e.lineNo ?? e.physicalLine,
    grower: (cols[1] ?? "").trim().slice(0, 20),
    name: (cols[2] ?? "").trim().slice(0, 80),
    walletId: (cols[3] ?? "").trim().slice(0, 20),
    phone: "",
    factoryCode: "",
    kg: 0,
    gross: 0,
    loan: 0,
    inputs: 0,
    advance: 0,
    amount: 0,
    payTo: "WALLET",
    check: "error",
    code: "E01_MALFORMED",
    reason: `${CHECK_TEXT.E01_MALFORMED}: ${e.column ? `${e.column}: ` : ""}${e.message}`,
  };
}

/** Parse, then run the service's line checks. `seen` is the per-file duplicate map, as for checkLine. */
export function checkRaw(raw: string, physicalLine: number, map: HeaderMap, lookup: RegisterLookup, seen: Map<string, number>): { checked: CheckedLine; parsed: ParsedLine | null } {
  const p = parseLine(raw, physicalLine, map);
  if (!p.ok) return { checked: parseErrorLine(p.error, raw), parsed: null };
  const checked = checkLine(toCanonicalCsv(p.line), physicalLine, lookup, seen);
  return { checked, parsed: p.line };
}

/** One line as uploaded to the ledger-api (POST /api/runs/{id}/lines). Money in cents; the server re-checks it. */
export type UploadLine = {
  lineNo: number;
  grower: string;
  name: string;
  walletId: string;
  phone: string;
  idNo: string;
  factoryCode: string;
  centre: string;
  kg: number;
  rateCents: number;
  grossCents: number;
  deductionsCents: number;
  amountCents: number;
  payTo: string;
  check: CheckedLine["check"];
  code: CheckedLine["code"];
  reason: string;
};

export function toUploadLine(checked: CheckedLine, parsed: ParsedLine | null): UploadLine {
  return {
    lineNo: checked.lineNo,
    grower: checked.grower,
    name: checked.name,
    walletId: checked.walletId,
    phone: parsed?.phone ?? "",
    idNo: parsed?.idNo ?? "",
    factoryCode: checked.factoryCode,
    centre: parsed?.centre ?? "",
    kg: checked.kg,
    rateCents: parsed?.rate ?? 0,
    grossCents: checked.gross,
    deductionsCents: checked.loan + checked.inputs + checked.advance,
    amountCents: checked.amount,
    payTo: checked.payTo,
    check: checked.check,
    code: checked.code,
    reason: checked.reason,
  };
}

/**
 * Splits streamed text into lines without holding the file: feed() returns the complete lines in a chunk and keeps
 * the tail; end() returns what's left. Handles CRLF and a leading BOM; a quoted field can't span lines (by design,
 * so one bad quote can't swallow the rest of the file).
 */
export class LineSplitter {
  private rest = "";
  private first = true;

  feed(chunk: string): string[] {
    let text = this.rest + chunk;
    if (this.first) {
      text = text.replace(/^﻿/, "");
      this.first = false;
    }
    const parts = text.split("\n");
    this.rest = parts.pop() ?? "";
    if (this.rest.length > MAX_LINE_CHARS) throw new Error(`A line is longer than ${MAX_LINE_CHARS.toLocaleString("en-KE")} characters. This isn't a CSV payment file.`);
    return parts.map((p) => (p.endsWith("\r") ? p.slice(0, -1) : p));
  }

  end(): string | null {
    const r = this.rest;
    this.rest = "";
    if (r === "") return null;
    return r.endsWith("\r") ? r.slice(0, -1) : r;
  }
}

/** Hex digest helper shared by the worker and the proof script. */
export const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
