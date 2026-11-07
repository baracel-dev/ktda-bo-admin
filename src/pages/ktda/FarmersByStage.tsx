import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { Badge, Button, Field, FilterBar, Input, Modal, NotePanel, PageHeader, SearchInput, SelectFilter, Skeleton, Tabs } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { calendarDate, units } from "../../lib/tokenConsole/format";
import { farmersApi, type Registered } from "../../lib/api.farmers";
import {
  ALL_FARMER_STATES, FARMER_STATES, KYC_LABEL, KYC_STATUSES, KYC_TONE, NOT_AVAILABLE, STATE_LABEL, STATE_MEANS, STATE_TONE, SUMMARY_KEY,
  type Farmer, type FarmerState, type KycStatus, type RegisterFarmer,
} from "../../lib/journeyContract";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { KycSweep } from "./KycSweep";

/* This institution's farmers and where each is in the journey (registered,
   activated, funded), from omnichannel, which answers only for this back
   office's institution. Search by grower number, name or phone; filter by
   stage and by KYC; the counts come from the institution-wide summary. "Register
   farmer" creates one record (no wallet, no PIN) through the single-farmer
   endpoint, never the bulk one. A row opens the farmer's profile and wallet
   (FarmerDetail). See journeyContract.ts; where this
   environment lacks the endpoints the page says so. */

const SIZE = 20;
const isState = (v: string | null): v is FarmerState => !!v && (ALL_FARMER_STATES as string[]).includes(v);
const isKyc = (v: string | null): v is KycStatus => !!v && (KYC_STATUSES as string[]).includes(v);
const KYC_OPTIONS = KYC_STATUSES.map((k) => ({ value: k, label: `KYC: ${KYC_LABEL[k].toLowerCase()}` }));

const NotAvailable = () => (
  <div data-testid="not-available">
    <NotePanel tone="info" title="Not available on this environment yet">{NOT_AVAILABLE.replace(/^Not available on this environment yet: /, "")}</NotePanel>
  </div>
);

