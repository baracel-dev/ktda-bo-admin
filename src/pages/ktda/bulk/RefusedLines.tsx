import { Download } from "lucide-react";
import { Badge, Button } from "../../../ui";
import { money, units } from "../../../lib/tokenConsole/format";
import { useAction } from "../../../lib/tokenConsole/useAction";
import { bulkLoads, hasRefusals, type LedgerRefusals } from "../../../lib/api.bulkLoad";
import { saveBlob } from "./rules";

/* Lines the ledger was sent but refused (a grower with no wallet, say), as
   their own total: not held by a file check, not paid by bank or SACCO, and
   counted in the reconciliation (posted + already applied + refused =
   expected). Their rows, with the ledger's reason, download from the ledger.
   Shown only where the core reports refusals (tokenization-project#52). */

export function RefusedLines({ runId, refusals, currency }: { runId: string; refusals: LedgerRefusals | null | undefined; currency: string }) {
  const rows = useAction(async () => {
    const { filename, blob } = await bulkLoads.rows(runId, "REFUSED");
    saveBlob(filename, blob);
  });
  if (!hasRefusals(refusals)) return null;
  const n = refusals!.refusedCount ?? 0;
  return (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-border p-4" data-testid="refused-lines">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Badge tone={n > 0 ? "warning" : "success"}>Refused by the ledger</Badge>
            <span className="tabular" data-testid="refused-total">{units(n)} line{n === 1 ? "" : "s"} · {money(refusals!.refusedAmount ?? 0, currency)}</span>
          </div>
          <p className="mt-1 text-[12.5px] text-text-soft">
            {n > 0
              ? "Sent to the ledger and not credited, each with the ledger's reason (a grower with no wallet, say). Separate from the lines held by the file's checks and the bank or SACCO lines; the reconciliation counts them."
              : "The ledger credited or had already applied every line it was sent."}
          </p>
        </div>
        {n > 0 && (
          <Button size="sm" variant="outline" disabled={rows.pending} onClick={() => void rows.run()}>
            <Download size={13} /> {rows.pending ? "Downloading…" : "Refused lines"}
          </Button>
        )}
      </div>
      {rows.error && <p role="alert" className="mt-2 text-[12.5px] text-danger" data-testid="refused-error">Could not download the refused lines: {rows.error}</p>}
    </div>
  );
}
