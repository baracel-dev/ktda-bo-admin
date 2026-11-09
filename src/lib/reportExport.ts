/* Report exports, made in the browser from the rows on screen (REQ 5.8, 6.8:
   the data is KTDA's, exports carry no vendor lock-in): CSV, a real Excel
   workbook (.xlsx: one sheet, written here without a library), and dates in
   Africa/Nairobi. PDF is the browser's print, with the print stylesheet in
   index.css showing only the report. */

export type Cell = string | number | null | undefined;
export type Column = { key: string; header: string; numeric?: boolean };
export type Row = Record<string, Cell>;

const TZ = "Africa/Nairobi";

/** "08 Nov 2026" in Nairobi. */
export const nairobiDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "";
/** "08 Nov 2026, 14:05" in Nairobi. */
export const nairobiDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "";
/** "2026-11" in Nairobi: the month a moment falls in there. */
export function nairobiMonth(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

const cellText = (v: Cell) => (v === null || v === undefined ? "" : String(v));

/** RFC 4180, with a byte-order mark so Excel reads it as UTF-8. */
export function toCsv(columns: Column[], rows: Row[]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [columns.map((c) => q(c.header)).join(","), ...rows.map((r) => columns.map((c) => q(cellText(r[c.key]))).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/* ---- XLSX: a zip (stored, not deflated) of five small XML parts ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Characters XML 1.0 does not allow.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** What every export says it is: "Institution", "KTDA Holdings", ... */
export type ExportHeader = [label: string, value: string][];

/** A one-sheet workbook: the `header` lines first (label bold), a blank row,
 *  then the table with its header row bold, numbers as numbers. */
export function toXlsx(sheetName: string, columns: Column[], rows: Row[], header: ExportHeader = []): Uint8Array {
  const enc = new TextEncoder();
  const cell = (ref: string, v: Cell, style = 0) => {
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
    const t = cellText(v);
    return t ? `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xml(t)}</t></is></c>` : "";
  };
  // The header lines, then a blank row, then the table.
  const top = header.length ? header.length + 1 : 0;
  const at = top + 1;
  const sheetRows = [
    ...header.map(([k, v], i) => `<row r="${i + 1}">${cell(`A${i + 1}`, k, 1)}${cell(`B${i + 1}`, v)}</row>`),
    `<row r="${at}">${columns.map((c, i) => cell(`${colName(i)}${at}`, c.header, 1)).join("")}</row>`,
    ...rows.map((r, ri) => `<row r="${at + ri + 1}">${columns.map((c, i) => cell(`${colName(i)}${at + ri + 1}`, r[c.key])).join("")}</row>`),
  ].join("");
  const name = xml(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31)) || "Report";
  const parts: Record<string, string> = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return zip(Object.entries(parts).map(([n, s]) => ({ name: n, data: enc.encode(s) })));
}

/** Hand the browser a file to save. */
export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "payment-runs-2026-11-08" */
export const fileStem = (slug: string, at = new Date()) => `${slug}-${nairobiMonth(at.toISOString())}-${new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "2-digit" }).format(at)}`;
