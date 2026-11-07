import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Store } from "lucide-react";
import { Badge, Button, Card, Checkbox, Field, FilterBar, Input, Modal, NotePanel, PageHeader, SearchInput, Select, Skeleton, StatCard, Tabs, Textarea, useToast } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { calendarDate, dateTime, money, units } from "../../lib/tokenConsole/format";
import { canDecideKyc } from "../../lib/tokenConsole/kyc";
import { useAuth } from "../../lib/auth";
import { MERCHANTS_NOT_AVAILABLE, merchantsApi } from "../../lib/api.merchants";
import {
  BRS_LABEL, BRS_TONE, DOCUMENT_LABEL, KYB_COUNT_KEY, KYB_LABEL, KYB_STATUSES, KYB_TONE, MERCHANT_TYPE_LABEL, MERCHANT_TYPES, VOUCHER_CATEGORIES, ratePercent,
  type KybStatus, type Merchant, type MerchantDecision, type MerchantType, type RegisterMerchant,
} from "../../lib/merchantsAgentsContract";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { DetailItem } from "../../components/tokenconsole/DetailItem";

/* Merchants (prototype 3.8): agro-dealers and shops where farmers spend, each
   checked against the Business Registration Service before they can take
   payments. From omnichannel (merchantsAgentsContract.ts), this institution's
   only. Tiles from the summary, tabs by KYB status, search, and a drawer
   linkable as ?focus=<reference> with the BRS card, settlement and documents.
   KYB decisions, document marking and BRS re-checks are for the roles that
   may decide KYC. Spend at merchants is not measured yet: sales and
   transactions show as such. */

const SIZE = 20;
type Tab = KybStatus | "ALL";
const TABS: Tab[] = ["ALL", ...KYB_STATUSES];
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);
const NOT_MEASURED = "Not yet measured";
const categoryWords = (c: string) => c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " ");

const NotAvailable = () => (
  <div data-testid="not-available">
    <NotePanel tone="info" title="Not available on this environment yet">Omnichannel here does not have merchants. It needs the omnichannel release with the merchant register.</NotePanel>
  </div>
);

