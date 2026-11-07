import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BadgeCheck, Camera, Fingerprint, ShieldQuestion } from "lucide-react";
import {
  Badge, Button, FilterBar, GlassStat, Modal, NotePanel, PageHeader, SearchInput, SectionTitle, SelectFilter,
  StatRail, useToast,
} from "../../ui";
import { omniApi, type CheckedApplication, type QueuedDocument } from "../../lib/omniApi";
import { useAsyncData } from "../../lib/useAsyncData";
import { dateOf, dateTime, label, shortId } from "../../lib/tokenConsole/format";
import { useAction } from "../../lib/tokenConsole/useAction";
import { canDecideKyc, KYC_DECIDER_ROLES, type KycDecision } from "../../lib/tokenConsole/kyc";
import { DOC_LABEL, DOC_ORDER, fieldWords, REGISTRY_RESULT } from "../../lib/tokenConsole/identity";
import { useAuth } from "../../lib/auth";
import { Code, ConsoleTable, StatusBadge, type Source } from "../../components/tokenconsole/ConsoleTable";
import { DetailItem } from "../../components/tokenconsole/DetailItem";
import { ApplicantPhotos, ApplicationSection } from "../../components/tokenconsole/IdentityReview";
import { CustomerPhotos } from "../../components/tokenconsole/CustomerPhotos";
import { customerDeskLink } from "../../lib/tokenConsole/customerSearch";
import { Rescreening } from "../../components/tokenconsole/Rescreening";

/* The KYC desk: everything a reviewer needs to decide who someone is, on one
   page, one row per applicant. All of it from omnichannel, which answers only
   for this back office's institution:
   - the applications, by what the population registry made of them (a
     MISMATCH or an unchecked registry is what needs a person), and
   - the selfie and ID photos, each approved or rejected with a note the
     customer receives.
   Joined on the app profile. A decision sets the applicant's KYC status
   through omnichannel (POST /investors/{id}/kyc-status, audited there), which
   refuses another institution's customer. Nothing here reads the engine
   directly: its compliance reviews and investor register cover every
   institution. */

type Row = {
  /** The app profile. */
  key: string;
  profileId: string;
  /** The accounting investor the application opened (its externalRef); null before. */
  investorId: string | null;
  application: CheckedApplication | null;
  /** Waiting for a decision. */
  photos: QueuedDocument[];
  accepted: QueuedDocument[];
  name: string;
  /** When they first needed attention. */
  since: string;
};

const TO_DECIDE = "TODO";
const SHOW_OPTIONS = [
  { value: TO_DECIDE, label: "To decide" },
  { value: "MISMATCH", label: "Registry mismatch" },
  { value: "UNCHECKED", label: "Registry not checked" },
  { value: "PHOTOS", label: "Photos waiting" },
  { value: "ACCEPTED", label: "Photos approved" },
];

/** A registry result a person has to look at, or photos waiting. Omnichannel
 *  does not yet say whether someone already decided, so a decided mismatch
 *  stays here; the panel shows their KYC status now. */
const toDecide = (r: Row) => r.photos.length > 0 || (!!r.application && r.application.identityResult !== "MATCH");

function matches(r: Row, show: string) {
  switch (show) {
    case "all": return true;
    case TO_DECIDE: return toDecide(r);
    case "MISMATCH":
    case "UNCHECKED": return r.application?.identityResult === show;
    case "PHOTOS": return r.photos.length > 0;
    case "ACCEPTED": return r.accepted.length > 0;
    default: return false;
  }
}

/** One row per app profile: every application the registry did not match,
 *  and anyone with photos. A matched application only joins a row. */
function applicants(applications: CheckedApplication[], waiting: QueuedDocument[], accepted: QueuedDocument[]): Row[] {
  const appByProfile = new Map(applications.map((a) => [a.profileId, a]));
  const rows = new Map<string, Row>();
  const row = (profileId: string) => {
    let r = rows.get(profileId);
    if (!r) {
      const application = appByProfile.get(profileId) ?? null;
      rows.set(profileId, (r = {
        key: profileId, profileId, investorId: application?.externalRef || null, application,
        photos: [], accepted: [], name: application?.fullName ?? "", since: "",
      }));
    }
    return r;
  };
  for (const app of applications) if (app.identityResult !== "MATCH") row(app.profileId);
  for (const doc of waiting) row(doc.profileId).photos.push(doc);
  for (const doc of accepted) row(doc.profileId).accepted.push(doc);
  for (const r of rows.values()) {
    r.photos.sort((x, y) => DOC_ORDER.indexOf(x.type) - DOC_ORDER.indexOf(y.type));
    // The oldest photo waiting; otherwise when they applied.
    r.since = r.photos.map((p) => p.uploadedAt).filter(Boolean).sort()[0] ?? r.application?.submittedAt ?? "";
  }
  return [...rows.values()];
}

