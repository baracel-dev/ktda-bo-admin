/* The page's rules and helpers for bulk payment runs, kept apart from the
   components so each can be tested and reused on its own. */
import type { BulkRun } from "../../../lib/api.bulkLoad";
import { formatKes } from "../../../lib/bulk-file";
import { PERIOD, checkControl, controlOk, type ControlResult } from "../../../lib/sapPaymentFile";
import type { ControlState, SapCheckState } from "./useSapCheck";

/** Integer cents as "KES 1,234,567.89", without going through a float. */
export function kesCents(cents: number): string {
  const [whole, frac] = formatKes(cents).replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "−" : ""}KES ${grouped}.${frac}`;
}

/** Saves text as a file in the browser (an exception report, say). */
export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  saveBlob(name, new Blob([text], { type }));
}

/** Saves a file a service answered with. */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file's name without its extension, for a report named after it. */
export const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

/** The control sheet against the checked file, once both are in. */
export function controlFor(check: SapCheckState, control: ControlState): ControlResult | null {
  if (check.kind !== "done" || control.kind !== "ok") return null;
  return checkControl(control.sheet, check.file.name, check.done.result, check.done.sha256);
}

/** Why the file may not be sent yet, or null when it may. */
export function sapBlocker(check: SapCheckState, control: ControlState, period: string): string | null {
  if (check.kind === "checking") return "The file is still being checked.";
  if (check.kind === "error") return "The file could not be checked, so it cannot be sent.";
  if (check.kind !== "done") return "Choose the file first.";
  if (check.done.result.expectedCount <= 0) return "No line of this file is paid to a wallet (every line is held, or paid by bank or SACCO), so there is nothing for this run to pay.";
  if (!PERIOD.test(period)) return "Pick the pay period this file is for.";
  if (control.kind === "reading") return "The control sheet is still being read.";
  if (control.kind === "error") return "The control sheet could not be read. Remove it or pick the right one.";
  const c = controlFor(check, control);
  if (c && !controlOk(c)) return "The file does not match its control sheet, so it is not the file SAP sent. Get the right file or control sheet.";
  return null;
}

/** Why a file is too big to send through this site, or null. */
export function sizeBlocker(file: File | null, limitMb: number): string | null {
  if (!file || file.size <= limitMb * 1024 * 1024) return null;
  return `The file is ${(file.size / 1024 / 1024).toFixed(0)} MB; this site takes ${limitMb} MB at most. Split it by factory and send each part.`;
}

/* ---- Maker-checker ---- */

/** Subjects every caller shares when a proxy cannot name the operator. */
export const SHARED_SUBJECTS = new Set(["ktda-operator", "dev-operator"]);

/** Why `me` may not release this run, or null when they may. */
export function releaseBlocker(run: BulkRun, me: string | null): string | null {
  if (run.status !== "SUBMITTED") return null;
  if (!me) return "Sign in to release this run.";
  if (run.submittedBy && run.submittedBy === me) return "You submitted this run. A different operator must sign in and release it.";
  return null;
}
