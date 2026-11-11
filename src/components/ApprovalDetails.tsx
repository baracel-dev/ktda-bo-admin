import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, NotePanel, Skeleton } from "../ui";
import { useAsyncData } from "../lib/useAsyncData";
import { calendarDate, dateTime, label, money, units } from "../lib/tokenConsole/format";
import { ratePercent } from "../lib/merchantsAgentsContract";
import { approvalsApi } from "../lib/api.approvals";
import {
  DETAILED_TYPES, TARGET_KIND_LABEL, targetLink,
  type AgentDetails, type Approval, type BulkDecisionDetails, type ChannelAgentDetails, type FarmerDetails, type MerchantDetails,
  type ReconciliationResolveDetails,
} from "../lib/approvalsContract";
import { OUTCOME_LABEL, OUTCOME_TONE, periodText, type ReconciliationOutcome } from "../lib/reconciliationContract";
import { DetailItem } from "./tokenconsole/DetailItem";

/* The approval drawer's "Details": the target as it stands now, from
   GET /approvals/{id}/details, so the checker sees what they are approving.
   Phones and ids come masked. Nothing shows on an omnichannel without the
   read (before approvals v2). */

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : String(v));
const words = (v: string | null | undefined) => (v ? label(v) : "—");
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? "—" : v ? "Yes" : "No");

const SCOPE_WORDS: Record<BulkDecisionDetails["scope"], string> = {
  ALL_PENDING: "every farmer waiting on a KYC decision",
  REGISTRY_MATCH: "the farmers waiting whose registry answer is a match",
  GROWERS: "the grower numbers listed",
};

/** A registry answer other than MATCH is what the checker is asked to override. */
function Identity({ result }: { result: string | null | undefined }) {
  if (!result) return <>—</>;
  return <Badge tone={result === "MATCH" ? "success" : result === "UNCHECKED" ? "neutral" : "danger"}>{label(result)}</Badge>;
}

const isType = (a: Approval, prefix: string) => a.type.startsWith(prefix);

