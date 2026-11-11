import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight, Download } from "lucide-react";
import { Badge, Button, Field, NotePanel, PageHeader, Skeleton, StatCard, Tabs, Textarea, useToast } from "../../../ui";
import { useAsyncData } from "../../../lib/useAsyncData";
import { useAction } from "../../../lib/tokenConsole/useAction";
import { dateTime, money, units } from "../../../lib/tokenConsole/format";
import { saveDownload } from "../../../lib/tokenConsole/reporting";
import { useAuth } from "../../../lib/auth";
import { ACT } from "../../../lib/staffContract";
import { OmniApiError } from "../../../lib/omniApi";
import { reconciliationApi } from "../../../lib/api.reconciliation";
import { approvalLink } from "../../../lib/approvalsContract";
import {
  MATCHED_BY_LABEL, NOTE_MAX, OUTCOME_LABEL, OUTCOME_MEANS, OUTCOME_TONE, OUTCOMES, RESOLVE_MAX, lineRef, periodText, selectable,
  type ReconciliationLine, type ReconciliationOutcome, type ReconciliationRun,
} from "../../../lib/reconciliationContract";
import { SourceError } from "../../../components/tokenconsole/ConsoleTable";
import { ActionModal } from "../../../components/tokenconsole/ActionModal";

/* One reconciliation run: its counts, then every line by outcome, each with
   the statement's side and the ledger's (a dash where one is missing). An
   exception is resolved with a note; a resolved one can be noted again (the
   first note counts). "Export exceptions" is the CSV for working them
   outside the page. Linkable as ?outcome=LEDGER_ONLY&page=2.

   A note is proposed, not applied: it goes to a second person in the
   Approvals queue, and the line stays open (and counted in "Exceptions
   open") until they approve. A waiting line shows the request and has no
   Resolve. Open exceptions can be ticked, across tabs and pages, and
   resolved together under one note and one approval (at most 200). */

const SIZE = 25;
type Tab = ReconciliationOutcome | "ALL";
const isOutcome = (v: string | null): v is ReconciliationOutcome => !!v && (OUTCOMES as string[]).includes(v);
const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : String(v));

type Loaded = { found: true; run: ReconciliationRun } | { found: false };
async function load(id: string): Promise<Loaded> {
  try {
    return { found: true, run: await reconciliationApi.run(id) };
  } catch (e) {
    if (e instanceof OmniApiError && (e.status === 404 || e.status === 400)) return { found: false };
    throw e;
  }
}

