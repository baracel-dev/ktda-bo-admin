import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Store } from "lucide-react";
import { Badge, Button, Checkbox, Field, FilterBar, Input, Modal, NotePanel, PageHeader, SearchInput, Select, Skeleton, StatCard, Tabs, Textarea } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { money, units } from "../../lib/tokenConsole/format";
import { MERCHANTS_NOT_AVAILABLE, merchantsApi } from "../../lib/api.merchants";
import {
  KYB_COUNT_KEY, KYB_LABEL, KYB_STATUSES, KYB_TONE, MERCHANT_TYPE_LABEL, MERCHANT_TYPES, VOUCHER_CATEGORIES,
  type KybStatus, type Merchant, type MerchantType, type RegisterMerchant,
} from "../../lib/merchantsAgentsContract";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { ErrorWithApproval, SentForApproval } from "../../components/ApprovalNotice";
import { withReason } from "../../lib/api.approvals";
import { REASON_MAX, type Approval, type Staged } from "../../lib/approvalsContract";

/* Merchants (prototype 3.8): agro-dealers and shops where farmers spend, each
   checked against the Business Registration Service before they can take
   payments. From omnichannel (merchantsAgentsContract.ts), this institution's
   only. Tiles from the summary, tabs by KYB status, search; a row opens the
   merchant's own page (/merchants/:id, MerchantDetail.tsx) with their wallet
   and transaction history. KYB decisions belong to the channel-api, so none
   are taken here. Spend at merchants is not measured yet: sales and
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
  const navigate = useNavigate();
  const open = (m: { id?: string | null; reference: string }) => navigate(`/merchants/${encodeURIComponent(m.id ?? m.reference)}`);
  // An older link (?focus=<reference>) opens that merchant's page.
  const focus = params.get("focus");
  useEffect(() => { if (focus) navigate(`/merchants/${encodeURIComponent(focus)}`, { replace: true }); }, [focus, navigate]);
  const [typed, setTyped] = useState(q);
  const [registering, setRegistering] = useState(false);

  const set = (next: { status?: Tab; q?: string; page?: number }) => {
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
      if (next.page && next.page > 1) p.set("page", String(next.page));
      else p.delete("page");
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
                    <tr key={m.reference} className="cursor-pointer border-t border-border/60 hover:bg-surface-sunken/60" data-ref={m.reference} onClick={() => open(m)}>
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

      {registering && (
        <MerchantFormModal
          onClose={() => setRegistering(false)}
          onDone={(m) => { setRegistering(false); refresh(); open(m); }}
        />
      )}
    </div>
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
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<Approval | null>(null);
  const rate = f.commission.trim() ? Number(f.commission) / 100 : undefined;
  const act = useAction(async (): Promise<Staged<Merchant>> => {
    const common = {
      name: f.name.trim(), type: f.type, town: f.town.trim(), county: f.county.trim(), ownerName: f.ownerName.trim(),
      ownerPhone: f.ownerPhone.trim(), tillNo: f.tillNo.trim(),
      ...(rate !== undefined ? { commissionRate: Number(rate.toFixed(4)) } : {}),
      vouchers: { accepts: f.accepts, categories: f.accepts ? f.categories : [] },
    };
    if (merchant) {
      return merchantsApi.update(merchant.reference, {
        ...common, settlement: { bank: f.bank.trim(), ...(f.account.trim() ? { account: f.account.trim() } : {}) }, ...withReason(reason),
      });
    }
    return { applied: await merchantsApi.register({ ...common, registrationNo: f.registrationNo.trim(), settlement: { bank: f.bank.trim(), account: f.account.trim() } } satisfies RegisterMerchant) };
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
    const r = await act.run();
    if (!r) return;
    if (r.approval) setSent(r.approval);
    else onDone(r.applied);
  };
  if (sent) {
    return (
      <Modal open onClose={onClose} title="Sent for approval" footer={<Button onClick={onClose}>Done</Button>}>
        <SentForApproval approval={sent} />
      </Modal>
    );
  }
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
        {editing && (
          <div className="sm:col-span-2">
            <Field label="Reason (optional)" hint="Changing the settlement bank or account, the commission or the till needs a second person's approval; this is shown to them.">
              <Textarea rows={2} aria-label="Reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
        {act.error && (
          <div className="sm:col-span-2">
            {act.error === MERCHANTS_NOT_AVAILABLE ? <NotAvailable /> : <ErrorWithApproval message={act.error} />}
          </div>
        )}
      </div>
    </Modal>
  );
}
