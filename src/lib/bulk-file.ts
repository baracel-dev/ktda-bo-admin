/* COPIED VERBATIM from baracel/ktda apps/backoffice-web/src/lib/bulk-file.ts (KTDA back office), so this
 * back office checks a SAP payment file by exactly the same rules. Do not edit here: change it there and copy
 * it again (everything below this comment is byte-identical to the source). */
/**
 * KTDA bulk payment file: format, parsing and line checks.
 *
 * SOURCE OF TRUTH. This file is copied verbatim into apps/backoffice-web/src/lib/bulk-file.ts so the browser and the
 * service apply exactly the same rules. Edit it here, then run `npm run check:sync -- --write` in apps/bulk-service.
 * It must stay pure: no imports, no I/O, no floating-point money.
 */

/** The columns, in order. KTDA asked for GNo, Name, WalletID and Amount; the rest is what SAP exports with them. */
export const COLUMNS = [
  "LineNo",
  "GNo",
  "Name",
  "WalletID",
  "PhoneNo",
  "FactoryCode",
  "FactoryName",
  "BuyingCentre",
  "KgDelivered",
  "RateKES",
  "GrossKES",
  "LoanKES",
  "InputsKES",
  "AdvanceKES",
  "Amount",
  "PayTo",
] as const;

export const HEADER = COLUMNS.join(",");

export type PayTo = "WALLET" | "BANK" | "SACCO";
export type LineCheck = "ok" | "warning" | "error";

export type CheckCode =
  | "OK"
  | "E01_MALFORMED"
  | "E02_UNKNOWN_GROWER"
  | "E03_DUPLICATE"
  | "E04_WALLET_CHECK_DIGIT"
  | "E05_WALLET_MISMATCH"
  | "E06_WALLET_SUSPENDED"
  | "E07_FACTORY_MISMATCH"
  | "E08_AMOUNT_ARITHMETIC"
  | "E09_AMOUNT_NOT_POSITIVE"
  | "W01_NAME_DIFFERS";

/** Plain-language reasons shown to finance staff and written to the exception report. */
export const CHECK_TEXT: Record<CheckCode, string> = {
  OK: "",
  E01_MALFORMED: "Line can't be read",
  E02_UNKNOWN_GROWER: "Grower number not in the farmer register",
  E03_DUPLICATE: "Grower already appears earlier in this file",
  E04_WALLET_CHECK_DIGIT: "Wallet ID fails its check digit (likely a typo)",
  E05_WALLET_MISMATCH: "Wallet ID belongs to a different grower",
  E06_WALLET_SUSPENDED: "Wallet is suspended",
  E07_FACTORY_MISMATCH: "Factory code doesn't match the grower number",
  E08_AMOUNT_ARITHMETIC: "Amount isn't gross pay minus deductions",
  E09_AMOUNT_NOT_POSITIVE: "Amount must be more than zero",
  W01_NAME_DIFFERS: "Name differs from the farmer register",
};

/** What the register knows about a grower. The browser reads it from demo data, the service from Postgres. */
export type RegisterEntry = { name: string; walletId: string; status: "active" | "suspended" | "dormant"; factoryCode: string };
export type RegisterLookup = (grower: string) => RegisterEntry | null | undefined;

export type CheckedLine = {
  lineNo: number;
  grower: string;
  name: string;
  walletId: string;
  phone: string;
  factoryCode: string;
  kg: number;
  /** Money is integer cents. */
  gross: number;
  loan: number;
  inputs: number;
  advance: number;
  amount: number;
  payTo: PayTo;
  check: LineCheck;
  code: CheckCode;
  reason: string;
};

const KES = /^(0|[1-9]\d{0,10})(\.\d{1,2})?$/;