export default function FarmersByStage() {
  const [params, setParams] = useSearchParams();
  const state = isState(params.get("state")) ? (params.get("state") as FarmerState) : null;
  const kyc = isKyc(params.get("kyc")) ? (params.get("kyc") as KycStatus) : null;
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [registering, setRegistering] = useState(false);
  const navigate = useNavigate();

  const set = (next: { state?: FarmerState | null; kyc?: KycStatus | null; q?: string; page?: number }) => {
    const p = new URLSearchParams(params);
    const put = (k: string, v: string | null | undefined) => (v ? p.set(k, v) : p.delete(k));
    if ("state" in next) put("state", next.state ?? null);
    if ("kyc" in next) put("kyc", next.kyc ?? null);
    if ("q" in next) put("q", next.q?.trim() || null);
    put("page", next.page && next.page > 1 ? String(next.page) : null);
    setParams(p, { replace: true });
  };

  // Search as the operator stops typing.
  useEffect(() => {
    if (typed.trim() === q.trim()) return;
    const t = setTimeout(() => set({ q: typed }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const list = useAsyncData(() => farmersApi.list({ state, kyc, q, page, size: SIZE }));
  const { reload } = list;
  useEffect(() => { void reload(); }, [state, kyc, q, page, reload]);
  const summary = useAsyncData(() => farmersApi.summary());
  const { reload: reloadSummary } = summary;
  // A KYC sweep that ends has moved farmers from NONE to PENDING.
  const sweepEnded = useCallback(() => { void reload(); void reloadSummary(); }, [reload, reloadSummary]);

  const result = list.data;
  const data = result?.available ? result.data : null;
  const counts = summary.data?.available ? summary.data.data : null;
  const unavailable = (result && !result.available) || (summary.data && !summary.data.available);

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="Farmers"
        subtitle="This institution's farmers and where each is: registered (still has to onboard), activated (wallet open) or funded."
        actions={
          <div className="flex items-center gap-3">
            <Link to="/journey" className="text-sm font-medium text-primary-600 hover:text-primary-700">Farmer journey →</Link>
            <Button onClick={() => setRegistering(true)}><UserPlus size={14} /> Register farmer</Button>
          </div>
        }
      />

      {list.error ? (
        <SourceError what="the farmers" error={list.error} onRetry={list.reload} />
      ) : unavailable ? (
        <NotAvailable />
      ) : (
        <>
          {summary.error && <SourceError what="the counts per stage" error={summary.error} onRetry={summary.reload} />}
          <Tabs
            className="mb-4"
            active={state ?? "ALL"}
            onChange={(k) => set({ state: isState(k) ? k : null })}
            tabs={[
              { key: "ALL", label: "All", count: counts?.total },
              // The Clash tab only where omnichannel counts clashes (or one was asked for).
              ...(counts?.clash !== undefined || state === "CLASH" ? ALL_FARMER_STATES : FARMER_STATES)
                .map((s) => ({ key: s, label: STATE_LABEL[s], count: counts?.[SUMMARY_KEY[s]] })),
            ]}
          />
          <FilterBar>
            <SearchInput value={typed} onChange={setTyped} placeholder="Grower number, name or phone" className="w-72" />
            <SelectFilter value={kyc ?? "all"} onChange={(v) => set({ kyc: isKyc(v) ? v : null })} options={KYC_OPTIONS} allLabel="Any KYC" />
            {state && <span className="text-[12.5px] text-text-soft">{STATE_MEANS[state]}.</span>}
            {(counts?.kycPending ?? 0) > 0 && kyc !== "PENDING" && (
              <button type="button" className="text-[12.5px] font-medium text-primary-600 hover:text-primary-700" data-testid="kyc-pending" onClick={() => set({ kyc: "PENDING" })}>
                {units(counts!.kycPending!)} waiting on a KYC decision
              </button>
            )}
          </FilterBar>

          <KycSweep onFinished={sweepEnded} />

          {!data ? <Skeleton className="h-48" /> : data.items.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="farmers-empty">
              {q || state || kyc ? "No farmer matches." : "No farmers registered yet. Run step 1 of the farmer journey, or register one."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[13px]" data-testid="farmers-table">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">Grower no.</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Factory</th>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">KYC</th>
                    <th className="px-3 py-2 font-medium">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((f) => (
                    <tr
                      key={f.growerNo}
                      className="cursor-pointer border-t border-border/60 hover:bg-surface-sunken/60"
                      data-grower={f.growerNo}
                      onClick={() => navigate(farmerHref(f.growerNo))}
                    >
                      <td className="px-3 py-2 font-mono text-[12.5px]">
                        <Link to={farmerHref(f.growerNo)} className="text-primary-600 hover:underline" onClick={(e) => e.stopPropagation()}>{f.growerNo}</Link>
                      </td>
                      <td className="px-3 py-2">{f.fullName ?? "—"}</td>
                      <td className="px-3 py-2 tabular">{f.phone ?? "—"}</td>
                      <td className="px-3 py-2">{f.factory ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATE_TONE[f.status] ?? "neutral"}>{STATE_LABEL[f.status] ?? f.status}</Badge>
                        {f.status === "CLASH" && f.clashReason && <span className="mt-1 block max-w-xs text-[12px] text-warning" data-testid="clash-reason">{f.clashReason}</span>}
                      </td>
                      <td className="px-3 py-2" data-testid="kyc-cell">
                        {f.kyc ? <Badge tone={KYC_TONE[f.kyc.status] ?? "neutral"}>{KYC_LABEL[f.kyc.status] ?? f.kyc.status}</Badge> : <span className="text-text-faint">—</span>}
                      </td>
                      <td className="px-3 py-2 tabular text-text-soft">{since(f)}</td>
                    </tr>
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

      <RegisterFarmerModal
        open={registering}
        onClose={() => setRegistering(false)}
        onDone={() => { void list.reload(); void summary.reload(); }}
      />
    </div>
  );
}

const farmerHref = (growerNo: string) => `/farmers/${encodeURIComponent(growerNo)}`;

/** When the farmer reached the stage they are at. */
function since(f: Farmer): string {
  const at = f.status === "FUNDED" ? f.lastFundedAt : f.status === "ACTIVATED" ? f.activatedAt : f.registeredAt;
  return at ? calendarDate(at) : "—";
}

type Form = { growerNo: string; fullName: string; phone: string; nationalId: string; factory: string };
const EMPTY: Form = { growerNo: "", fullName: "", phone: "", nationalId: "", factory: "" };
/** Omnichannel takes 07…, 2547… or +2547… and checks the rest; this only
 *  catches what is plainly not a phone number. */
const PHONE = /^\+?\d[\d ]{8,14}$/;

function RegisterFarmerModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [done, setDone] = useState<Registered | null>(null);
  const register = useAction((body: RegisterFarmer) => farmersApi.register(body));

  const close = () => { setForm(EMPTY); setDone(null); register.reset(); onClose(); };
  const field = (k: keyof Form) => ({
    value: form[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
  });
  const body: RegisterFarmer = {
    growerNo: form.growerNo.trim(), fullName: form.fullName.trim(), phone: form.phone.trim(),
    ...(form.nationalId.trim() ? { nationalId: form.nationalId.trim() } : {}),
    ...(form.factory.trim() ? { factory: form.factory.trim() } : {}),
  };
  const touched = Object.values(form).some((v) => v.trim() !== "");
  const problem = !body.growerNo || !body.fullName || !body.phone
    ? "Grower number, full name and phone are needed."
    : !PHONE.test(body.phone) ? "That does not look like a phone number. Use 07…, 2547… or +2547…." : null;

  const submit = async () => {
    const r = await register.run(body);
    if (!r) return;
    setDone(r);
    onDone();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Register farmer"
      footer={done ? <Button onClick={close}>Done</Button> : (
        <>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button disabled={!!problem || register.pending} onClick={() => void submit()}>{register.pending ? "Registering…" : "Register"}</Button>
        </>
      )}
    >
      {done ? (
        <div data-testid="registered">
          <NotePanel tone="success" title={done.created ? "Registered" : "Already registered"}>
            {done.created
              ? `Farmer ${done.farmer.growerNo} is registered and awaiting activation: no wallet and no PIN until they finish onboarding.`
              : `Farmer ${done.farmer.growerNo} was already registered with this phone. Nothing changed.`}
            {" "}Stage: {STATE_LABEL[done.farmer.status] ?? done.farmer.status}.
          </NotePanel>
          <Link to={farmerHref(done.farmer.growerNo)} className="mt-3 inline-block text-sm font-medium text-primary-600 hover:text-primary-700">Open the farmer's profile →</Link>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-[12.5px] text-text-soft">Creates the farmer's record only. The farmer then finishes onboarding in the app or on the web, which opens their wallet.</p>
          <Field label="Grower number"><Input aria-label="Grower number" {...field("growerNo")} /></Field>
          <Field label="Full name"><Input aria-label="Full name" {...field("fullName")} /></Field>
          <Field label="Phone"><Input aria-label="Phone" inputMode="tel" placeholder="07XXXXXXXX" {...field("phone")} /></Field>
          <Field label="National ID (optional)"><Input aria-label="National ID" {...field("nationalId")} /></Field>
          <Field label="Factory (optional)"><Input aria-label="Factory" {...field("factory")} /></Field>
          {touched && problem && <p className="text-[12.5px] text-text-soft" data-testid="form-problem">{problem}</p>}
          {register.error === NOT_AVAILABLE ? <NotAvailable /> : register.error && <p role="alert" className="text-[13px] text-danger">{register.error}</p>}
        </div>
      )}
    </Modal>
  );
}
