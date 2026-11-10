import { useState, type ReactNode } from "react";
import { CheckCircle2, Clock, ShieldCheck, XCircle } from "lucide-react";
import { Button, Field, NotePanel, Textarea } from "../../../ui";
import { dateTime, money, units } from "../../../lib/tokenConsole/format";
import { staffName } from "../../../lib/omniApi";
import type { BulkRun } from "../../../lib/api.bulkLoad";
import { SHARED_SUBJECTS, releaseBlocker } from "./rules";

/* Maker-checker for a payment or payout run: the operator who uploads it submits it, a different
   signed-in operator checks it and then accepts (releases) or rejects it with a note, and only a
   release starts it. The summary is what the checker verifies — batch, institution, amount, rows,
   who submitted it and when, and the file's checksum. Omnichannel enforces the rule (403 for the
   same person); the buttons say so first. */

const NOTE_LIMIT = 500;

/** Shown in place of the buttons' reason when the member's roles lack the key. */
const NOT_YOURS = "Your roles do not allow releasing or rejecting this run. An administrator can change that on Users & roles.";

export function RunApproval({ run, me, institutionName, releasing, rejecting, error, onRelease, onReject, mayDecide = true }: {
  run: BulkRun;
  me: string | null;
  /** The institution's name, resolved by the page (omnichannel does not send it on the run). */
  institutionName?: string | null;
  releasing: boolean;
  rejecting: boolean;
  error: string | null;
  onRelease: (note?: string) => void;
  onReject: (note: string) => void;
  /** The staff directory's act:payouts.release (a payout) or act:bulk.run. */
  mayDecide?: boolean;
}) {
  const [note, setNote] = useState("");
  const waiting = run.status === "SUBMITTED";
  const rejected = run.status === "REJECTED";
  const blocker = mayDecide ? releaseBlocker(run, me) : NOT_YOURS;
  const shared = !!run.submittedBy && SHARED_SUBJECTS.has(run.submittedBy);
  const busy = releasing || rejecting;
  const payout = run.flow === "PAYOUT";
  // What release moves: a SAP/payout file carries its own total and count; a plain payment file is
  // itemised only once it runs, so the amount is shown as checked on release.
  const amount = run.payableAmount ?? (payout ? null : run.totalAmount || null);
  const rows = run.payableCount ?? (run.totalRows || null);

  return (
    <div className="mt-5 rounded-[var(--radius-lg)] border border-border p-4" data-testid="run-approval">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text"><ShieldCheck size={15} /> Approval</div>

      <dl className="mb-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2" data-testid="run-summary">
        <SummaryRow k="Batch" v={<span className="tabular break-all">{run.runId}</span>} />
        {(institutionName ?? run.institutionName) && <SummaryRow k="Institution" v={institutionName ?? run.institutionName} />}
        {run.period && <SummaryRow k="Pay period" v={<span className="tabular">{run.period}</span>} />}
        <SummaryRow k="File" v={<span className="break-all">{run.sourceName}</span>} />
        <SummaryRow
          k={payout ? "Total to pay out" : "Total to credit"}
          v={amount != null
            ? <span className="tabular font-medium text-text">{money(amount, run.currency)}</span>
            : <span className="text-text-soft">Itemised when released</span>}
        />
        {rows != null && <SummaryRow k={payout ? "Farmers to pay" : "Rows"} v={<span className="tabular">{units(rows)}</span>} />}
        <SummaryRow k="Submitted by" v={<span className="break-all">{staffName(run.submittedBy)}</span>} sub={dateTime(run.submittedAt)} />
        {run.fileSha256 && <SummaryRow k="File checksum" v={<span className="font-mono text-[11.5px] text-text-soft break-all">{run.fileSha256.slice(0, 16)}…</span>} />}
      </dl>

      <ol className="grid gap-3 sm:grid-cols-2">
        <Stage done title="Submitted" who={run.submittedBy} when={run.submittedAt} testId="submitted" />
        {rejected ? (
          <Stage done tone="danger" title="Rejected" who={run.rejectedBy} when={run.rejectedAt} testId="rejected" />
        ) : (
          <Stage
            done={!!run.releasedBy || (!waiting && !!run.releasedAt)}
            title={waiting ? "Waiting for release" : "Released"}
            who={run.releasedBy}
            when={run.releasedAt}
            testId="released"
            pendingText="A second operator checks the run, then accepts or rejects it."
          />
        )}
      </ol>

      {run.decisionNote && (
        <p className="mt-3 text-[12.5px] text-text-soft" data-testid="decision-note">
          <span className="font-medium text-text">{rejected ? "Reason for rejection" : "Note"}:</span> {run.decisionNote}
        </p>
      )}

      {waiting && (
        <div className="mt-4 space-y-3">
          {payout && run.payableAmount != null && (
            <p className="text-[12.5px] text-text-soft" data-testid="release-summary">
              Releasing pays{" "}
              <span className="font-medium text-text tabular">{run.payableCount != null ? `${units(run.payableCount)} row${run.payableCount === 1 ? "" : "s"}, ` : ""}{money(run.payableAmount, run.currency)}</span> from the farmers&apos; wallets to their M-PESA
              {(run.refusedCount ?? 0) > 0 && <>; {units(run.refusedCount!)} row{run.refusedCount === 1 ? " was" : "s were"} refused at upload and {run.refusedCount === 1 ? "is" : "are"} not paid</>}
              {run.skippedCount > 0 && <>; {units(run.skippedCount)} {run.skippedCount === 1 ? "was" : "were"} paid already</>}.
            </p>
          )}
          {!payout && run.payableAmount != null && (
            <p className="text-[12.5px] text-text-soft" data-testid="release-summary">
              Releasing credits{" "}
              <span className="font-medium text-text tabular">{run.payableCount != null ? `${units(run.payableCount)} lines, ` : ""}{money(run.payableAmount, run.currency)}</span> to wallets
              {(run.routedCount ?? 0) > 0 && <>; {units(run.routedCount!)} bank or SACCO line{run.routedCount === 1 ? " is" : "s are"} not paid to wallets by this run</>}
              {(run.heldCount ?? 0) > 0 && <>; {units(run.heldCount!)} held line{run.heldCount === 1 ? " is" : "s are"} never paid</>}.
            </p>
          )}

          <Field label="Note" group
            hint={`Optional on accept, required to reject. ${note.length}/${NOTE_LIMIT}`}>
            <Textarea
              value={note}
              disabled={busy || !!blocker}
              rows={3}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_LIMIT))}
              placeholder="Why you accept or reject this batch."
              data-testid="decision-note-input"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!!blocker || busy} onClick={() => onRelease(note)} aria-describedby={blocker ? "release-why" : undefined}>
              <CheckCircle2 size={14} /> {releasing ? "Releasing…" : "Release"}
            </Button>
            <Button
              variant="outline"
              disabled={!!blocker || busy || !note.trim()}
              onClick={() => onReject(note.trim())}
              aria-describedby={blocker ? "release-why" : note.trim() ? undefined : "reject-why"}
              data-testid="reject-button"
            >
              <XCircle size={14} /> {rejecting ? "Rejecting…" : "Reject"}
            </Button>
            {blocker
              ? <span id="release-why" className="text-[12.5px] text-text-soft" data-testid="release-blocked">{blocker}</span>
              : !note.trim() && <span id="reject-why" className="text-[12.5px] text-text-faint">Add a note to reject.</span>}
          </div>
          {shared && (
            <NotePanel tone="warning" title="Submitted under a shared identity">
              The proxy in front of omnichannel did not say who submitted this run, so omnichannel cannot tell two operators apart and will refuse any decision. Deploy the back office&apos;s proxy update (it passes on the signed-in operator) and submit again.
            </NotePanel>
          )}
          {error && <p role="alert" className="text-[13px] text-danger" data-testid="release-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-text-soft">{k}</dt>
      <dd className="text-text">{v}{sub && <span className="text-text-faint"> · <span className="tabular">{sub}</span></span>}</dd>
    </div>
  );
}

function Stage({ done, title, who, when, testId, pendingText, tone = "success" }: {
  done: boolean; title: string; who?: string | null; when?: string | null; testId: string; pendingText?: string; tone?: "success" | "danger";
}) {
  const Icon = tone === "danger" ? XCircle : CheckCircle2;
  return (
    <li className="flex gap-2.5" data-testid={`approval-${testId}`}>
      <span className={`mt-0.5 shrink-0 ${done ? (tone === "danger" ? "text-danger" : "text-success") : "text-warning"}`}>{done ? <Icon size={16} /> : <Clock size={16} />}</span>
      <div className="min-w-0 text-[13px]">
        <div className="font-medium text-text">{title}</div>
        {done || who ? (
          <div className="text-text-soft"><span className="break-all">{staffName(who)}</span> · <span className="tabular">{dateTime(when)}</span></div>
        ) : (
          <div className="text-text-soft">{pendingText}</div>
        )}
      </div>
    </li>
  );
}
