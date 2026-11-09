import { useMemo, useState } from "react";
import { ENQUIRY_CHANNEL_LABELS, ENQUIRY_STATUS_LABELS, type EnquiryRow } from "../mock";
import {
  getEnquiries, getCrmOwners, acknowledgeEnquiry, assignEnquiry, resolveEnquiry,
} from "../lib/api";
import {
  PageHeader, Badge, DataTable, Skeleton, Button, Modal, Field, Textarea,
  Dropdown, GlassPanel, GlassStat, StatRail, useToast, formatDateTime, FilterBar,
  SearchInput, SelectFilter, type Column,
} from "../ui";
import { Inbox, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth, ADMIN_USERS } from "../lib/auth";
import { useAsyncData } from "../lib/useAsyncData";

/** Farmers' support requests: a missing payment, a wrong number, a cash-out
 * not received from an agent, a voucher not accepted. Each is acknowledged,
 * classified and routed, against the acknowledgement standard.
 *
 * The SLA is counted in BUSINESS days, per the SOP's own wording. Calendar
 * days would flag weekends as breaches and let a genuine Friday-to-Tuesday
 * lapse read as one day. */
export default function Enquiries() {
  const { role } = useAuth();
  const toast = useToast();
  const { data: enquiries, loading, reload } = useAsyncData(getEnquiries);
  const { data: owners } = useAsyncData(getCrmOwners);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [slaOnly, setSlaOnly] = useState(false);
  const [detail, setDetail] = useState<EnquiryRow | null>(null);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const me = role ? ADMIN_USERS[role].name : "";

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      toast.push(success, "success");
      setDetail(null);
      setResolution("");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not complete that", "error");
    } finally {
      setBusy(null);
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (enquiries ?? []).filter((e) => {
      if (status !== "all" && e.status !== status) return false;
      if (channel !== "all" && e.channel !== channel) return false;
      if (slaOnly && e.sla.state !== "breached" && e.sla.state !== "due_today") return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q) || e.body.toLowerCase().includes(q);
    });
  }, [enquiries, query, status, channel, slaOnly]);

  const all = enquiries ?? [];
  const unacknowledged = all.filter((e) => !e.acknowledgedAt).length;
  const breached = all.filter((e) => e.sla.state === "breached").length;
  const open = all.filter((e) => e.status !== "resolved" && e.status !== "closed" && e.status !== "converted").length;
  const answered = all.filter((e) => e.acknowledgedAt);
  const onTime = answered.filter((e) => e.sla.state === "met").length;

  const columns: Column<EnquiryRow>[] = [
    { key: "name", header: "From", className: "min-w-[190px]", render: (r) => (
      <div>
        <div className="text-text font-medium">{r.name}</div>
        <div className="mt-0.5 text-xs text-text-faint">{r.contact}</div>
      </div>
    ) },
    { key: "subject", header: "Subject", className: "min-w-[240px]", render: (r) => (
      <div>
        <div className="text-text leading-snug">{r.subject}</div>
        <div className="mt-0.5 text-xs text-text-faint">{r.categoryLabel} · via {r.channelLabel}</div>
      </div>
    ) },
    // Channel reads under the subject; the column stays available in the picker.
    { key: "channel", header: "Channel", className: "whitespace-nowrap", render: (r) => <span className="text-text-soft">{r.channelLabel}</span>, hideOnMobile: true, defaultHidden: true },
    // Where the routing rule sent it, then who picked it up there.
    { key: "queue", header: "Routed to · owner", className: "whitespace-nowrap", render: (r) => (
      <div>
        <div className="text-text-soft">{r.routing.queue}</div>
        <div className="mt-0.5 text-xs text-text-faint">{r.ownerName || "unassigned"}</div>
      </div>
    ), hideOnMobile: true },
    { key: "owner", header: "Owner", className: "whitespace-nowrap", render: (r) => r.ownerName
      ? <span className="text-text-soft">{r.ownerName}</span>
      : <span className="text-text-faint">unassigned</span>, hideOnMobile: true, defaultHidden: true },
    { key: "sla", header: "Acknowledgement", render: (r) => <SlaBadge sla={r.sla} />, className: "whitespace-nowrap" },
    { key: "status", header: "Status", render: (r) => (
      <Badge tone={r.status === "resolved" || r.status === "converted" ? "success" : r.status === "new" ? "warning" : "info"}>
        {r.statusLabel}
      </Badge>
    ), className: "whitespace-nowrap" },
    { key: "received", header: "Received", className: "whitespace-nowrap", render: (r) => <span className="tabular text-xs text-text-soft">{formatDateTime(r.receivedAt)}</span>, hideOnMobile: true, defaultHidden: true },
  ];

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div>
      <PageHeader
        title="Enquiries"
        tooltip="Every request from a farmer, from any channel, with the acknowledgement clock running against the one-business-day standard. 'Routed to' comes from a rule per category, not from whoever picked it up."
        subtitle="Farmers' support requests raised on USSD, through an agent, at the call centre or in the app."
      />

      <StatRail className="mb-5">
        <GlassStat label="Open" value={open} icon={<Inbox size={17} />} tone="primary" hint="not yet resolved" />
        <GlassStat
          label="Unacknowledged"
          value={unacknowledged}
          icon={<Clock size={17} />}
          tone={unacknowledged ? "warning" : "neutral"}
          hint="clock still running"
        />
        <GlassStat
          label="SLA breached"
          value={breached}
          icon={<AlertTriangle size={17} />}
          tone={breached ? "danger" : "success"}
          hint="past the acknowledgement standard"
        />
        <GlassStat
          label="Acknowledged on time"
          value={answered.length ? `${Math.round((onTime / answered.length) * 100)}%` : "—"}
          icon={<CheckCircle2 size={17} />}
          tone={answered.length && onTime === answered.length ? "success" : "neutral"}
          emphasis={false}
          hint={answered.length ? `${onTime} of ${answered.length} answered` : "nothing answered yet"}
        />
      </StatRail>

      <FilterBar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, subject or body…" />
        <SelectFilter
          value={status}
          onChange={setStatus}
          allLabel="All statuses"
          options={Object.entries(ENQUIRY_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <SelectFilter
          value={channel}
          onChange={setChannel}
          allLabel="All channels"
          options={Object.entries(ENQUIRY_CHANNEL_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <button
          type="button"
          onClick={() => setSlaOnly((v) => !v)}
          className={`h-9 px-3.5 rounded-md border text-[13px] font-medium transition-colors ${
            slaOnly
              ? "border-danger/40 bg-danger-bg text-danger"
              : "border-border bg-glass text-text-soft hover:text-text hover:border-border-strong"
          }`}
        >
          Needs attention
        </button>
      </FilterBar>

      <GlassPanel className="p-1" sheen={false}>
        <DataTable newest={(r) => r.receivedAt} columns={columns} rows={rows} onRowClick={setDetail} columnPicker emptyLabel="No enquiries match" />
      </GlassPanel>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.subject} size="lg">
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Meta label="From" value={detail.clientId ? `${detail.name} (${detail.clientId})` : detail.name} />
              <Meta label="Contact" value={detail.contact} />
              <Meta label="Channel" value={detail.channelLabel} />
              <Meta label="Category" value={detail.categoryLabel} />
            </div>

            <div className="rounded-lg border border-border bg-surface-sunken p-3">
              <div className="text-xs text-text-faint mb-1">What the farmer said</div>
              <p className="text-[13px] text-text leading-relaxed">{detail.body}</p>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-text-faint mb-1">Routing rule — {detail.routing.queue}</div>
              <p className="text-[13px] text-text-soft leading-relaxed">{detail.routing.note}</p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <div className="text-xs text-text-faint mb-1">Acknowledgement</div>
                <SlaBadge sla={detail.sla} />
              </div>
              {!detail.acknowledgedAt && (
                <Button
                  onClick={() => act("ack", () => acknowledgeEnquiry(detail.id, me), "Acknowledged — the clock stops here.")}
                  disabled={busy === "ack"}
                >
                  {busy === "ack" ? "Acknowledging…" : "Acknowledge"}
                </Button>
              )}
            </div>

            <Field label="Owner" hint="Assigning is separate from acknowledging — an enquiry can be answered before anyone owns it.">
              <Dropdown
                value={detail.ownerId ?? ""}
                onChange={(v) => act("assign", () => assignEnquiry(detail.id, v || null, me), "Owner updated.")}
                placeholder="Unassigned"
                options={(owners ?? []).map((o) => ({ value: o.id, label: o.name, description: o.roleLabel }))}
              />
            </Field>

            {detail.resolution && (
              <div className="rounded-lg border border-success/30 bg-success-bg/40 p-3">
                <div className="text-xs text-text-faint mb-1">Resolution</div>
                <p className="text-[13px] text-text">{detail.resolution}</p>
              </div>
            )}

            {detail.status !== "resolved" && detail.status !== "converted" && (
              <Field label="Resolve" hint="Say what was actually done — this is what a later complaint gets checked against.">
                <Textarea rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done" />
              </Field>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
              {detail.status !== "resolved" && detail.status !== "converted" && (
                <Button
                  onClick={() => act("resolve", () => resolveEnquiry(detail.id, resolution, me), "Resolved.")}
                  disabled={busy === "resolve" || !resolution.trim()}
                >
                  {busy === "resolve" ? "Resolving…" : "Resolve"}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-faint mb-0.5">{label}</div>
      <div className="text-text font-medium break-words">{value}</div>
    </div>
  );
}

/** Five states, not a boolean. "Met late" is a different fact from "breached":
 * one is a closed problem worth reporting on, the other is a live one worth
 * working — and a queue that conflates them makes the backlog unreadable. */
function SlaBadge({ sla }: { sla: EnquiryRow["sla"] }) {
  // Badge copy is uppercased and sits in a narrow cell, so it has to stay
  // short enough not to wrap — a two-line badge reads as a layout fault.
  const map = {
    within: { tone: "info", label: sla.elapsed === 0 ? "Within standard" : `Day ${sla.elapsed}` },
    due_today: { tone: "warning", label: "Due today" },
    breached: { tone: "danger", label: `Breached · ${sla.elapsed}d` },
    met: { tone: "success", label: sla.elapsed === 0 ? "Same day" : `Met in ${sla.elapsed}d` },
    met_late: { tone: "warning", label: `Late · ${sla.elapsed}d` },
  } as const;
  const it = map[sla.state];
  return <Badge tone={it.tone}>{it.label}</Badge>;
}