export default function ReconciliationRunPage() {
  const id = useParams().id ?? "";
  const toast = useToast();
  const mayRun = useAuth().can(ACT.reconciliationRun);
  const [params, setParams] = useSearchParams();
  const outcome = isOutcome(params.get("outcome")) ? (params.get("outcome") as ReconciliationOutcome) : null;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const set = (next: { outcome?: Tab; page?: number }) => setParams(() => {
    const p = new URLSearchParams(window.location.search);
    if (next.outcome) {
      if (next.outcome === "ALL") p.delete("outcome");
      else p.set("outcome", next.outcome);
    }
    if (next.page && next.page > 1) p.set("page", String(next.page));
    else p.delete("page");
    return p;
  }, { replace: true });

  const loaded = useAsyncData(() => load(id));
  const run = loaded.data?.found ? loaded.data.run : null;
  const lines = useAsyncData(() => reconciliationApi.lines(id, outcome, page, SIZE));
  const { reload } = lines;
  useEffect(() => { void reload(); }, [outcome, page, reload]);
  const [resolving, setResolving] = useState<ReconciliationLine[] | null>(null);
  // Ticked lines, by id, kept across tabs and pages.
  const [picked, setPicked] = useState<Map<string, ReconciliationLine>>(new Map());
  const full = picked.size >= RESOLVE_MAX;
  const pick = (ls: ReconciliationLine[], on: boolean) => setPicked((cur) => {
    const next = new Map(cur);
    for (const l of ls) {
      if (!on) next.delete(l.id);
      else if (next.size < RESOLVE_MAX) next.set(l.id, l);
    }
    return next;
  });
  const exportCsv = useAction(() => reconciliationApi.exceptions(id));

  const crumb = (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-[12.5px] text-text-soft">
      <Link to="/reconciliation" className="hover:text-text">Reconciliation</Link>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="text-text">{run?.fileName ?? "Run"}</span>
    </nav>
  );

  if (loaded.error) return <div>{crumb}<SourceError what="the run" error={loaded.error} onRetry={loaded.reload} /></div>;
  if (!loaded.data) return <div>{crumb}<Skeleton className="h-48" /></div>;
  if (!run) {
    return (
      <div>
        {crumb}
        <div data-testid="run-not-found"><NotePanel tone="info" title="No such run">This run is not one of this institution&apos;s.</NotePanel></div>
      </div>
    );
  }

  const total = run.matched + run.ledgerOnly + run.statementOnly + run.amountMismatch;
  const count: Record<Tab, number> = { ALL: total, MATCHED: run.matched, LEDGER_ONLY: run.ledgerOnly, STATEMENT_ONLY: run.statementOnly, AMOUNT_MISMATCH: run.amountMismatch };
  const data = lines.data;
  const exceptions = run.ledgerOnly + run.statementOnly + run.amountMismatch;
  const open = data ? data.items.filter(selectable) : [];
  const anyOnPage = open.some((l) => picked.has(l.id));
  // Ticked when every open line here is picked, or as many as the cap allowed.
  const allOnPage = open.length > 0 && (open.every((l) => picked.has(l.id)) || (full && anyOnPage));

  return (
    <div data-testid="run-page">
      {crumb}
      <PageHeader
        eyebrow="KTDA · Reconciliation"
        title={run.fileName ?? "Statement"}
        subtitle={[`Period ${periodText(run)}`, `run ${dateTime(run.createdAt)}`, run.runBy && `by ${run.runBy}`].filter(Boolean).join(" · ")}
        actions={exceptions > 0 && (
          <Button
            variant="outline"
            disabled={exportCsv.pending}
            onClick={async () => {
              const f = await exportCsv.run();
              if (f) saveDownload(f);
              else toast.push("The exceptions could not be exported.", "error");
            }}
          >
            <Download size={14} /> Export exceptions
          </Button>
        )}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="run-tiles">
        <StatCard label="Statement lines" value={units(run.statementLines)} hint={money(run.statementAmount, run.currency)} />
        <StatCard label="Ledger payments" value={units(run.ledgerPayments)} hint={money(run.ledgerAmount, run.currency)} />
        <StatCard label="Matched" value={units(run.matched)} hint={total ? `${Math.round((run.matched / total) * 100)}% of lines` : undefined} />
        <StatCard label="Exceptions open" value={units(run.exceptionsOpen)} hint={`${units(run.resolved)} resolved · open until a resolution is approved`} />
      </div>
      {run.skippedLines > 0 && (
        <p className="mb-4 text-[12.5px] text-text-soft" data-testid="skipped">
          {units(run.skippedLines)} statement {run.skippedLines === 1 ? "line" : "lines"} could not be read (no reference, no amount or a bad number) and {run.skippedLines === 1 ? "was" : "were"} left out.
        </p>
      )}

      <Tabs
        className="mb-3"
        active={outcome ?? "ALL"}
        onChange={(k) => set({ outcome: k as Tab })}
        tabs={(["ALL", ...OUTCOMES] as Tab[]).map((t) => ({ key: t, label: t === "ALL" ? "All" : OUTCOME_LABEL[t], count: count[t] }))}
      />
      {outcome && outcome !== "MATCHED" && <p className="mb-3 text-[12.5px] text-text-soft">{OUTCOME_MEANS[outcome]}</p>}

      {mayRun && picked.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-primary-300 bg-primary-50 px-3 py-2 text-[12.5px]" data-testid="selection-bar">
          <span className="font-medium text-text" data-testid="selected-count">{units(picked.size)} selected</span>
          {full && <span className="text-text-soft" data-testid="selection-full">At most {units(RESOLVE_MAX)} under one note.</span>}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Map())}>Clear</Button>
            <Button size="sm" onClick={() => setResolving([...picked.values()])}>Resolve selected</Button>
          </div>
        </div>
      )}

      {lines.error ? <SourceError what="the lines" error={lines.error} onRetry={lines.reload} /> : !data ? <Skeleton className="h-48" /> : data.items.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="lines-empty">
          {outcome ? `No line is ${OUTCOME_LABEL[outcome].toLowerCase()}.` : "This run has no lines."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full text-[12.5px]" data-testid="lines-table">
            <thead className="bg-surface-sunken text-left text-[11.5px] text-text-soft">
              <tr>
                {mayRun && (
                  <th className="w-8 px-2.5 py-2" rowSpan={2}>
                    <input
                      type="checkbox" aria-label="Select the open exceptions on this page" className="h-4 w-4 cursor-pointer rounded border border-border-strong accent-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
                      checked={allOnPage} disabled={open.length === 0 || (full && !anyOnPage)} onChange={(e) => pick(open, e.target.checked)}
                    />
                  </th>
                )}
                <th className="px-2.5 py-2 font-medium">Outcome</th>
                <th className="border-l border-border px-2.5 py-2 font-medium" colSpan={5}>Statement</th>
                <th className="border-l border-border px-2.5 py-2 font-medium" colSpan={4}>Recorded here</th>
                <th className="border-l border-border px-2.5 py-2 font-medium">Matched by</th>
                <th className="px-2.5 py-2 font-medium">Note</th>
              </tr>
              <tr className="text-[11px]">
                <th className="px-2.5 pb-2" />
                <th className="border-l border-border px-2.5 pb-2 font-normal">Reference</th>
                <th className="px-2.5 pb-2 font-normal">Channel</th>
                <th className="px-2.5 pb-2 font-normal">Phone</th>
                <th className="px-2.5 pb-2 text-right font-normal">Amount</th>
                <th className="px-2.5 pb-2 font-normal">Paid at</th>
                <th className="border-l border-border px-2.5 pb-2 font-normal">Payment ref.</th>
                <th className="px-2.5 pb-2 font-normal">Provider ref.</th>
                <th className="px-2.5 pb-2 text-right font-normal">Amount</th>
                <th className="px-2.5 pb-2 font-normal">Completed</th>
                <th className="border-l border-border px-2.5 pb-2" />
                <th className="px-2.5 pb-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => {
                const s = l.statement;
                const g = l.ledger;
                const exception = l.outcome !== "MATCHED";
                const waiting = l.pendingApproval;
                const can = selectable(l);
                const on = picked.has(l.id);
                return (
                  <tr key={l.id} className={`border-t border-border/60 align-top ${on ? "bg-primary-50/60" : ""}`} data-line={l.id} data-outcome={l.outcome}>
                    {mayRun && (
                      <td className="px-2.5 py-2">
                        {can && (
                          <input
                            type="checkbox" aria-label={`Select ${lineRef(l)}`} className="h-4 w-4 cursor-pointer rounded border border-border-strong accent-primary-600 disabled:cursor-not-allowed disabled:opacity-40" data-testid="line-pick"
                            checked={on} disabled={!on && full} onChange={(e) => pick([l], e.target.checked)}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-2.5 py-2"><Badge tone={OUTCOME_TONE[l.outcome]} className="whitespace-nowrap">{OUTCOME_LABEL[l.outcome]}</Badge></td>
                    <td className="border-l border-border/60 px-2.5 py-2 font-mono" data-testid="statement-ref">{dash(s?.reference)}</td>
                    <td className="px-2.5 py-2">{dash(s?.channel)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono">{dash(s?.phone)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right tabular">{s?.amount !== null && s?.amount !== undefined ? money(s.amount, s.currency ?? run.currency) : "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-text-soft">{s?.paidAt ? dateTime(s.paidAt) : "—"}</td>
                    <td className="border-l border-border/60 px-2.5 py-2 font-mono" data-testid="ledger-ref">{dash(g?.reference)}</td>
                    <td className="px-2.5 py-2 font-mono">{dash(g?.providerRef)}</td>
                    <td className={`whitespace-nowrap px-2.5 py-2 text-right tabular ${l.outcome === "AMOUNT_MISMATCH" ? "font-semibold text-danger" : ""}`}>
                      {g?.amount !== null && g?.amount !== undefined ? money(g.amount, run.currency) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-text-soft">{g?.completedAt ? dateTime(g.completedAt) : "—"}</td>
                    <td className="border-l border-border/60 px-2.5 py-2">{l.matchedBy ? MATCHED_BY_LABEL[l.matchedBy] ?? l.matchedBy : "—"}</td>
                    <td className="min-w-[200px] px-2.5 py-2">
                      {l.note && (
                        <div data-testid="line-note">
                          <div className="text-text">{l.note}</div>
                          <div className="text-[11.5px] text-text-faint">{resolvedLine(l)}</div>
                        </div>
                      )}
                      {waiting && (
                        <div className={l.note ? "mt-2" : ""} data-testid="line-pending">
                          <Link to={approvalLink(waiting.reference)} className="hover:underline">
                            <Badge tone="warning" className="whitespace-nowrap">Awaiting approval {waiting.reference}</Badge>
                          </Link>
                          {waiting.note && <div className="mt-1 text-text">{waiting.note}</div>}
                          <div className="text-[11.5px] text-text-faint">
                            Proposed{waiting.proposedBy ? ` by ${waiting.proposedBy}` : ""}{waiting.proposedAt ? `, ${dateTime(waiting.proposedAt)}` : ""}
                          </div>
                        </div>
                      )}
                      {exception && mayRun && !waiting && (
                        <Button size="sm" variant={l.resolvedAt ? "ghost" : "outline"} className="mt-1" onClick={() => setResolving([l])}>
                          {l.resolvedAt ? "Add a note" : "Resolve"}
                        </Button>
                      )}
                      {!exception && !l.note && <span className="text-text-faint">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12.5px] text-text-soft">
          <span>{units(data.total)} lines · page {page} of {data.pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => set({ page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {resolving && (
        <ResolveModal
          runId={run.id}
          lines={resolving}
          onClose={() => setResolving(null)}
          onDone={(reference) => {
            const many = resolving.length > 1;
            setResolving(null);
            setPicked(new Map());
            toast.push(reference
              ? `Sent for approval as ${reference}. ${many ? "The lines stay" : "The line stays"} open until a second person approves.`
              : "Noted.");
            void lines.reload();
            void loaded.reload();
          }}
        />
      )}
    </div>
  );
}

/** "Resolved by X, approved by Y · AP-10042", or "X, 3 Nov 2026 10:00" from before approvals. */
function resolvedLine(l: ReconciliationLine): ReactNode {
  if (l.approvedBy || l.approvalReference) {
    return (
      <>
        {[l.resolvedBy && `Resolved by ${l.resolvedBy}`, l.approvedBy && `approved by ${l.approvedBy}`].filter(Boolean).join(", ")}
        {l.approvalReference && <> · <Link to={approvalLink(l.approvalReference)} className="hover:underline" data-testid="line-approval">{l.approvalReference}</Link></>}
      </>
    );
  }
  return [l.resolvedBy, l.resolvedAt && dateTime(l.resolvedAt)].filter(Boolean).join(", ");
}

/** One line (Resolve, Add a note) or the ticked ones (Resolve selected), under one note. */
function ResolveModal({ runId, lines, onClose, onDone }: {
  runId: string; lines: ReconciliationLine[]; onClose: () => void; onDone: (reference: string | null) => void;
}) {
  const [note, setNote] = useState("");
  const one = lines.length === 1 ? lines[0] : null;
  const save = useAction(() => (one
    ? reconciliationApi.resolve(runId, one.id, note.trim())
    : reconciliationApi.resolveMany(runId, lines.map((l) => l.id), note.trim())));
  const submit = async () => {
    const r = await save.run();
    if (r) onDone(r.approval?.reference ?? null);
  };
  const again = !!one?.resolvedAt;
  return (
    <ActionModal
      title={one ? `${again ? "Add a note on" : "Resolve"} ${lineRef(one)}` : `Resolve ${units(lines.length)} exceptions`}
      description={one && one.outcome !== "MATCHED" ? OUTCOME_MEANS[one.outcome] : "One note for every line selected."}
      submitLabel="Send for approval"
      pendingLabel="Sending…"
      problem={!note.trim() ? "A note: what was found, and what was done." : undefined}
      pending={save.pending}
      error={save.error}
      onSubmit={() => void submit()}
      onClose={onClose}
      size="sm"
    >
      <NotePanel tone="info" title="A second person approves it">
        The note goes to the Approvals queue. {one ? "The line stays" : "The lines stay"} open, and counted in exceptions open, until someone other than you approves it.
      </NotePanel>
      {one?.note && <p className="text-[12.5px] text-text-soft">Noted already: {one.note}. The first note is the one that counts.</p>}
      <Field label="Note" required hint={`What was found, and what was done. ${note.length}/${NOTE_MAX}`}>
        <Textarea rows={3} aria-label="Note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </ActionModal>
  );
}
