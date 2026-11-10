import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Field, FilterBar, Modal, NotePanel, PageHeader, Select, SelectFilter, Skeleton, Tabs, Textarea, useToast } from "../ui";
import { useAsyncData } from "../lib/useAsyncData";
import { useAction } from "../lib/tokenConsole/useAction";
import { dateTime, label, units } from "../lib/tokenConsole/format";
import { approvalsApi, APPROVALS_NOT_AVAILABLE } from "../lib/api.approvals";
import {
  APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE, APPROVAL_TYPE_LABEL, DECIDED_STATUSES, REASON_MAX, RESUBMITTABLE, approvalLink, targetLink, targetPhrase,
  type ApprovalStatus, type ApprovalType,
} from "../lib/approvalsContract";
import { ApprovalDetailsSection } from "../components/ApprovalDetails";
import { NoPermission } from "../components/Allowed";
import { useAuth } from "../lib/auth";
import { ACT } from "../lib/staffContract";
import { SourceError } from "../components/tokenconsole/ConsoleTable";
import { DetailItem } from "../components/tokenconsole/DetailItem";
import { ErrorWithApproval } from "../components/ApprovalNotice";

/* Approvals (prototype 3.4): "Every change that moves money or loosens a
   control needs a second person." Omnichannel's queue (approvalsContract.ts),
   this institution's only. A controlled write (an agent's float top-up,
   suspension or reinstatement; a merchant's settlement change, approval or
   revoked approval; verifying a farmer the registry did not match) waits here
   until a checker approves it, which replays it, or rejects it with a note.
   Omnichannel decides who may check (on UAT the maker may approve their own,
   one demo user), so the page shows who made a request and never blocks the
   maker. Linkable as ?open=AP-10001.

   v2: the drawer shows the target as it stands now (Details), and after a
   rejection the note, what happens now, and Resubmit. "My requests" lists
   the signed-in staff member's own (mine=true), and a banner counts their
   rejections of the last 7 days. */

const SIZE = 20;
/** MINE is "Waiting on me" (kept for old links); BYME is "My requests". */
type Tab = "MINE" | "PENDING" | "DECIDED" | "BYME";
const TABS: Tab[] = ["MINE", "PENDING", "DECIDED", "BYME"];
const ALL_STATUSES: ApprovalStatus[] = ["PENDING", ...DECIDED_STATUSES];
const isStatus = (v: string | null): v is ApprovalStatus => !!v && (ALL_STATUSES as string[]).includes(v);
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);
const isDecided = (v: string | null): v is Exclude<ApprovalStatus, "PENDING"> => !!v && (DECIDED_STATUSES as string[]).includes(v);
const TYPE_OPTIONS = (Object.keys(APPROVAL_TYPE_LABEL) as ApprovalType[]).map((t) => ({ value: t, label: APPROVAL_TYPE_LABEL[t] }));
const isType = (v: string | null): v is ApprovalType => !!v && v in APPROVAL_TYPE_LABEL;

