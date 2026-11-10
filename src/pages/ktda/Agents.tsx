import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { Badge, Button, Field, FilterBar, Input, Modal, NotePanel, PageHeader, SearchInput, Select, Skeleton, StatCard, Tabs, Textarea, useToast } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { calendarDate, dateTime, money, units } from "../../lib/tokenConsole/format";
import { AGENTS_NOT_AVAILABLE, RECORDED_IN_APP, agentsApi } from "../../lib/api.agents";
import {
  ACTIVITY_LABEL, AGENT_STATUS_LABEL, AGENT_STATUS_TONE, CHANNEL_AGENT_NO, RECORDABLE_ACTIVITIES, activityMovesMoney,
  type Agent, type AgentStatus, type RecordActivity, type RegisterAgent,
} from "../../lib/merchantsAgentsContract";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { DetailItem } from "../../components/tokenconsole/DetailItem";
import { ErrorWithApproval, LastRejection, REASON_HINT, SentForApproval } from "../../components/ApprovalNotice";
import { withReason } from "../../lib/api.approvals";
import { REASON_MAX, type Approval } from "../../lib/approvalsContract";

/* Agents (prototype 3.9): the people who onboard farmers with a camera,
   upgrade Tier 1 wallets, and handle cash in and cash out. From omnichannel
   (merchantsAgentsContract.ts), this institution's only. Tiles from the
   summary, tabs with counts, search, the float as a bar that turns red when
   low, suspend with a reason (direct and audited for now; the prototype's
   Approvals step comes with maker-checker later), and a drawer linkable as
   ?focus=<agentNo> with a float top-up, a "record activity" form and the
   activities list.

   On KTDA the agents are the channel-api's (api.agents.ts decides once per
   page load): the agents the agent app signs in as. Registering one sends
   the starter PIN to their phone by SMS; the app asks for a new PIN at first
   sign-in. Their cash in, cash out and onboarding are recorded in the app,
   so the drawer has no "record activity" form and no activities list for
   them. */

const SIZE = 20;
type Tab = "ALL" | "LOW_FLOAT" | "SUSPENDED";
const TABS: Tab[] = ["ALL", "LOW_FLOAT", "SUSPENDED"];
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);

/** 200000 as "200.0K". */
const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : money(n);

/** What staff are told once a channel agent is registered. The starter PIN
 *  itself only where the channel echoed it (an environment that echoes codes). */
function registeredMessage(a: Agent): string {
  if (a.source !== "channel") return `${a.fullName} is registered as ${a.agentNo}.`;
  const sms = `${a.fullName} is registered as ${a.agentNo}. The starter PIN went by SMS to ${a.pinSentTo ?? "their phone"}; the agent app asks for a new PIN at first sign-in.`;
  return a.devCode ? `${sms} This environment echoes codes: the starter PIN is ${a.devCode}.` : sms;
}

const NotAvailable = () => (
  <div data-testid="not-available">
    <NotePanel tone="info" title="Not available on this environment yet">Omnichannel here does not have agents. It needs the omnichannel release with the agent register.</NotePanel>
  </div>
);

function FloatBar({ agent }: { agent: Agent }) {
  const { balance, limit, low } = agent.float;
  const pct = limit > 0 ? Math.min(100, (balance / limit) * 100) : 0;
  return (
    <div className="min-w-[150px]" data-testid="float">
      <div className="text-[12.5px] tabular text-text">{money(balance)} <span className="text-text-soft">of {compact(limit)}</span></div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div className={`h-full rounded-full ${low ? "bg-danger" : "bg-primary-600"}`} style={{ width: `${pct}%` }} data-low={low ? "true" : "false"} />
      </div>
    </div>
  );
}

