import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Download, FileUp, Info, Play, Send } from "lucide-react";
import { Badge, Button, Field, GlassPanel, NotePanel, PageHeader, ProgressBar, SectionTitle, Skeleton, StatCard } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { dateTime, duration, money, units } from "../../lib/tokenConsole/format";
import { tokenConsole } from "../../lib/api.tokenConsole";
import {
  BULK_COLUMNS, ERR, MAX_PAYMENT_KES, MAX_UPLOAD_MB, PAYOUT_NOT_AVAILABLE, bulkLoads, earlierRunIn, hasApproval, hasRefusals, readsSapFiles, summariseCsv,
  type BulkFlow, type BulkReconciliation, type BulkRun, type FileSummary,
} from "../../lib/api.bulkLoad";
import { formatProblem, paymentFormatOf, periodFromName, type PaymentFormat } from "../../lib/sapPaymentFile";
import { farmersApi } from "../../lib/api.farmers";
import { useAuth } from "../../lib/auth";
import { omniSubjectFor, staffName } from "../../lib/omniApi";
import { SapFileCheck } from "./bulk/SapFileCheck";
import { useControlSheet, useSapCheck } from "./bulk/useSapCheck";
import { RunApproval } from "./bulk/RunApproval";
import { RunChecks } from "./bulk/RunChecks";
import { RefusedLines } from "./bulk/RefusedLines";
import { DemoSasaPay, PaymentKindSwitch, PayoutGate, PayoutOutcomeNote, PayoutReconPanel, PayoutRows, usePayoutOpen } from "./bulk/Payout";
import { Check, Row } from "./bulk/shared";
import { kesCents, sapBlocker, sizeBlocker } from "./bulk/rules";
import { ConsoleTable, SourceError, StatusBadge } from "../../components/tokenconsole/ConsoleTable";
import { OmniApiError } from "../../lib/omniApi";
import {
  COLUMNS, GATE, HAS_RECONCILIATION, JOURNEY, NOT_AVAILABLE, SAMPLE_FILES, stepFor, templateCsv, templateName,
} from "../../lib/journeyContract";

/* Bulk onboarding and bulk payment for an institution's farmers (section 1A of
   the KTDA handoff). The institution is not a choice: omnichannel scopes every
   operator call to the one this back office is configured for (the proxy sets
   it), and lists only that one. Four steps: the institution, the file, Process (upload,
   start, then a poll about once a second while RUNNING), and the result with
   the reconciliation, read once when the run ends. Payments open only once an
   onboarding run has completed for the institution; omnichannel refuses a
   payment upload before then (409) and that message is shown as it comes.

   The same page runs the farmer journey's steps (journeyContract.ts): step 1
   registers farmers (REGISTRATION), step 2 simulates their own onboarding and
   opens the wallets (ACTIVATION), step 3 is Payment runs (PAYMENT). Step 2
   opens once anyone is registered, step 3 once anyone has a wallet (both from
   omnichannel's onboarding-status). A registration run has no
   reconciliation: it posts nothing to the ledger. A flow this environment's
   omnichannel does not have yet says so; it never falls back to ONBOARDING.

   Payment runs also take KTDA's SAP export, checked here first by the KTDA
   back office's rules (bulk/SapFileCheck.tsx), and where omnichannel has
   maker-checker a payment run stops at SUBMITTED after Process: a different
   signed-in operator releases it (bulk/RunApproval.tsx). Both are read from
   omnichannel's answers; without them the page works as it always has.

   Payment runs come in two kinds, side by side on /bulk/payments: Credit
   wallets (PAYMENT) and Pay to M-PESA (PAYOUT, ?flow=payout; bulk/Payout.tsx).
   A payout run takes the accounting file only, opens once the institution has
   a funded farmer, and after its release pays each row from the farmer's
   wallet to their M-PESA. */

const POLL_MS = 1000;
/** A SUBMITTED run waits for a person, so it is read less often. */
const WAIT_POLL_MS = 3000;
const TERMINAL = new Set(["COMPLETED", "PARTIAL", "FAILED"]);

const COPY: Record<BulkFlow, { title: string; subtitle: string; processed: string; other: { label: string; to: string } }> = {
  ONBOARDING: {
    title: "Bulk onboarding",
    subtitle: "Today's one-step onboarding: each farmer in the file gets a phone and PIN login, a profile and an empty KES wallet at once.",
    processed: "Wallets created",
    other: { label: "Farmer journey", to: "/journey" },
  },
  REGISTRATION: {
    title: "Register farmers",
    subtitle: "Step 1: upload grower numbers with basic details. This creates each farmer's record only: no wallet and no PIN.",
    processed: stepFor("REGISTRATION")!.processed,
    other: { label: "Farmer journey", to: "/journey" },
  },
  ACTIVATION: {
    title: "Farmer onboarding (simulated)",
    subtitle: "Step 2: in real life each farmer finishes onboarding in the app or on the web. This file stands in for them, and opens each farmer's KES wallet.",
    processed: stepFor("ACTIVATION")!.processed,
    other: { label: "Farmer journey", to: "/journey" },
  },
  PAYMENT: {
    title: "Bulk payments",
    subtitle: "Step 3: upload a payment file to credit farmers' wallets. Re-uploading a file is safe: each payment_ref is applied once.",
    processed: stepFor("PAYMENT")!.processed,
    other: { label: "Farmer journey", to: "/journey" },
  },
  PAYOUT: {
    title: "Pay to M-PESA",
    subtitle: "Upload a payment file to pay farmers out of their wallets to their M-PESA. After a second operator releases the run, each row is drawn from the farmer's wallet and sent through SasaPay. Each payment_ref is paid once.",
    processed: "Sent to M-PESA",
    other: { label: "Farmer journey", to: "/journey" },
  },
};

