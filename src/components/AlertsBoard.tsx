import { useState } from "react";
import { openCaseFromAlert, type AmlAlert } from "../mock";
import {
  PageHeader, Badge, DataTable, type Column, Button, useToast, formatDateTime, Skeleton, Card,
  FilterBar, SearchInput, SelectFilter, DateRangeFilter, inDateRange,
} from "../ui";
import { useNavigate } from "react-router-dom";
import { FolderOpen } from "lucide-react";
import { useAuth, ADMIN_USERS } from "../lib/auth";
import { useAsyncData } from "../lib/useAsyncData";

const SEVERITY_TONE: Record<AmlAlert["severity"], "info" | "warning" | "danger"> = { low: "info", medium: "warning", high: "danger" };
const STATUS_TONE: Record<AmlAlert["status"], "warning" | "info" | "success" | "danger"> = { open: "warning", under_review: "info", cleared: "success", escalated: "danger" };

const SEVERITY_OPTIONS = (Object.keys(SEVERITY_TONE) as AmlAlert["severity"][]).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
const STATUS_OPTIONS = (Object.keys(STATUS_TONE) as AmlAlert["status"][]).map((v) => ({ value: v, label: v.replace("_", " ")[0].toUpperCase() + v.replace("_", " ").slice(1) }));

/** The alert board shared by Transaction Monitoring and Fraud Reporting.
 *
 * Both desks work the same record and the same workflow — triage, then escalate
 * into a case — so they run one component rather than two that drift apart.
 * What differs is the queue's identity and where its cases live, which is what
 * these props carry. */
export function AlertsBoard({
  eyebrow,
  title,
  subtitle,
  tooltip,
  fetchAlerts,
  casesPath,
  noun = "alerts",
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  tooltip?: string;
  fetchAlerts: () => Promise<AmlAlert[]>;
  /** The case listing this board escalates into. Used for the access check —
   * an alert must not offer an escalation into a queue the reader cannot open.
   * The case *detail* route is always /cases/:id: one case, one URL, whichever
   * board opened it. */
  casesPath: string;
  noun?: string;
}) {
  const { data: alerts, loading, error, reload, setData } = useAsyncData(fetchAlerts);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const { role, canAccess } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const me = role ? ADMIN_USERS[role].name : "";
  const canOpenCase = canAccess(casesPath);

  const openCase = async (alert: AmlAlert) => {
    setBusyId(alert.id);
    try {
      const created = await openCaseFromAlert(alert.id, me);
      setData((prev) => (prev ? prev.map((a) => (a.id === alert.id ? { ...a, status: "under_review" as const, assignee: me, caseId: created.id } : a)) : prev));
      toast.push(`Case ${created.id} opened — investigation started`, "success");
      navigate(`/cases/${created.id}`);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not open a case", "error");
      setBusyId(null);
    }
  };

  const all = alerts ?? [];
  const rows = all.filter((r) => {
    if (severity !== "all" && r.severity !== severity) return false;
    if (status !== "all" && r.status !== status) return false;
    if (!inDateRange(r.raisedAt, range.from, range.to)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return r.clientName.toLowerCase().includes(q) || r.rule.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q);
  });

  const columns: Column<AmlAlert>[] = [
    {
      key: "clientName",
      header: "Farmer, agent or merchant",
      className: "min-w-[150px]",
      render: (r) => (
        <div>
          <div className="text-text font-medium">{r.clientName}</div>
          {r.clientId && <div className="mt-0.5 tabular text-xs text-text-faint">{r.clientId}</div>}
        </div>
      ),
    },
    { key: "id", header: "Alert ID", className: "whitespace-nowrap", render: (r) => <span className="tabular text-text-faint text-xs">{r.id}</span>, hideOnMobile: true, defaultHidden: true },
    // The rule is the headline; its detail is a paragraph, clamped under it with
    // the full text on hover (and still available as its own column).
    { key: "rule", header: "Rule · detail", className: "min-w-[260px]", render: (r) => (
      <div>
        <div className="text-text">{r.rule}</div>
        <div className="mt-0.5 text-xs text-text-soft line-clamp-2" title={r.detail}>{r.detail}</div>
      </div>
    ) },
    { key: "detail", header: "Detail", render: (r) => <span className="text-xs text-text-soft block max-w-sm">{r.detail}</span>, hideOnMobile: true, defaultHidden: true },
    { key: "severity", header: "Severity · status", className: "whitespace-nowrap", render: (r) => (
      <div className="flex flex-col items-start gap-1">
        <Badge tone={SEVERITY_TONE[r.severity]} className="whitespace-nowrap">{r.severity}</Badge>
        <Badge tone={STATUS_TONE[r.status]} className="whitespace-nowrap">{r.status.replace("_", " ")}</Badge>
      </div>
    ) },
    { key: "assignee", header: "Assignee", render: (r) => r.assignee ?? <span className="text-text-faint">—</span>, hideOnMobile: true },
    { key: "raisedAt", header: "Raised", className: "whitespace-nowrap", render: (r) => {
      const [date, time] = formatDateTime(r.raisedAt).split(", ");
      return (
        <div className="tabular text-xs text-text-soft">
          <div>{date}</div>
          {time && <div className="text-text-faint">{time}</div>}
        </div>
      );
    }, hideOnMobile: true },
    {
      key: "actions",
      header: "",
      className: "text-right whitespace-nowrap",
      render: (r) => {
        if (r.caseId && canOpenCase) {
          return (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/cases/${r.caseId}`)}>
              <FolderOpen size={13} /> View case
            </Button>
          );
        }
        if (r.status === "open" && canOpenCase) {
          return (
            <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => openCase(r)}>
              <FolderOpen size={13} /> {busyId === r.id ? "Opening…" : "Open case"}
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div>
      <PageHeader title={title} eyebrow={eyebrow} tooltip={tooltip} subtitle={subtitle} />

      {error && (
        <Card className="p-5 mb-6 flex items-center justify-between">
          <span className="text-sm text-danger">{error}</span>
          <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
        </Card>
      )}

      <FilterBar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, rule, detail…" />
        <SelectFilter value={severity} onChange={setSeverity} options={SEVERITY_OPTIONS} allLabel="All severities" />
        <SelectFilter value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="All statuses" />
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <span className="text-xs text-text-faint ml-auto">{rows.length} of {all.length} {noun}</span>
      </FilterBar>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <DataTable newest={(r) => r.raisedAt} columns={columns} rows={rows} columnPicker emptyLabel={`No ${noun} match`} />
      )}
    </div>
  );
}
