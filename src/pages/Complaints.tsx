import { useState } from "react";
import {
  COMPLAINT_STATUS_LABELS, COMPLAINT_CATEGORY_LABELS, COMPLAINT_CHANNEL_LABELS,
  ROLE_LABELS as SYSTEM_ROLE_LABELS,
  type Complaint, type ComplaintStatus, type ComplaintCategory,
} from "../mock";
import { getComplaints, updateComplaint, getStaffDirectory } from "../lib/api";
import {
  PageHeader, Card, Badge, Button, DataTable, type Column, Modal, Field, Textarea, Dropdown, Skeleton,
  FilterBar, SearchInput, SelectFilter, DateRangeFilter, inDateRange, useToast, formatDateTime,
} from "../ui";
import { useAuth, ADMIN_USERS } from "../lib/auth";
import { useAsyncData } from "../lib/useAsyncData";

const STATUS_TONE: Record<ComplaintStatus, "info" | "accent" | "warning" | "success" | "neutral"> = {
  new: "info", acknowledged: "accent", investigating: "warning", resolved: "success", closed: "neutral",
};
const CATEGORY_TONE: Record<ComplaintCategory, "info" | "warning" | "accent" | "danger" | "neutral"> = {
  transaction: "info", service: "accent", fees: "warning", onboarding: "neutral", data_privacy: "danger", other: "neutral",
};

/** SOP §7 pipeline — each status has exactly one forward step. */
const NEXT_STATUS: Partial<Record<ComplaintStatus, ComplaintStatus>> = {
  new: "acknowledged",
  acknowledged: "investigating",
  investigating: "resolved",
};

const STATUS_OPTIONS = (Object.keys(COMPLAINT_STATUS_LABELS) as ComplaintStatus[]).map((v) => ({ value: v, label: COMPLAINT_STATUS_LABELS[v] }));
const CATEGORY_OPTIONS = (Object.keys(COMPLAINT_CATEGORY_LABELS) as ComplaintCategory[]).map((v) => ({ value: v, label: COMPLAINT_CATEGORY_LABELS[v] }));

export default function Complaints() {
  const { data: complaints, loading, error, reload, setData } = useAsyncData(getComplaints);
  const { data: users } = useAsyncData(getStaffDirectory);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = complaints ?? [];
  const rows = all.filter((c) => {
    if (status !== "all" && c.status !== status) return false;
    if (category !== "all" && c.category !== category) return false;
    if (!inDateRange(c.submittedAt, range.from, range.to)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.subject.toLowerCase().includes(q) || c.clientName.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
  });

  const selected = selectedId ? all.find((c) => c.id === selectedId) ?? null : null;

  const columns: Column<Complaint>[] = [
    {
      key: "subject",
      header: "Complaint",
      className: "min-w-[260px]",
      render: (r) => (
        <div>
          <div className="text-text font-medium">{r.subject}</div>
          {/* Clamped rather than truncated: a one-line truncate forced the column to its full nowrap width. */}
          <div className="text-xs text-text-soft mt-0.5 line-clamp-2 leading-snug" title={r.description}>{r.description}</div>
        </div>
      ),
    },
    { key: "id", header: "ID", className: "whitespace-nowrap", render: (r) => <span className="tabular text-text-faint text-xs">{r.id}</span>, hideOnMobile: true, defaultHidden: true },
    { key: "clientName", header: "Farmer · raised", className: "whitespace-nowrap", render: (r) => (
      <div>
        <div className="text-text">{r.clientName}</div>
        <div className="mt-0.5 tabular text-xs text-text-faint">{formatDateTime(r.submittedAt)} · via {COMPLAINT_CHANNEL_LABELS[r.channel]}</div>
      </div>
    ), hideOnMobile: true },
    { key: "channel", header: "Channel", className: "whitespace-nowrap", render: (r) => <span>{COMPLAINT_CHANNEL_LABELS[r.channel]}</span>, hideOnMobile: true, defaultHidden: true },
    { key: "category", header: "Category", className: "whitespace-nowrap", render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{COMPLAINT_CATEGORY_LABELS[r.category]}</Badge>, hideOnMobile: true },
    // Where it is in the SOP §7 pipeline, then who is holding it there.
    { key: "status", header: "Status · assignee", className: "whitespace-nowrap", render: (r) => (
      <div>
        <Badge tone={STATUS_TONE[r.status]}>{COMPLAINT_STATUS_LABELS[r.status]}</Badge>
        <div className="mt-1 text-xs text-text-faint">{r.assignee ?? "unassigned"}</div>
      </div>
    ) },
    { key: "assignee", header: "Assignee", className: "whitespace-nowrap", render: (r) => r.assignee ?? <span className="text-text-faint">—</span>, hideOnMobile: true, defaultHidden: true },
    { key: "submittedAt", header: "Submitted", className: "whitespace-nowrap", render: (r) => <span className="tabular text-xs text-text-soft">{formatDateTime(r.submittedAt)}</span>, hideOnMobile: true, defaultHidden: true },
  ];

  return (
    <div>
      <PageHeader
        title="Disputes"
        tooltip="Every dispute is acknowledged within one business day, investigated, and closed with a recorded resolution. The full handling history stays on the record."
        subtitle="Farmers' disputes about payments, cash-outs, charges and vouchers, from USSD, agents, the call centre and the app."
      />

      {error && (
        <Card className="p-5 mb-6 flex items-center justify-between">
          <span className="text-sm text-danger">{error}</span>
          <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
        </Card>
      )}

      <FilterBar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search subject, farmer, description…" />
        <SelectFilter value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="All statuses" />
        <SelectFilter value={category} onChange={setCategory} options={CATEGORY_OPTIONS} allLabel="All categories" />
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <span className="text-xs text-text-faint ml-auto">{rows.length} of {all.length} complaints</span>
      </FilterBar>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : (
        <DataTable newest={(r) => r.submittedAt} columns={columns} rows={rows} onRowClick={(r) => setSelectedId(r.id)} columnPicker emptyLabel="No complaints match" />
      )}

      <ComplaintModal
        complaint={selected}
        users={users ?? []}
        onClose={() => setSelectedId(null)}
        onUpdated={(updated) => setData((prev) => (prev ? prev.map((c) => (c.id === updated.id ? { ...updated } : c)) : prev))}
      />
    </div>
  );
}

