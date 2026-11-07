import { useEffect, useRef, useState } from "react";
import { Badge, Button, Modal, NotePanel, ProgressBar } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { dateTime, units } from "../../lib/tokenConsole/format";
import { canDecideKyc } from "../../lib/tokenConsole/kyc";
import { useAuth } from "../../lib/auth";
import { farmersApi } from "../../lib/api.farmers";
import { NOT_AVAILABLE, SWEEP_LABEL, SWEEP_TONE, type KycSweep as Sweep } from "../../lib/journeyContract";

/* The KYC sweep on the Farmers page: start KYC, in the background, for every
   activated farmer still at NONE (those activated before KYC existed; a
   farmer activated later starts by themselves). Shows the latest sweep from
   GET, polls it while it runs, and tells the page when it ends so the
   counts refresh. Starting it is for the roles that may decide KYC. */

export const SWEEP_POLL_MS = 3000;

export function KycSweep({ onFinished }: { onFinished: () => void }) {
  const { user } = useAuth();
  const mayStart = canDecideKyc(user?.tokRoles);
  const latest = useAsyncData(() => farmersApi.latestSweep());
  const start = useAction(() => farmersApi.startSweep());
  const [confirming, setConfirming] = useState(false);
  const [alreadyRunning, setAlreadyRunning] = useState(false);
  const sweep = latest.data;
  const running = sweep?.status === "RUNNING";

  // Poll while it runs; when a run we watched ends, refresh the page's counts.
  const { reload } = latest;
  const watched = useRef(false);
  useEffect(() => {
    if (!running) {
      if (watched.current) { watched.current = false; onFinished(); }
      return;
    }
    watched.current = true;
    const t = setInterval(() => void reload(), SWEEP_POLL_MS);
    return () => clearInterval(t);
  }, [running, reload, onFinished]);

  const run = async () => {
    const r = await start.run();
    setConfirming(false);
    if (!r) return;
    setAlreadyRunning(r.alreadyRunning);
    if (r.sweep) latest.setData(r.sweep);
    else void latest.reload();
  };

  if (!sweep && !mayStart && !latest.error) return null;

  return (
    <div className="mb-4 rounded-[var(--radius-lg)] border border-border p-4" data-testid="kyc-sweep">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Start KYC for the backlog</h2>
          <p className="text-[12.5px] text-text-soft">Every activated farmer whose KYC has not started. Farmers activated from now on start by themselves.</p>
        </div>
        {mayStart && (
          <Button size="sm" disabled={running || start.pending} onClick={() => { start.reset(); setConfirming(true); }}>
            {running ? "Running…" : "Start KYC for all activated farmers"}
          </Button>
        )}
      </div>

      {latest.error && <p role="alert" className="mt-3 text-[13px] text-danger">Could not read the last sweep: {latest.error}</p>}
      {start.error && !confirming && (start.error === NOT_AVAILABLE
        ? <div className="mt-3" data-testid="sweep-not-available"><NotePanel tone="info" title="Not available on this environment yet">Omnichannel here cannot start KYC for every farmer at once yet.</NotePanel></div>
        : <p role="alert" className="mt-3 text-[13px] text-danger">{start.error}</p>)}
      {alreadyRunning && running && <p className="mt-3 text-[12.5px] text-warning" data-testid="sweep-already-running">A sweep is already running; this is that one.</p>}

      {sweep ? <SweepState sweep={sweep} /> : latest.data === null && (
        <p className="mt-3 text-[12.5px] text-text-soft" data-testid="sweep-never">No sweep has run yet.</p>
      )}

      {confirming && (
        <Modal
          open
          onClose={start.pending ? () => undefined : () => setConfirming(false)}
          size="sm"
          title="Start KYC for all activated farmers?"
          footer={
            <>
              <Button variant="ghost" size="sm" disabled={start.pending} onClick={() => setConfirming(false)}>Cancel</Button>
              <Button size="sm" disabled={start.pending} onClick={() => void run()}>{start.pending ? "Starting…" : "Start"}</Button>
            </>
          }
        >
          <p className="text-sm text-text-soft">
            Each activated farmer whose KYC has not started is checked against the population registry and screening, and then waits
            for a decision on the KYC desk. It runs in the background; a farmer missing a national ID or date of birth stays not started, with the reason.
          </p>
          {start.error && <NotePanel tone="danger" className="mt-3">{start.error}</NotePanel>}
        </Modal>
      )}
    </div>
  );
}

function SweepState({ sweep }: { sweep: Sweep }) {
  const done = sweep.started + sweep.notStarted;
  const running = sweep.status === "RUNNING";
  return (
    <div className="mt-3" data-testid="sweep-state">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-soft">
        <Badge tone={SWEEP_TONE[sweep.status] ?? "neutral"}>{SWEEP_LABEL[sweep.status] ?? sweep.status}</Badge>
        <span>
          {running ? `Started ${dateTime(sweep.startedAt)}` : `Last run ${dateTime(sweep.finishedAt ?? sweep.startedAt)}`}
          {sweep.requestedBy ? ` by ${sweep.requestedBy}` : ""}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-text" data-testid="sweep-counts">
        Started {units(sweep.started)} of {units(sweep.total)}, {units(sweep.notStarted)} not started.
      </p>
      {running && sweep.total > 0 && <div className="mt-2"><ProgressBar value={Math.min(100, (done / sweep.total) * 100)} /></div>}
      {sweep.notStarted > 0 && !running && (
        <p className="mt-1 text-[12px] text-text-soft">Each farmer not started carries the reason on their profile (filter KYC: not started).</p>
      )}
      {sweep.message && !running && (
        <p className={`mt-2 text-[12.5px] ${sweep.status === "FAILED" ? "text-danger" : "text-text"}`} data-testid="sweep-message">{sweep.message}</p>
      )}
      {sweep.status === "INTERRUPTED" && (
        <p className="mt-1 text-[12px] text-text-soft">The service restarted while it ran. Starting again carries on where it left off.</p>
      )}
    </div>
  );
}