export default function Agents() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get("status")) ? (params.get("status") as Tab) : "ALL";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const focus = params.get("focus");
  const [typed, setTyped] = useState(q);
  const [registering, setRegistering] = useState(false);
  const [changing, setChanging] = useState<{ agent: Agent; action: "suspend" | "reinstate" } | null>(null);
  const setSuspending = (a: Agent) => setChanging({ agent: a, action: "suspend" });
  const toast = useToast();

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

  const list = useAsyncData(() => agentsApi.list({ status: tab === "ALL" ? null : (tab as AgentStatus), q, page, size: SIZE }));
  const { reload } = list;
  useEffect(() => { void reload(); }, [tab, q, page, reload]);
  const summary = useAsyncData(() => agentsApi.summary());
  const refresh = () => { void list.reload(); void summary.reload(); };

  const data = list.data?.available ? list.data.data : null;
  const s = summary.data?.available ? summary.data.data : null;
  const unavailable = (list.data && !list.data.available) || (summary.data && !summary.data.available);

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="Agents"
        subtitle="Agents onboard farmers with a camera, upgrade Tier 1 wallets, and handle cash in and cash out."
        actions={!unavailable && <Button onClick={() => setRegistering(true)}><UserPlus size={14} /> Register agent</Button>}
      />

      {list.error ? <SourceError what="the agents" error={list.error} onRetry={list.reload} /> : unavailable ? <NotAvailable /> : (
        <>
          {summary.error && <SourceError what="the agent counts" error={summary.error} onRetry={summary.reload} />}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="agent-tiles">
            <StatCard label="Active agents" value={s ? units(s.active) : "—"} hint={s ? `${units(s.lowFloat)} of them low on float` : undefined} />
            <StatCard label="Low on float" value={s ? units(s.lowFloat) : "—"} hint="Below 25% of their limit" />
            <StatCard label="Onboarded this month" value={s ? units(s.onboardedThisMonth) : "—"} hint="Assisted sign-ups" />
            <StatCard label="Commission this month" value={s ? money(s.commissionThisMonth, "KES") : "—"} />
          </div>
          <Tabs
            className="mb-4"
            active={tab}
            onChange={(k) => isTab(k) && set({ status: k })}
            tabs={[
              { key: "ALL", label: "All", count: s ? s.active + s.suspended : undefined },
              { key: "LOW_FLOAT", label: "Low float", count: s?.lowFloat },
              { key: "SUSPENDED", label: "Suspended", count: s?.suspended },
            ]}
          />
          <FilterBar>
            <SearchInput value={typed} onChange={setTyped} placeholder="Name, agent no. or town" className="w-72" />
          </FilterBar>

          {!data ? <Skeleton className="h-48" /> : data.items.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="agents-empty">
              {q || tab !== "ALL" ? "No agent matches." : "No agents registered yet."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[13px]" data-testid="agents-table">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">Float</th>
                    <th className="px-3 py-2 text-right font-medium">Today</th>
                    <th className="px-3 py-2 text-right font-medium">Onboarded (month)</th>
                    <th className="px-3 py-2 text-right font-medium">Commission (KES)</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.agentNo} className="cursor-pointer border-t border-border/60 hover:bg-surface-sunken/60" data-agent={a.agentNo} onClick={() => set({ focus: a.agentNo })}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-text">{a.fullName}</div>
                        <div className="text-[12px] text-text-soft"><span className="font-mono">{a.agentNo}</span>{a.town ? ` · ${a.town}` : ""}</div>
                      </td>
                      <td className="px-3 py-2"><FloatBar agent={a} /></td>
                      <td className="px-3 py-2 text-right tabular">{units(a.today.transactions)}</td>
                      <td className="px-3 py-2 text-right tabular">{units(a.onboardedThisMonth)}</td>
                      <td className="px-3 py-2 text-right tabular">{money(a.commissionThisMonth)}</td>
                      <td className="px-3 py-2"><Badge tone={AGENT_STATUS_TONE[a.status] ?? "neutral"}>{AGENT_STATUS_LABEL[a.status] ?? a.status}</Badge></td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        {a.status === "SUSPENDED"
                          ? <Button size="sm" variant="outline" onClick={() => setChanging({ agent: a, action: "reinstate" })}>Reinstate</Button>
                          : <Button size="sm" variant="outline" onClick={() => setSuspending(a)}>Suspend</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-[12.5px] text-text-soft">
              <span>{units(data.total)} agents · page {page} of {data.pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => set({ page: page + 1 })}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {focus && <AgentDrawer key={focus} agentNo={focus} onClose={() => set({ focus: null })} onChanged={refresh} onSuspend={setSuspending} />}
      {changing && (
        <StatusModal
          agent={changing.agent}
          action={changing.action}
          onClose={() => setChanging(null)}
          onDone={() => { setChanging(null); toast.push(`${changing.agent.fullName} is ${changing.action === "suspend" ? "suspended" : "reinstated"}.`); refresh(); }}
        />
      )}
      {registering && (
        <RegisterAgentModal
          onClose={() => setRegistering(false)}
          onDone={(a) => { setRegistering(false); if (a.source === "channel") toast.push(registeredMessage(a)); refresh(); set({ focus: a.agentNo }); }}
        />
      )}
    </div>
  );
}

/** Suspend (a reason is needed: why, for the agent's record and the
 *  checker) or reinstate (a reason is optional). Either is sent for approval;
 *  the modal then says so and nothing is reloaded. */
function StatusModal({ agent, action, onClose, onDone }: { agent: Agent; action: "suspend" | "reinstate"; onClose: () => void; onDone: (a: Agent) => void }) {
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<Approval | null>(null);
  const suspending = action === "suspend";
  const act = useAction(() => suspending ? agentsApi.suspend(agent.agentNo, reason.trim()) : agentsApi.reinstate(agent.agentNo, reason));
  const submit = async () => {
    const r = await act.run();
    if (!r) return;
    if (r.approval) setSent(r.approval);
    else onDone(r.applied);
  };
  if (sent) {
    return (
      <Modal open onClose={onClose} size="sm" title="Sent for approval" footer={<Button size="sm" onClick={onClose}>Done</Button>}>
        <SentForApproval approval={sent} />
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={act.pending ? () => undefined : onClose}
      size="sm"
      title={suspending ? `Suspend ${agent.fullName}?` : `Reinstate ${agent.fullName}?`}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={act.pending} onClick={onClose}>Cancel</Button>
          <Button variant={suspending ? "danger" : "primary"} size="sm" disabled={act.pending || (suspending && !reason.trim())} onClick={() => void submit()}>
            {act.pending ? "Sending…" : suspending ? "Suspend" : "Reinstate"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-soft">
        {suspending
          ? "They can no longer handle cash or onboard farmers until reinstated. A second person approves it; who asked and why is recorded."
          : "They can handle cash and onboard farmers again. A second person approves it."}
      </p>
      <Field label={suspending ? "Reason" : "Reason (optional)"} hint={REASON_HINT}>
        <Textarea rows={3} aria-label="Reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder={suspending ? "Why they are suspended." : undefined} />
      </Field>
      {act.error && <ErrorWithApproval message={act.error} className="mt-3 text-[13px] text-danger" />}
    </Modal>
  );
}

const PHONE = /^\+?\d[\d ]{8,14}$/;
const positive = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0;

function RegisterAgentModal({ onClose, onDone }: { onClose: () => void; onDone: (a: Agent) => void }) {
  const [f, setF] = useState({ agentNo: "", fullName: "", phone: "", town: "", floatLimit: "" });
  // On the channel the number must be one the agent app accepts.
  const [channel, setChannel] = useState(false);
  useEffect(() => {
    let live = true;
    agentsApi.source().then((src) => { if (live) setChannel(src === "channel"); }, () => undefined);
    return () => { live = false; };
  }, []);
  const act = useAction((body: RegisterAgent) => agentsApi.register(body));
  const field = (k: keyof typeof f, labelText: string, extra: Record<string, string> = {}) => (
    <Field label={labelText}>
      <Input aria-label={labelText} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} {...extra} />
    </Field>
  );
  const problem = !f.fullName.trim() || !f.phone.trim() || !f.town.trim() || !f.floatLimit.trim() ? "Name, phone, town and float limit are needed."
    : !PHONE.test(f.phone.trim()) ? "That does not look like a phone number."
    : !positive(f.floatLimit) ? "The float limit is an amount above 0."
    : channel && f.agentNo.trim() && !CHANNEL_AGENT_NO.test(f.agentNo.trim()) ? "An agent no. is A- and 3 to 6 digits, such as A-4471, or leave it empty."
    : null;
  const touched = Object.values(f).some((v) => v.trim());
  const submit = async () => {
    const a = await act.run({
      ...(f.agentNo.trim() ? { agentNo: f.agentNo.trim() } : {}),
      fullName: f.fullName.trim(), phone: f.phone.trim(), town: f.town.trim(), floatLimit: Number(f.floatLimit),
    });
    if (a) onDone(a);
  };
  return (
    <Modal
      open
      onClose={act.pending ? () => undefined : onClose}
      title="Register agent"
      footer={
        <>
          <Button variant="outline" disabled={act.pending} onClick={onClose}>Cancel</Button>
          <Button disabled={!!problem || act.pending} onClick={() => void submit()}>{act.pending ? "Registering…" : "Register"}</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-[12.5px] text-text-soft">
          The float starts at 0; top it up from the agent's page.
          {channel && " The starter PIN goes by SMS to this phone, and the agent app asks for a new PIN at first sign-in."}
        </p>
        {field("fullName", "Full name")}
        {field("phone", "Phone", { inputMode: "tel", placeholder: "07XXXXXXXX" })}
        {field("town", "Town")}
        {field("floatLimit", "Float limit (KES)", { inputMode: "decimal" })}
        {field("agentNo", "Agent no. (optional)", { placeholder: channel ? "A-4471, or given if left empty" : "Given if left empty" })}
        {touched && problem && <p className="text-[12.5px] text-text-soft" data-testid="form-problem">{problem}</p>}
        {act.error && (act.error === AGENTS_NOT_AVAILABLE ? <NotAvailable /> : <p role="alert" className="text-[13px] text-danger">{act.error}</p>)}
      </div>
    </Modal>
  );
}

function AgentDrawer({ agentNo, onClose, onChanged, onSuspend }: { agentNo: string; onClose: () => void; onChanged: () => void; onSuspend: (a: Agent) => void }) {
  const toast = useToast();
  const agent = useAsyncData(() => agentsApi.one(agentNo));
  const [page, setPage] = useState(1);
  const activities = useAsyncData(() => agentsApi.activities(agentNo, page));
  const { reload: reloadActivities } = activities;
  useEffect(() => { void reloadActivities(); }, [page, reloadActivities]);
  const a = agent.data;
  const after = (message: string) => {
    toast.push(message);
    void agent.reload();
    void activities.reload();
    onChanged();
  };

  return (
    <Modal open onClose={onClose} title={a?.fullName ?? agentNo} size="lg">
      {agent.error ? <NotePanel tone="danger">{agent.error}</NotePanel> : agent.loading && !a ? <Skeleton className="h-48" /> : !a ? (
        <div data-testid="agent-not-found"><NotePanel tone="info" title="No such agent">No agent {agentNo} is registered with this institution.</NotePanel></div>
      ) : (
        <div data-testid="agent-drawer">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-text-soft">
            <span><span className="font-mono text-text">{a.agentNo}</span>{a.town ? ` · ${a.town}` : ""}{a.phone ? ` · ${a.phone}` : ""}</span>
            <Badge tone={AGENT_STATUS_TONE[a.status] ?? "neutral"}>{AGENT_STATUS_LABEL[a.status] ?? a.status}</Badge>
          </div>
          <LastRejection key={a.agentNo} target={a.agentNo} className="mb-4" />
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Float</div><FloatBar agent={a} /></div>
            <dl className="grid grid-cols-2 gap-3">
              <DetailItem term="Today">{units(a.today.transactions)} transactions</DetailItem>
              <DetailItem term="Onboarded (month)">{units(a.onboardedThisMonth)}</DetailItem>
              <DetailItem term="Commission (month)">{money(a.commissionThisMonth, "KES")}</DetailItem>
              <DetailItem term="Registered">{calendarDate(a.createdAt)}</DetailItem>
              {a.source === "channel" && (
                <DetailItem term="Agent app">{a.mustChangePin ? "Starter PIN not changed yet" : "Own PIN set"}</DetailItem>
              )}
            </dl>
          </div>
          {a.suspension && (
            <div className="mb-4" data-testid="suspension">
              <NotePanel tone="warning" title="Suspended">
                {a.suspension.reason} ({a.suspension.by}, {dateTime(a.suspension.at)})
              </NotePanel>
            </div>
          )}

          {a.status === "SUSPENDED" ? (
            <p className="mb-4 text-[12.5px] text-text-soft">A suspended agent's float cannot be topped up and no activity can be recorded for them.</p>
          ) : (
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              <TopUpForm agentNo={a.agentNo} onDone={(amount) => after(`Float topped up by ${money(amount, "KES")}.`)} />
              {a.source === "channel"
                ? <p className="self-start rounded-[var(--radius-lg)] border border-border p-3 text-[12.5px] text-text-soft" data-testid="recorded-in-app">{RECORDED_IN_APP}</p>
                : <RecordActivityForm agentNo={a.agentNo} onDone={(type) => after(`${ACTIVITY_LABEL[type]} recorded.`)} />}
            </div>
          )}

          <h3 className="mb-2 text-sm font-semibold text-text">Activities</h3>
          {a.source === "channel" ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-4 text-center text-[12.5px] text-text-soft" data-testid="activities-in-app">
              This agent's activity is in the agent app; it is not listed here yet.
            </p>
          ) : activities.error ? <SourceError what="the activities" error={activities.error} onRetry={activities.reload} /> : !activities.data ? <Skeleton className="h-24" /> : activities.data.items.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-4 text-center text-[12.5px] text-text-soft" data-testid="activities-empty">Nothing recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[12.5px]" data-testid="activities">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">What</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Commission</th>
                    <th className="px-3 py-2 text-right font-medium">Float after</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.data.items.map((x) => (
                    <tr key={x.id} className="border-t border-border/60">
                      <td className="whitespace-nowrap px-3 py-2 tabular text-text-soft">{dateTime(x.occurredAt)}</td>
                      <td className="px-3 py-2">{ACTIVITY_LABEL[x.type] ?? x.type}{x.growerNo ? <span className="text-text-soft"> · {x.growerNo}</span> : null}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-text-soft">{x.reference}</td>
                      <td className="px-3 py-2 text-right tabular">{x.amount != null ? money(x.amount) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular">{x.commission != null ? money(x.commission) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular">{x.floatAfter != null ? money(x.floatAfter) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {a.source !== "channel" && activities.data && activities.data.pages > 1 && (
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page >= activities.data.pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
          {a.status !== "SUSPENDED" && (
            <div className="mt-5 border-t border-border pt-4">
              <Button size="sm" variant="outline" onClick={() => onSuspend(a)}>Suspend agent</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** A top-up is sent for approval: on a 202 the form says so and nothing is
 *  reloaded (the float has not changed yet). */
function TopUpForm({ agentNo, onDone }: { agentNo: string; onDone: (amount: number) => void }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<Approval | null>(null);
  const act = useAction(() => agentsApi.topUp(agentNo, { amount: Number(amount), reference: reference.trim(), ...withReason(reason) }));
  const ok = positive(amount) && !!reference.trim();
  const submit = async () => {
    setSent(null);
    const r = await act.run();
    if (!r) return;
    if (r.approval) setSent(r.approval);
    else onDone(Number(amount));
    setAmount("");
    setReference("");
    setReason("");
  };
  return (
    <form className="rounded-[var(--radius-lg)] border border-border p-3" data-testid="top-up" onSubmit={(e) => { e.preventDefault(); if (ok) void submit(); }}>
      <h4 className="mb-2 text-[13px] font-semibold text-text">Top up float</h4>
      <div className="grid gap-2">
        <Field label="Amount (KES)"><Input aria-label="Top-up amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reference"><Input aria-label="Top-up reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank or M-Pesa reference" /></Field>
        <Field label="Reason (optional)" hint={REASON_HINT}><Input aria-label="Top-up reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} /></Field>
        <Button size="sm" type="submit" disabled={!ok || act.pending}>{act.pending ? "Sending…" : "Top up"}</Button>
        {act.error && <ErrorWithApproval message={act.error} className="text-[12.5px] text-danger" />}
        {sent && <SentForApproval approval={sent} />}
      </div>
    </form>
  );
}

function RecordActivityForm({ agentNo, onDone }: { agentNo: string; onDone: (type: RecordActivity["type"]) => void }) {
  const [type, setType] = useState<RecordActivity["type"]>("CASH_IN");
  const [amount, setAmount] = useState("");
  const [growerNo, setGrowerNo] = useState("");
  const [reference, setReference] = useState("");
  const money_ = activityMovesMoney(type);
  const act = useAction((body: RecordActivity) => agentsApi.record(agentNo, body));
  const ok = !!reference.trim() && (!money_ || positive(amount));
  const submit = async () => {
    const done = await act.run({
      type, reference: reference.trim(),
      ...(money_ ? { amount: Number(amount) } : {}),
      ...(growerNo.trim() ? { growerNo: growerNo.trim() } : {}),
    });
    if (done === undefined) return;
    onDone(type);
    setAmount("");
    setGrowerNo("");
    setReference("");
  };
  return (
    <form className="rounded-[var(--radius-lg)] border border-border p-3" data-testid="record-activity" onSubmit={(e) => { e.preventDefault(); if (ok) void submit(); }}>
      <h4 className="mb-2 text-[13px] font-semibold text-text">Record activity</h4>
      <div className="grid gap-2">
        <Field label="What">
          <Select aria-label="Activity type" value={type} onChange={(e) => setType(e.target.value as RecordActivity["type"])}>
            {RECORDABLE_ACTIVITIES.map((t) => <option key={t} value={t}>{ACTIVITY_LABEL[t]}</option>)}
          </Select>
        </Field>
        {money_ && <Field label="Amount (KES)"><Input aria-label="Activity amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        <Field label="Grower no. (optional)"><Input aria-label="Grower number" value={growerNo} onChange={(e) => setGrowerNo(e.target.value)} /></Field>
        <Field label="Reference"><Input aria-label="Activity reference" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <p className="text-[12px] text-text-soft">
          {type === "CASH_IN" ? "Cash in: the agent credited a farmer from their float." : type === "CASH_OUT" ? "Cash out: the agent paid a farmer cash; the float grows." : "Moves no money; earns the flat commission."}
        </p>
        <Button size="sm" type="submit" disabled={!ok || act.pending}>{act.pending ? "Recording…" : "Record"}</Button>
        {act.error && <p role="alert" className="text-[12.5px] text-danger">{act.error}</p>}
      </div>
    </form>
  );
}