function ComplaintModal({
  complaint,
  users,
  onClose,
  onUpdated,
}: {
  complaint: Complaint | null;
  users: { id: string; name: string; role: keyof typeof SYSTEM_ROLE_LABELS }[];
  onClose: () => void;
  onUpdated: (c: Complaint) => void;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState("");

  const me = role ? ADMIN_USERS[role].name : "";
  const next = complaint ? NEXT_STATUS[complaint.status] : undefined;

  const apply = async (patch: { status?: ComplaintStatus; assignee?: string; resolution?: string }, success: string) => {
    if (!complaint) return;
    setBusy(true);
    try {
      const updated = await updateComplaint(complaint.id, patch, me);
      onUpdated(updated);
      toast.push(success, "success");
      if (patch.status === "resolved") setResolution("");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Update failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const advance = async () => {
    if (!complaint || !next) return;
    if (next === "resolved" && !resolution.trim()) {
      toast.push("A resolution note is required to resolve", "warning");
      return;
    }
    await apply(
      next === "resolved" ? { status: next, resolution: resolution.trim() } : { status: next },
      `Complaint ${COMPLAINT_STATUS_LABELS[next].toLowerCase()}`,
    );
  };

  return (
    <Modal open={!!complaint} onClose={() => !busy && onClose()} title={complaint?.subject ?? ""} size="lg">
      {complaint && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={STATUS_TONE[complaint.status]}>{COMPLAINT_STATUS_LABELS[complaint.status]}</Badge>
            <Badge tone={CATEGORY_TONE[complaint.category]}>{COMPLAINT_CATEGORY_LABELS[complaint.category]}</Badge>
            <span className="text-xs text-text-faint">
              {complaint.clientName}{complaint.clientId ? ` (${complaint.clientId})` : ""} · via {COMPLAINT_CHANNEL_LABELS[complaint.channel]} · {formatDateTime(complaint.submittedAt)}
            </span>
          </div>

          <p className="text-sm text-text leading-relaxed">{complaint.description}</p>

          {complaint.resolution && (
            <Card className="p-3.5 bg-success-bg border-success/30">
              <div className="text-xs font-semibold text-text mb-0.5">Resolution</div>
              <div className="text-sm text-text">{complaint.resolution}</div>
            </Card>
          )}

          <Field label="Assignee">
            <Dropdown
              value={complaint.assignee ?? ""}
              onChange={(v) => void apply({ assignee: v }, `Assigned to ${v}`)}
              options={users.map((u) => ({ value: u.name, label: u.name, description: SYSTEM_ROLE_LABELS[u.role] }))}
              placeholder="Unassigned"
              disabled={busy}
              ariaLabel="Assignee"
            />
          </Field>

          {next === "resolved" && (
            <Field label="Resolution" required hint="Recorded on the dispute and sent to the farmer.">
              <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done to resolve this dispute." />
            </Field>
          )}

          {next && (
            <div className="flex justify-end">
              <Button disabled={busy} onClick={advance}>
                {busy ? "Saving…" : `Mark ${COMPLAINT_STATUS_LABELS[next].toLowerCase()}`}
              </Button>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-text-soft uppercase tracking-wide mb-2">History</div>
            <ol className="flex flex-col gap-2.5">
              {complaint.history.map((h) => (
                <li key={`${h.at}-${h.action}`} className="flex gap-3 text-sm">
                  <span className="text-xs text-text-faint tabular shrink-0 mt-0.5 w-32">{formatDateTime(h.at)}</span>
                  <div>
                    <span className="text-text font-medium">{h.action}</span>
                    <span className="text-text-faint"> — {h.by}</span>
                    {h.note && <div className="text-xs text-text-soft mt-0.5">{h.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}