export default function TokenConsoleKyc() {
  const { user } = useAuth();
  // Each read on its own, so one failing never hides the rest.
  const mismatched = useAsyncData(() => omniApi.applications("MISMATCH"));
  const unchecked = useAsyncData(() => omniApi.applications("UNCHECKED"));
  const matched = useAsyncData(() => omniApi.applications("MATCH"));
  const waiting = useAsyncData(omniApi.pendingDocuments);
  const accepted = useAsyncData(omniApi.acceptedDocuments);
  const [show, setShow] = useState(TO_DECIDE);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const all = useMemo<Row[]>(() => applicants(
    [...(mismatched.data ?? []), ...(unchecked.data ?? []), ...(matched.data ?? [])],
    waiting.data ?? [], accepted.data ?? [],
  ), [mismatched.data, unchecked.data, matched.data, waiting.data, accepted.data]);

  const term = q.trim().toLowerCase();
  const showingAccepted = show === "ACCEPTED";
  const latestAccepted = (r: Row) => r.accepted.map((d) => d.reviewedAt ?? "").sort().at(-1) ?? "";
  const rows = all
    .filter((r) => matches(r, show))
    .filter((r) => !term || [r.name, r.investorId, r.profileId].some((v) => (v ?? "").toLowerCase().includes(term)))
    // Newest first: by when they started waiting, or for approved photos by the latest decision.
    .sort((a, b) => showingAccepted ? latestAccepted(b).localeCompare(latestAccepted(a)) : b.since.localeCompare(a.since));

  // The applications are the desk; the photos fill it in.
  const appsError = mismatched.error ?? unchecked.error ?? matched.error;
  const loaded = !!(mismatched.data && unchecked.data && matched.data);
  const photosWaiting = waiting.data?.length ?? 0;
  const mismatches = all.filter((r) => r.application?.identityResult === "MISMATCH").length;
  const notChecked = all.filter((r) => r.application?.identityResult === "UNCHECKED").length;
  const oldest = all.filter(toDecide).map((r) => r.since).filter(Boolean).sort()[0];
  // Deciding someone's last photo can take their row off the desk; the panel
  // stays open on what it had, with nothing left to decide.
  const found = all.find((r) => r.key === selected);
  const lastOpen = useRef<Row | null>(null);
  if (found) lastOpen.current = found;
  const selectedRow = found ?? (selected && lastOpen.current?.key === selected ? { ...lastOpen.current, photos: [], accepted: [] } : undefined);
  const partial = [
    waiting.error && `the photos waiting (${waiting.error})`,
    accepted.error && `the approved photos (${accepted.error})`,
  ].filter(Boolean);
  const reloadAll = () => {
    for (const s of [mismatched, unchecked, matched, waiting, accepted]) void s.reload();
  };

  const source: Source<Row> = {
    data: loaded ? rows : null,
    loading: mismatched.loading || unchecked.loading || matched.loading,
    error: appsError,
    reload: reloadAll,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Baracel Unyt"
        title="KYC desk"
        subtitle="Who each applicant is, in one place: what the population registry said about their application, and the selfie and ID photos they sent. Only this institution's applicants."
      />

      <StatRail className="mb-6">
        <GlassStat label="Registry mismatches" value={mismatched.data ? mismatches : "—"} icon={<Fingerprint size={16} />} tone={mismatches ? "danger" : "neutral"}
          hint="A name or date of birth the registry does not hold." />
        <GlassStat label="Registry not checked" value={unchecked.data ? notChecked : "—"} icon={<ShieldQuestion size={16} />} tone={notChecked ? "warning" : "neutral"} emphasis={false} />
        <GlassStat label="Photos waiting" value={waiting.data ? photosWaiting : "—"} icon={<Camera size={16} />} tone={photosWaiting ? "warning" : "neutral"} emphasis={false} />
        <GlassStat label="Oldest waiting" value={oldest ? dateOf(oldest) : "—"} hint={oldest ? "Decide this one first." : loaded && !partial.length ? "Nothing is waiting." : undefined} />
      </StatRail>

      {partial.length > 0 && (
        <NotePanel tone="warning" className="mb-4" title="Part of this page could not be loaded">
          Missing: {partial.join("; ")}. The applications below are complete.
        </NotePanel>
      )}

      <FilterBar className="mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Name, investor id or profile id…" className="w-72" />
        <SelectFilter value={show} onChange={setShow} options={SHOW_OPTIONS} allLabel="Everyone" />
      </FilterBar>

      <ConsoleTable<Row>
        what="the KYC desk"
        source={source}
        rows={rows}
        rowId={(r) => r.key}
        onRowClick={(r) => setSelected(r.key)}
        selectedId={selected}
        title={showingAccepted ? "Photos approved" : "Applicants"}
        description={loaded ? `${rows.length} of ${all.length}` : undefined}
        emptyLabel={show === TO_DECIDE ? "Nothing is waiting on a KYC decision" : "Nobody matches that"}
        columns={[
          { key: "applicant", header: "Applicant", className: "min-w-[200px]", render: (r) => (
            <div>
              <div className="font-medium text-text">{r.name || <Code>{shortId(r.profileId)}</Code>}</div>
              <div className="mt-0.5 text-xs text-text-faint">
                {r.application ? `Born ${dateOf(r.application.dateOfBirth)} · ${r.application.nationality}` : "Has not applied yet"}
              </div>
            </div>
          ) },
          { key: "registry", header: "Registry", render: (r) => r.application ? (
            <div>
              <Badge tone={REGISTRY_RESULT[r.application.identityResult]?.tone ?? "neutral"} className="whitespace-nowrap">
                {REGISTRY_RESULT[r.application.identityResult]?.text ?? label(r.application.identityResult)}
              </Badge>
              {r.application.identityMismatches?.length ? (
                <div className="mt-1 text-xs text-text-soft">Differs: {r.application.identityMismatches.map(fieldWords).join(", ")}</div>
              ) : null}
            </div>
          ) : <span className="text-xs text-text-faint">No application</span>, hideOnMobile: true },
          { key: "photos", header: showingAccepted ? "Photos approved" : "Photos waiting", render: (r) => {
            const list = showingAccepted ? r.accepted : r.photos;
            return list.length
              ? <span className="text-text">{list.map((p) => DOC_LABEL[p.type] ?? p.type).join(", ")}</span>
              : <span className="text-xs text-text-faint">None</span>;
          } },
          { key: "since", header: showingAccepted ? "Approved" : "Waiting since", className: "whitespace-nowrap", render: (r) => {
            const at = showingAccepted ? latestAccepted(r) : r.since;
            return <span className="tabular text-xs text-text-soft">{at ? dateTime(at) : "—"}</span>;
          }, hideOnMobile: true },
        ]}
      />

      <Rescreening mayRun={canDecideKyc(user?.tokRoles)} />

      <Modal open={!!selectedRow} onClose={() => setSelected(null)} title={selectedRow?.name || "Applicant"} size="lg">
        {/* Keyed so one applicant's images and errors never carry to the next. */}
        {selectedRow && (
          <ApplicantPanel
            key={selectedRow.key}
            row={selectedRow}
            onPhotoDecided={(decided) => {
              // Moved across before the reloads, so an approved photo never leaves the panel in between.
              if (decided) {
                waiting.setData((list) => list?.filter((d) => d.id !== decided.id) ?? list);
                if (decided.status === "PASSED") accepted.setData((list) => [decided, ...(list ?? []).filter((d) => d.id !== decided.id)]);
              }
              void waiting.reload();
              void accepted.reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/** The photos to decide, with the latest approved one of each kind and the
 *  ones rejected while the panel is open beside them. */
function photosOnShow(r: Row, rejected: QueuedDocument[]): QueuedDocument[] {
  const approved = DOC_ORDER.flatMap((type) => {
    const latest = r.accepted.filter((d) => d.type === type)
      .sort((x, y) => (y.reviewedAt ?? "").localeCompare(x.reviewedAt ?? ""))[0];
    return latest ? [latest] : [];
  });
  return [...r.photos, ...rejected, ...approved].sort((x, y) => DOC_ORDER.indexOf(x.type) - DOC_ORDER.indexOf(y.type));
}

function ApplicantPanel({ row, onPhotoDecided }: { row: Row; onPhotoDecided: (decided?: QueuedDocument) => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const mayDecide = canDecideKyc(user?.tokRoles);
  const investorId = row.investorId;
  // Their standing now, from omnichannel's customer record (this institution's only).
  const customer = useAsyncData(() => omniApi.customer(row.profileId));
  const decide = useAction((kycStatus: "VERIFIED" | "REJECTED") => omniApi.setKycStatus(investorId ?? "", kycStatus));
  const [decision, setDecision] = useState<KycDecision | null>(null);

  const c = customer.data;
  const kycStatus = c?.account?.kycStatus ?? null;
  const name = row.name || c?.legalName || c?.displayName || "";
  // Rejected just now: kept on show until the panel closes. After that they are in "Every photo sent".
  const [rejected, setRejected] = useState<QueuedDocument[]>([]);
  const photos = photosOnShow(row, rejected);
  const photoDecided = (decided?: QueuedDocument) => {
    if (decided?.status === "FAILED") setRejected((list) => [...list, decided]);
    onPhotoDecided(decided);
  };

  const submit = async () => {
    if (!decision) return;
    const done = await decide.run(decision === "verify" ? "VERIFIED" : "REJECTED");
    if (!done) return; // the error is on the confirmation
    toast.push(`${name || "Applicant"}: KYC status is now ${label(done.kycStatus).toLowerCase()}.`);
    setDecision(null);
    void customer.reload();
  };

  const start = (d: KycDecision) => {
    decide.reset();
    setDecision(d);
  };

  return (
    <div className="flex flex-col">
      {customer.error && <NotePanel tone="danger" className="mb-4">Could not load their standing: {customer.error}</NotePanel>}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="applicant-standing">
        <DetailItem term="Applicant">{name || "—"}</DetailItem>
        <DetailItem term="Investor"><Code>{investorId ?? "—"}</Code></DetailItem>
        <DetailItem term="KYC status">{customer.loading && !c ? "…" : <StatusBadge status={kycStatus} />}</DetailItem>
        <DetailItem term="Profile"><StatusBadge status={c?.status} /></DetailItem>
      </dl>
      {/* ID and KRA numbers stay with onboarding; omnichannel does not return them. */}
      <p className="mt-2 text-xs text-text-soft">
        Identity numbers stay with onboarding and are not shown. What is checkable is the registry result and the photos below.
      </p>

      {row.application && <div className="mt-6"><ApplicationSection app={row.application} /></div>}
      {(row.application || photos.length > 0) && (
        <div className="mt-6"><ApplicantPhotos photos={photos} onDecided={photoDecided} /></div>
      )}
      <div className="mt-6">
        <SectionTitle title="Every photo sent" />
        <CustomerPhotos key={row.photos.map((p) => p.id).join()} profileId={row.profileId} onKycDesk />
      </div>
      <p className="mt-4 text-[12.5px] text-text-soft">
        Their M-Pesa payments, the messages we sent and what they did in the app are on the{" "}
        <Link to={customerDeskLink(row.profileId)} className="font-medium text-primary-600 hover:text-primary-700">Customer desk</Link>.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {!investorId ? (
          <span className="text-[12.5px] text-text-soft">They have not applied yet: there is no KYC status to decide.</span>
        ) : !mayDecide ? (
          <span className="text-[12.5px] text-text-soft">
            Deciding KYC needs the {KYC_DECIDER_ROLES.map((r) => label(r)).join(" or ")} role. You can see the desk; someone with that role decides.
          </span>
        ) : (
          <>
            <Button size="sm" disabled={decide.pending || kycStatus === "VERIFIED"} onClick={() => start("verify")}>
              <BadgeCheck size={14} /> Approve
            </Button>
            <Button variant="outline" size="sm" disabled={decide.pending || kycStatus === "REJECTED"} onClick={() => start("reject")}>
              Reject
            </Button>
          </>
        )}
      </div>

      {decision &&
        // Portalled: BO Admin's Modal is not, and this one opens over another.
        createPortal(
          <ConfirmDecision
            decision={decision}
            name={name}
            busy={decide.pending}
            error={decide.error}
            onCancel={() => setDecision(null)}
            onConfirm={() => void submit()}
          />,
          document.body,
        )}
    </div>
  );
}

/** Each decision states its consequence before it is made; omnichannel
 *  records who made it. */
function ConfirmDecision({ decision, name, busy, error, onCancel, onConfirm }: {
  decision: KycDecision;
  name: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const verifying = decision === "verify";
  const who = name || "this applicant";
  return (
    <Modal
      open
      onClose={busy ? () => undefined : onCancel}
      size="sm"
      title={verifying ? "Approve this applicant?" : "Reject this applicant?"}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant={verifying ? "primary" : "danger"} size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? "Saving…" : verifying ? "Approve applicant" : "Reject applicant"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-soft">
        {verifying ? `${who}'s KYC status will be set to verified.` : `${who}'s KYC status will be set to rejected.`}
      </p>
      {error && <NotePanel tone="danger" className="mt-3">{error}</NotePanel>}
    </Modal>
  );
}
