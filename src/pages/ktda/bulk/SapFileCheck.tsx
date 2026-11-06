import { Download, FileCheck2, RotateCcw } from "lucide-react";
import { Badge, Button, Field, NotePanel, ProgressBar, Skeleton, StatCard } from "../../../ui";
import { units } from "../../../lib/tokenConsole/format";
import { CHECK_TEXT, PERIOD, REGISTER_CODES, controlOk, periodFromName, type CheckCode } from "../../../lib/sapPaymentFile";
import type { SapCheckState, ControlState } from "./useSapCheck";
import { Check, MiniTable } from "./shared";
import { baseName, controlFor, downloadText, kesCents } from "./rules";

/* What the browser found in a SAP payment file before anything is sent: the
   lines and net, what the checks hold and why (by rule code), what the run
   should credit, the exception report, and the file against its control
   sheet. The rules are the KTDA back office's (lib/file-rules.ts). */

const ORDER: CheckCode[] = ["OK", "E01_MALFORMED", "E03_DUPLICATE", "E04_WALLET_CHECK_DIGIT", "E07_FACTORY_MISMATCH", "E08_AMOUNT_ARITHMETIC", "E09_AMOUNT_NOT_POSITIVE", "E02_UNKNOWN_GROWER", "E05_WALLET_MISMATCH", "E06_WALLET_SUSPENDED", "W01_NAME_DIFFERS"];