/** "1234.5" -> 123450 cents, exactly. Returns null for anything that isn't a plain non-negative KES amount. */
export function parseKes(s: string): number | null {
  const t = s.trim();
  const m = KES.exec(t);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2].slice(1).padEnd(2, "0")) : 0;
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 123450 cents -> "1234.50". */
export function formatKes(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Luhn check digit over a string of digits. */
export function luhnDigit(digits: string): number {
  let sum = 0;
  for (let k = 0; k < digits.length; k++) {
    let d = digits.charCodeAt(digits.length - 1 - k) - 48;
    if (k % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

const WALLET = /^KTW(\d{8})(\d)$/;
export const walletCheckOk = (w: string) => {
  const m = WALLET.exec(w);
  return !!m && luhnDigit(m[1]) === Number(m[2]);
};

const GROWER = /^([A-Z]{2})-(\d{6})$/;

/** Splits one CSV record. Supports quoted fields with doubled quotes; a name may contain a comma. */
export function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (q) {
      if (c === '"') {
        if (line[k + 1] === '"') {
          cur += '"';
          k++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Quotes a value for CSV output only when it needs it. */
export const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function headerOk(line: string): boolean {
  return splitCsv(line.replace(/^﻿/, "").trim()).map((c) => c.trim().toLowerCase()).join(",") === HEADER.toLowerCase();
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function malformed(lineNo: number, cols: string[], detail: string): CheckedLine {
  return {
    lineNo,
    grower: (cols[1] ?? "").trim().slice(0, 20),
    name: (cols[2] ?? "").trim().slice(0, 80),
    walletId: (cols[3] ?? "").trim().slice(0, 20),
    phone: "",
    factoryCode: (cols[5] ?? "").trim().slice(0, 4),
    kg: 0,
    gross: 0,
    loan: 0,
    inputs: 0,
    advance: 0,
    amount: 0,
    payTo: "WALLET",
    check: "error",
    code: "E01_MALFORMED",
    reason: `${CHECK_TEXT.E01_MALFORMED}: ${detail}`,
  };
}

/**
 * Checks one data line. `seen` maps grower -> first line number and is updated by this call, so pass the same map for
 * the whole file. The first failing rule wins, in the order finance staff would fix them.
 */
export function checkLine(raw: string, physicalLine: number, lookup: RegisterLookup, seen: Map<string, number>): CheckedLine {
  const cols = splitCsv(raw);
  if (cols.length !== COLUMNS.length) return malformed(physicalLine, cols, `${cols.length} columns, expected ${COLUMNS.length}`);
  const lineNo = Number(cols[0]);
  if (!Number.isSafeInteger(lineNo) || lineNo <= 0) return malformed(physicalLine, cols, "LineNo isn't a whole number");
  const grower = cols[1].trim().toUpperCase();
  const name = cols[2].trim();
  const walletId = cols[3].trim().toUpperCase();
  const phone = cols[4].trim();
  const factoryCode = cols[5].trim().toUpperCase();
  const kg = Number(cols[8]);
  const gross = parseKes(cols[10]);
  const loan = parseKes(cols[11]);
  const inputs = parseKes(cols[12]);
  const advance = parseKes(cols[13]);
  const amountRaw = cols[14].trim();
  const amountNeg = /^-\d/.test(amountRaw);
  const amount = amountNeg ? -(parseKes(amountRaw.slice(1)) ?? 0) : parseKes(amountRaw);
  const payTo = cols[15].trim().toUpperCase() as PayTo;
  if (!GROWER.test(grower)) return malformed(lineNo, cols, "GNo isn't in the form AA-000000");
  if (!Number.isSafeInteger(kg) || kg < 0) return malformed(lineNo, cols, "KgDelivered isn't a whole number");
  if (gross === null || loan === null || inputs === null || advance === null || amount === null) return malformed(lineNo, cols, "an amount isn't a valid KES value");
  if (payTo !== "WALLET" && payTo !== "BANK" && payTo !== "SACCO") return malformed(lineNo, cols, "PayTo must be WALLET, BANK or SACCO");

  const base = { lineNo, grower, name, walletId, phone, factoryCode, kg, gross, loan, inputs, advance, amount, payTo };
  const fail = (code: CheckCode, extra = ""): CheckedLine => ({ ...base, check: "error", code, reason: CHECK_TEXT[code] + extra });

  const first = seen.get(grower);
  if (first !== undefined) return fail("E03_DUPLICATE", ` (line ${first})`);
  seen.set(grower, lineNo);

  if (amount <= 0) return fail("E09_AMOUNT_NOT_POSITIVE");
  if (gross - loan - inputs - advance !== amount) return fail("E08_AMOUNT_ARITHMETIC");
  if (grower.slice(0, 2) !== factoryCode) return fail("E07_FACTORY_MISMATCH");
  const reg = lookup(grower);
  if (!reg) return fail("E02_UNKNOWN_GROWER");
  if (!walletCheckOk(walletId)) return fail("E04_WALLET_CHECK_DIGIT");
  if (reg.walletId !== walletId) return fail("E05_WALLET_MISMATCH");
  if (reg.status === "suspended") return fail("E06_WALLET_SUSPENDED");
  if (normName(reg.name) !== normName(name)) return { ...base, check: "warning", code: "W01_NAME_DIFFERS", reason: `${CHECK_TEXT.W01_NAME_DIFFERS} (register: ${reg.name})` };
  return { ...base, check: "ok", code: "OK", reason: "" };
}

export type FactorySummary = { factoryCode: string; lines: number; kg: number; gross: number; deductions: number; net: number; errors: number; warnings: number; heldNet: number };
export type FileSummary = Omit<FactorySummary, "factoryCode"> & { factories: FactorySummary[]; byCode: Partial<Record<CheckCode, number>> };

/** Running totals while a file streams through. Held = error lines, which are never paid. */
export class Summary {
  private f = new Map<string, FactorySummary>();
  private codes: Partial<Record<CheckCode, number>> = {};

  add(l: CheckedLine) {
    const key = l.factoryCode || "??";
    let t = this.f.get(key);
    if (!t) {
      t = { factoryCode: key, lines: 0, kg: 0, gross: 0, deductions: 0, net: 0, errors: 0, warnings: 0, heldNet: 0 };
      this.f.set(key, t);
    }
    t.lines++;
    t.kg += l.kg;
    t.gross += l.gross;
    t.deductions += l.loan + l.inputs + l.advance;
    t.net += l.amount;
    if (l.check === "error") {
      t.errors++;
      t.heldNet += l.amount;
    } else if (l.check === "warning") t.warnings++;
    this.codes[l.code] = (this.codes[l.code] ?? 0) + 1;
  }

  result(): FileSummary {
    const factories = [...this.f.values()].sort((a, b) => a.factoryCode.localeCompare(b.factoryCode));
    const sum = factories.reduce(
      (a, t) => ({ lines: a.lines + t.lines, kg: a.kg + t.kg, gross: a.gross + t.gross, deductions: a.deductions + t.deductions, net: a.net + t.net, errors: a.errors + t.errors, warnings: a.warnings + t.warnings, heldNet: a.heldNet + t.heldNet }),
      { lines: 0, kg: 0, gross: 0, deductions: 0, net: 0, errors: 0, warnings: 0, heldNet: 0 },
    );
    return { ...sum, factories, byCode: { ...this.codes } };
  }
}

/** The control sheet SAP sends with the file. The import is compared against it line count, total and checksum. */
export type ControlSheet = { file: string; rows: number; totalAmountKES: string; sha256: string; paymentType?: string; period?: string };

export type ControlCheck = { rows: boolean; total: boolean; sha256: boolean };

export function compareControl(c: ControlSheet, actual: { rows: number; totalCents: number; sha256: string }): ControlCheck {
  return { rows: c.rows === actual.rows, total: parseKes(c.totalAmountKES) === actual.totalCents, sha256: c.sha256.toLowerCase() === actual.sha256.toLowerCase() };
}