const initials = (who: string) => who.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** "5 min", "3 h", "2 d". */
function age(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

const NotAvailable = () => (
  <div data-testid="not-available">
    <NotePanel tone="info" title="Not available on this environment yet">Omnichannel here has no approvals queue. It needs the omnichannel release with maker-checker.</NotePanel>
  </div>
);

export default function Approvals() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get("tab")) ? (params.get("tab") as Tab) : "MINE";
  const decided = isDecided(params.get("status")) ? (params.get("status") as Exclude<ApprovalStatus, "PENDING">) : "APPROVED";
  const mineStatus: ApprovalStatus = isStatus(params.get("status")) ? (params.get("status") as ApprovalStatus) : "PENDING";
  const type = isType(params.get("type")) ? (params.get("type") as ApprovalType) : null;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const open = params.get("open");

  const set = (next: { tab?: Tab; status?: string; type?: ApprovalType | null; page?: number; open?: string | null }) => {
    setParams(() => {
      // The live address: see FarmersByStage.
      const p = new URLSearchParams(window.location.search);
      if (next.tab) p.set("tab", next.tab);
      if (next.status) p.set("status", next.status);
      if ("type" in next) {
        if (next.type) p.set("type", next.type);
        else p.delete("type");
      }
      if ("open" in next) {
        if (next.open) p.set("open", next.open);
        else p.delete("open");
      } else if (next.page && next.page > 1) p.set("page", String(next.page));
      else p.delete("page");
      return p;
    }, { replace: true });
  };

  const status: ApprovalStatus = tab === "DECIDED" ? decided : tab === "BYME" ? mineStatus : "PENDING";
  const mine = tab === "BYME";
  const list = useAsyncData(() => approvalsApi.list({ status, type, mine, page, size: SIZE }));
  const { reload } = list;
  useEffect(() => { void reload(); }, [status, type, mine, page, reload]);
  const summary = useAsyncData(() => approvalsApi.summary());
  const refresh = () => { void list.reload(); void summary.reload(); };

  const data = list.data?.available ? list.data.data : null;
  const s = summary.data?.available ? summary.data.data : null;
  const unavailable = list.data && !list.data.available;

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="Approvals"
        subtitle="Every change that moves money or loosens a control needs a second person: agents' float top-ups, suspensions and reinstatements, merchants' settlement changes and approvals, and verifying a farmer the registry did not match."
      />

      {list.error ? <SourceError what="the approvals" error={list.error} onRetry={list.reload} /> : unavailable ? <NotAvailable /> : (
        <>
          {summary.error && <SourceError what="the approval counts" error={summary.error} onRetry={summary.reload} />}
          {!!s?.mineRejected && (
            <div className="mb-4" data-testid="mine-rejected-banner">
              <NotePanel tone="warning">
                {units(s.mineRejected)} of your requests {s.mineRejected === 1 ? "was" : "were"} rejected in the last 7 days.{" "}
                <Link to="/approvals?tab=BYME&status=REJECTED" className="font-medium text-primary-600 hover:underline">See them in My requests</Link>
              </NotePanel>
            </div>
          )}
          <Tabs
            className="mb-4"
            active={tab}
            onChange={(k) => isTab(k) && set({ tab: k })}
            tabs={[
              { key: "MINE", label: "Waiting on me", count: s?.pending },
              { key: "PENDING", label: "All pending", count: s?.pending },
              { key: "DECIDED", label: "Decided" },
              { key: "BYME", label: "My requests", count: s?.minePending },
            ]}
          />
          <FilterBar>
            <SelectFilter value={type ?? "all"} onChange={(v) => set({ type: isType(v) ? v : null })} options={TYPE_OPTIONS} allLabel="Every kind" />
            {tab === "DECIDED" && (
              <Select aria-label="Outcome" value={decided} onChange={(e) => set({ status: e.target.value })} className="w-40">
                {DECIDED_STATUSES.map((st) => <option key={st} value={st}>{APPROVAL_STATUS_LABEL[st]}</option>)}
              </Select>
            )}
            {tab === "BYME" && (
              <Select aria-label="Status" value={mineStatus} onChange={(e) => set({ status: e.target.value })} className="w-40">
                {ALL_STATUSES.map((st) => <option key={st} value={st}>{APPROVAL_STATUS_LABEL[st]}</option>)}
              </Select>
            )}
            {tab === "BYME" && <span className="text-[12.5px] text-text-soft">The requests you made.</span>}
            {tab === "MINE" && <span className="text-[12.5px] text-text-soft">Every request still waiting: omnichannel decides who may check.</span>}
            {tab === "DECIDED" && s && <span className="text-[12.5px] text-text-soft">{units(s.decidedToday)} decided today.</span>}
          </FilterBar>

          {!data ? <Skeleton className="h-48" /> : data.items.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="approvals-empty">
              {tab === "DECIDED" ? `Nothing ${APPROVAL_STATUS_LABEL[decided].toLowerCase()}.`
                : tab === "BYME" ? (mineStatus === "PENDING" ? "None of your requests is waiting." : `None of your requests is ${APPROVAL_STATUS_LABEL[mineStatus].toLowerCase()}.`)
                : "Nothing is waiting for a second person."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[13px]" data-testid="approvals-table">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">Request</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Requested by</th>
                    <th className="px-3 py-2 font-medium">Age</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id} className="cursor-pointer border-t border-border/60 align-top hover:bg-surface-sunken/60" data-ref={a.reference} onClick={() => set({ open: a.reference })}>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          <span aria-hidden="true" className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-50 text-[11px] font-semibold text-primary-700">{initials(a.maker)}</span>
                          <div>
                            <div className="font-medium text-text">{a.title}</div>
                            <div className="font-mono text-[12px] text-text-soft">{a.reference}</div>
                            {a.resubmitOf && (
                              <a
                                href={approvalLink(a.resubmitOf)}
                                className="text-[12px] text-primary-600 hover:underline"
                                data-testid="row-resubmit-of"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); set({ open: a.resubmitOf }); }}
                              >Asked again after {a.resubmitOf}</a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><Badge tone="neutral" className="whitespace-nowrap">{APPROVAL_TYPE_LABEL[a.type] ?? label(a.type)}</Badge></td>
                      <td className="px-3 py-2">{a.maker}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular text-text-soft" title={dateTime(a.madeAt)}>{age(a.madeAt)}</td>
                      <td className="max-w-xs px-3 py-2 text-[12.5px] text-text-soft">{a.reason ?? "—"}</td>
                      <td className="px-3 py-2"><Badge tone={APPROVAL_STATUS_TONE[a.status] ?? "neutral"}>{APPROVAL_STATUS_LABEL[a.status] ?? a.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-[12.5px] text-text-soft">
              <span>{units(data.total)} requests · page {page} of {data.pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => set({ page: page + 1 })}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {open && <ApprovalDrawer key={open} reference={open} onClose={() => set({ open: null })} onChanged={refresh} onOpen={(ref) => set({ open: ref })} />}
    </div>
  );
}

function ApprovalDrawer({ reference, onClose, onChanged, onOpen }: { reference: string; onClose: () => void; onChanged: () => void; onOpen: (reference: string) => void }) {
  const toast = useToast();
  const mayDecide = useAuth().can(ACT.approvalsDecide);
  const approval = useAsyncData(() => approvalsApi.one(reference));
  const a = approval.data;
  const [note, setNote] = useState("");
  const act = useAction(async (kind: "approve" | "reject" | "cancel") =>
    kind === "approve" ? approvalsApi.approve(reference, note.trim() || undefined)
      : kind === "reject" ? approvalsApi.reject(reference, note.trim())
      : approvalsApi.cancel(reference));
  const run = async (kind: "approve" | "reject" | "cancel") => {
    const after = await act.run(kind);
    if (after) {
      approval.setData(after);
      toast.push(`${after.reference}: ${APPROVAL_STATUS_LABEL[after.status]?.toLowerCase() ?? after.status}.`);
    } else {
      // A refused approval (APPROVAL_FAILED) leaves the request FAILED: show it as it now is.
      void approval.reload();
    }
    onChanged();
  };
  const [again, setAgain] = useState("");
  const [asking, setAsking] = useState(false);
  const resubmit = async () => {
    setAsking(true);
    try {
      const next = await approvalsApi.resubmit(reference, again);
      toast.push(`Asked again as ${next.reference}.`);
      onChanged();
      onOpen(next.reference);
    } catch (e) {
      // 409: another request for the target is open (named), or this one was approved.
      toast.push(e instanceof Error ? e.message : "Something went wrong", "error");
    } finally {
      setAsking(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={a?.title ?? reference} size="lg">
      {approval.error ? <NotePanel tone="danger">{approval.error}</NotePanel> : approval.loading && !a ? <Skeleton className="h-48" /> : !a ? (
        <div data-testid="approval-not-found"><NotePanel tone="info" title="No such request">No request {reference} in this institution.</NotePanel></div>
      ) : (
        <div data-testid="approval-drawer">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-text-soft">
            <Badge tone="neutral">{APPROVAL_TYPE_LABEL[a.type] ?? label(a.type)}</Badge>
            <span className="font-mono text-text">{a.reference}</span>
            <Badge tone={APPROVAL_STATUS_TONE[a.status] ?? "neutral"}>{APPROVAL_STATUS_LABEL[a.status] ?? a.status}</Badge>
            {a.resubmitOf && (
              <a
                href={approvalLink(a.resubmitOf)}
                className="text-primary-600 hover:underline"
                data-testid="approval-resubmit-of"
                onClick={(e) => { e.preventDefault(); onOpen(a.resubmitOf!); }}
              >Asked again after {a.resubmitOf}</a>
            )}
          </div>

          {a.reason && <p className="mb-4 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[13px] text-text" data-testid="approval-reason">{a.reason}</p>}

          <dl className="mb-4 grid gap-3 sm:grid-cols-2">
            <DetailItem term="Requested by">{a.maker}</DetailItem>
            <DetailItem term="Requested">{dateTime(a.madeAt)}</DetailItem>
            <DetailItem term="What it changes">
              <Link to={targetLink(a.target, a.type)} className="font-medium text-primary-600 hover:underline" data-testid="approval-target">
                {label(a.target.kind)} {a.target.reference}{a.target.name ? ` · ${a.target.name}` : ""}
              </Link>
            </DetailItem>
            <DetailItem term="Who can decide">{a.checkerRoles.length ? a.checkerRoles.map((r) => label(r)).join(", ") : "—"}</DetailItem>
          </dl>

          <ApprovalDetailsSection approval={a} />

          {a.changes.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[13px]" data-testid="approval-changes">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr><th className="px-3 py-2 font-medium">Setting</th><th className="px-3 py-2 font-medium">Now</th><th className="px-3 py-2 font-medium">Proposed</th></tr>
                </thead>
                <tbody>
                  {a.changes.map((c) => (
                    <tr key={c.setting} className="border-t border-border/60">
                      <td className="px-3 py-2">{c.setting}</td>
                      <td className="px-3 py-2 tabular text-text-soft"><s>{c.now ?? "—"}</s></td>
                      <td className="px-3 py-2 tabular font-medium text-text">{c.proposed ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {a.status !== "PENDING" && (
            <div className="mb-4 text-[12.5px] text-text-soft" data-testid="approval-outcome">
              {/* The checker's note first: after a rejection it is what the maker has to act on. */}
              {a.decisionNote && (
                <p className={`mb-2 rounded-md border px-3 py-2 text-[13px] text-text ${a.status === "APPROVED" ? "border-border bg-surface-sunken" : "border-danger/40 bg-danger-bg"}`} data-testid="approval-note">
                  Note: {a.decisionNote}
                </p>
              )}
              {a.status === "CANCELLED" ? "Cancelled by the requester" : `${APPROVAL_STATUS_LABEL[a.status]}${a.checker ? ` by ${a.checker}` : ""}`}
              {a.decidedAt ? `, ${dateTime(a.decidedAt)}` : ""}.
              {a.status === "FAILED" && a.error && <span className="mt-1 block text-danger" data-testid="approval-error">It could not be applied: {a.error}</span>}
              {a.appliedAt && <span className="block">Applied {dateTime(a.appliedAt)}.</span>}
            </div>
          )}

          {RESUBMITTABLE.includes(a.status) && (
            <div className="border-t border-border pt-4" data-testid="resubmit">
              <p className="mb-3 text-[13px] text-text" data-testid="what-now">
                Nothing was changed on {targetPhrase(a.target, a.type)}. Fix what the note asks and ask again, or leave it.
              </p>
              <Field label="New reason" hint={a.reason ? `Optional. Left empty, the request keeps its reason: ${a.reason}` : "Optional. Shown to whoever approves it."}>
                <Textarea rows={2} aria-label="New reason" value={again} maxLength={REASON_MAX} onChange={(e) => setAgain(e.target.value)} />
              </Field>
              <div className="mt-3">
                <Button disabled={asking} onClick={() => void resubmit()}>{asking ? "Asking again…" : "Resubmit"}</Button>
              </div>
            </div>
          )}

          {a.status === "PENDING" && (
            <div className="border-t border-border pt-4">
              <Field label="Note" hint="Required when you reject. Saved in the audit log.">
                <Textarea rows={3} aria-label="Note" value={note} maxLength={REASON_MAX} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {act.error && act.error !== APPROVALS_NOT_AVAILABLE && <ErrorWithApproval message={act.error} className="mt-3 text-[13px] text-danger" />}
              {act.error === APPROVALS_NOT_AVAILABLE && <NotePanel tone="info" className="mt-3">{APPROVALS_NOT_AVAILABLE}</NotePanel>}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {mayDecide && <Button variant="outline" disabled={act.pending || !note.trim()} onClick={() => void run("reject")}>Reject</Button>}
                {mayDecide && <Button disabled={act.pending} onClick={() => void run("approve")}>Approve</Button>}
                {!mayDecide && <NoPermission />}
                <span className="flex-1" />
                <Button variant="ghost" size="sm" disabled={act.pending} onClick={() => void run("cancel")} title="Only the person who asked can cancel">Cancel request</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
