import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, FilterBar, NotePanel, PageHeader, SearchInput, SectionTitle, Skeleton, Tabs, Modal, useToast } from "../../ui";
import { omniApi, type QueuedDocument } from "../../lib/omniApi";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { calendarDate, label, units } from "../../lib/tokenConsole/format";
import { canDecideKyc } from "../../lib/tokenConsole/kyc";
import { DOC_ORDER } from "../../lib/tokenConsole/identity";
import { useAuth } from "../../lib/auth";
import { ACT } from "../../lib/staffContract";
import { Allowed } from "../../components/Allowed";
import { farmersApi } from "../../lib/api.farmers";
import {
  IDENTITY_LABEL, IDENTITY_TONE, KYC_LABEL, KYC_TONE, NOT_AVAILABLE, STATE_LABEL, STATE_TONE,
  type Farmer, type KycStatus,
} from "../../lib/journeyContract";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { ApplicantPhotos, ApplicationSection } from "../../components/tokenconsole/IdentityReview";
import { CustomerPhotos } from "../../components/tokenconsole/CustomerPhotos";
import { customerDeskLink } from "../../lib/tokenConsole/customerSearch";
import { Rescreening } from "../../components/tokenconsole/Rescreening";
import { FarmerKyc } from "../ktda/FarmerKyc";
import { KycSweep } from "../ktda/KycSweep";
import { KycBulkDecision } from "../ktda/KycBulkDecision";

/* The KYC desk: this institution's farmers by where their KYC stands (not
   started, to decide, verified, rejected), so staff always see where
   everyone is. All from omnichannel, which answers only for this
   institution: the farmer list with ?kyc= and the counts from the summary.
   A row opens the farmer: their KYC (Start KYC, Approve or Reject with a
   note, through the farmer endpoints, as on the profile), and the
   application and photos found through their app profile (customerId).
   "Start KYC for all activated farmers" (the sweep) sits on Not started.
   Applicants who are not farmers are not listed: a KTDA back office has
   none. */

const SIZE = 20;
type Tab = KycStatus | "ALL";
const TABS: Tab[] = ["PENDING", "NONE", "VERIFIED", "REJECTED", "ALL"];
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);
const COUNT_KEY = { NONE: "none", PENDING: "pending", VERIFIED: "verified", REJECTED: "rejected" } as const;
const EMPTY: Record<Tab, string> = {
  PENDING: "No farmer is waiting on a KYC decision.",
  NONE: "Every activated farmer's KYC has started.",
  VERIFIED: "No farmer is verified yet.",
  REJECTED: "No farmer has been rejected.",
  ALL: "No farmers registered yet.",
};
const activated = (f: Farmer) => f.status === "ACTIVATED" || f.status === "FUNDED";

