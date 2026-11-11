import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FlaskConical, Upload } from "lucide-react";
import { Badge, Button, Field, Input, NotePanel, PageHeader, Skeleton, useToast } from "../../../ui";
import { useAsyncData } from "../../../lib/useAsyncData";
import { useAction } from "../../../lib/tokenConsole/useAction";
import { dateTime, money, units } from "../../../lib/tokenConsole/format";
import { saveDownload } from "../../../lib/tokenConsole/reporting";
import { useAuth } from "../../../lib/auth";
import { ACT } from "../../../lib/staffContract";
import { reconciliationApi } from "../../../lib/api.reconciliation";
import { generateMockStatement } from "../../../lib/reconciliationSim";
import { nairobiMidnight, runLink, type ReconciliationRun } from "../../../lib/reconciliationContract";
import { SourceError } from "../../../components/tokenconsole/ConsoleTable";
import { ActionModal } from "../../../components/tokenconsole/ActionModal";

/* Reconciliation: the runs, newest first, and "Upload statement". Each run
   puts one channel statement against what this service recorded as paid
   (reconciliationContract.ts) and opens on its own page. */

/** "3 Nov – 4 Nov 2026"; the end is exclusive, so the last day shown is the day before. */
export function periodText(r: Pick<ReconciliationRun, "periodFrom" | "periodTo">): string {
  if (!r.periodFrom && !r.periodTo) return "—";
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
  const last = r.periodTo ? new Date(new Date(r.periodTo).getTime() - 1).toISOString() : null;
  return `${r.periodFrom ? day(r.periodFrom) : "…"} – ${last ? day(last) : "…"}`;
}

export function CountPills({ run }: { run: ReconciliationRun }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="run-pills">
      <Badge tone="success">{units(run.matched)} matched</Badge>
      {run.ledgerOnly > 0 && <Badge tone="warning">{units(run.ledgerOnly)} ledger only</Badge>}
      {run.statementOnly > 0 && <Badge tone="danger">{units(run.statementOnly)} statement only</Badge>}
      {run.amountMismatch > 0 && <Badge tone="danger">{units(run.amountMismatch)} mismatch</Badge>}
      <Badge tone={run.exceptionsOpen > 0 ? "warning" : "neutral"}>{units(run.exceptionsOpen)} open</Badge>
    </div>
  );
}

export function TemplateLink() {
  const toast = useToast();
  const get = useAction(() => reconciliationApi.template());
  return (
    <Button
      variant="outline"
      disabled={get.pending}
      onClick={async () => {
        const f = await get.run();
        if (f) saveDownload(f);
        else toast.push("The template could not be downloaded.", "error");
      }}
    >
      <Download size={14} /> Download template
    </Button>
  );
}

const NotAvailable = () => (
  <div data-testid="not-available">
    <NotePanel tone="info" title="Not available on this environment yet">Omnichannel here has no cash-in reconciliation.</NotePanel>
  </div>
);

