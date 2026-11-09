import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Download, RotateCcw } from "lucide-react";
import { Badge, Button, Field, Input, NotePanel, Pagination, SectionTitle, GlassPanel, Skeleton, Tabs } from "../../../ui";
import { useAsyncData } from "../../../lib/useAsyncData";
import { useAction } from "../../../lib/tokenConsole/useAction";
import { dateTime, money, units } from "../../../lib/tokenConsole/format";
import { bulkLoads, PAYOUT_OUTCOMES, type BulkRun, type PayoutOutcome, type PayoutReconciliation, type PayoutRow } from "../../../lib/api.bulkLoad";
import { farmersApi } from "../../../lib/api.farmers";
import { mockSasapay, type MockPayout } from "../../../lib/api.mockSasapay";
import { SourceError, StatusBadge } from "../../../components/tokenconsole/ConsoleTable";
import { saveBlob } from "./rules";
import { Check, Row } from "./shared";

/* Pay to M-PESA (bulk-loads flow PAYOUT): the same payment file and release
   step as a wallet credit run, but after release each row draws its amount
   from the farmer's wallet and pays it to their M-PESA through SasaPay. Here:
   the switch between the two kinds of payment run, the gate (the institution
   has funded farmers), the run's rows by outcome, its reconciliation, and the
   demo's mock SasaPay panel. */

/** Where a failed payout is retried. */
export const ISSUES_LINK = "/token-console/transactions?tab=issues";

const OUTCOME_LABEL: Record<PayoutOutcome, string> = {
  SENT: "Sent",
  FAILED: "Failed",
  REFUSED: "Refused",
  ALREADY_PAID: "Already paid",
  PLANNED: "Planned",
};
const OUTCOME_TONE: Record<PayoutOutcome, "success" | "danger" | "warning" | "neutral" | "info"> = {
  SENT: "success",
  FAILED: "danger",
  REFUSED: "warning",
  ALREADY_PAID: "neutral",
  PLANNED: "info",
};
const isOutcome = (v: string): v is PayoutOutcome => (PAYOUT_OUTCOMES as string[]).includes(v);

