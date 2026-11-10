import { useState } from "react";
import { ACT } from "../../lib/staffContract";
import { NoPermission } from "../../components/Allowed";
import { Link } from "react-router-dom";
import { BadgeCheck } from "lucide-react";
import { Badge, Button, Card, Field, Modal, NotePanel, Textarea, useToast } from "../../ui";
import { useAction } from "../../lib/tokenConsole/useAction";
import { calendarDate, label } from "../../lib/tokenConsole/format";
import { canDecideKyc, KYC_DECIDER_ROLES } from "../../lib/tokenConsole/kyc";
import { useAuth } from "../../lib/auth";
import { farmersApi } from "../../lib/api.farmers";
import {
  IDENTITY_LABEL, IDENTITY_TONE, KYC_LABEL, KYC_NOTE_MAX, KYC_TONE, NOT_AVAILABLE,
  type Farmer, type KycDecisionBody,
} from "../../lib/journeyContract";
import { DetailItem } from "../../components/tokenconsole/DetailItem";
import { ErrorWithApproval, REASON_HINT, SentForApproval } from "../../components/ApprovalNotice";
import { withReason } from "../../lib/api.approvals";
import { REASON_MAX, type Approval, type Staged } from "../../lib/approvalsContract";
import { kycDeskLink } from "../../lib/tokenConsole/customerSearch";

/* A farmer's KYC on their profile: where it stands, what the population
   registry said, and the actions omnichannel offers for it. Start KYC for an
   activated farmer still at NONE; Approve or Reject, with a note, for one
   that is PENDING (decider roles only). Each answers the farmer as it is
   now, which replaces the page's copy. */

const activated = (f: Farmer) => f.status === "ACTIVATED" || f.status === "FUNDED";