export default function ReconciliationRuns() {
  const navigate = useNavigate();
  const mayRun = useAuth().can(ACT.reconciliationRun);
  const runs = useAsyncData(() => reconciliationApi.runs());
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const unavailable = runs.data && !runs.data.available;
  const list = runs.data?.available ? runs.data.data : null;

  return (
    <div>
      <PageHeader
        eyebrow="KTDA · Money"
        title="Reconciliation"
        subtitle="Put a channel's statement (M-PESA, Airtel Money, a paybill, agents, a bank) against what this service recorded as paid, and chase where they disagree. Nothing here moves money."
        actions={!unavailable && (
          <div className="flex flex-wrap gap-2">
            <TemplateLink />
            {mayRun && <Button variant="outline" onClick={() => setGenerating(true)}><FlaskConical size={14} /> Generate test statement</Button>}
            {mayRun && <Button onClick={() => setUploading(true)}><Upload size={14} /> Upload statement</Button>}
          </div>
        )}
      />

      {runs.error ? <SourceError what="the reconciliation runs" error={runs.error} onRetry={runs.reload} /> : unavailable ? <NotAvailable /> : !list ? <Skeleton className="h-48" /> : list.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="runs-empty">
          No statement has been reconciled yet. Map the channel&apos;s export to the template, then upload it.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full text-[13px]" data-testid="runs-table">
            <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
              <tr>
                <th className="px-3 py-2 font-medium">Statement</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 text-right font-medium">Statement total</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-border/60 align-top hover:bg-surface-sunken/60" data-run={r.id} onClick={() => navigate(runLink(r.id))}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{r.fileName ?? "Statement"}</div>
                    <div className="text-[12px] text-text-soft">{units(r.statementLines)} lines{r.skippedLines > 0 ? `, ${units(r.skippedLines)} skipped` : ""}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{periodText(r)}</td>
                  <td className="px-3 py-2 text-[12.5px] text-text-soft">{dateTime(r.createdAt)}{r.runBy ? <span className="block">{r.runBy}</span> : null}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular">{money(r.statementAmount, r.currency)}</td>
                  <td className="px-3 py-2"><CountPills run={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploading && <UploadModal onClose={() => setUploading(false)} onDone={(r) => navigate(runLink(r.id))} />}
      {generating && <GenerateModal onClose={() => setGenerating(false)} />}
    </div>
  );
}

/* Builds a statement CSV from the period's own paid cash-ins (mostly matching,
   a few of each exception, two unreadable lines) and saves it, to simulate a
   run without a real channel export. It is uploaded through the normal flow. */
function GenerateModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // The last day is included: `to` is exclusive, so it is sent as the next day's midnight — as on upload.
  const gen = useAction(() => generateMockStatement({ from: from ? nairobiMidnight(from) : null, to: to ? nairobiMidnight(to, 1) : null }));
  const problem = from && to && to < from ? "The last day is before the first." : undefined;
  const submit = async () => {
    const res = await gen.run();
    if (!res) return;
    saveDownload(res.download);
    const m = res.mix;
    toast.push(`Statement ready (${units(res.statementLines)} lines from ${units(res.used)} cash-ins): ${units(m.matched)} matched, ${units(m.amountMismatch)} mismatch, ${units(m.statementOnly)} statement only, ${units(m.ledgerOnly)} ledger only, ${units(m.skipped)} skipped. Upload it to reconcile.`, "success");
    if (res.inPeriod != null && res.inPeriod > res.used) {
      toast.push(`This period holds ${units(res.inPeriod)} cash-ins, so the ${units(res.inPeriod - res.used)} not on the statement will also show as "ledger only". Narrow the dates (to about ${units(res.used)} cash-ins) for a mostly-matched run.`, "warning");
    }
    onClose();
  };
  return (
    <ActionModal
      title="Generate a test statement"
      description="A channel statement built from this period's own paid cash-ins: most match, with a few of each exception and two unreadable lines, so a run shows every outcome. Nothing moves money — upload it as usual to reconcile."
      submitLabel="Generate CSV"
      pendingLabel="Reading cash-ins…"
      problem={problem}
      pending={gen.pending}
      error={gen.error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From (optional)">
          <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To, including (optional)">
          <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <p className="text-[12.5px] text-text-soft" data-testid="generate-hint">
        Up to 500 of the period&apos;s paid cash-ins are used. Any left over show as &quot;ledger only&quot; when the statement is
        reconciled over the same period, so a tighter period gives a cleaner, mostly-matched run.
      </p>
    </ActionModal>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: (r: ReconciliationRun) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // The last day is included: the server's `to` is exclusive, so it is sent as the next day's midnight.
  const send = useAction(() => reconciliationApi.upload(file!, { from: from ? nairobiMidnight(from) : null, to: to ? nairobiMidnight(to, 1) : null }));
  const problem = !file ? "Choose the statement CSV." : from && to && to < from ? "The last day is before the first." : undefined;
  const submit = async () => {
    const r = await send.run();
    if (r) onDone(r);
  };
  return (
    <ActionModal
      title="Upload a statement"
      description="A channel's statement mapped to the template. It is matched against the payments recorded here as paid."
      submitLabel="Reconcile"
      pendingLabel="Matching…"
      problem={problem}
      pending={send.pending}
      error={send.error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field label="Statement (CSV)" required>
        <Input type="file" accept=".csv,text/csv" aria-label="Statement (CSV)" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From (optional)">
          <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To, including (optional)">
          <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <p className="text-[12.5px] text-text-soft" data-testid="period-hint">
        The period bounds the payments recorded here, by when they were started. Left blank, it is the statement&apos;s own dates, a day either side.
      </p>
    </ActionModal>
  );
}
