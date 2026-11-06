import { Download } from "lucide-react";
import { Badge, Button } from "../../../ui";
import { money, units } from "../../../lib/tokenConsole/format";
import { useAction } from "../../../lib/tokenConsole/useAction";
import { CHECK_TEXT, type CheckCode } from "../../../lib/bulk-file";
import { bulkLoads, heldCodesOf, type BulkReconciliation, type BulkRun } from "../../../lib/api.bulkLoad";
import { MiniTable } from "./shared";
import { saveBlob } from "./rules";

/* What omnichannel's checks did with a SAP pay file at upload: lines sent to
   the wallets, lines paid by bank or SACCO (not paid to wallets by this run),
   and lines held by a rule, per rule. Every held or routed line, with its
   reason, is in omnichannel's exception report, downloaded from it here.
   Shown only for a run omnichannel read as a SAP file. */

type Checks = Pick<BulkRun, "payableCount" | "payableAmount" | "routedCount" | "routedAmount" | "heldCount" | "heldAmount" | "heldCodes" | "fileFormat" | "warningCount" | "checksNotRun">;

export function RunChecks({ runId, checks, currency }: { runId: string; checks: Checks | BulkReconciliation; currency: string }) {
  const report = useAction(async () => {
    const { filename, blob } = await bulkLoads.exceptions(runId);
    saveBlob(filename, blob);
  });
  if (checks.fileFormat !== "SAP") return null;
  const codes = heldCodesOf(checks.heldCodes);
  const some = (checks.heldCount ?? 0) + (checks.routedCount ?? 0) > 0;
  return (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-border p-4" data-testid="run-checks">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Omnichannel&apos;s check of the file</h3>
        {some && (
          <Button size="sm" variant="outline" disabled={report.pending} onClick={() => void report.run()}>
            <Download size={13} /> {report.pending ? "Downloading…" : "Exception report"}
          </Button>
        )}
      </div>
      <MiniTable testId="run-checks-table" caption="Where the file's lines go" head={[{ label: "Lines" }, { label: "What happens" }, { label: "Count", right: true }, { label: "Net", right: true }]}>
        <tr className="border-t border-border/60" data-row="payable">
          <td className="px-3 py-2"><Badge tone="success">Wallet</Badge></td>
          <td className="px-3 py-2 text-text-soft">Paid to the farmer&apos;s wallet by this run</td>
          <td className="px-3 py-2 text-right tabular">{units(checks.payableCount)}</td>
          <td className="whitespace-nowrap px-3 py-2 text-right tabular">{money(checks.payableAmount, currency)}</td>
        </tr>
        <tr className="border-t border-border/60" data-row="routed">
          <td className="px-3 py-2"><Badge tone="info">Bank / SACCO</Badge></td>
          <td className="px-3 py-2 text-text-soft">Not paid to wallets by this run: paid by bank or SACCO</td>
          <td className="px-3 py-2 text-right tabular">{units(checks.routedCount)}</td>
          <td className="whitespace-nowrap px-3 py-2 text-right tabular">{money(checks.routedAmount, currency)}</td>
        </tr>
        <tr className="border-t border-border/60" data-row="held">
          <td className="px-3 py-2"><Badge tone="danger">Held</Badge></td>
          <td className="px-3 py-2 text-text-soft">Held by a check, never paid</td>
          <td className="px-3 py-2 text-right tabular">{units(checks.heldCount)}</td>
          <td className="whitespace-nowrap px-3 py-2 text-right tabular">{money(checks.heldAmount, currency)}</td>
        </tr>
        {codes.map(([code, n]) => (
          <tr key={code} className="border-t border-border/60 text-[12.5px]" data-code={code}>
            <td className="px-3 py-1.5 pl-8 font-mono text-[11.5px] text-text-faint">{code.slice(0, 3)}</td>
            <td className="px-3 py-1.5 text-text-soft">{CHECK_TEXT[code as CheckCode] ?? code}</td>
            <td className="px-3 py-1.5 text-right tabular text-text-soft">{units(n)}</td>
            <td />
          </tr>
        ))}
        {(checks.warningCount ?? 0) > 0 && (
          <tr className="border-t border-border/60" data-row="warning">
            <td className="px-3 py-2"><Badge tone="warning">Warning</Badge></td>
            <td className="px-3 py-2 text-text-soft">{CHECK_TEXT.W01_NAME_DIFFERS}: paid to the wallet, worth a look</td>
            <td className="px-3 py-2 text-right tabular">{units(checks.warningCount)}</td>
            <td />
          </tr>
        )}
      </MiniTable>
      {checks.checksNotRun && (
        <p className="mt-2 text-[12px] text-text-faint" data-testid="checks-not-run">
          Not checked by omnichannel on this file: {checks.checksNotRun.split(",").map((c) => c.trim()).filter(Boolean).map((c) => CHECK_TEXT[c as CheckCode] ?? c).join("; ")}.
        </p>
      )}
      {report.error && <p role="alert" className="mt-2 text-[12.5px] text-danger" data-testid="exceptions-error">Could not download the exception report: {report.error}</p>}
    </div>
  );
}