/** `onDesk`: shown on the KYC desk, so no link back to it. */
export function FarmerKyc({ farmer, onChanged, onDesk = false }: { farmer: Farmer; onChanged: (f: Farmer) => void; onDesk?: boolean }) {
  const toast = useToast();
  const { user, can } = useAuth();
  const engineMay = canDecideKyc(user?.tokRoles);
  const allowed = can(ACT.kycDecide);
  const mayDecide = engineMay && allowed;
  const kyc = farmer.kyc;
  const start = useAction(() => farmersApi.startKyc(farmer.growerNo));
  const [deciding, setDeciding] = useState<KycDecisionBody["decision"] | null>(null);

  if (kyc === undefined) {
    return (
      <Card className="mb-5 p-4" data-testid="kyc-not-available">
        <h2 className="mb-2 text-sm font-semibold text-text">KYC</h2>
        <p className="text-[12.5px] text-text-soft">Not available on this environment yet: omnichannel here does not keep KYC on farmers.</p>
      </Card>
    );
  }

  const status = kyc?.status ?? "NONE";
  const runStart = async () => {
    const f = await start.run();
    if (!f) return;
    onChanged(f);
    toast.push(f.kyc?.status === "PENDING" ? "KYC started: the farmer is waiting on a decision." : `KYC: ${KYC_LABEL[f.kyc?.status ?? "NONE"].toLowerCase()}.`);
  };

  return (
    <Card className="mb-5 p-4" data-testid="farmer-kyc">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">KYC</h2>
        <Badge tone={KYC_TONE[status] ?? "neutral"}>{KYC_LABEL[status] ?? status}</Badge>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <DetailItem term="Registry">
          {kyc?.identityResult
            ? <Badge tone={IDENTITY_TONE[kyc.identityResult] ?? "neutral"}>{IDENTITY_LABEL[kyc.identityResult] ?? label(kyc.identityResult)}</Badge>
            : <span className="text-text-faint">Not checked yet</span>}
        </DetailItem>
        <DetailItem term="Started">{kyc?.startedAt ? calendarDate(kyc.startedAt) : "—"}</DetailItem>
        <DetailItem term="Decided">{kyc?.decidedAt ? calendarDate(kyc.decidedAt) : "—"}</DetailItem>
      </dl>
      {kyc?.note && (
        <p className="mt-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[12.5px] text-text" data-testid="kyc-note">
          {status === "NONE" ? "Not started: " : "Note: "}{kyc.note}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {status === "NONE" && !allowed && <NoPermission />}
        {status === "NONE" && allowed && (activated(farmer) ? (
          <Button size="sm" disabled={start.pending} onClick={() => void runStart()}>{start.pending ? "Starting…" : "Start KYC"}</Button>
        ) : (
          <span className="text-[12.5px] text-text-soft">KYC starts once the farmer is activated.</span>
        ))}
        {status === "PENDING" && (mayDecide ? (
          <>
            <Button size="sm" onClick={() => setDeciding("VERIFIED")}><BadgeCheck size={14} /> Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setDeciding("REJECTED")}>Reject</Button>
          </>
        ) : !allowed ? <NoPermission /> : (
          <span className="text-[12.5px] text-text-soft">Deciding KYC needs the {KYC_DECIDER_ROLES.map((r) => label(r)).join(" or ")} role.</span>
        ))}
        {!onDesk && (
          <Link to={kycDeskLink(farmer.growerNo, status)} className="text-[12.5px] font-medium text-primary-600 hover:text-primary-700" data-testid="kyc-desk-link">
            Open on the KYC desk →
          </Link>
        )}
      </div>
      {start.error && (start.error === NOT_AVAILABLE
        ? <NotePanel tone="info" className="mt-3">{NOT_AVAILABLE}</NotePanel>
        : <p role="alert" className="mt-3 text-[13px] text-danger">{start.error}</p>)}

      {deciding && (
        <KycDecisionModal
          name={farmer.fullName ?? farmer.growerNo}
          decision={deciding}
          needsApproval={deciding === "VERIFIED" && !!kyc?.identityResult && kyc.identityResult !== "MATCH"}
          decide={(body) => farmersApi.decideKyc(farmer.growerNo, body)}
          onCancel={() => setDeciding(null)}
          onDone={(f) => {
            setDeciding(null);
            onChanged(f);
            toast.push(`${farmer.fullName ?? farmer.growerNo}: KYC ${KYC_LABEL[f.kyc?.status ?? "NONE"].toLowerCase()}.`);
          }}
        />
      )}
    </Card>
  );
}

/** Approve or reject a farmer's KYC with a note kept on the farmer.
 *  Verifying a farmer the registry did not match is sent for approval: the
 *  modal then says so, and nothing is reloaded (nothing changed yet). */
export function KycDecisionModal({ name, decision, needsApproval = false, decide, onCancel, onDone }: {
  name: string;
  decision: KycDecisionBody["decision"];
  /** The registry did not match: verifying needs a second person. */
  needsApproval?: boolean;
  decide: (body: KycDecisionBody & { reason?: string }) => Promise<Staged<Farmer>>;
  onCancel: () => void;
  onDone: (f: Farmer) => void;
}) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<Approval | null>(null);
  const act = useAction((body: KycDecisionBody & { reason?: string }) => decide(body));
  const verifying = decision === "VERIFIED";
  const submit = async () => {
    const r = await act.run({ decision, ...(note.trim() ? { note: note.trim() } : {}), ...(verifying ? withReason(reason) : {}) });
    if (!r) return;
    if (r.approval) setSent(r.approval);
    else onDone(r.applied);
  };
  if (sent) {
    return (
      <Modal open onClose={onCancel} size="sm" title="Sent for approval" footer={<Button size="sm" onClick={onCancel}>Done</Button>}>
        <SentForApproval approval={sent} />
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={act.pending ? () => undefined : onCancel}
      size="sm"
      title={verifying ? "Approve this farmer's KYC?" : "Reject this farmer's KYC?"}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={act.pending} onClick={onCancel}>Cancel</Button>
          <Button variant={verifying ? "primary" : "danger"} size="sm" disabled={act.pending} onClick={() => void submit()}>
            {act.pending ? "Saving…" : verifying ? "Approve" : "Reject"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-soft">
        {verifying ? `${name} will be recorded as verified, here and on the ledger.` : `${name} will be recorded as rejected, here and on the ledger.`}
      </p>
      <Field label="Note" hint={`Kept with the decision on the farmer. Up to ${KYC_NOTE_MAX} characters.`}>
        <Textarea
          rows={3}
          aria-label="Decision note"
          value={note}
          maxLength={KYC_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder={verifying ? "Details checked against the registry." : "Why this was refused."}
        />
      </Field>
      {verifying && (
        <div className="mt-3">
          {needsApproval && <p className="mb-2 text-[12.5px] text-warning" data-testid="needs-approval">The registry did not match, so verifying needs a second person's approval.</p>}
          <Field label="Reason (optional)" hint={REASON_HINT}>
            <Textarea rows={2} aria-label="Reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
      {act.error && <ErrorWithApproval message={act.error} className="mt-3 text-[13px] text-danger" />}
    </Modal>
  );
}