export function ApprovalDetailsSection({ approval }: { approval: Approval }) {
  const details = useAsyncData(() => approvalsApi.details(approval.reference));
  const r = details.data;
  if (details.error || (r && !r.available)) return null;
  if (!r) return <Skeleton className="mb-4 h-24" />;
  const d = r.data;
  if (!d) {
    if (!DETAILED_TYPES.includes(approval.type)) return null;
    return (
      <section aria-label="Details" className="mb-4" data-testid="approval-details">
        <h3 className="mb-2 text-sm font-semibold text-text">Details</h3>
        <p className="text-[12.5px] text-text-soft" data-testid="details-gone">The {(TARGET_KIND_LABEL[approval.target.kind] ?? label(approval.target.kind)).toLowerCase()} is no longer on record. The request still shows.</p>
      </section>
    );
  }
  const bulk = approval.type === "FARMER_KYC_BULK_DECISION" ? (d as BulkDecisionDetails) : null;
  const recon = approval.type === "RECONCILIATION_RESOLVE" ? (d as ReconciliationResolveDetails) : null;
  const open = recon ? "Open the run"
    : approval.target.kind === "AGENT" ? `Open agent ${approval.target.reference}`
    : approval.target.kind === "MERCHANT" ? `Open merchant ${approval.target.reference}`
    : bulk ? "Open the KYC desk" : `Open farmer ${approval.target.reference}`;

  return (
    <section aria-label="Details" className="mb-4 rounded-[var(--radius-lg)] border border-border p-3" data-testid="approval-details">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Details <span className="font-normal text-text-soft">as it stands now</span></h3>
        <Link to={targetLink(approval.target, approval.type, bulk ?? recon, approval.payload)} className="text-[12.5px] font-medium text-primary-600 hover:underline" data-testid="details-link">{open}</Link>
      </div>
      {recon ? <ReconciliationBody d={recon} />
        : bulk ? <BulkBody d={bulk} />
        : isType(approval, "KTDA_AGENT_") ? <ChannelAgentBody d={d as ChannelAgentDetails} />
        : isType(approval, "AGENT_") ? <AgentBody d={d as AgentDetails} />
        : isType(approval, "MERCHANT_") ? <MerchantBody d={d as MerchantDetails} />
        : approval.type === "FARMER_KYC_OVERRIDE" ? <FarmerBody d={d as FarmerDetails} />
        : null}
    </section>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <dl className="grid gap-3 sm:grid-cols-3">{children}</dl>;

function Suspended({ reason, by, at }: { reason: string | null | undefined; by: string | null | undefined; at: string | null | undefined }) {
  if (!reason && !at) return null;
  return (
    <NotePanel tone="warning" title="Suspended" className="mt-3">
      {dash(reason)}{by || at ? ` (${[by, at && dateTime(at)].filter(Boolean).join(", ")})` : ""}
    </NotePanel>
  );
}

function floatLine(balance: number | null | undefined, limit: number | null | undefined, low: boolean | null | undefined) {
  return (
    <>
      {money(balance ?? null, "KES")}
      {limit !== null && limit !== undefined && <span className="text-text-soft"> of {money(limit, "KES")}</span>}
      {low && <Badge tone="warning" className="ml-2">Low</Badge>}
    </>
  );
}

function AgentBody({ d }: { d: AgentDetails }) {
  return (
    <>
      <Grid>
        <DetailItem term="Agent">{dash(d.fullName)} <span className="font-mono text-[12.5px] text-text-soft">{d.agentNo}</span></DetailItem>
        <DetailItem term="Phone"><span className="font-mono">{dash(d.phone)}</span></DetailItem>
        <DetailItem term="Town">{dash(d.town)}</DetailItem>
        <DetailItem term="Status">{words(d.status)}</DetailItem>
        <DetailItem term="Float">{floatLine(d.floatBalance, d.floatLimit, d.floatLow)}</DetailItem>
        <DetailItem term="Joined">{calendarDate(d.joinedAt)}</DetailItem>
      </Grid>
      <Suspended reason={d.suspensionReason} by={d.suspendedBy} at={d.suspendedAt} />
    </>
  );
}

function ChannelAgentBody({ d }: { d: ChannelAgentDetails }) {
  return (
    <>
      <Grid>
        <DetailItem term="Agent">{dash(d.fullName)} <span className="font-mono text-[12.5px] text-text-soft">{d.agentNo}</span></DetailItem>
        <DetailItem term="Phone"><span className="font-mono">{dash(d.phone)}</span></DetailItem>
        <DetailItem term="Town">{dash(d.town)}</DetailItem>
        <DetailItem term="Status">{words(d.status)}</DetailItem>
        <DetailItem term="Float">{floatLine(d.float?.balance, d.float?.limit, d.float?.low)}</DetailItem>
        <DetailItem term="Today">{d.today?.transactions !== null && d.today?.transactions !== undefined ? `${units(d.today.transactions)} transactions` : "—"}</DetailItem>
      </Grid>
      <Suspended reason={d.suspension?.reason} by={d.suspension?.by} at={d.suspension?.at} />
    </>
  );
}

function MerchantBody({ d }: { d: MerchantDetails }) {
  return (
    <Grid>
      <DetailItem term="Merchant">{dash(d.name)} <span className="font-mono text-[12.5px] text-text-soft">{d.reference}</span></DetailItem>
      <DetailItem term="Kind">{words(d.type)}</DetailItem>
      <DetailItem term="Where">{[d.town, d.county].filter(Boolean).join(", ") || "—"}</DetailItem>
      <DetailItem term="Owner">{dash(d.ownerName)}{d.ownerPhone && <span className="block font-mono text-[12.5px] text-text-soft">{d.ownerPhone}</span>}</DetailItem>
      <DetailItem term="Till">{dash(d.tillNo)}</DetailItem>
      <DetailItem term="Registration no.">{dash(d.registrationNo)}</DetailItem>
      <DetailItem term="BRS answer">
        <span data-testid="details-brs">{words(d.brsStatus)}</span>
        {(d.brsRegisteredName || d.brsRegisteredOwner) && (
          <span className="block text-[12.5px] text-text-soft">{[d.brsRegisteredName, d.brsRegisteredOwner && `owner ${d.brsRegisteredOwner}`].filter(Boolean).join(", ")}</span>
        )}
        {d.brsCheckedAt && <span className="block text-[12px] text-text-faint">Checked {dateTime(d.brsCheckedAt)}</span>}
      </DetailItem>
      <DetailItem term="KYB">
        {words(d.kybStatus)}
        {d.kybNote && <span className="block text-[12.5px] text-text-soft">{d.kybNote}</span>}
        {d.kybDecidedAt && <span className="block text-[12px] text-text-faint">Decided {dateTime(d.kybDecidedAt)}</span>}
      </DetailItem>
      <DetailItem term="Settlement">{dash(d.settlementBank)}{d.settlementAccount && <span className="block font-mono text-[12.5px] text-text-soft">{d.settlementAccount}</span>}</DetailItem>
      <DetailItem term="Commission">{ratePercent(d.commissionRate)}</DetailItem>
      <DetailItem term="Accepts vouchers">{yesNo(d.acceptsVouchers)}</DetailItem>
      <DetailItem term="Joined">{calendarDate(d.joinedAt)}</DetailItem>
    </Grid>
  );
}

function FarmerBody({ d }: { d: FarmerDetails }) {
  return (
    <Grid>
      <DetailItem term="Farmer">{dash(d.fullName)} <span className="font-mono text-[12.5px] text-text-soft">{d.growerNo}</span></DetailItem>
      <DetailItem term="Factory">{dash(d.factory)}</DetailItem>
      <DetailItem term="Phone"><span className="font-mono">{dash(d.phone)}</span></DetailItem>
      <DetailItem term="ID number"><span className="font-mono">{dash(d.nationalId)}</span></DetailItem>
      <DetailItem term="Stage">{words(d.state)}</DetailItem>
      <DetailItem term="KYC">{words(d.kycStatus)}{d.kycStartedAt && <span className="block text-[12px] text-text-faint">Started {dateTime(d.kycStartedAt)}</span>}</DetailItem>
      <DetailItem term="Registry answer"><span data-testid="details-identity"><Identity result={d.identityResult} /></span></DetailItem>
      <DetailItem term="KYC note">{dash(d.kycNote)}</DetailItem>
      <DetailItem term="Joined via">{words(d.onboardingChannel)}{d.onboardingAgentNo ? ` (agent ${d.onboardingAgentNo})` : ""}</DetailItem>
      <DetailItem term="Activated">{calendarDate(d.activatedAt)}</DetailItem>
      <DetailItem term="Last paid">{calendarDate(d.lastFundedAt)}</DetailItem>
    </Grid>
  );
}

function BulkBody({ d }: { d: BulkDecisionDetails }) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-semibold tabular text-text" data-testid="details-total">{units(d.total)}</span>
        <span className="text-[13px] text-text-soft">
          farmers would be {d.decision === "VERIFIED" ? "verified" : d.decision === "REJECTED" ? "rejected" : label(d.decision).toLowerCase()}: {SCOPE_WORDS[d.scope] ?? label(d.scope)}
          {d.scope === "GROWERS" && d.listed !== null ? ` (${units(d.listed)} listed)` : ""}, as it stands now.
        </span>
      </div>
      {d.note && <p className="mb-3 text-[12.5px] text-text">Note on the decision: {d.note}</p>}
      {d.sample.length > 0 && (
        <>
          <div className="mb-1 text-[12px] text-text-soft">The first {units(d.sample.length)} by grower number{d.total > d.sample.length ? ` of ${units(d.total)}` : ""}:</div>
          <div className="max-h-64 overflow-auto rounded-md border border-border">
            <table className="w-full text-[12px]" data-testid="details-sample">
              <thead className="sticky top-0 bg-surface-sunken text-left text-text-soft">
                <tr><th className="px-2 py-1.5 font-medium">Grower no.</th><th className="px-2 py-1.5 font-medium">Name</th><th className="px-2 py-1.5 font-medium">Factory</th><th className="px-2 py-1.5 font-medium">KYC</th><th className="px-2 py-1.5 font-medium">Registry</th></tr>
              </thead>
              <tbody>
                {d.sample.map((f) => (
                  <tr key={f.growerNo} className="border-t border-border/60">
                    <td className="px-2 py-1 font-mono">{f.growerNo}</td>
                    <td className="px-2 py-1">{dash(f.fullName)}</td>
                    <td className="px-2 py-1">{dash(f.factory)}</td>
                    <td className="px-2 py-1">{words(f.kycStatus)}</td>
                    <td className="px-2 py-1"><Identity result={f.identityResult} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

const amount = (v: number | null | undefined) => (v === null || v === undefined ? "—" : money(v, "KES"));

/** RECONCILIATION_RESOLVE: the run, the proposed note, and both sides of each line it would close. */
function ReconciliationBody({ d }: { d: ReconciliationResolveDetails }) {
  return (
    <>
      <Grid>
        <DetailItem term="Statement">{dash(d.fileName)}</DetailItem>
        <DetailItem term="Period">{periodText(d)}</DetailItem>
        <DetailItem term="Exceptions open in the run">{units(d.exceptionsOpen)}</DetailItem>
      </Grid>
      <p className="my-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[13px] text-text" data-testid="details-note">
        <span className="text-text-soft">Proposed note: </span>{dash(d.note)}
      </p>
      <div className="mb-1 text-[12px] text-text-soft">{units(d.lines.length)} {d.lines.length === 1 ? "line" : "lines"} it would close:</div>
      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <table className="w-full text-[12px]" data-testid="details-lines">
          <thead className="sticky top-0 bg-surface-sunken text-left text-text-soft">
            <tr>
              <th className="px-2 py-1.5 font-medium">Outcome</th>
              <th className="border-l border-border px-2 py-1.5 font-medium">Statement ref.</th>
              <th className="px-2 py-1.5 text-right font-medium">Amount</th>
              <th className="px-2 py-1.5 font-medium">Paid at</th>
              <th className="border-l border-border px-2 py-1.5 font-medium">Payment ref.</th>
              <th className="px-2 py-1.5 text-right font-medium">Amount</th>
              <th className="px-2 py-1.5 font-medium">Completed</th>
              <th className="border-l border-border px-2 py-1.5 font-medium">Note now</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => {
              const o = l.outcome as ReconciliationOutcome;
              return (
                <tr key={l.id} className="border-t border-border/60 align-top" data-line={l.id}>
                  <td className="px-2 py-1"><Badge tone={OUTCOME_TONE[o] ?? "neutral"} className="whitespace-nowrap">{OUTCOME_LABEL[o] ?? label(l.outcome)}</Badge></td>
                  <td className="border-l border-border/60 px-2 py-1 font-mono">{dash(l.statementReference)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular">{amount(l.statementAmount)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-text-soft">{l.paidAt ? dateTime(l.paidAt) : "—"}</td>
                  <td className="border-l border-border/60 px-2 py-1 font-mono">{dash(l.providerReference ?? l.paymentReference)}</td>
                  <td className={`whitespace-nowrap px-2 py-1 text-right tabular ${o === "AMOUNT_MISMATCH" ? "font-semibold text-danger" : ""}`}>{amount(l.paymentAmount)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-text-soft">{l.completedAt ? dateTime(l.completedAt) : "—"}</td>
                  <td className="border-l border-border/60 px-2 py-1">{l.resolved ? <Badge tone="success">Resolved</Badge> : null} {l.currentNote ?? (l.resolved ? "" : "—")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
