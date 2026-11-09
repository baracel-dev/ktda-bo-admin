import { useMemo, useState } from "react";
import { getAuditLog, verifyAuditChain } from "../lib/api";
import { AUDIT_CATEGORY_LABELS, type AuditEvent, type AuditCategory } from "../mock";
import { Link } from "react-router-dom";
import { PageHeader, Card, Badge, Button, DataTable, Tabs, Input, Skeleton, formatDateTime, type Column, FilterBar, DateRangeFilter, inDateRange } from "../ui";
import { Search, ShieldCheck, ShieldAlert } from "lucide-react";
import { useAsyncData } from "../lib/useAsyncData";

const CATEGORY_TONE: Record<AuditCategory, "info" | "accent" | "warning" | "success" | "neutral" | "danger"> = {
  config: "accent",
  security: "warning",
  approval: "info",
  data: "neutral",
  report: "success",
  compliance: "danger",
};

export default function AuditLog() {
  const { data: events, loading, error, reload } = useAsyncData(getAuditLog);
  const { data: chain } = useAsyncData(verifyAuditChain);
  const [category, setCategory] = useState<"all" | AuditCategory>("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });

  const tabs = useMemo(() => {
    const all = events ?? [];
    return [
      { key: "all", label: "All", count: all.length },
      ...(Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[]).map((c) => ({
        key: c,
        label: AUDIT_CATEGORY_LABELS[c],
        count: all.filter((e) => e.category === c).length,
      })),
    ];
  }, [events]);

  const rows = (events ?? []).filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (!inDateRange(e.at, range.from, range.to)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [e.actor, e.action, e.target, e.detail ?? ""].some((s) => s.toLowerCase().includes(q));
  });

  const columns: Column<AuditEvent>[] = [
    { key: "at", header: "When", render: (r) => <span className="text-xs text-text-soft whitespace-nowrap">{formatDateTime(r.at)}</span> },
    { key: "id", header: "Event ID", render: (r) => <span className="tabular text-text-faint text-xs">{r.id}</span>, hideOnMobile: true, defaultHidden: true },
    { key: "hash", header: "Chain hash", render: (r) => <span className="tabular text-text-faint text-xs">#{r.hash}</span>, hideOnMobile: true, defaultHidden: true },
    {
      key: "entity",
      header: "Linked record",
      render: (r) =>
        r.entityId ? (
          r.entityType === "case" ? (
            <Link to={`/cases/${r.entityId}`} className="text-xs text-primary-600 font-medium tabular">
              {r.entityType} {r.entityId}
            </Link>
          ) : (
            <span className="text-xs text-text-soft tabular">{r.entityType} {r.entityId}</span>
          )
        ) : (
          <span className="text-text-faint text-xs">—</span>
        ),
      hideOnMobile: true,
    },
    {
      key: "actor",
      header: "Actor",
      render: (r) => (
        <div>
          <div className="text-text font-medium text-sm">{r.actor}</div>
          <div className="text-[11px] text-text-faint">{r.actorRole}</div>
        </div>
      ),
    },
    { key: "category", header: "Category", render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{AUDIT_CATEGORY_LABELS[r.category]}</Badge>, hideOnMobile: true },
    {
      key: "action",
      header: "Event",
      render: (r) => (
        <div>
          <div className="text-sm text-text">
            <span className="font-medium">{r.action}</span> — {r.target}
          </div>
          {r.detail && <div className="text-xs text-text-soft mt-0.5 max-w-lg">{r.detail}</div>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit log"
        tooltip="A tamper-evident, hash-chained trail: each event's hash covers the previous one, so any edit or deletion breaks the chain and is detectable."
        subtitle="Every configuration change, security action, approval, compliance decision and report run, linked to the farmer, case or wallet it concerns."
        actions={
          chain && (
            <Badge tone={chain.intact ? "success" : "danger"}>
              {chain.intact ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
              {chain.intact ? `chain intact · ${chain.length} events` : `chain broken at ${chain.brokenAtId}`}
            </Badge>
          )
        }
      />

      {error && (
        <Card className="p-5 mb-6 flex items-center justify-between">
          <span className="text-sm text-danger">{error}</span>
          <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
        </Card>
      )}

      {loading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-96" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!loading && events && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <Tabs tabs={tabs} active={category} onChange={(k) => setCategory(k as typeof category)} />
            <div className="relative sm:ml-auto sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search actor, action, target…"
                className="pl-8 text-[13px]"
              />
            </div>
          </div>
          <FilterBar>
            <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
            <span className="text-xs text-text-faint ml-auto">{rows.length} of {events.length} events</span>
          </FilterBar>
          <DataTable newest={(r) => r.at} columns={columns} rows={rows} columnPicker emptyLabel="No events match" />
        </>
      )}
    </div>
  );
}