export function SapFileCheck({ check, control, onRetry, onControl, disabled, period, onPeriod }: {
  check: SapCheckState;
  control: ControlState;
  onRetry: () => void;
  onControl: (f: File | null) => void;
  disabled: boolean;
  /** The pay period sent with the file (YYYY-MM); prefilled from the file name. */
  period: string;
  onPeriod: (p: string) => void;
}) {
  if (check.kind === "idle") return null;
  if (check.kind === "checking") {
    const p = check.progress;
    const pct = p && p.total > 0 && p.stage === "checking" ? Math.min(100, (p.bytes / p.total) * 100) : 0;
    return (
      <div data-testid="sap-checking" aria-live="polite">
        <div className="mb-1.5 flex justify-between text-[12.5px] text-text-soft">
          <span>{!p || p.stage === "hashing" ? "Taking the file's checksum…" : `Checking lines: ${units(p.lines)} so far`}</span>
          <span className="tabular">{Math.floor(pct)}%</span>
        </div>
        <ProgressBar value={pct} />
        <Skeleton className="mt-3 h-24" />
      </div>
    );
  }
  if (check.kind === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-danger" data-testid="sap-check-error">
        <span>{check.message}</span>
        <Button size="sm" variant="outline" onClick={onRetry}><RotateCcw size={13} /> Check again</Button>
      </div>
    );
  }

  const { result, sha256, ms } = check.done;
  const s = result.summary;
  const rate = ms > 0 ? Math.round(result.lines / (ms / 1000)) : null;
  const codes = ORDER.filter((c) => (s.byCode[c] ?? 0) > 0);
  const c = controlFor(check, control);
  const name = check.file.name;

  return (
    <div className="space-y-4" data-testid="sap-check">
      <p className="text-[12.5px] text-text-soft">
        <span className="font-medium text-text">{name}</span>: KTDA SAP export, {units(result.lines)} line{result.lines === 1 ? "" : "s"} across {units(s.factories.length)} factor{s.factories.length === 1 ? "y" : "ies"}.
        {" "}Checked in your browser in <span className="tabular" data-testid="sap-check-time">{ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}</span>{rate ? <> ({units(rate)} lines/s)</> : null}; nothing has been sent yet.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net in the file" value={<span className="tabular" data-testid="sap-net">{kesCents(s.net)}</span>} hint={`${units(result.lines)} lines`} />
        <StatCard label="To wallets" value={<span className="tabular" data-testid="sap-expected">{kesCents(result.expectedCents)}</span>} hint={<span data-testid="sap-expected-count">{units(result.expectedCount)} lines: what this run credits</span>} tooltip="PayTo WALLET lines that pass every check. The reconciliation checks the run against this total." />
        <StatCard label="Bank or SACCO" value={<span className="tabular" data-testid="sap-routed">{units(result.routedCount)}</span>} hint={`${kesCents(result.routedCents)}, not paid to wallets by this run`} />
        <StatCard label="Held by these checks" value={<span className="tabular" data-testid="sap-held">{units(result.heldCount)}</span>} hint={`${kesCents(result.heldCents)}, never paid`} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-2">
        <MiniTable testId="sap-by-code" caption="Lines by rule" head={[{ label: "Rule" }, { label: "What it means" }, { label: "Lines", right: true }]}>
          {codes.map((code) => (
            <tr key={code} className="border-t border-border/60" data-code={code}>
              <td className="whitespace-nowrap px-3 py-2"><Badge tone={code === "OK" ? "success" : code.startsWith("W") ? "warning" : "danger"}>{code === "OK" ? "OK" : code.slice(0, 3)}</Badge></td>
              <td className="px-3 py-2 text-text-soft">{code === "OK" ? "Passes every check made here" : CHECK_TEXT[code]}</td>
              <td className="px-3 py-2 text-right tabular">{units(s.byCode[code] ?? 0)}</td>
            </tr>
          ))}
        </MiniTable>
        <p className="text-[12px] text-text-faint">
          Not checked here: {REGISTER_CODES.map((code) => CHECK_TEXT[code].toLowerCase()).join("; ")}. Those need the farmer register: omnichannel checks what it can against its register at upload and says on the run which checks it could not make, and the ledger refuses a grower with no wallet (shown after the run as refused).
        </p>
        </div>
        <div className="space-y-4">
        <div className="rounded-[var(--radius-lg)] border border-border p-4" data-testid="pay-period">
          <Field label="Pay period">
            <input
              type="month"
              aria-label="Pay period"
              value={period}
              disabled={disabled}
              onChange={(e) => onPeriod(e.target.value)}
              className="h-10 w-48 rounded-md border border-border bg-surface px-3 text-sm text-text disabled:opacity-50"
            />
          </Field>
          <p className="mt-2 text-[12.5px] text-text-soft">
            {periodFromName(name) === period && period
              ? `Read from the file name. It makes each line's payment reference (KTDA:${period}:line:grower), so the same line of a period is never paid twice.`
              : PERIOD.test(period)
                ? "Sent with the file. It makes each line's payment reference, so the same line of a period is never paid twice."
                : "The file name carries no period: pick the month this file pays for."}
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border p-4" data-testid="control-sheet">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text"><FileCheck2 size={15} /> Control sheet <span className="text-[12px] font-normal text-text-faint">(optional)</span></div>
          <Field label="Control sheet (.control.json)">
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Control sheet"
              disabled={disabled}
              onChange={(e) => onControl(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-text-soft file:mr-3 file:h-9 file:rounded-md file:border file:border-border file:bg-surface-sunken file:px-3 file:text-sm file:text-text disabled:opacity-50"
            />
          </Field>
          {control.kind === "none" && <p className="mt-2 text-[12.5px] text-text-soft">SAP sends one with each file. Add it to check the line count, total and checksum before sending.</p>}
          {control.kind === "reading" && <Skeleton className="mt-2 h-8" />}
          {control.kind === "error" && <p role="alert" className="mt-2 text-[12.5px] text-danger">{control.name}: {control.message}</p>}
          {c && (
            <div className="mt-3 space-y-2" data-testid="control-result">
              <div className="flex flex-wrap gap-2">
                <Check ok={c.check.rows} yes={`Lines match (${units(c.sheet.rows)})`} no={`Lines: sheet ${units(c.sheet.rows)}, file ${units(result.lines)}`} />
                <Check ok={c.check.total} yes="Total matches" no={`Total: sheet KES ${c.sheet.totalAmountKES}, file ${kesCents(s.net)}`} />
                {c.shaChecked ? <Check ok={c.check.sha256} yes="Checksum matches" no="Checksum differs" /> : <Badge tone="neutral">Checksum not checked on this page</Badge>}
              </div>
              {!c.sameName && <p className="text-[12.5px] text-warning">The sheet is for {c.sheet.file}, not {name}.</p>}
              {controlOk(c) ? (
                <p className="text-[12.5px] text-success">This is the file SAP sent{c.sheet.period ? ` for ${c.sheet.period}` : ""}.</p>
              ) : (
                <NotePanel tone="danger" title="Does not match the control sheet">The file cannot be sent until it matches. Get the right file or control sheet from SAP.</NotePanel>
              )}
            </div>
          )}
          {sha256 && <p className="mt-2 break-all font-mono text-[11px] text-text-faint">SHA-256 {sha256}</p>}
        </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {result.exceptionsTotal > 0 ? (
          <Button size="sm" variant="outline" onClick={() => downloadText(`${baseName(name)}.exceptions.csv`, result.exceptionsCsv)}>
            <Download size={13} /> Exception report, held and bank/SACCO ({units(result.exceptionsTotal)} line{result.exceptionsTotal === 1 ? "" : "s"})
          </Button>
        ) : (
          <span className="text-[12.5px] text-success" data-testid="sap-no-exceptions">Every line passes and is paid to a wallet.</span>
        )}
        {result.exceptionsTruncated && <span className="text-[12px] text-warning">The report lists the first {units(result.exceptionsCsv.split("\n").length - 2)} lines only.</span>}
      </div>

      {result.preview.length > 0 && (
        <MiniTable testId="sap-exceptions" caption="Held lines, and lines paid by bank or SACCO" head={[{ label: "Line" }, { label: "Grower" }, { label: "Name" }, { label: "Reason" }, { label: "Net", right: true }]}>
          {result.preview.slice(0, 10).map((l) => (
            <tr key={l.lineNo} className="border-t border-border/60">
              <td className="px-3 py-2 tabular text-text-soft">{l.lineNo}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{l.grower || "—"}</td>
              <td className="px-3 py-2">{l.name || "—"}</td>
              <td className={`px-3 py-2 ${l.check === "error" ? "text-danger" : "text-text-soft"}`}>{l.check === "error" ? l.reason : `Paid by ${l.payTo}: not paid to wallets by this run`}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular">{kesCents(l.amount)}</td>
            </tr>
          ))}
        </MiniTable>
      )}
      {result.preview.length > 10 && <p className="text-[12px] text-text-faint">Showing 10 of {units(result.exceptionsTotal)}; the exception report has them all.</p>}

    </div>
  );
}
