import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Lock } from "lucide-react";
import { Badge, GlassPanel, NotePanel, PageHeader, SectionTitle, Skeleton, StatCard } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { dateTime, units } from "../../lib/tokenConsole/format";
import { bulkLoads, type BulkRun } from "../../lib/api.bulkLoad";
import { farmersApi } from "../../lib/api.farmers";
import { FARMER_STATES, JOURNEY, NOT_AVAILABLE, STATE_LABEL, STATE_MEANS, SUMMARY_KEY, type JourneyStep } from "../../lib/journeyContract";
import { SourceError, StatusBadge } from "../../components/tokenconsole/ConsoleTable";

/* The farmer journey in one place, for a demo walked step by step: register
   (CSV 1), farmer onboarding simulated (CSV 2, opens the wallets), fund
   (CSV 3, Payment runs). Each step shows what its last run did and whether it
   is open (omnichannel's onboarding-status), and if not, why. Below, how many
   of the institution's farmers are at each stage (GET /farmers/summary). The
   flows and endpoints are in journeyContract.ts. */

type Gate = { open: boolean; why: string | null; loading: boolean };

export default function Journey() {
  const own = useAsyncData(() => bulkLoads.ownInstitution());
  const institution = own.data?.length === 1 ? own.data[0] : null;
  const runs = useAsyncData(() => bulkLoads.recent());
  const funding = useAsyncData(async () => (institution ? bulkLoads.onboardingStatus(institution.id) : null));
  const { reload: reloadFunding } = funding;
  const institutionId = institution?.id ?? null;
  useEffect(() => {
    if (institutionId) void reloadFunding();
  }, [institutionId, reloadFunding]);
  const farmers = useAsyncData(() => farmersApi.summary());

  const mine = (runs.data ?? []).filter((r) => !institution || r.institutionId === institution.id);
  const last = (flow: BulkRun["flow"]) =>
    mine.filter((r) => r.flow === flow).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

  const gateFor = (step: JourneyStep): Gate => {
    if (step.n === 1) return { open: true, why: null, loading: false };
    if ((funding.loading || !own.data) && !funding.data && !funding.error) return { open: false, why: null, loading: true };
    if (funding.error) return { open: false, why: `Could not check whether this step is open: ${funding.error}`, loading: false };
    if (step.n === 2) {
      if (funding.data && funding.data.registrationCompleted === undefined) {
        return { open: false, why: "Not available on this environment yet: omnichannel here does not have the farmer journey.", loading: false };
      }
      return funding.data?.registrationCompleted
        ? { open: true, why: null, loading: false }
        : { open: false, why: "Waiting for step 1: nobody is on the register yet.", loading: false };
    }
    return funding.data?.onboardingCompleted
      ? { open: true, why: null, loading: false }
      : { open: false, why: "Waiting for step 2: no farmer has a wallet yet, so there is nothing to credit.", loading: false };
  };

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="Farmer journey"
        subtitle="Three uploads take a farmer from registered to activated (wallet open) to funded. Walk them in order."
        actions={<Link to="/farmers" className="text-sm font-medium text-primary-600 hover:text-primary-700">Farmers →</Link>}
      />

      {own.error && <SourceError what="this back office's institution" error={own.error} onRetry={own.reload} />}
      {runs.error && <SourceError what="the recent runs" error={runs.error} onRetry={runs.reload} />}

      <NotePanel tone="info" className="mb-5" title="Steps 1 and 2 are new">
        Registration on its own, and the simulated farmer onboarding, need a backend change that is not on every environment yet.
        Where it is missing, the step says so instead of running something else.
      </NotePanel>

      <ol className="mb-6 grid gap-4 lg:grid-cols-3" aria-label="Journey steps">
        {JOURNEY.map((step) => (
          <StepCard key={step.n} step={step} gate={gateFor(step)} last={last(step.flow)} loading={runs.loading && !runs.data} />
        ))}
      </ol>

      <GlassPanel className="p-5" data-testid="stage-counts">
        <SectionTitle title="Where the farmers are" />
        {farmers.error ? (
          <SourceError what="the farmers" error={farmers.error} onRetry={farmers.reload} className="" />
        ) : farmers.loading && !farmers.data ? (
          <Skeleton className="h-20" />
        ) : !farmers.data?.available ? (
          <div data-testid="not-available"><NotePanel tone="info" title="Not available on this environment yet">{NOT_AVAILABLE.replace(/^Not available on this environment yet: /, "")}</NotePanel></div>
        ) : (
          <div className={`grid gap-3 ${farmers.data.data.kycPending !== undefined ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
            {FARMER_STATES.map((st) => (
              <StatCard key={st} label={STATE_LABEL[st]} value={units(farmers.data!.available ? farmers.data!.data[SUMMARY_KEY[st]] ?? 0 : 0)} hint={STATE_MEANS[st]} to={`/farmers?state=${st}`} />
            ))}
            {farmers.data.data.kycPending !== undefined && (
              <div data-testid="kyc-pending-tile">
                <StatCard label="KYC to decide" value={units(farmers.data.data.kycPending)} hint="Activated farmers waiting on a compliance decision" to="/farmers?kyc=PENDING" />
              </div>
            )}
          </div>
        )}
        {farmers.data?.available && (farmers.data.data.clash ?? 0) > 0 && (
          <NotePanel tone="warning" className="mt-3" title={`${units(farmers.data.data.clash!)} held as a clash`}>
            Their phone is already another farmer&apos;s login, so they have no login and cannot be activated or paid.{" "}
            <Link className="font-medium text-primary-600 hover:text-primary-700" to="/farmers?state=CLASH">See who and why</Link>.
          </NotePanel>
        )}
      </GlassPanel>
    </div>
  );
}

function StepCard({ step, gate, last, loading }: { step: JourneyStep; gate: Gate; last: BulkRun | null; loading: boolean }) {
  return (
    <li>
      <GlassPanel className="flex h-full flex-col p-5" data-testid={`journey-step-${step.n}`} data-open={gate.open ? "true" : "false"}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">Step {step.n}</span>
          {gate.loading ? <Skeleton className="h-5 w-16" /> : gate.open
            ? <Badge tone="success"><CheckCircle2 size={12} /> Open</Badge>
            : <Badge tone="neutral"><Lock size={12} /> Blocked</Badge>}
        </div>
        <h2 className="text-[15px] font-semibold text-text">{step.title}</h2>
        <p className="mt-1 text-[12.5px] text-text-soft">{step.does}</p>
        {gate.why && <p className="mt-2 text-[12.5px] text-warning" data-testid="blocked-why">{gate.why}</p>}

        <div className="mt-4 border-t border-border/60 pt-3 text-[12.5px]" data-testid="last-run">
          {loading ? <Skeleton className="h-10" /> : last ? (
            <LastRun run={last} processed={step.processed} />
          ) : (
            <span className="text-text-faint">No run yet.</span>
          )}
        </div>

        <div className="mt-auto pt-4">
          <Link to={step.to} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700">
            {gate.open ? "Go to step" : "Open step"} {step.n} <ArrowRight size={14} />
          </Link>
        </div>
      </GlassPanel>
    </li>
  );
}

function LastRun({ run, processed }: { run: BulkRun; processed: string }) {
  const line = (k: string, v: ReactNode) => (
    <div className="flex justify-between gap-3"><span className="text-text-soft">{k}</span><span className="tabular text-text">{v}</span></div>
  );
  return (
    <div className="space-y-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-text-faint">Last run, {dateTime(run.startedAt)}</span>
        <StatusBadge status={run.status} />
      </div>
      {line(processed, units(run.processedCount))}
      {line("Skipped / failed", `${units(run.skippedCount)} / ${units(run.failureCount)}`)}
      {line("File", <span className="break-all">{run.sourceName}</span>)}
    </div>
  );
}
