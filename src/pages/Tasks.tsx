import { useMemo, useState } from "react";
import { getCrmTasks, getCrmOwners, createCrmTask, setCrmTaskStatus } from "../lib/api";
import {
  PageHeader, Badge, DataTable, Skeleton, Button, Modal, Field, Input, Textarea,
  Dropdown, GlassPanel, GlassStat, StatRail, Tabs, useToast, formatDate, FilterBar,
  SearchInput, type Column, type TabDef,
} from "../ui";
import { CalendarClock, AlertTriangle, ListChecks } from "lucide-react";
import { useAuth, ADMIN_USERS } from "../lib/auth";
import { useAsyncData } from "../lib/useAsyncData";

type TaskRow = Awaited<ReturnType<typeof getCrmTasks>>[number];

/** The follow-up queue. Every service standard in Platform Settings and every
 * "next action" logged against an interaction lands here — otherwise both are
 * notes somebody has to remember to re-read, which is how pipelines go quiet
 * and SLAs get discovered at month-end. */
export default function Tasks() {
  const { role } = useAuth();
  const toast = useToast();
  const { data: tasks, loading, reload } = useAsyncData(() => getCrmTasks());
  const { data: owners } = useAsyncData(getCrmOwners);

  const [tab, setTab] = useState("mine");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", detail: "", ownerId: "", dueDate: "" });

  const me = role ? ADMIN_USERS[role].name : "";
  const myId = (owners ?? []).find((o) => o.name === me)?.id ?? null;

  const all = tasks ?? [];
  const openTasks = all.filter((t) => t.status === "open");
  const overdue = openTasks.filter((t) => t.overdue);
  const today = openTasks.filter((t) => t.dueToday);
  const mine = openTasks.filter((t) => myId && t.ownerId === myId);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      tab === "mine" ? (myId ? openTasks.filter((t) => t.ownerId === myId) : [])
      : tab === "overdue" ? overdue
      : tab === "done" ? all.filter((t) => t.status !== "open")
      : openTasks;
    return q ? base.filter((t) => t.title.toLowerCase().includes(q) || (t.detail ?? "").toLowerCase().includes(q)) : base;
  }, [tab, query, all, openTasks, overdue, myId]);

  const tabs: TabDef[] = [
    { key: "mine", label: "Mine", count: mine.length },
    { key: "all", label: "All open", count: openTasks.length },
    { key: "overdue", label: "Overdue", count: overdue.length },
    { key: "done", label: "Closed", count: all.length - openTasks.length },
  ];

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      toast.push(success, "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not complete that", "error");
    } finally {
      setBusy(null);
    }
  };

  const submit = () =>
    act("create", () => createCrmTask({ ...form, actor: me }), "Task created.").then(() => {
      setOpen(false);
      setForm({ title: "", detail: "", ownerId: "", dueDate: "" });
    });

  const columns: Column<TaskRow>[] = [
    { key: "title", header: "Task", render: (r) => (
      <div>
        <div className={`font-medium ${r.status === "open" ? "text-text" : "text-text-faint line-through"}`}>{r.title}</div>
        {r.detail && <div className="text-xs text-text-faint mt-0.5 max-w-md">{r.detail}</div>}
      </div>
    ) },
    { key: "owner", header: "Owner", render: (r) => <span className="text-text-soft">{r.ownerLabel}</span>, hideOnMobile: true },
    { key: "due", header: "Due", className: "whitespace-nowrap", render: (r) => (
      <span className={`tabular ${r.overdue ? "text-danger font-medium" : r.dueToday ? "text-warning font-medium" : "text-text-soft"}`}>
        {formatDate(r.dueDate)}
      </span>
    ) },
    { key: "source", header: "Raised by", render: (r) => <span className="text-xs text-text-faint">{r.sourceLabel}</span>, hideOnMobile: true },
    { key: "subject", header: "About", render: (r) => r.subjectId
      ? <span className="tabular text-xs text-text-soft">{r.subjectType} · {r.subjectId}</span>
      : <span className="text-text-faint text-xs">—</span>, hideOnMobile: true, defaultHidden: true },
    { key: "status", header: "Status", render: (r) => (
      r.status !== "open"
        ? <Badge tone="neutral">{r.status}</Badge>
        : r.overdue
          ? <Badge tone="danger">Overdue</Badge>
          : r.dueToday
            ? <Badge tone="warning">Due today</Badge>
            : <Badge tone="info">Open</Badge>
    ) },
    { key: "action", header: "", className: "whitespace-nowrap", render: (r) => r.status === "open" ? (
      <div className="flex gap-1 justify-end">
        <Button variant="ghost" onClick={() => act(r.id, () => setCrmTaskStatus(r.id, "done", me), "Marked done.")} disabled={busy === r.id}>Done</Button>
        <Button variant="ghost" onClick={() => act(`${r.id}-c`, () => setCrmTaskStatus(r.id, "cancelled", me), "Cancelled.")} disabled={busy === `${r.id}-c`}>Cancel</Button>
      </div>
    ) : (
      <Button variant="ghost" onClick={() => act(r.id, () => setCrmTaskStatus(r.id, "open", me), "Reopened.")} disabled={busy === r.id}>Reopen</Button>
    ) },
  ];

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        tooltip="Tasks are raised three ways: manually, by a service standard falling due, or as the 'next action' on a logged interaction. The source column says which."
        subtitle="One queue for everything owed to a farmer, an agent or a merchant."
        actions={<Button onClick={() => setOpen(true)}>New task</Button>}
      />

      <StatRail columns={3} className="mb-5">
        <GlassStat
          label="Assigned to me"
          value={mine.length}
          icon={<ListChecks size={17} />}
          tone="primary"
          hint={myId ? undefined : "no staff record matches this login"}
        />
        <GlassStat label="Due today" value={today.length} icon={<CalendarClock size={17} />} tone={today.length ? "warning" : "neutral"} />
        <GlassStat
          label="Overdue"
          value={overdue.length}
          icon={<AlertTriangle size={17} />}
          tone={overdue.length ? "danger" : "success"}
          hint="past the due date and still open"
        />
      </StatRail>

      <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-4" />
      <FilterBar><SearchInput value={query} onChange={setQuery} placeholder="Search tasks…" /></FilterBar>

      <GlassPanel className="p-1" sheen={false}>
        <DataTable
          columns={columns}
          rows={rows}
          columnPicker
          emptyLabel={tab === "mine" && !myId ? "This login has no staff record, so nothing is assigned to it" : "Nothing here"}
        />
      </GlassPanel>

      <Modal open={open} onClose={() => setOpen(false)} title="New task">
        <div className="flex flex-col gap-4">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What needs doing" /></Field>
          <Field label="Detail"><Textarea rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></Field>
          <Field label="Owner">
            <Dropdown
              value={form.ownerId}
              onChange={(v) => setForm({ ...form, ownerId: v })}
              placeholder="Select…"
              options={(owners ?? []).map((o) => ({ value: o.id, label: o.name, description: o.roleLabel }))}
            />
          </Field>
          <Field label="Due date"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={busy === "create" || !form.title.trim() || !form.ownerId || !form.dueDate}>
              {busy === "create" ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
