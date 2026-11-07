import { useRef, useState } from "react";
import { Badge, Button, Card, Checkbox, Field, Input, NotePanel, Select, Skeleton } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { dateTime } from "../../lib/tokenConsole/format";
import { farmersApi } from "../../lib/api.farmers";
import {
  CHANNEL_LABEL, FARMER_PHOTO_TYPES, ID_DOCUMENT_REF_MAX, IDENTITY_LABEL, KYC_LABEL, NOT_AVAILABLE, PHOTO_CONTENT_TYPES, PHOTO_LABEL, PHOTO_MAX_BYTES,
  type AssistedOnboarding as Body, type Farmer, type FarmerPhotoType,
} from "../../lib/journeyContract";

/* Assisted onboarding (KTDA 5.2.1) on a farmer's profile: a member of staff,
   or a field agent, with the farmer in front of them completes a REGISTERED
   farmer's onboarding in one call (POST /farmers/{g}/assisted-onboarding):
   the wallet opens, the farmer is activated, their consent is recorded and
   KYC starts. And the photos 5.2.2 asks for (selfie and ID), uploaded here
   before or after and reviewed on the KYC desk. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function AssistedOnboardingSection({ farmer, onDone }: { farmer: Farmer; onDone: (f: Farmer) => void }) {
  const onFile = farmer.nationalIdOnFile;
  const [nationalId, setNationalId] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [idDocumentRef, setIdDocumentRef] = useState("");
  const [agentNo, setAgentNo] = useState("");
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState<Farmer | null>(null);
  const act = useAction((body: Body) => farmersApi.assistedOnboarding(farmer.growerNo, body));

  const idNeeded = onFile === false;
  const problem = idNeeded && !nationalId.trim() ? "The farmer's national ID is needed: the register holds none."
    : !DATE.test(dateOfBirth) ? "The date of birth is needed; KYC cannot start without it."
    : !consent ? "The farmer has to agree to the terms first."
    : null;

  const submit = async () => {
    const f = await act.run({
      ...(onFile !== true && nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
      dateOfBirth,
      ...(idDocumentRef.trim() ? { idDocumentRef: idDocumentRef.trim() } : {}),
      ...(agentNo.trim() ? { agentNo: agentNo.trim() } : {}),
      consent: { terms: true },
    });
    if (!f) return;
    setDone(f);
    onDone(f);
  };

  if (done) {
    const k = done.kyc;
    const o = done.onboarding;
    return (
      <div className="mb-5" data-testid="assisted-done">
        <NotePanel tone="success" title="Onboarding complete">
          {done.fullName ?? done.growerNo} is activated: their wallet is open.
          {k && <> KYC: {KYC_LABEL[k.status]?.toLowerCase() ?? k.status}{k.identityResult ? `, the registry says: ${IDENTITY_LABEL[k.identityResult]?.toLowerCase() ?? k.identityResult}` : ""}.</>}
          {o?.channel && <> Onboarded {o.channel === "AGENT" && o.agentNo ? `by agent ${o.agentNo}` : `via ${CHANNEL_LABEL[o.channel].toLowerCase()}`}{o.at ? `, ${dateTime(o.at)}` : ""}.</>}
        </NotePanel>
      </div>
    );
  }

  return (
    <Card className="mb-5 p-4" data-testid="assisted-onboarding">
      <h2 className="mb-1 text-sm font-semibold text-text">Complete onboarding in person</h2>
      <p className="mb-3 text-[12.5px] text-text-soft">
        With the farmer in front of you: their wallet opens, they are activated and their KYC starts against the population registry.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="National ID" hint={onFile === undefined ? "Leave empty if the register already holds it; a different one is refused." : undefined}>
          {onFile === true
            ? <Input aria-label="National ID" value="On file" readOnly disabled />
            : <Input aria-label="National ID" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />}
        </Field>
        <Field label="Date of birth">
          <Input aria-label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        </Field>
        <Field label="ID document reference (optional)">
          <Input aria-label="ID document reference" value={idDocumentRef} maxLength={ID_DOCUMENT_REF_MAX} onChange={(e) => setIdDocumentRef(e.target.value)} />
        </Field>
        <Field label="Field agent no. (optional)" hint="The agent who did it earns the onboarding commission, once per farmer.">
          <Input aria-label="Field agent number" value={agentNo} placeholder="A-0042" onChange={(e) => setAgentNo(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox checked={consent} onChange={setConsent}>
            The farmer has agreed to the institution's terms, in front of me.
          </Checkbox>
        </div>
      </div>
      {(nationalId || dateOfBirth || consent) && problem && <p className="mt-3 text-[12.5px] text-text-soft" data-testid="assisted-problem">{problem}</p>}
      {act.error && (act.error === NOT_AVAILABLE
        ? <NotePanel tone="info" className="mt-3">Not available on this environment yet: omnichannel here cannot onboard a farmer in person.</NotePanel>
        : <p role="alert" className="mt-3 text-[13px] text-danger">{act.error}</p>)}
      <div className="mt-4">
        <Button disabled={!!problem || act.pending} onClick={() => void submit()}>{act.pending ? "Onboarding…" : "Complete onboarding"}</Button>
      </div>
    </Card>
  );
}

const STATUS: Record<string, { text: string; tone: "warning" | "success" | "danger" }> = {
  PENDING_REVIEW: { text: "Waiting for review", tone: "warning" },
  PASSED: { text: "Approved", tone: "success" },
  FAILED: { text: "Rejected", tone: "danger" },
};

/** The farmer's selfie and ID photos: upload, and where each stands. */
export function FarmerPhotos({ growerNo }: { growerNo: string }) {
  const docs = useAsyncData(() => farmersApi.documents(growerNo));
  const [type, setType] = useState<FarmerPhotoType>("SELFIE");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = useAction((t: FarmerPhotoType, f: File) => farmersApi.uploadDocument(growerNo, t, f));

  const pick = (f: File | null) => {
    setFile(f);
    setProblem(!f ? null : !PHOTO_CONTENT_TYPES.includes(f.type) ? "A photo is a JPEG or PNG." : f.size > PHOTO_MAX_BYTES ? "A photo is at most 5 MB." : null);
  };
  const send = async () => {
    if (!file) return;
    const d = await upload.run(type, file);
    if (!d) return;
    setFile(null);
    if (input.current) input.current.value = "";
    void docs.reload();
  };

  if (docs.data && !docs.data.available) {
    return (
      <Card className="mb-5 p-4" data-testid="farmer-photos">
        <h2 className="mb-2 text-sm font-semibold text-text">Photos</h2>
        <p className="text-[12.5px] text-text-soft" data-testid="photos-not-available">Not available on this environment yet: omnichannel here does not take a farmer's photos.</p>
      </Card>
    );
  }
  const list = docs.data?.available ? docs.data.data : null;
  return (
    <Card className="mb-5 p-4" data-testid="farmer-photos">
      <h2 className="mb-1 text-sm font-semibold text-text">Photos</h2>
      <p className="mb-3 text-[12.5px] text-text-soft">The selfie and both sides of the ID, before or after onboarding. Compliance reviews them on the KYC desk.</p>
      {docs.error ? <p role="alert" className="mb-3 text-[13px] text-danger">Could not load the photos: {docs.error}</p> : !list ? <Skeleton className="h-16" /> : (
        <ul className="mb-3 divide-y divide-border rounded-[var(--radius-lg)] border border-border" data-testid="photo-list">
          {FARMER_PHOTO_TYPES.map((t) => {
            const d = list.find((x) => x.type === t);
            const st = d ? STATUS[d.status] : null;
            return (
              <li key={t} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]" data-photo={t}>
                <span>{PHOTO_LABEL[t]}</span>
                {d && st ? (
                  <span className="flex items-center gap-2 text-[12px] text-text-soft">
                    <span>Sent {dateTime(d.uploadedAt)}</span>
                    <Badge tone={st.tone}>{st.text}</Badge>
                  </span>
                ) : <Badge tone="neutral">Not sent</Badge>}
                {d?.status === "FAILED" && d.reviewNote && <span className="w-full text-[12px] text-danger">{d.reviewNote}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Photo">
          <Select aria-label="Photo type" value={type} onChange={(e) => setType(e.target.value as FarmerPhotoType)}>
            {FARMER_PHOTO_TYPES.map((t) => <option key={t} value={t}>{PHOTO_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="File">
          <input ref={input} aria-label="Photo file" type="file" accept={PHOTO_CONTENT_TYPES.join(",")} className="text-[12.5px]" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </Field>
        <Button size="sm" disabled={!file || !!problem || upload.pending} onClick={() => void send()}>{upload.pending ? "Uploading…" : "Upload"}</Button>
      </div>
      {problem && <p className="mt-2 text-[12.5px] text-danger" data-testid="photo-problem">{problem}</p>}
      {upload.error && <p role="alert" className="mt-2 text-[13px] text-danger">{upload.error === NOT_AVAILABLE ? "Not available on this environment yet." : upload.error}</p>}
    </Card>
  );
}