export default function TokenConsoleKyc() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get("kyc")) ? (params.get("kyc") as Tab) : "PENDING";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [typed, setTyped] = useState(q);
  // ?grower= opens that farmer (the farmer profile links here).
  const [open, setOpen] = useState<string | null>(params.get("grower"));

  const set = (next: { kyc?: Tab; q?: string; page?: number }) => {
    // From the address as it is now, not as this render saw it: a delayed
    // search must not undo a tab chosen meanwhile. (React Router's own
    // updater hands back the render's copy, so read the location itself.)
    setParams(() => {
      const p = new URLSearchParams(window.location.search);
      if (next.kyc) p.set("kyc", next.kyc);
      if ("q" in next) {
        if (next.q?.trim()) p.set("q", next.q.trim());
        else p.delete("q");
      }
      if (next.page && next.page > 1) p.set("page", String(next.page));
      else p.delete("page");
      p.delete("grower");
      return p;
    }, { replace: true });
  };

  useEffect(() => {
    if (typed.trim() === q.trim()) return;
    const t = setTimeout(() => set({ q: typed }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const list = useAsyncData(() => farmersApi.list({ kyc: tab === "ALL" ? null : tab, q, page, size: SIZE }));
  const { reload } = list;
  useEffect(() => { void reload(); }, [tab, q, page, reload]);
  const summary = useAsyncData(() => farmersApi.summary());
  const { reload: reloadSummary } = summary;
  const refresh = useCallback(() => { void reload(); void reloadSummary(); }, [reload, reloadSummary]);

  const result = list.data;
  const data = result?.available ? result.data : null;
  const counts = summary.data?.available ? summary.data.data : null;
  const kycCounts = counts?.kyc;
  const unavailable = result && !result.available;

  // A farmer changed in the panel: their row now belongs to another tab.
  const changed = (f: Farmer) => {
    list.setData((r) => r && r.available ? { ...r, data: { ...r.data, items: r.data.items.map((x) => x.growerNo === f.growerNo ? f : x) } } : r);
    void reloadSummary();
  };

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="KYC desk"
        subtitle="This institution's farmers by where their KYC stands: not started, to decide, verified or rejected. Open a farmer to see what the population registry said, their photos, and to decide."
      />

      {list.error ? (
        <SourceError what="the KYC desk" error={list.error} onRetry={list.reload} />
      ) : unavailable ? (
        <div data-testid="not-available"><NotePanel tone="info" title="Not available on this environment yet">{NOT_AVAILABLE.replace(/^Not available on this environment yet: /, "")}</NotePanel></div>
      ) : (
        <>
          {counts && !kycCounts && (
            <p className="mb-3 text-[12.5px] text-text-soft" data-testid="counts-not-available">
              The counts per KYC status are not available on this environment yet.
            </p>
          )}
          {summary.error && <SourceError what="the counts per KYC status" error={summary.error} onRetry={summary.reload} />}
          <Tabs
            className="mb-4"
            active={tab}
            onChange={(k) => isTab(k) && set({ kyc: k })}
            tabs={TABS.map((t) => ({
              key: t,
              label: t === "ALL" ? "Everyone" : KYC_LABEL[t],
              count: t === "ALL" ? counts?.total : kycCounts?.[COUNT_KEY[t]],
            }))}
          />
          <Allowed perm={ACT.kycDecide} fallback={null}>
            {tab === "NONE" && <KycSweep onFinished={refresh} />}
            {(tab === "PENDING" || tab === "NONE") && <KycBulkDecision onFinished={refresh} />}
          </Allowed>
          <FilterBar>
            <SearchInput value={typed} onChange={setTyped} placeholder="Grower number, name or phone" className="w-72" />
          </FilterBar>

          {!data ? <Skeleton className="h-48" /> : data.items.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="kyc-empty">
              {q ? "No farmer matches." : EMPTY[tab]}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[13px]" data-testid="kyc-table">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">Grower no.</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">KYC</th>
                    <th className="px-3 py-2 font-medium">Registry</th>
                    <th className="px-3 py-2 font-medium">Dates</th>
                    <th className="px-3 py-2 font-medium">Note</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((f) => (
                    <FarmerRow key={f.growerNo} farmer={f} onOpen={() => setOpen(f.growerNo)} onChanged={changed} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-[12.5px] text-text-soft">
              <span>{units(data.total)} farmers · page {page} of {data.pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => set({ page: page + 1 })}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      <Rescreening mayRun={canDecideKyc(user?.tokRoles)} />

      {open && <FarmerPanel growerNo={open} onClose={() => setOpen(null)} onChanged={changed} />}
    </div>
  );
}

function FarmerRow({ farmer: f, onOpen, onChanged }: { farmer: Farmer; onOpen: () => void; onChanged: (f: Farmer) => void }) {
  const toast = useToast();
  const mayStart = useAuth().can(ACT.kycDecide);
  const k = f.kyc ?? null;
  const status = k?.status ?? "NONE";
  const start = useAction(() => farmersApi.startKyc(f.growerNo));
  const runStart = async () => {
    const after = await start.run();
    if (!after) return;
    onChanged(after);
    toast.push(after.kyc?.status === "PENDING" ? `${f.growerNo}: KYC started.` : `${f.growerNo}: ${after.kyc?.note ?? "KYC could not start."}`);
  };
  return (
    <tr className="cursor-pointer border-t border-border/60 align-top hover:bg-surface-sunken/60" data-grower={f.growerNo} onClick={onOpen}>
      <td className="px-3 py-2 font-mono text-[12.5px]">{f.growerNo}</td>
      <td className="px-3 py-2">{f.fullName ?? "—"}</td>
      <td className="px-3 py-2 tabular">{f.phone ?? "—"}</td>
      <td className="px-3 py-2"><Badge tone={STATE_TONE[f.status] ?? "neutral"}>{STATE_LABEL[f.status] ?? f.status}</Badge></td>
      <td className="px-3 py-2"><Badge tone={KYC_TONE[status] ?? "neutral"}>{KYC_LABEL[status] ?? status}</Badge></td>
      <td className="px-3 py-2">
        {k?.identityResult
          ? <Badge tone={IDENTITY_TONE[k.identityResult] ?? "neutral"} className="whitespace-nowrap">{IDENTITY_LABEL[k.identityResult] ?? label(k.identityResult)}</Badge>
          : <span className="text-text-faint">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-[12px] text-text-soft">
        {k?.startedAt && <div>Started {calendarDate(k.startedAt)}</div>}
        {k?.decidedAt && <div>Decided {calendarDate(k.decidedAt)}</div>}
        {!k?.startedAt && !k?.decidedAt && "—"}
      </td>
      <td className="max-w-xs px-3 py-2 text-[12.5px] text-text-soft" data-testid="kyc-row-note">{k?.note ?? "—"}</td>
      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
        {status === "NONE" && activated(f) && mayStart && (
          <Button size="sm" variant="outline" disabled={start.pending} onClick={() => void runStart()}>{start.pending ? "Starting…" : "Start KYC"}</Button>
        )}
        {status === "PENDING" && <Button size="sm" variant="outline" onClick={onOpen}>Decide</Button>}
        {start.error && <p role="alert" className="mt-1 text-[12px] text-danger">{start.error}</p>}
      </td>
    </tr>
  );
}

/** One farmer: their KYC with its actions, then the application and photos
 *  from their app profile. */
function FarmerPanel({ growerNo, onClose, onChanged }: { growerNo: string; onClose: () => void; onChanged: (f: Farmer) => void }) {
  const farmer = useAsyncData(() => farmersApi.one(growerNo));
  const f = farmer.data;
  return (
    <Modal open onClose={onClose} title={f?.fullName ?? growerNo} size="lg">
      {farmer.error ? <NotePanel tone="danger">{farmer.error}</NotePanel> : !f ? <Skeleton className="h-40" /> : (
        <div className="flex flex-col" data-testid="kyc-panel">
          <p className="mb-3 text-[12.5px] text-text-soft">
            <Link to={`/farmers/${encodeURIComponent(f.growerNo)}`} className="font-mono font-medium text-primary-600 hover:underline">{f.growerNo}</Link>
            {" · "}{STATE_LABEL[f.status] ?? f.status}{f.phone ? ` · ${f.phone}` : ""}{f.factory ? ` · ${f.factory}` : ""}
          </p>
          <FarmerKyc farmer={f} onDesk onChanged={(after) => { farmer.setData(after); onChanged(after); }} />
          {f.customerId
            ? <ApplicationAndPhotos profileId={f.customerId} />
            : <NotePanel tone="info">No app profile yet, so no application or photos.</NotePanel>}
        </div>
      )}
    </Modal>
  );
}

function ApplicationAndPhotos({ profileId }: { profileId: string }) {
  const app = useAsyncData(() => omniApi.applicationOfProfile(profileId));
  const docs = useAsyncData(() => omniApi.customerDocuments(profileId));
  // The ones to decide, and the latest approved of each kind beside them.
  const photos: QueuedDocument[] = (docs.data ?? []).filter((d) => d.status === "PENDING_REVIEW")
    .concat(DOC_ORDER.flatMap((t) => (docs.data ?? []).filter((d) => d.type === t && d.status === "PASSED").slice(0, 1)))
    .sort((x, y) => DOC_ORDER.indexOf(x.type) - DOC_ORDER.indexOf(y.type));
  return (
    <>
      {app.error ? <NotePanel tone="danger" className="mt-2">The application could not be loaded: {app.error}</NotePanel>
        : app.loading && !app.data ? <Skeleton className="h-24" />
        : app.data ? <ApplicationSection app={app.data} />
        : <p className="text-[12.5px] text-text-soft" data-testid="no-application">No application yet: it is made when their KYC starts.</p>}
      {photos.length > 0 && <div className="mt-6"><ApplicantPhotos photos={photos} onDecided={() => void docs.reload()} /></div>}
      <div className="mt-6">
        <SectionTitle title="Every photo sent" />
        <CustomerPhotos key={(docs.data ?? []).map((d) => `${d.id}:${d.status}`).join()} profileId={profileId} onKycDesk />
      </div>
      <p className="mt-4 text-[12.5px] text-text-soft">
        Their M-Pesa payments, the messages we sent and what they did in the app are on the{" "}
        <Link to={customerDeskLink(profileId)} className="font-medium text-primary-600 hover:text-primary-700">Customer desk</Link>.
      </p>
    </>
  );
}