export default function Merchants() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get("status")) ? (params.get("status") as Tab) : "ALL";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const focus = params.get("focus");
  const [typed, setTyped] = useState(q);
  const [registering, setRegistering] = useState(false);

  const set = (next: { status?: Tab; q?: string; page?: number; focus?: string | null }) => {
    // From the address as it is now, not as this render saw it: a delayed
    // search must not undo a tab chosen meanwhile. (React Router's own
    // updater hands back the render's copy, so read the location itself.)
    setParams(() => {
      const p = new URLSearchParams(window.location.search);
      if (next.status) {
        if (next.status === "ALL") p.delete("status");
        else p.set("status", next.status);
      }
      if ("q" in next) {
        if (next.q?.trim()) p.set("q", next.q.trim());
        else p.delete("q");
      }
      if ("focus" in next) {
        if (next.focus) p.set("focus", next.focus);
        else p.delete("focus");
      } else {
        if (next.page && next.page > 1) p.set("page", String(next.page));
        else p.delete("page");
      }
      return p;
    }, { replace: true });
  };

  useEffect(() => {
    if (typed.trim() === q.trim()) return;
    const t = setTimeout(() => set({ q: typed }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const list = useAsyncData(() => merchantsApi.list({ status: tab === "ALL" ? null : tab, q, page, size: SIZE }));
  const { reload } = list;
  useEffect(() => { void reload(); }, [tab, q, page, reload]);
  const summary = useAsyncData(() => merchantsApi.summary());
  const refresh = () => { void list.reload(); void summary.reload(); };

  const data = list.data?.available ? list.data.data : null;
  const s = summary.data?.available ? summary.data.data : null;
  const unavailable = (list.data && !list.data.available) || (summary.data && !summary.data.available);

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="Merchants"
        subtitle="Agro-dealers and shops where farmers spend. Every merchant is checked against the Business Registration Service before they can take payments."
        actions={!unavailable && <Button onClick={() => setRegistering(true)}><Store size={14} /> Register merchant</Button>}
      />

      {list.error ? <SourceError what="the merchants" error={list.error} onRetry={list.reload} /> : unavailable ? <NotAvailable /> : (
        <>
          {summary.error && <SourceError what="the merchant counts" error={summary.error} onRetry={summary.reload} />}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="merchant-tiles">
            <StatCard label="Approved merchants" value={s ? units(s.approved) : "—"} hint={s ? `${units(s.agroDealers)} agro-dealers` : undefined} />
            <StatCard label="Waiting for KYB" value={s ? units(s.waitingForKyb) : "—"} hint="Needs Compliance" />
            <StatCard label="Sales in the last 30 days" value={s?.sales30d != null ? money(s.sales30d, "KES") : NOT_MEASURED} hint="Paid from farmer wallets" />
            <StatCard label="Accept input vouchers" value={s ? units(s.acceptVouchers) : "—"} hint="Purpose-bound spend (REQ 5.6.4)" />
          </div>
          <Tabs
            className="mb-4"
            active={tab}
            onChange={(k) => isTab(k) && set({ status: k })}
            tabs={TABS.map((t) => ({
              key: t,
              label: t === "ALL" ? "All" : KYB_LABEL[t],
              count: !s ? undefined : t === "ALL" ? Object.values(s.byStatus).reduce((a, b) => a + b, 0) : s.byStatus[KYB_COUNT_KEY[t]],
            }))}
          />
          <FilterBar>
            <SearchInput value={typed} onChange={setTyped} placeholder="Name, town, owner or till" className="w-72" />
          </FilterBar>

          {!data ? <Skeleton className="h-48" /> : data.items.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="merchants-empty">
              {q || tab !== "ALL" ? "No merchant matches." : "No merchants registered yet."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[13px]" data-testid="merchants-table">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">Merchant</th>
                    <th className="px-3 py-2 font-medium">Till</th>
                    <th className="px-3 py-2 font-medium">Accepts vouchers</th>
                    <th className="px-3 py-2 text-right font-medium">Sales 30 days (KES)</th>
                    <th className="px-3 py-2 text-right font-medium">Txns</th>
                    <th className="px-3 py-2 font-medium">KYB status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.reference} className="cursor-pointer border-t border-border/60 hover:bg-surface-sunken/60" data-ref={m.reference} onClick={() => set({ focus: m.reference })}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-text">{m.name}</div>
                        <div className="text-[12px] text-text-soft">{MERCHANT_TYPE_LABEL[m.type] ?? m.type}{m.town ? ` · ${m.town}` : ""}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{m.tillNo ?? "—"}</td>
                      <td className="px-3 py-2">{m.vouchers.accepts ? m.vouchers.categories.map(categoryWords).join(", ") || "Yes" : <span className="text-text-faint">No</span>}</td>
                      <td className="px-3 py-2 text-right tabular text-text-soft">{m.sales30d != null ? money(m.sales30d) : NOT_MEASURED}</td>
                      <td className="px-3 py-2 text-right tabular text-text-soft">{m.transactions30d != null ? units(m.transactions30d) : NOT_MEASURED}</td>
                      <td className="px-3 py-2"><Badge tone={KYB_TONE[m.kyb.status] ?? "neutral"}>{KYB_LABEL[m.kyb.status] ?? m.kyb.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-[12.5px] text-text-soft">
              <span>{units(data.total)} merchants · page {page} of {data.pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => set({ page: page + 1 })}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {focus && <MerchantDrawer key={focus} reference={focus} onClose={() => set({ focus: null })} onChanged={refresh} />}
      {registering && (
        <MerchantFormModal
          onClose={() => setRegistering(false)}
          onDone={(m) => { setRegistering(false); refresh(); set({ focus: m.reference }); }}
        />
      )}
    </div>
  );
}

function MerchantDrawer({ reference, onClose, onChanged }: { reference: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const mayDecide = canDecideKyc(user?.tokRoles);
  const merchant = useAsyncData(() => merchantsApi.one(reference));
  const m = merchant.data;
  const [deciding, setDeciding] = useState<MerchantDecision["decision"] | null>(null);
  const [editing, setEditing] = useState(false);
  const act = useAction(async (fn: () => Promise<Merchant>) => fn());
  const apply = async (fn: () => Promise<Merchant>, ok: string) => {
    const after = await act.run(fn);
    if (!after) return;
    merchant.setData(after);
    onChanged();
    toast.push(ok);
  };

  return (
    <Modal open onClose={onClose} title={m?.name ?? reference} size="lg">
      {merchant.error ? <NotePanel tone="danger">{merchant.error}</NotePanel> : merchant.loading && !m ? <Skeleton className="h-48" /> : !m ? (
        <div data-testid="merchant-not-found"><NotePanel tone="info" title="No such merchant">No merchant {reference} is registered with this institution.</NotePanel></div>
      ) : (() => {
        const missing = m.documents.filter((d) => !d.received);
        const ready = m.brs.status === "VERIFIED" && missing.length === 0;
        const decided = m.kyb.status === "APPROVED" || m.kyb.status === "REJECTED";
        return (
          <div data-testid="merchant-drawer">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] text-text-soft">
                <span className="font-mono text-text">{m.reference}</span> · {MERCHANT_TYPE_LABEL[m.type] ?? m.type}
                {m.town ? ` · ${m.town}` : ""}{m.county ? `, ${m.county}` : ""}
              </p>
              <div className="flex items-center gap-2 text-[12.5px] text-text-soft">
                <Badge tone={KYB_TONE[m.kyb.status] ?? "neutral"}>{KYB_LABEL[m.kyb.status] ?? m.kyb.status}</Badge>
                <span>Joined {calendarDate(m.joinedAt)}</span>
                {mayDecide && m.kyb.status !== "REJECTED" && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit details</Button>}
              </div>
            </div>

            <Card className="mb-4 p-4" data-testid="brs-card">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text">Business Registration Service</h3>
                <Badge tone={BRS_TONE[m.brs.status] ?? "neutral"}>{BRS_LABEL[m.brs.status] ?? m.brs.status}</Badge>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailItem term="Registration no."><span className="font-mono">{m.brs.registrationNo}</span></DetailItem>
                <DetailItem term="Registered name">{m.brs.registeredName ?? "—"}</DetailItem>
                <DetailItem term="Type">{m.brs.registeredType ?? "—"}</DetailItem>
                <DetailItem term="Owner">{m.brs.registeredOwner ?? "—"}</DetailItem>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-text-soft">
                <span>{m.brs.checkedAt ? `Checked ${dateTime(m.brs.checkedAt)}` : "Not checked yet"}</span>
                {mayDecide && !decided && (
                  <Button size="sm" variant="outline" disabled={act.pending} onClick={() => void apply(() => merchantsApi.checkBrs(m.reference), "Checked against the Business Registration Service.")}>Check again</Button>
                )}
              </div>
            </Card>

            <dl className="mb-4 grid gap-3 sm:grid-cols-2" data-testid="merchant-details">
              <DetailItem term="Owner">{m.ownerName ?? "—"}</DetailItem>
              <DetailItem term="Owner phone"><span className="tabular">{m.ownerPhone ?? "—"}</span></DetailItem>
              <DetailItem term="Till number"><span className="font-mono">{m.tillNo ?? "—"}</span></DetailItem>
              <DetailItem term="Settles to">{[m.settlement.bank, m.settlement.accountMasked].filter(Boolean).join(" · ") || "—"}</DetailItem>
              <DetailItem term="Commission">{m.commissionRate != null ? `${ratePercent(m.commissionRate)} per sale` : "—"}</DetailItem>
              <DetailItem term="Input vouchers">{m.vouchers.accepts ? m.vouchers.categories.map(categoryWords).join(", ") || "Accepted" : "Not accepted"}</DetailItem>
              <DetailItem term="Sales, last 30 days">{m.sales30d != null ? money(m.sales30d, "KES") : NOT_MEASURED}</DetailItem>
              <DetailItem term="Transactions, last 30 days">{m.transactions30d != null ? units(m.transactions30d) : NOT_MEASURED}</DetailItem>
            </dl>

            <h3 className="mb-2 text-sm font-semibold text-text">Documents</h3>
            <ul className="mb-4 divide-y divide-border rounded-[var(--radius-lg)] border border-border" data-testid="merchant-documents">
              {m.documents.map((d) => (
                <li key={d.type} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]" data-doc={d.type}>
                  <span>{DOCUMENT_LABEL[d.type] ?? d.type}</span>
                  <span className="flex items-center gap-2">
                    {d.received
                      ? <Badge tone="success">Received{d.receivedAt ? ` ${calendarDate(d.receivedAt)}` : ""}</Badge>
                      : <Badge tone="warning">Missing</Badge>}
                    {!d.received && mayDecide && m.kyb.status !== "REJECTED" && (
                      <Button size="sm" variant="outline" disabled={act.pending} onClick={() => void apply(() => merchantsApi.markDocument(m.reference, d.type), `${DOCUMENT_LABEL[d.type]} marked received.`)}>Mark received</Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {m.kyb.note && (
              <p className="mb-3 text-[12.5px] text-text" data-testid="kyb-note">
                Note{m.kyb.decidedBy ? ` from ${m.kyb.decidedBy}` : ""}{m.kyb.decidedAt ? `, ${calendarDate(m.kyb.decidedAt)}` : ""}: {m.kyb.note}
              </p>
            )}
            {act.error && <p role="alert" className="mb-3 text-[13px] text-danger">{act.error}</p>}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              {!mayDecide ? (
                <span className="text-[12.5px] text-text-soft">Deciding KYB needs the Admin or Compliance role.</span>
              ) : m.kyb.status === "REJECTED" ? (
                <span className="text-[12.5px] text-text-soft">Rejected. Nothing more to decide.</span>
              ) : m.kyb.status === "APPROVED" ? (
                <Button size="sm" variant="outline" onClick={() => setDeciding("REJECTED")}>Revoke approval</Button>
              ) : (
                <>
                  <Button size="sm" disabled={!ready} onClick={() => setDeciding("APPROVED")}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => setDeciding("NEEDS_DOCUMENTS")}>Needs documents</Button>
                  <Button size="sm" variant="outline" onClick={() => setDeciding("REJECTED")}>Reject</Button>
                  {!ready && (
                    <span className="text-[12.5px] text-text-soft" data-testid="not-ready">
                      Approving needs {[m.brs.status !== "VERIFIED" && "a verified BRS check", missing.length > 0 && `${missing.length} more ${missing.length === 1 ? "document" : "documents"}`].filter(Boolean).join(" and ")}.
                    </span>
                  )}
                </>
              )}
            </div>

            {editing && (
              <MerchantFormModal
                merchant={m}
                onClose={() => setEditing(false)}
                onDone={(after) => { setEditing(false); merchant.setData(after); onChanged(); toast.push(`${after.name}: details saved.`); }}
              />
            )}
            {deciding && (
              <DecisionModal
                name={m.name}
                decision={deciding}
                revoking={m.kyb.status === "APPROVED"}
                onCancel={() => setDeciding(null)}
                onDone={(after) => { setDeciding(null); merchant.setData(after); onChanged(); toast.push(`${after.name}: ${KYB_LABEL[after.kyb.status].toLowerCase()}.`); }}
                decide={(body) => merchantsApi.decide(m.reference, body)}
              />
            )}
          </div>
        );
      })()}
    </Modal>
  );
}

function DecisionModal({ name, decision, revoking, decide, onCancel, onDone }: {
  name: string;
  decision: MerchantDecision["decision"];
  revoking: boolean;
  decide: (body: MerchantDecision) => Promise<Merchant>;
  onCancel: () => void;
  onDone: (m: Merchant) => void;
}) {
  const [note, setNote] = useState("");
  const act = useAction((body: MerchantDecision) => decide(body));
  // Revoking an approval needs a note.
  const needsNote = revoking;
  const title = revoking ? "Revoke this approval?" : decision === "APPROVED" ? "Approve this merchant?" : decision === "REJECTED" ? "Reject this merchant?" : "Ask for documents?";
  const consequence = revoking
    ? `${name} will be rejected and can no longer take payments.`
    : decision === "APPROVED" ? `${name} can take payments from farmer wallets.`
    : decision === "REJECTED" ? `${name} will not be able to take payments.`
    : `${name} stays waiting until the missing documents arrive.`;
  const submit = async () => {
    const m = await act.run({ decision, ...(note.trim() ? { note: note.trim() } : {}) });
    if (m) onDone(m);
  };
  return (
    <Modal
      open
      onClose={act.pending ? () => undefined : onCancel}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={act.pending} onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant={decision === "REJECTED" ? "danger" : "primary"} disabled={act.pending || (needsNote && !note.trim())} onClick={() => void submit()}>
            {act.pending ? "Saving…" : "Confirm"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-soft">{consequence}</p>
      <Field label={needsNote ? "Note (needed)" : "Note"} hint="Kept with the decision.">
        <Textarea rows={3} aria-label="Decision note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {act.error && <NotePanel tone="danger" className="mt-3">{act.error}</NotePanel>}
    </Modal>
  );
}

type Form = {
  name: string; type: MerchantType; town: string; county: string; ownerName: string; ownerPhone: string; tillNo: string;
  registrationNo: string; bank: string; account: string; commission: string; accepts: boolean; categories: string[];
};
const BLANK: Form = { name: "", type: "AGRO_DEALER", town: "", county: "", ownerName: "", ownerPhone: "", tillNo: "", registrationNo: "", bank: "", account: "", commission: "", accepts: false, categories: [] };
const PHONE = /^\+?\d[\d ]{8,14}$/;

/** A merchant as the form edits it. The account starts empty: the page only
 *  ever sees it masked. */
const formOf = (m: Merchant): Form => ({
  name: m.name, type: m.type, town: m.town ?? "", county: m.county ?? "", ownerName: m.ownerName ?? "", ownerPhone: m.ownerPhone ?? "",
  tillNo: m.tillNo ?? "", registrationNo: m.brs.registrationNo, bank: m.settlement.bank ?? "", account: "",
  commission: m.commissionRate != null ? String(Number((m.commissionRate * 100).toFixed(4))) : "",
  accepts: m.vouchers.accepts, categories: m.vouchers.categories,
});

/** Register a merchant, or (given `merchant`) change their details: the
 *  register body without the registration number, the account only when a
 *  new one is typed. */
function MerchantFormModal({ merchant, onClose, onDone }: { merchant?: Merchant; onClose: () => void; onDone: (m: Merchant) => void }) {
  const editing = !!merchant;
  const [f, setF] = useState<Form>(merchant ? formOf(merchant) : BLANK);
  const rate = f.commission.trim() ? Number(f.commission) / 100 : undefined;
  const act = useAction(async () => {
    const common = {
      name: f.name.trim(), type: f.type, town: f.town.trim(), county: f.county.trim(), ownerName: f.ownerName.trim(),
      ownerPhone: f.ownerPhone.trim(), tillNo: f.tillNo.trim(),
      ...(rate !== undefined ? { commissionRate: Number(rate.toFixed(4)) } : {}),
      vouchers: { accepts: f.accepts, categories: f.accepts ? f.categories : [] },
    };
    if (merchant) {
      return merchantsApi.update(merchant.reference, {
        ...common, settlement: { bank: f.bank.trim(), ...(f.account.trim() ? { account: f.account.trim() } : {}) },
      });
    }
    return merchantsApi.register({ ...common, registrationNo: f.registrationNo.trim(), settlement: { bank: f.bank.trim(), account: f.account.trim() } } satisfies RegisterMerchant);
  });
  const text = (k: keyof Form, labelText: string, extra: Record<string, string> = {}, hint?: string) => (
    <Field label={labelText} hint={hint}>
      <Input aria-label={labelText} value={f[k] as string} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} {...extra} />
    </Field>
  );
  const required: (keyof Form)[] = ["name", "town", "county", "ownerName", "ownerPhone", "tillNo", "bank", ...(editing ? [] : (["registrationNo", "account"] as (keyof Form)[]))];
  const problem = required.some((k) => !(f[k] as string).trim()) ? "Every field but the commission and vouchers is needed."
    : !PHONE.test(f.ownerPhone.trim()) ? "The owner's phone does not look like a phone number."
    : rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 0.2) ? "Commission is a percentage, 0 to 20."
    : f.accepts && f.categories.length === 0 ? "Choose at least one voucher category, or untick accepting vouchers."
    : null;
  const touched = editing || Object.entries(f).some(([k, v]) => typeof v === "string" && k !== "type" && v.trim() !== "");
  const submit = async () => {
    const m = await act.run();
    if (m) onDone(m);
  };
  return (
    <Modal
      open
      onClose={act.pending ? () => undefined : onClose}
      title={editing ? `Edit ${merchant.name}` : "Register merchant"}
      footer={
        <>
          <Button variant="outline" disabled={act.pending} onClick={onClose}>Cancel</Button>
          <Button disabled={!!problem || act.pending} onClick={() => void submit()}>
            {act.pending ? "Saving…" : editing ? "Save" : "Register"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" data-testid="merchant-form">
        <p className="text-[12.5px] text-text-soft sm:col-span-2">
          {editing
            ? `The registration number (${merchant.brs.registrationNo}) cannot change here.`
            : "The registration number is checked against the Business Registration Service straight away. The merchant starts in review."}
        </p>
        {text("name", "Business name")}
        <Field label="Type">
          <Select aria-label="Type" value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value as MerchantType }))}>
            {MERCHANT_TYPES.map((t) => <option key={t} value={t}>{MERCHANT_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        {!editing && text("registrationNo", "Registration no.")}
        {text("tillNo", "Till number")}
        {text("town", "Town")}
        {text("county", "County")}
        {text("ownerName", "Owner name")}
        {text("ownerPhone", "Owner phone", { inputMode: "tel", placeholder: "07XXXXXXXX" })}
        {text("bank", "Settlement bank")}
        {editing
          ? text("account", "Settlement account", { placeholder: merchant.settlement.accountMasked ?? "" }, "Leave empty to keep the current account; only its last digits are shown here.")
          : text("account", "Settlement account")}
        {text("commission", "Commission % per sale (optional)", { inputMode: "decimal", placeholder: "0.50" })}
        <div className="sm:col-span-2">
          <Checkbox checked={f.accepts} onChange={(v) => setF((x) => ({ ...x, accepts: v }))}>Accepts input vouchers</Checkbox>
          {f.accepts && (
            <div className="mt-2 grid grid-cols-2 gap-2 pl-7 sm:grid-cols-3">
              {VOUCHER_CATEGORIES.map((c) => (
                <Checkbox key={c} checked={f.categories.includes(c)} onChange={(v) => setF((x) => ({ ...x, categories: v ? [...x.categories, c] : x.categories.filter((y) => y !== c) }))}>
                  {categoryWords(c)}
                </Checkbox>
              ))}
            </div>
          )}
        </div>
        {touched && problem && <p className="text-[12.5px] text-text-soft sm:col-span-2" data-testid="form-problem">{problem}</p>}
        {act.error && (
          <div className="sm:col-span-2">
            {act.error === MERCHANTS_NOT_AVAILABLE ? <NotAvailable /> : <p role="alert" className="text-[13px] text-danger">{act.error}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
