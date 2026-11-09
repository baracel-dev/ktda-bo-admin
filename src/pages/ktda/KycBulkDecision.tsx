import { useEffect, useRef, useState } from "react";
import { Badge, Button, Field, Modal, NotePanel, ProgressBar, Textarea } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { dateTime, units } from "../../lib/tokenConsole/format";
import { canDecideKyc } from "../../lib/tokenConsole/kyc";
import { useAuth } from "../../lib/auth";
import { farmersApi } from "../../lib/api.farmers";
import { withReason } from "../../lib/api.approvals";
import { REASON_MAX, type Approval } from "../../lib/approvalsContract";
import { ErrorWithApproval, REASON_HINT, SentForApproval } from "../../components/ApprovalNotice";
import {
  KYC_BULK_SCOPE_LABEL, KYC_NOTE_MAX, NOT_AVAILABLE, SWEEP_LABEL, SWEEP_TONE,
  type KycBulkRun, type KycBulkScope,
} from "../../lib/journeyContract";

/* One KYC decision for many farmers, on the KYC desk (the ledger pays out
   only to verified farmers, and thousands can be waiting). "Decide for many"
   opens the choice: verify or reject; every farmer waiting, only those the
   registry matched, or a list of grower numbers; the note written on every
   farmer; and the reason for the checker. Verifying only the registry's
   matches starts at once (201, the run); anything else is one approval
   request (202), approved on the Approvals page. The panel shows the latest
   run, polls it while it runs, and tells the desk when it ends so the counts
   refresh. Deciding is for the roles that may decide KYC. */

export const BULK_POLL_MS = 3000;

const SCOPES: KycBulkScope[] = ["ALL_PENDING", "REGISTRY_MATCH", "GROWERS"];

/** Grower numbers from pasted text or a CSV: one per cell, the header and
 *  blanks left out, each once, in the order given. */