/** Credit wallets or Pay to M-PESA: the two payment runs, side by side. */
export function PaymentKindSwitch({ active }: { active: "PAYMENT" | "PAYOUT" }) {
  const item = (to: string, label: string, on: boolean) => (
    <Link
      to={to}
      role="tab"
      aria-selected={on}
      className={`inline-flex h-8 items-center rounded-md px-3.5 text-[13px] font-medium whitespace-nowrap ${on ? "bg-surface text-text shadow-sm" : "text-text-soft hover:text-text"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mb-5" data-testid="payment-kind">
      <div role="tablist" aria-label="Kind of payment run" className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-sunken p-1">
        {item("/bulk/payments", "Credit wallets", active === "PAYMENT")}
        {item("/bulk/payments?flow=payout", "Pay to M-PESA", active === "PAYOUT")}
      </div>
    </div>
  );
}

type GateSource = { data: { payoutReady?: boolean } | null; loading: boolean; error: string | null; reload: () => Promise<void> };

/** Open once the institution has a FUNDED farmer: omnichannel's payoutReady,
 *  or, on an omnichannel without it, the farmers summary's funded count. */
export function usePayoutOpen(gate: GateSource, on: boolean) {
  const missing = on && !!gate.data && gate.data.payoutReady === undefined;
  const summary = useAsyncData(async () => (missing ? farmersApi.summary() : null));
  const { reload } = summary;
  useEffect(() => { if (missing) void reload(); }, [missing, reload]);
  if (!on) return { open: true, loading: false, error: null as string | null, reload: gate.reload };
  if (gate.error) return { open: false, loading: false, error: gate.error, reload: gate.reload };
  if (!gate.data) return { open: false, loading: true, error: null, reload: gate.reload };
  if (!missing) return { open: gate.data.payoutReady === true, loading: false, error: null, reload: gate.reload };
  if (summary.error) return { open: false, loading: false, error: summary.error, reload: summary.reload };
  if (!summary.data) return { open: false, loading: true, error: null, reload: summary.reload };
  return { open: summary.data.available && summary.data.data.funded > 0, loading: false, error: null, reload: summary.reload };
}

export function PayoutGate({ gate }: { gate: ReturnType<typeof usePayoutOpen> }) {
  if (gate.error) return <SourceError what="whether any farmer is funded" error={gate.error} onRetry={gate.reload} className="mt-3" />;
  if (gate.loading) return <Skeleton className="mt-3 h-10" />;
  if (gate.open) {
    return <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-success" data-testid="payout-gate"><CheckCircle2 size={14} /> Farmers have funded wallets. Payouts are open.</p>;
  }
  return (
    <NotePanel tone="warning" className="mt-3" title="Payouts are closed">
      <span data-testid="payout-gate">
        No farmer of this institution has been funded yet, so there is no wallet to pay out of.
        {" "}<Link className="font-medium text-primary-600 hover:text-primary-700" to="/bulk/payments">Credit wallets</Link> first.
      </span>
    </NotePanel>
  );
}

/** The wording of a finished PAYOUT run. */
export function PayoutOutcomeNote({ run }: { run: BulkRun }) {
  if (run.status === "COMPLETED") {
    return <NotePanel tone="success" title="Completed: all sent">Every row was paid to the farmer&apos;s M-PESA, or had been already.{run.message ? ` ${run.message}` : ""}</NotePanel>;
  }
  const partial = run.status === "PARTIAL";
  return (
    <NotePanel tone={partial ? "warning" : "danger"} title={partial ? "Partly paid: some payouts failed" : "Failed: none paid"}>
      <span className="whitespace-pre-wrap" data-testid="run-message">{run.message ?? "The service gave no reason."}</span>
      {" "}Retry failed payouts on the <Link className="font-medium text-primary-600 hover:text-primary-700" to={ISSUES_LINK}>payments issues list</Link>.
    </NotePanel>
  );
}


/** The run's rows, one outcome at a time, and the exception report. */
export function PayoutRows({ run }: { run: BulkRun }) {
  // Before its release a run's rows are all still to pay (or refused at upload).
  const [outcome, setOutcome] = useState<PayoutOutcome>(
    run.status === "SUBMITTED" || run.status === "RUNNING" ? "PLANNED" : run.failureCount > 0 ? "FAILED" : "SENT",
  );
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const rows = useAsyncData(() => bulkLoads.payoutRows(run.runId, outcome, page, size));
  const { reload } = rows;
  useEffect(() => { void reload(); }, [outcome, page, size, reload]);
  const report = useAction(async () => {
    const { filename, blob } = await bulkLoads.exceptions(run.runId);
    saveBlob(filename, blob);
  });
  const all = useAction(async () => {
    const { filename, blob } = await bulkLoads.payoutRowsCsv(run.runId);
    saveBlob(filename, blob);
  });
  const items: PayoutRow[] = rows.data?.items ?? [];

  return (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-border p-4" data-testid="payout-rows">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Payouts</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={all.pending} onClick={() => void all.run()}>
            <Download size={13} /> {all.pending ? "Downloading…" : "All rows CSV"}
          </Button>
          <Button size="sm" variant="outline" disabled={report.pending} onClick={() => void report.run()}>
            <Download size={13} /> {report.pending ? "Downloading…" : "Exceptions CSV"}
          </Button>
        </div>
      </div>
      {all.error && <p role="alert" className="mb-2 text-[12.5px] text-danger">Could not download the rows: {all.error}</p>}
      {report.error && <p role="alert" className="mb-2 text-[12.5px] text-danger">Could not download the exceptions: {report.error}</p>}
      <Tabs
        className="mb-3"
        active={outcome}
        onChange={(k) => { if (isOutcome(k)) { setOutcome(k); setPage(1); } }}
        tabs={PAYOUT_OUTCOMES.map((o) => ({ key: o, label: OUTCOME_LABEL[o], count: o === outcome && rows.data ? rows.data.total : undefined }))}
      />
      {outcome === "FAILED" && (
        <p className="mb-3 text-[12.5px] text-text-soft">
          Each message is the provider&apos;s own words. Retry these on the{" "}
          <Link className="font-medium text-primary-600 hover:text-primary-700" to={ISSUES_LINK}>payments issues list</Link>.
        </p>
      )}
      {rows.error ? <SourceError what="the payouts" error={rows.error} onRetry={rows.reload} className="" />
        : !rows.data ? <Skeleton className="h-24" />
        : items.length === 0 ? <p className="py-4 text-center text-[12.5px] text-text-soft" data-testid="payout-rows-empty">No {OUTCOME_LABEL[outcome].toLowerCase()} rows.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]" data-testid="payout-table">
              <thead className="text-left text-[12px] text-text-soft">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Row</th>
                  <th className="px-2 py-1.5 font-medium">Grower</th>
                  <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                  <th className="px-2 py-1.5 font-medium">Payment ref</th>
                  <th className="px-2 py-1.5 font-medium">Outcome</th>
                  <th className="px-2 py-1.5 font-medium">Message</th>
                  <th className="px-2 py-1.5 font-medium">Payment</th>
                  <th className="px-2 py-1.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={`${r.row}-${r.paymentRef}`} className="border-t border-border/60">
                    <td className="tabular px-2 py-1.5">{r.row}</td>
                    <td className="px-2 py-1.5"><Link className="font-medium text-primary-600 hover:text-primary-700" to={`/farmers/${encodeURIComponent(r.grower)}`}>{r.grower}</Link></td>
                    <td className="tabular px-2 py-1.5 text-right">{money(r.amount, r.currency || run.currency)}</td>
                    <td className="tabular px-2 py-1.5 break-all">{r.paymentRef}</td>
                    <td className="px-2 py-1.5">{isOutcome(r.outcome) ? <Badge tone={OUTCOME_TONE[r.outcome]} className="whitespace-nowrap">{OUTCOME_LABEL[r.outcome]}</Badge> : <StatusBadge status={r.outcome} />}</td>
                    <td className="px-2 py-1.5 text-text-soft">{r.message || "—"}</td>
                    <td className="tabular px-2 py-1.5 text-xs text-text-soft break-all">{r.paymentId || "—"}</td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 text-xs text-text-soft">{r.at ? dateTime(r.at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination className="mt-3" page={page} pageSize={size} total={rows.data.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} disabled={rows.loading} />
          </div>
        )}
    </div>
  );
}

/* The reconciliation: the ledger's checks, then a count and an amount per
   outcome. */
const GROUPS = [
  { label: "Sent to M-PESA", count: "sentCount", amount: "sentAmount" },
  { label: "Failed", count: "failedCount", amount: "failedAmount" },
  { label: "Refused", count: "refusedCount", amount: "refusedAmount" },
  { label: "Already paid", count: "alreadyPaidCount", amount: "alreadyPaidAmount" },
] as const;

export function PayoutReconPanel({ recon, currency }: { recon: PayoutReconciliation; currency: string }) {
  const rows = GROUPS.map((g) => ({ label: g.label, count: recon[g.count] ?? null, amount: recon[g.amount] ?? null }))
    .filter((r) => r.count != null || r.amount != null);
  return (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-border p-4" data-testid="payout-recon">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Reconciliation</h3>
        <div className="flex flex-wrap gap-2">
          {typeof recon.doubleEntryBalanced === "boolean" && <Check ok={recon.doubleEntryBalanced} yes="Double entry balanced" no="Double entry not balanced" />}
          {recon.matchesExpected != null && <Check ok={recon.matchesExpected} yes="Sent matches the expected total" no="Sent does not match the expected total" />}
        </div>
      </div>
      {recon.matchRule && <p className="mb-3 text-[12.5px] text-text-soft" data-testid="recon-rule">The ledger&apos;s rule: {recon.matchRule}.</p>}
      <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
        {recon.walletCount != null && <Row k="Farmers paid" v={units(recon.walletCount)} />}
        {rows.map((r) => <Row key={r.label} k={r.label} v={`${r.count != null ? units(r.count) : "—"}${r.amount != null ? ` · ${money(r.amount, currency)}` : ""}`} />)}
        {recon.creditedTotal != null && <Row k="Amount sent" v={money(recon.creditedTotal, currency)} />}
        <Row k="Expected (rows to pay)" v={recon.expectedTotal == null ? "Not checked" : money(recon.expectedTotal, currency)} />
      </dl>
    </div>
  );
}

/* ---- Demo SasaPay: the mock provider omnichannel serves on the demo ---- */

export function DemoSasaPay() {
  const state = useAsyncData(() => mockSasapay.get());
  const [working, setWorking] = useState("");
  const [utility, setUtility] = useState("");
  const reset = useAction(async () => {
    const body: { workingBalance?: number; utilityBalance?: number } = {};
    if (working.trim()) body.workingBalance = Number(working);
    if (utility.trim()) body.utilityBalance = Number(utility);
    if (Object.values(body).some((n) => !Number.isFinite(n) || n < 0)) throw new Error("A balance must be a number of zero or more.");
    return mockSasapay.reset(body);
  });
  // A 404 (the mock is off) or an unreadable answer shows nothing.
  if (state.error || !state.data || !state.data.available) return null;
  const m = state.data.data;
  const cur = m.currency || "KES";
  const raw = m as unknown as Record<string, unknown>;
  const payouts = (Array.isArray(m.payouts) ? m.payouts : Array.isArray(raw.lastPayouts) ? raw.lastPayouts : []) as MockPayout[];

  const onReset = async () => {
    const r = await reset.run();
    if (r) {
      setWorking("");
      setUtility("");
      void state.reload();
    }
  };

  return (
    <GlassPanel className="mt-6 p-5" data-testid="demo-sasapay">
      <SectionTitle title="Demo SasaPay" />
      <p className="mb-3 text-[12.5px] text-text-soft">
        The mock M-PESA provider this demo pays through. {m.enabled ? "It is on." : "It is off."} No real money moves.
      </p>
      <dl className="mb-4 grid gap-3 text-[13px] sm:grid-cols-2">
        <div className="rounded-[var(--radius-lg)] border border-border p-3"><dt className="text-text-soft">Working balance</dt><dd className="tabular text-lg font-semibold text-text" data-testid="sasapay-working">{money(m.workingBalance ?? 0, cur)}</dd></div>
        <div className="rounded-[var(--radius-lg)] border border-border p-3"><dt className="text-text-soft">Utility balance</dt><dd className="tabular text-lg font-semibold text-text" data-testid="sasapay-utility">{money(m.utilityBalance ?? 0, cur)}</dd></div>
      </dl>
      <h3 className="mb-2 text-[13px] font-semibold text-text">Last payouts</h3>
      {payouts.length === 0 ? <p className="mb-4 text-[12.5px] text-text-soft">None yet.</p> : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-[12.5px]" data-testid="sasapay-payouts">
            <thead className="text-left text-[12px] text-text-soft">
              <tr><th className="px-2 py-1.5 font-medium">Receiver</th><th className="px-2 py-1.5 text-right font-medium">Amount</th><th className="px-2 py-1.5 font-medium">Result</th><th className="px-2 py-1.5 font-medium">When</th></tr>
            </thead>
            <tbody>
              {payouts.map((p, i) => (
                <tr key={p.reference ?? i} className="border-t border-border/60">
                  <td className="tabular px-2 py-1.5">{p.receiver ?? "—"}</td>
                  <td className="tabular px-2 py-1.5 text-right">{p.amount != null ? money(p.amount, p.currency || cur) : "—"}</td>
                  <td className="px-2 py-1.5"><StatusBadge status={p.result} /></td>
                  <td className="tabular whitespace-nowrap px-2 py-1.5 text-xs text-text-soft">{p.at ? dateTime(p.at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Working balance (KES)"><Input inputMode="decimal" value={working} onChange={(e) => setWorking(e.target.value)} placeholder="unchanged" className="w-40" /></Field>
        <Field label="Utility balance (KES)"><Input inputMode="decimal" value={utility} onChange={(e) => setUtility(e.target.value)} placeholder="unchanged" className="w-40" /></Field>
        <Button variant="outline" disabled={reset.pending} onClick={() => void onReset()}><RotateCcw size={14} /> {reset.pending ? "Resetting…" : "Reset"}</Button>
      </div>
      {reset.error && <p role="alert" className="mt-2 text-[12.5px] text-danger">Could not reset the mock: {reset.error}</p>}
    </GlassPanel>
  );
}