/** /bulk/payments: Credit wallets, or Pay to M-PESA with ?flow=payout. */
export function PaymentRuns() {
  const [params] = useSearchParams();
  const flow: BulkFlow = params.get("flow") === "payout" ? "PAYOUT" : "PAYMENT";
  return <BulkLoad key={flow} flow={flow} />;
}

/** Why the page cannot name its institution, from omnichannel's list of the
 *  caller's own (one entry when scoping works). */
function institutionProblem(count: number): string | null {
  if (count === 1) return null;
  if (count === 0) return "Omnichannel did not name an institution for this back office, so no file can be loaded.";
  return `Omnichannel listed ${count} institutions instead of this back office's own, so it is not separating institutions yet. No file can be loaded until it does.`;
}

export default function BulkLoad({ flow }: { flow: BulkFlow }) {
  const copy = COPY[flow];
  const { user } = useAuth();
  const me = user?.email ? omniSubjectFor(user.email) : null;
  const own = useAsyncData(() => bulkLoads.ownInstitution());
  // The engine's names, for an institution omnichannel has no name for yet.
  const engine = useAsyncData(() => tokenConsole.institutions());
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<FileSummary | null>(null);
  /** PAYMENT: which payment file was picked; null before, or for neither. */
  const [format, setFormat] = useState<PaymentFormat | null>(null);
  const sap = useSapCheck();
  const control = useControlSheet();
  /** A SAP file this omnichannel took but cannot read yet: stored, not started. */
  const [sapNotTaken, setSapNotTaken] = useState(false);
  /** A SAP file's pay period (YYYY-MM), sent with it; from the file name when it carries one. */
  const [period, setPeriod] = useState("");
  /** REGISTRATION: farmers held as CLASH after the run (the phone is another farmer's). */
  const [clashes, setClashes] = useState<number | null>(null);
  /** Omnichannel's error code for a refused upload. */
  const [uploadCode, setUploadCode] = useState<string | null>(null);
  const [run, setRunState] = useState<BulkRun | null>(null);
  /** When the run was last read, for the throughput of a run still going. */
  const [seenAt, setSeenAt] = useState(0);
  const setRun = (r: BulkRun | null) => {
    setRunState(r);
    setSeenAt(Date.now());
  };
  /** Process was accepted, so the run is moving and worth polling. */
  const [started, setStarted] = useState(false);
  /** What the run should credit (cents), kept with the run it was sent in:
   *  the file less the lines that will be held. */
  const [expectedCents, setExpectedCents] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [recon, setRecon] = useState<BulkReconciliation | null>(null);
  const [reconError, setReconError] = useState<string | null>(null);
  const [reconTick, setReconTick] = useState(0);
  /** Why this run has no reconciliation to show (a registration run, say). */
  const [noRecon, setNoRecon] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const mine = useMemo(() => own.data ?? [], [own.data]);
  const problem = own.data ? institutionProblem(mine.length) : null;
  const institutionId = !problem ? mine[0]?.id ?? "" : "";
  const nameOf = (id: string | null | undefined) =>
    (id && mine.find((i) => i.id === id)?.name) || (engine.data ?? []).find((i) => i.institutionId === id)?.name || null;

  const history = useAsyncData(() => bulkLoads.recent());
  // Steps 2 and 3 open on omnichannel's own answer (onboarding-status); it
  // refuses the upload (409) either way.
  const gateKey = GATE[flow] ?? null;
  const gate = useAsyncData(async () => (gateKey && institutionId ? bulkLoads.onboardingStatus(institutionId) : null));
  const { reload: reloadGate } = gate;
  useEffect(() => {
    if (gateKey) void reloadGate();
  }, [gateKey, institutionId, reloadGate]);

  // An omnichannel without the journey has no registrationCompleted.
  const stepGateMissing = flow === "ACTIVATION" && !!gate.data && gate.data.registrationCompleted === undefined;
  const stepGate = flow === "ACTIVATION"
    ? { loading: gate.loading && !gate.data, error: gate.error, open: gate.data?.registrationCompleted === true, missing: stepGateMissing, reload: gate.reload }
    : null;
  const payout = flow === "PAYOUT";
  /** A payment run of either kind: submitted, then released by someone else. */
  const paying = flow === "PAYMENT" || payout;
  const payoutGate = usePayoutOpen(gate, payout);
  const paymentsClosed = (flow === "PAYMENT" && gate.data?.onboardingCompleted !== true) || (!!stepGate && !stepGate.open) || (payout && !payoutGate.open);
  const busy = !!run && run.status === "RUNNING" && !sapNotTaken;
  const waiting = !!run && run.status === "SUBMITTED";

  // Poll while the run is moving, or waiting for its release (which another
  // operator gives elsewhere); each answer schedules the next.
  useEffect(() => {
    if (!run || !started || !(run.status === "RUNNING" || run.status === "SUBMITTED") || pollError || sapNotTaken) return;
    let stopped = false;
    const timer = setTimeout(async () => {
      try {
        const next = await bulkLoads.run(run.runId);
        if (!stopped) {
          setRunState(next);
          setSeenAt(Date.now());
        }
      } catch (e) {
        if (!stopped) setPollError(e instanceof Error ? e.message : "Could not read the run.");
      }
    }, run.status === "SUBMITTED" ? WAIT_POLL_MS : POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run, started, pollError, pollTick, sapNotTaken]);

  // Once the run ends: the reconciliation, once, and fresh history and gate.
  const finishedId = run && TERMINAL.has(run.status) ? run.runId : null;
  // What omnichannel says the run sends to the wallets (a SAP file) wins over
  // the browser's own sum; cents from its exact KES amount.
  const runExpected = run?.payableAmount != null ? Math.round(run.payableAmount * 100) : null;
  useEffect(() => {
    if (!finishedId) return;
    let stopped = false;
    setReconError(null);
    setNoRecon(null);
    void history.reload();
    if (gateKey) void reloadGate();
    if (!HAS_RECONCILIATION[flow]) {
      setNoRecon("A registration run posts nothing to the ledger, so it has no reconciliation.");
      // Farmers whose phone is already another farmer's are held as CLASH.
      if (flow === "REGISTRATION") {
        farmersApi.summary().then(
          (s) => { if (!stopped) setClashes(s.available ? s.data.clash ?? null : null); },
          () => { if (!stopped) setClashes(null); },
        );
      }
      return () => {
        stopped = true;
      };
    }
    // A SAP file with no line for a wallet ends at upload: nothing reached the ledger.
    if (run?.fileFormat === "SAP" && run.payableCount === 0) {
      setNoRecon("No line of this file was sent to the wallets, so the ledger has nothing to reconcile. The exception report says why.");
      return;
    }
    bulkLoads.reconciliation(finishedId, paying ? runExpected ?? expectedCents : null).then(
      (r) => { if (!stopped) setRecon(r); },
      (e) => {
        if (stopped) return;
        // An activation run that opened no wallet has nothing to reconcile.
        if (flow === "ACTIVATION" && e instanceof OmniApiError && e.status === 409) {
          setNoRecon("No farmer in the file was eligible, so no wallet was opened and there is nothing to reconcile.");
        } else {
          setReconError(e instanceof Error ? e.message : "Could not read the reconciliation.");
        }
      },
    );
    return () => {
      stopped = true;
    };
    // history.reload is stable; the expected total belongs to the run it was sent with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedId, reconTick]);

  const upload = useAction(async () => {
    if (!file || !institutionId) throw new Error("Choose the file first.");
    setUploadCode(null);
    try {
      return await bulkLoads.upload(flow, institutionId, file, nameOf(institutionId), "KES", format === "SAP" ? period : null);
    } catch (e) {
      // The page acts on omnichannel's code (DUPLICATE_FILE), not only its words.
      setUploadCode(e instanceof OmniApiError ? e.code : null);
      throw e;
    }
  });
  const process = useAction((runId: string) => bulkLoads.process(runId));
  const release = useAction((runId: string) => bulkLoads.release(runId));

  // The file picked last: a slower read of an earlier pick must not land on it.
  const picked = useRef<File | null>(null);
  const pickFile = async (f: File | null) => {
    picked.current = f;
    setFile(f);
    setSummary(null);
    setFormat(null);
    sap.reset();
    upload.reset();
    if (!f) return;
    // A payout takes the accounting file only.
    if (flow !== "PAYMENT") {
      setSummary(summariseCsv(flow, await f.text()));
      return;
    }
    // A payment file is either the accounting file or the SAP export; the
    // first line says which. Only the accounting file is read whole here: the
    // SAP check streams in a worker, so 600,000 lines never block the page.
    const first = (await f.slice(0, 16_384).text()).split(/\r?\n/)[0] ?? "";
    if (picked.current !== f) return;
    const kind = paymentFormatOf(first);
    setFormat(kind);
    if (kind === "SAP") {
      setPeriod(periodFromName(f.name) ?? "");
      setSummary({ rows: 0, total: null, problem: null, warnings: [] });
      sap.start(f);
    } else if (kind === "SIMPLE") {
      const text = await f.text();
      if (picked.current === f) setSummary(summariseCsv(flow, text));
    } else {
      setSummary({ rows: 0, total: null, problem: first.trim() === "" ? "The file is empty." : `This isn't a payment file. ${formatProblem(first)}`, warnings: [] });
    }
  };

  const startProcess = async (runId: string) => {
    const r = await process.run(runId);
    if (!r) return;
    setRun(r);
    setStarted(true);
    // The list should say what the run is now (SUBMITTED), not what upload said.
    void history.reload();
  };

  const onProcess = async () => {
    setRecon(null);
    setReconError(null);
    setPollError(null);
    setStarted(false);
    setSapNotTaken(false);
    release.reset();
    const staged = await upload.run();
    if (!staged) return;
    setRun(staged);
    setExpectedCents(format === "SAP" && sap.state.kind === "done" ? sap.state.done.result.expectedCents : summary?.expectedCents ?? null);
    void history.reload();
    // An omnichannel without the SAP adapter answers like it always has; it
    // would read the SAP columns as the accounting file's, so the run is
    // left unstarted and nothing is paid.
    if (format === "SAP" && !readsSapFiles(staged) && staged.status !== "SUBMITTED") {
      setSapNotTaken(true);
      return;
    }
    // Ended at upload already (a SAP file with no line for a wallet): nothing to start.
    if (TERMINAL.has(staged.status)) {
      setStarted(true);
      return;
    }
    // Submitted on upload already: it waits for its release.
    if (staged.status === "SUBMITTED") {
      setStarted(true);
      return;
    }
    await startProcess(staged.runId);
  };

  const onRelease = async () => {
    if (!run) return;
    const r = await release.run(run.runId);
    if (!r) return;
    setRun(r);
    setStarted(true);
    void history.reload();
  };

  const startAgain = () => {
    setRun(null);
    setStarted(false);
    setRecon(null);
    setReconError(null);
    setPollError(null);
    setExpectedCents(null);
    picked.current = null;
    setPeriod("");
    setClashes(null);
    setUploadCode(null);
    setFile(null);
    setSummary(null);
    setFormat(null);
    setSapNotTaken(false);
    sap.reset();
    void control.pick(null);
    setFileInputKey((k) => k + 1);
    upload.reset();
    process.reset();
    release.reset();
  };

  /** A run from the history, reopened (a page reload mid-run, say). */
  const open = (r: BulkRun) => {
    startAgain();
    setRun(r);
    setStarted(true);
  };

  const sapWhy = sizeBlocker(file, MAX_UPLOAD_MB) ?? (format === "SAP" ? sapBlocker(sap.state, control.state, period) : null);
  // While a run waits for its release the file is already in; sending it
  // again would only be refused as the same file.
  const canProcess = !!institutionId && !!file && !!summary && !summary.problem && !paymentsClosed && !busy && !waiting
    && !upload.pending && !process.pending && !sapWhy;
  // A "same file" refusal names the run that already has it.
  const earlier = upload.error ? earlierRunIn(upload.error) : null;
  const duplicate = uploadCode === ERR.DUPLICATE_FILE;
  /** Opens the run a "same file" refusal names, from the list or read on its own (it may be older than the list). */
  const openEarlier = async (runId: string) => {
    const listed = (history.data ?? []).find((r) => r.runId === runId);
    const r = listed ?? (await bulkLoads.run(runId).catch(() => null));
    if (r) open(r);
  };
  const myRuns = (history.data ?? []).filter((r) => r.flow === flow && (!institutionId || r.institutionId === institutionId));

  return (
    <div>
      <PageHeader
        eyebrow={stepFor(flow) ? `Farmer journey · step ${stepFor(flow)!.n} of ${JOURNEY.length}` : payout ? "KTDA · Payment runs" : "KTDA"}
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <Link to={copy.other.to} className="text-sm font-medium text-primary-600 hover:text-primary-700">{copy.other.label} →</Link>
        }
      />

      {paying && <PaymentKindSwitch active={payout ? "PAYOUT" : "PAYMENT"} />}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Step n={1} title="Institution">
          {own.error ? (
            <SourceError what="this back office's institution" error={own.error} onRetry={own.reload} className="" />
          ) : own.loading && !own.data ? (
            <Skeleton className="h-11" />
          ) : problem ? (
            <div data-testid="institution-problem"><NotePanel tone="danger">{problem}</NotePanel></div>
          ) : (
            <div data-testid="institution">
              <div className="text-[15px] font-semibold text-text">{nameOf(institutionId) ?? "Unnamed institution"}</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-text-faint">{institutionId}</div>
              <p className="mt-2 text-[12.5px] text-text-soft">Set for this back office. Every run here is for this institution.</p>
            </div>
          )}
          {flow === "PAYMENT" && institutionId && <PaymentGate gate={gate} />}
          {stepGate && institutionId && <ActivationGate gate={stepGate} />}
          {payout && institutionId && <PayoutGate gate={payoutGate} />}
        </Step>

        <Step n={2} title="File">
          <p className="mb-3 text-[12.5px] text-text-soft">
            {COLUMNS[flow].byName ? (
              <>
                A CSV with a header row naming its columns, in any order. Needed: <code className="tabular text-text">{COLUMNS[flow].required.join(", ")}</code>
                {COLUMNS[flow].optional.length > 0 && <>; optional: <code className="tabular text-text">{COLUMNS[flow].optional.join(", ")}</code></>}.
                {" "}No value may contain a comma.{COLUMNS[flow].notes && <> {COLUMNS[flow].notes}</>}
              </>
            ) : flow === "PAYMENT" ? (
              <>
                KTDA&apos;s SAP payment export as it comes (LineNo, GNo, Name, WalletID, Phone, Factory, Centre, Kg, Rate, Gross, deductions, Amount, PayTo), checked here before it is sent.
                {" "}Or the accounting file with the header <code className="tabular text-text">{BULK_COLUMNS[flow].join(",")}</code>, each amount_kes under KES {MAX_PAYMENT_KES.toLocaleString()}, to 2 decimals.
              </>
            ) : payout ? (
              <>
                The accounting file with the header <code className="tabular text-text">{BULK_COLUMNS[flow].join(",")}</code>, each amount_kes under KES {MAX_PAYMENT_KES.toLocaleString()}, to 2 decimals.
                {" "}Each row is drawn from that farmer&apos;s wallet and paid to their M-PESA.
              </>
            ) : (
              <>
                A CSV with a header row: <code className="tabular text-text">{BULK_COLUMNS[flow].join(",")}</code>.
              </>
            )}
          </p>
          <FileHelp flow={flow} />
          <Field label="CSV file">
            <input
              key={fileInputKey}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              disabled={busy || paymentsClosed}
              onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-text-soft file:mr-3 file:h-9 file:rounded-md file:border file:border-border file:bg-surface-sunken file:px-3 file:text-sm file:text-text disabled:opacity-50"
            />
          </Field>
          {file && format === "SAP" && (
            <p className="mt-3 text-[12.5px] text-text-soft" data-testid="sap-picked">
              <span className="font-medium text-text">{file.name}</span>: KTDA SAP export. {sap.state.kind === "checking" ? "Checking it now…" : sap.state.kind === "done" ? "Checked; the result is below." : sap.state.kind === "error" ? "It could not be checked; see below." : ""}
            </p>
          )}
          {file && summary && format !== "SAP" && (
            <div className="mt-3 text-[12.5px]" data-testid="file-summary">
              {summary.problem ? (
                <p role="alert" className="text-danger">{summary.problem}</p>
              ) : (
                <p className="text-text-soft">
                  <span className="font-medium text-text">{file.name}</span>: {units(summary.rows)} row{summary.rows === 1 ? "" : "s"}
                  {summary.total != null && <>, total {money(summary.total, "KES")}</>}
                  {summary.expectedCents != null && summary.total != null && summary.expectedCents !== Math.round(summary.total * 100) && (
                    <>; expected to credit <span className="tabular font-medium text-text" data-testid="file-expected">{kesCents(summary.expectedCents)}</span></>
                  )}
                </p>
              )}
              {summary.warnings.map((w) => <p key={w} className="mt-1 text-warning">{w}</p>)}
            </div>
          )}
        </Step>
      </div>

      {file && format === "SAP" && sap.state.kind !== "idle" && (
        <GlassPanel className="mb-6 p-5" data-testid="file-check-panel">
          <SectionTitle title="File check" />
          <SapFileCheck
            check={sap.state}
            control={control.state}
            onRetry={() => sap.start(file)}
            onControl={(f) => void control.pick(f)}
            disabled={busy || paymentsClosed}
            period={period}
            onPeriod={setPeriod}
          />
        </GlassPanel>
      )}

      <Step n={3} title={paying ? "Submit" : "Process"} className="mb-6">
        {paying && (
          <p className="mb-3 text-[12.5px] text-text-soft">
            Where omnichannel has approvals, a submitted run waits until a different signed-in operator releases it; until then nothing is paid.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!canProcess} onClick={() => void onProcess()} aria-describedby={sapWhy && file ? "process-why" : undefined}>
            {paying ? <Send size={14} /> : <Play size={14} />}{" "}
            {upload.pending ? "Uploading…" : process.pending ? (paying ? "Submitting…" : "Starting…") : busy && started ? "Processing…" : paying ? "Submit" : "Process"}
          </Button>
          {run && !busy && <Button variant="outline" onClick={startAgain}><FileUp size={14} /> Start another</Button>}
          {run && <span className="tabular text-xs text-text-faint">Run {run.runId}</span>}
        </div>
        {sapWhy && file && !run && (
          <p id="process-why" className="mt-2 text-[12.5px] text-text-soft" data-testid="process-blocked">{sapWhy}</p>
        )}
        {upload.error === NOT_AVAILABLE || upload.error === PAYOUT_NOT_AVAILABLE ? (
          <div data-testid="not-available" className="mt-3">
            <NotePanel tone="info" title="Not available on this environment yet">{upload.error.replace(/^Not available on this environment yet: /, "")}</NotePanel>
          </div>
        ) : upload.error && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-danger" data-testid="upload-error">
            <span>{upload.error}</span>
            {duplicate && earlier && <Button size="sm" variant="outline" onClick={() => void openEarlier(earlier)}>Open the earlier run</Button>}
          </div>
        )}
        {sapNotTaken && run && (
          <div className="mt-3" data-testid="sap-not-taken">
            <NotePanel tone="info" title="This omnichannel does not take the SAP export yet">
              The file was stored as run {run.runId} but not started, so nothing was paid. Send the accounting file ({BULK_COLUMNS.PAYMENT.join(",")}) on this environment, or wait for the omnichannel release with the SAP adapter.
            </NotePanel>
          </div>
        )}
        {process.error && run && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-danger">
            <span>The file was uploaded but could not be started: {process.error}</span>
            <Button size="sm" variant="outline" onClick={() => void startProcess(run.runId)}>Try again</Button>
          </div>
        )}
        {pollError && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-danger">
            <span>Lost track of the run: {pollError}</span>
            <Button size="sm" variant="outline" onClick={() => { setPollError(null); setPollTick((t) => t + 1); }}>Resume</Button>
          </div>
        )}
        {run && hasApproval(run) && (
          <RunApproval run={run} me={me} pending={release.pending} error={release.error} onRelease={() => void onRelease()} />
        )}
        {run && payout && waiting && <PayoutRows run={run} />}
        {run && !sapNotTaken && !waiting && <Progress run={run} seenAt={seenAt} processedLabel={copy.processed} skippedHint={stepFor(flow)?.skipped ?? (payout ? "Paid already" : "Already applied")} />}
        {run && !TERMINAL.has(run.status) && !sapNotTaken && <RunChecks runId={run.runId} checks={run} currency={run.currency} />}
      </Step>

      {run && TERMINAL.has(run.status) && (
        <Step n={4} title="Result" className="mb-6">
          {payout ? <PayoutOutcomeNote run={run} /> : <Outcome run={run} />}
          {run.completedAt && (
            <p className="mt-2 text-[12.5px] text-text-soft" data-testid="run-total-time">
              Total time <span className="tabular font-medium text-text">{duration((Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000)}</span>
              {" "}· started {dateTime(run.startedAt)}, finished {dateTime(run.completedAt)}
            </p>
          )}
          <RunChecks runId={run.runId} checks={recon?.fileFormat ? recon : run} currency={run.currency} />
          {payout && <PayoutRows run={run} />}
          {flow === "PAYMENT" && <RefusedLines runId={run.runId} refusals={hasRefusals(recon) ? recon : run} currency={run.currency} />}
          {flow === "REGISTRATION" && clashes != null && clashes > 0 && (
            <div className="mt-4" data-testid="clash-note">
              <NotePanel tone="warning" title={`${units(clashes)} farmer${clashes === 1 ? "" : "s"} held as a clash`}>
                Their phone is already another farmer&apos;s login, so they were put on the register with no login and cannot be activated or paid until the phone is put right.{" "}
                <Link className="font-medium text-primary-600 hover:text-primary-700" to="/farmers?state=CLASH">See who and why</Link>.
              </NotePanel>
            </div>
          )}
          {noRecon ? (
            <p className="mt-4 text-[12.5px] text-text-soft" data-testid="no-recon">{noRecon}</p>
          ) : reconError ? (
            <SourceError what="the reconciliation" error={reconError} onRetry={() => setReconTick((t) => t + 1)} className="mt-4" />
          ) : recon && payout ? (
            <PayoutReconPanel recon={recon} currency={run.currency} />
          ) : recon ? (
            <ReconPanel recon={recon} institutionName={recon.institutionName ?? nameOf(recon.institutionId)} />
          ) : (
            <Skeleton className="mt-4 h-32" />
          )}
        </Step>
      )}

      <ConsoleTable<BulkRun>
        title="Recent runs"
        description={`${copy.title} runs for ${nameOf(institutionId) ?? "this institution"}, newest first. Open one to see its result.`}
        what="the recent runs"
        source={history}
        rows={myRuns}
        newest={(r) => r.startedAt}
        rowId={(r) => r.runId}
        onRowClick={(r) => open(r)}
        selectedId={run?.runId ?? null}
        emptyLabel="No runs yet"
        columns={[
          { key: "when", header: "Started", className: "whitespace-nowrap", render: (r) => <span className="tabular text-xs text-text-soft">{dateTime(r.startedAt)}</span> },
          { key: "file", header: "File", render: (r) => <span className="text-[13px] text-text break-all">{r.sourceName}</span> },
          { key: "rows", header: "Rows", render: (r) => <span className="tabular text-[13px]">{units(r.totalRows)}</span> },
          { key: "done", header: "Done / skipped / failed", hideOnMobile: true, render: (r) => <span className="tabular text-xs text-text-soft">{units(r.processedCount)} / {units(r.skippedCount)} / {units(r.failureCount)}</span> },
          ...(paying
            ? [{ key: "amount", header: payout ? "Paid out" : "Credited", render: (r: BulkRun) => <span className="tabular text-[13px]">{money(r.totalAmount, r.currency)}</span> }]
            : []),
          ...(myRuns.some(hasApproval)
            ? [{ key: "who", header: "Submitted / released by", hideOnMobile: true, render: (r: BulkRun) => <span className="text-xs text-text-soft break-all">{hasApproval(r) ? `${staffName(r.submittedBy)} / ${r.releasedBy ? staffName(r.releasedBy) : "—"}` : "—"}</span> }]
            : []),
          { key: "status", header: "Status", render: (r) => <RunBadge status={r.status} /> },
        ]}
      />
      {paying && <DemoSasaPay />}
    </div>
  );
}

function Step({ n, title, className, children }: { n: number; title: string; className?: string; children: ReactNode }) {
  return (
    <GlassPanel className={`p-5 ${className ?? ""}`} data-testid={`step-${n}`}>
      <SectionTitle title={`${n}. ${title}`} />
      {children}
    </GlassPanel>
  );
}

function PaymentGate({ gate }: { gate: { data: { onboardingCompleted: boolean } | null; loading: boolean; error: string | null; reload: () => Promise<void> } }) {
  if (gate.error) return <SourceError what="whether onboarding has completed" error={gate.error} onRetry={gate.reload} className="mt-3" />;
  if (gate.loading || !gate.data) return <Skeleton className="mt-3 h-10" />;
  if (gate.data.onboardingCompleted) {
    return <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-success"><CheckCircle2 size={14} /> Farmers have wallets. Payments are open.</p>;
  }
  return (
    <NotePanel tone="warning" className="mt-3" title="Payments are closed">
      No farmer of this institution has a wallet yet, so there is nothing to credit.
      Run <Link className="font-medium text-primary-600 hover:text-primary-700" to="/journey/activate">step 2, farmer onboarding</Link> first
      (on this environment today: <Link className="font-medium text-primary-600 hover:text-primary-700" to="/bulk/onboarding">bulk onboarding</Link>).
    </NotePanel>
  );
}

function ActivationGate({ gate }: { gate: { loading: boolean; error: string | null; open: boolean; missing: boolean; reload: () => Promise<void> } }) {
  if (gate.error) return <SourceError what="whether anyone is registered" error={gate.error} onRetry={gate.reload} className="mt-3" />;
  if (gate.loading) return <Skeleton className="mt-3 h-10" />;
  if (gate.missing) {
    return (
      <div data-testid="not-available" className="mt-3">
        <NotePanel tone="info" title="Not available on this environment yet">{NOT_AVAILABLE.replace(/^Not available on this environment yet: /, "")}</NotePanel>
      </div>
    );
  }
  if (gate.open) {
    return <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-success"><CheckCircle2 size={14} /> Farmers are on the register. This step is open.</p>;
  }
  return (
    <NotePanel tone="warning" className="mt-3" title="Step 2 is closed">
      Nobody is on this institution's register yet, so there is no farmer to onboard.
      Run <Link className="font-medium text-primary-600 hover:text-primary-700" to="/journey/register">step 1, register farmers</Link> first.
    </NotePanel>
  );
}

/** The flow's header-only template, and the demo's matching sample file. */
function FileHelp({ flow }: { flow: BulkFlow }) {
  const sample = SAMPLE_FILES[flow];
  const link = "inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary-600 hover:text-primary-700";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <a className={link} href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(flow))}`} download={templateName(flow)}>
        <Download size={13} /> Download template
      </a>
      {sample && (
        <a className={link} href={`${import.meta.env.BASE_URL}${sample}`} download>
          <Info size={13} /> Sample file (five test farmers)
        </a>
      )}
    </div>
  );
}

/** SUBMITTED reads as what it means here: waiting for a second operator. */
function RunBadge({ status }: { status: string }) {
  return status === "SUBMITTED" ? <Badge tone="warning" className="whitespace-nowrap">Awaiting release</Badge> : <StatusBadge status={status} />;
}

function Progress({ run, seenAt, processedLabel, skippedHint }: { run: BulkRun; seenAt: number; processedLabel: string; skippedHint: string }) {
  const counted = run.processedCount + run.skippedCount + run.failureCount;
  // Held and bank/SACCO lines never go to the ledger, so they are settled at
  // upload; counted unless that would pass the file (they are failures there).
  const aside = (run.heldCount ?? 0) + (run.routedCount ?? 0);
  const done = aside > 0 && counted + aside <= run.totalRows ? counted + aside : counted;
  const end = run.completedAt ? Date.parse(run.completedAt) : seenAt;
  const seconds = Math.max(0, (end - Date.parse(run.startedAt)) / 1000);
  const rate = seconds >= 1 ? Math.round(done / seconds) : null;
  const pct = run.totalRows > 0 ? Math.min(100, (done / run.totalRows) * 100) : run.status === "RUNNING" ? 0 : 100;
  const tone = run.status === "FAILED" ? "danger" : run.status === "PARTIAL" ? "warning" : "primary";
  return (
    <div className="mt-5" data-testid="run-progress">
      <div className="mb-2 flex items-center justify-between gap-3 text-[12.5px] text-text-soft">
        <span className="flex items-center gap-2"><RunBadge status={run.status} /> {units(done)} of {units(run.totalRows)} rows</span>
        <span className="tabular">{Math.floor(pct)}%</span>
      </div>
      <ProgressBar value={pct} tone={tone} />
      <div className={`mt-4 grid grid-cols-2 gap-3 ${readsSapFiles(run) && run.fileFormat === "SAP" ? "md:grid-cols-4 xl:grid-cols-8" : "md:grid-cols-6"}`}>
        <StatCard label="Rows read" value={units(run.totalRows)} />
        <StatCard label={processedLabel} value={units(run.processedCount)} />
        <StatCard label="Skipped" value={units(run.skippedCount)} hint={skippedHint} />
        <StatCard label="Failed" value={units(run.failureCount)} />
        {run.fileFormat === "SAP" && (
          <>
            <StatCard label="Bank or SACCO" value={units(run.routedCount)} hint={`${money(run.routedAmount, run.currency)}, not paid to wallets by this run`} />
            <StatCard label="Held" value={units(run.heldCount)} hint={`${money(run.heldAmount, run.currency)}, never paid`} />
          </>
        )}
        <StatCard label="Throughput" value={rate == null ? "—" : `${units(rate)}/s`} hint={run.flow === "PAYMENT" || run.flow === "PAYOUT" ? money(run.totalAmount, run.currency) : undefined} />
        <StatCard label={run.completedAt ? "Total time" : "Elapsed"} value={duration(seconds)} hint={run.completedAt ? undefined : "so far"} />

      </div>
    </div>
  );
}

/** COMPLETED green, PARTIAL amber, FAILED red; the message always on the last two. */
function Outcome({ run }: { run: BulkRun }) {
  if (run.status === "COMPLETED") {
    return (
      <NotePanel tone="success" title="Completed">
        {run.fileFormat === "SAP"
          ? "Every line sent to the wallets was applied or had been already."
          : "Every row was applied or had been already."}
        {run.message ? ` ${run.message}` : ""}
      </NotePanel>
    );
  }
  const partial = run.status === "PARTIAL";
  // A SAP run with held lines ends PARTIAL even when every line sent was paid.
  const onlyHeld = partial && run.failureCount === 0 && (run.heldCount ?? 0) > 0;
  // Every failure is a line the ledger refused and reported (each with its reason below).
  const onlyRefused = partial && run.refusedCount != null && run.failureCount > 0 && run.failureCount === run.refusedCount;
  const title = onlyHeld ? "Completed, with held lines"
    : onlyRefused ? "Completed, with lines the ledger refused"
    : partial ? "Partly completed: some rows failed" : "Failed";
  return (
    <NotePanel tone={partial ? "warning" : "danger"} title={title}>
      <span className="whitespace-pre-wrap" data-testid="run-message">{run.message ?? "The service gave no reason."}</span>
    </NotePanel>
  );
}

function ReconPanel({ recon, institutionName }: { recon: BulkReconciliation; institutionName: string | null }) {
  const payment = recon.flow === "PAYMENT";
  return (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-border p-4" data-testid="recon-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Reconciliation</h3>
        <div className="flex flex-wrap gap-2">
          <Check ok={recon.doubleEntryBalanced} yes="Double entry balanced" no="Double entry not balanced" />
          {payment && recon.matchesExpected != null && (
            <Check ok={recon.matchesExpected} yes="Matches the expected total" no="Does not match the expected total" />
          )}
        </div>
      </div>
      {payment && hasRefusals(recon) && recon.expectedTotal != null && (
        <p className="mb-3 text-[12.5px] text-text-soft" data-testid="recon-rule">
          {recon.matchRule ? `The ledger's rule: ${recon.matchRule}.` : "The ledger checks posted + already applied + refused against the expected total."}
          {" "}A line it refuses (a grower with no wallet, say) is accounted for, not a mismatch.
        </p>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
        <Row k="Institution" v={institutionName ?? recon.institutionId} />
        <Row k="Wallets held" v={units(recon.walletCount)} />
        <Row k="Processed" v={units(recon.processedCount)} />
        <Row k="Skipped" v={units(recon.skippedCount)} />
        <Row k="Failed" v={units(recon.failureCount)} />
        {payment && (
          <>
            <Row k="Credited by this run" v={money(recon.creditedTotal, "KES")} />
            {hasRefusals(recon) && <Row k="Refused by the ledger" v={`${units(recon.refusedCount)} · ${money(recon.refusedAmount ?? 0, "KES")}`} />}
            <Row k={recon.fileFormat === "SAP" ? "Expected (wallet lines that pass)" : "Expected (rows that will be credited)"} v={recon.expectedTotal == null ? "Not checked" : money(recon.expectedTotal, "KES")} />
            <Row k="Deposit debits" v={money(recon.depositDebitTotal, "KES")} />
            <Row k="Deposit credits" v={money(recon.depositCreditTotal, "KES")} />
          </>
        )}
      </dl>
    </div>
  );
}