export function growerNumbersIn(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/[\s,;]+/)) {
    const g = raw.trim().replace(/^"|"$/g, "").toUpperCase();
    if (!g || /^GROWER(_?NO)?$/.test(g) || !/^[A-Z0-9][A-Z0-9-]{2,}$/.test(g) || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

export function KycBulkDecision({ onFinished }: { onFinished: () => void }) {
  const { user } = useAuth();
  const mayDecide = canDecideKyc(user?.tokRoles);
  const latest = useAsyncData(() => farmersApi.latestBulkDecision());
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<Approval | null>(null);
  const run = latest.data;
  const running = run?.status === "RUNNING";

  const { reload } = latest;
  const watched = useRef(false);
  useEffect(() => {
    if (!running) {
      if (watched.current) { watched.current = false; onFinished(); }
      return;
    }
    watched.current = true;
    const t = setInterval(() => void reload(), BULK_POLL_MS);
    return () => clearInterval(t);
  }, [running, reload, onFinished]);

  if (!run && !mayDecide && !latest.error) return null;

  return (
    <div className="mb-4 rounded-[var(--radius-lg)] border border-border p-4" data-testid="kyc-bulk">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Bulk decision</h2>
          <p className="text-[12.5px] text-text-soft">One decision for many farmers waiting for KYC. Only verified farmers can be paid out.</p>
        </div>
        {mayDecide && (
          <Button size="sm" disabled={running} onClick={() => { setStaged(null); setOpen(true); }}>
            {running ? "Running…" : "Decide for many"}
          </Button>
        )}
      </div>

      {latest.error && <p role="alert" className="mt-3 text-[13px] text-danger">Could not read the last bulk decision: {latest.error}</p>}
      {staged && <SentForApproval approval={staged} className="mt-3" />}
      {run ? <RunState run={run} /> : latest.data === null && (
        <p className="mt-3 text-[12.5px] text-text-soft" data-testid="bulk-never">No bulk decision has run yet.</p>
      )}

      {open && (
        <DecideForMany
          onCancel={() => setOpen(false)}
          onStaged={(a) => { setOpen(false); setStaged(a); }}
          onStarted={(r) => { setOpen(false); setStaged(null); latest.setData(r); }}
        />
      )}
    </div>
  );
}

function DecideForMany({ onCancel, onStaged, onStarted }: { onCancel: () => void; onStaged: (a: Approval) => void; onStarted: (r: KycBulkRun) => void }) {
  const [decision, setDecision] = useState<"VERIFIED" | "REJECTED">("VERIFIED");
  const [scope, setScope] = useState<KycBulkScope>("REGISTRY_MATCH");
  const [list, setList] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const growers = scope === "GROWERS" ? growerNumbersIn(list) : [];
  const verifying = decision === "VERIFIED";
  const atOnce = verifying && scope === "REGISTRY_MATCH";

  const act = useAction(async () => {
    if (!note.trim()) throw new Error("Write the note that goes on every farmer.");
    if (scope === "GROWERS" && growers.length === 0) throw new Error("List at least one grower number.");
    return farmersApi.bulkDecideKyc({
      decision, scope, note: note.trim(),
      ...(scope === "GROWERS" ? { growerNos: growers } : {}),
      ...withReason(reason),
    });
  });

  const submit = async () => {
    const r = await act.run();
    if (!r) return;
    if (r.approval) onStaged(r.approval);
    else onStarted(r.applied);
  };

  const readCsv = async (f: File | null) => {
    if (f) setList(await f.text());
  };

  const radio = "flex items-start gap-2 text-[13px] text-text";
  return (
    <Modal
      open
      onClose={act.pending ? () => undefined : onCancel}
      title="Decide KYC for many farmers"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={act.pending} onClick={onCancel}>Cancel</Button>
          <Button variant={verifying ? "primary" : "danger"} size="sm" disabled={act.pending} onClick={() => void submit()}>
            {act.pending ? "Sending…" : atOnce ? "Verify now" : "Send for approval"}
          </Button>
        </>
      }
    >
      <fieldset className="mb-4">
        <legend className="mb-2 text-[13px] font-medium text-text">Decision</legend>
        <div className="flex gap-5">
          <label className={radio}><input type="radio" name="bulk-decision" checked={verifying} onChange={() => setDecision("VERIFIED")} /> Verify</label>
          <label className={radio}><input type="radio" name="bulk-decision" checked={!verifying} onChange={() => setDecision("REJECTED")} /> Reject</label>
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <legend className="mb-2 text-[13px] font-medium text-text">Which farmers</legend>
        <div className="flex flex-col gap-2">
          {SCOPES.map((s) => (
            <label key={s} className={radio}>
              <input type="radio" name="bulk-scope" checked={scope === s} onChange={() => setScope(s)} />
              <span>{KYC_BULK_SCOPE_LABEL[s]}</span>
            </label>
          ))}
        </div>
        {scope === "GROWERS" && (
          <div className="mt-3">
            <Field label="Grower numbers" hint="Paste them, one per line or separated by commas, or choose a CSV with a grower_no column.">
              <Textarea rows={4} aria-label="Grower numbers" value={list} onChange={(e) => setList(e.target.value)} placeholder={"TEST000001\nTEST000002"} />
            </Field>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label="Grower numbers file"
              onChange={(e) => void readCsv(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm text-text-soft file:mr-3 file:h-8 file:rounded-md file:border file:border-border file:bg-surface-sunken file:px-3 file:text-sm file:text-text"
            />
            <p className="mt-1 text-[12.5px] text-text-soft" data-testid="bulk-grower-count">{units(growers.length)} grower number{growers.length === 1 ? "" : "s"}.</p>
          </div>
        )}
      </fieldset>

      {verifying && scope !== "REGISTRY_MATCH" && (
        <p className="mb-3 text-[12.5px] text-warning" data-testid="bulk-override">Verifying farmers the registry did not match is an override and needs approval.</p>
      )}
      {!verifying && <p className="mb-3 text-[12.5px] text-warning" data-testid="bulk-reject-approval">Rejecting many farmers at once needs a second person&apos;s approval.</p>}
      {atOnce && <p className="mb-3 text-[12.5px] text-text-soft" data-testid="bulk-at-once">The registry matched these farmers, so this starts at once.</p>}

      <Field label="Note" hint={`Written on every farmer's decision. Up to ${KYC_NOTE_MAX} characters.`}>
        <Textarea rows={3} aria-label="Decision note" value={note} maxLength={KYC_NOTE_MAX} onChange={(e) => setNote(e.target.value)}
          placeholder={verifying ? "Registry match confirmed in bulk." : "Why these were refused."} />
      </Field>
      {!atOnce && (
        <div className="mt-3">
          <Field label="Reason (optional)" hint={REASON_HINT}>
            <Textarea rows={2} aria-label="Reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
      {act.error && (act.error === NOT_AVAILABLE
        ? <NotePanel tone="info" className="mt-3" title="Not available on this environment yet">Omnichannel here cannot decide KYC for many farmers at once yet.</NotePanel>
        : <ErrorWithApproval message={act.error} className="mt-3 text-[13px] text-danger" />)}
    </Modal>
  );
}

function RunState({ run }: { run: KycBulkRun }) {
  const running = run.status === "RUNNING";
  const done = run.decided + run.skipped + run.failed;
  const verb = run.decision === "VERIFIED" ? "Verified" : "Rejected";
  return (
    <div className="mt-3" data-testid="bulk-state">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-soft">
        <Badge tone={SWEEP_TONE[run.status] ?? "neutral"}>{SWEEP_LABEL[run.status] ?? run.status}</Badge>
        <span>
          {run.decision === "VERIFIED" ? "Verify" : "Reject"} · {KYC_BULK_SCOPE_LABEL[run.scope] ?? run.scope} ·{" "}
          {running ? `started ${dateTime(run.startedAt)}` : `last run ${dateTime(run.finishedAt ?? run.startedAt)}`}
          {run.requestedBy ? `, asked by ${run.requestedBy}` : ""}
          {run.approvedBy ? `, approved by ${run.approvedBy}` : ""}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-text" data-testid="bulk-counts">
        {verb} {units(run.decided)} of {units(run.total)}, {units(run.skipped)} skipped, {units(run.failed)} failed.
      </p>
      {running && run.total > 0 && <div className="mt-2"><ProgressBar value={Math.min(100, (done / run.total) * 100)} /></div>}
      {run.message && !running && (
        <p className={`mt-2 text-[12.5px] ${run.status === "FAILED" ? "text-danger" : "text-text"}`} data-testid="bulk-message">{run.message}</p>
      )}
      {run.status === "INTERRUPTED" && (
        <p className="mt-1 text-[12px] text-text-soft">The service restarted while it ran. Ask again to carry on with the farmers still waiting.</p>
      )}
    </div>
  );
}
