import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { Button, NotePanel } from "../../../ui";
import { dateTime, money, units } from "../../../lib/tokenConsole/format";
import { staffName } from "../../../lib/omniApi";
import type { BulkRun } from "../../../lib/api.bulkLoad";
import { SHARED_SUBJECTS, releaseBlocker } from "./rules";

/* Maker-checker for a payment run: the operator who uploads it submits it, a
   different signed-in operator releases it, and only then does it run. Each
   step shows who and when. Omnichannel enforces the rule (409 for the same
   person); the button says so first. */

export function RunApproval({ run, me, pending, error, onRelease }: {
  run: BulkRun;
  me: string | null;
  pending: boolean;
  error: string | null;
  onRelease: () => void;
}) {
  const waiting = run.status === "SUBMITTED";
  const blocker = releaseBlocker(run, me);
  const shared = !!run.submittedBy && SHARED_SUBJECTS.has(run.submittedBy);
  return (
    <div className="mt-5 rounded-[var(--radius-lg)] border border-border p-4" data-testid="run-approval">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text"><ShieldCheck size={15} /> Approval</div>
      <ol className="grid gap-3 sm:grid-cols-2">
        <Stage
          done
          title="Submitted"
          who={run.submittedBy}
          when={run.submittedAt}
          testId="submitted"
        />
        <Stage
          done={!!run.releasedBy || (!waiting && !!run.releasedAt)}
          title={waiting ? "Waiting for release" : "Released"}
          who={run.releasedBy}
          when={run.releasedAt}
          testId="released"
          pendingText="A second operator checks the run and releases it."
        />
      </ol>

      {waiting && (
        <div className="mt-4 space-y-3">
          {run.flow === "PAYOUT" && run.payableAmount != null && (
            <p className="text-[12.5px] text-text-soft" data-testid="release-summary">
              Releasing pays{" "}
              <span className="font-medium text-text tabular">{run.payableCount != null ? `${units(run.payableCount)} row${run.payableCount === 1 ? "" : "s"}, ` : ""}{money(run.payableAmount, run.currency)}</span> from the farmers&apos; wallets to their M-PESA
              {(run.refusedCount ?? 0) > 0 && <>; {units(run.refusedCount!)} row{run.refusedCount === 1 ? " was" : "s were"} refused at upload and {run.refusedCount === 1 ? "is" : "are"} not paid</>}
              {run.skippedCount > 0 && <>; {units(run.skippedCount)} {run.skippedCount === 1 ? "was" : "were"} paid already</>}.
            </p>
          )}
          {run.flow !== "PAYOUT" && run.payableAmount != null && (
            <p className="text-[12.5px] text-text-soft" data-testid="release-summary">
              Releasing credits{" "}
              <span className="font-medium text-text tabular">{run.payableCount != null ? `${units(run.payableCount)} lines, ` : ""}{money(run.payableAmount, run.currency)}</span> to wallets
              {(run.routedCount ?? 0) > 0 && <>; {units(run.routedCount!)} bank or SACCO line{run.routedCount === 1 ? " is" : "s are"} not paid to wallets by this run</>}
              {(run.heldCount ?? 0) > 0 && <>; {units(run.heldCount!)} held line{run.heldCount === 1 ? " is" : "s are"} never paid</>}.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!!blocker || pending} onClick={onRelease} aria-describedby={blocker ? "release-why" : undefined}>
              <CheckCircle2 size={14} /> {pending ? "Releasing…" : "Release"}
            </Button>
            {blocker && <span id="release-why" className="text-[12.5px] text-text-soft" data-testid="release-blocked">{blocker}</span>}
          </div>
          {shared && (
            <NotePanel tone="warning" title="Submitted under a shared identity">
              The proxy in front of omnichannel did not say who submitted this run, so omnichannel cannot tell two operators apart and will refuse any release. Deploy the back office's proxy update (it passes on the signed-in operator) and submit again.
            </NotePanel>
          )}
          {error && <p role="alert" className="text-[13px] text-danger" data-testid="release-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Stage({ done, title, who, when, testId, pendingText }: { done: boolean; title: string; who?: string | null; when?: string | null; testId: string; pendingText?: string }) {
  return (
    <li className="flex gap-2.5" data-testid={`approval-${testId}`}>
      <span className={`mt-0.5 shrink-0 ${done ? "text-success" : "text-warning"}`}>{done ? <CheckCircle2 size={16} /> : <Clock size={16} />}</span>
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
