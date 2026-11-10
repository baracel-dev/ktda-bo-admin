import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Input, NotePanel, PageHeader, SearchInput, Skeleton, Tabs, useToast } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAction } from "../../lib/tokenConsole/useAction";
import { dateTime } from "../../lib/tokenConsole/format";
import { tokenConsole } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { maybe } from "../../lib/omniMaybe";
import { staffApi } from "../../lib/api.staff";
import { ACT, rolesText, type AccessMatrix, type StaffPermission, type StaffRoleDef, type StaffView } from "../../lib/staffContract";
import type { AdminUserResponse } from "../../lib/tokenConsole/types.gen";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { ActionModal } from "../../components/tokenconsole/ActionModal";

/* Users & roles (staff-contract v1). Logins stay on the tokenization engine
   (its /admin/users: sign-ups, approve, reject, enable, disable); omnichannel's
   staff directory holds each person's roles and the permissions they resolve
   to. This page joins the two by email, one row per person, and acts on both
   sides as the contract's table says. The Access tab is the role-to-key
   matrix. Reading needs page:users; every change act:users.manage. */

type Kind = "invited" | "awaiting" | "noInvite" | "approved" | "active" | "legacy" | "engineOnly" | "disabled" | "rejected";

const KIND: Record<Kind, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  invited: { label: "Invited, waiting for sign-up", tone: "info" },
  awaiting: { label: "Signed up, awaiting approval", tone: "warning" },
  noInvite: { label: "Signed up, no invite", tone: "warning" },
  approved: { label: "Approved, waiting for first sign-in", tone: "info" },
  active: { label: "Active", tone: "success" },
  legacy: { label: "Active (engine account)", tone: "success" },
  engineOnly: { label: "Engine account, roles at next sign-in", tone: "neutral" },
  disabled: { label: "Disabled", tone: "danger" },
  rejected: { label: "Rejected", tone: "neutral" },
};

type Row = { email: string; name: string; engine: AdminUserResponse | null; staff: StaffView | null; kind: Kind };

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function kindOf(engine: AdminUserResponse | null, staff: StaffView | null): Kind {
  const e = engine?.status ?? null;
  const d = staff?.status ?? null;
  if (e === "REJECTED") return "rejected";
  if (e === "DISABLED" || d === "DISABLED") return "disabled";
  if (e === "PENDING") return staff ? "awaiting" : "noInvite";
  if (d === "INVITED") return engine ? "approved" : "invited";
  if (d === "ACTIVE") return staff!.legacy ? "legacy" : "active";
  return "engineOnly";
}

/** One row per email: the directory's records and the engine's logins. */
export function joinRows(staff: StaffView[], engine: AdminUserResponse[]): Row[] {
  const byEmail = new Map<string, Row>();
  for (const s of staff) byEmail.set(lower(s.email), { email: s.email, name: s.fullName ?? s.email, engine: null, staff: s, kind: "invited" });
  for (const u of engine) {
    const key = lower(u.email);
    if (!key) continue;
    const row = byEmail.get(key);
    if (row) {
      row.engine = u;
      if (!row.staff?.fullName && u.fullName) row.name = u.fullName;
    } else byEmail.set(key, { email: u.email!, name: u.fullName ?? u.email!, engine: u, staff: null, kind: "engineOnly" });
  }
  const rows = [...byEmail.values()];
  for (const r of rows) r.kind = kindOf(r.engine, r.staff);
  return rows;
}

const NotAvailable = () => (
  <div data-testid="not-available">
    <NotePanel tone="info" title="Not available on this environment yet">
      Omnichannel here has no staff directory, so roles are not managed or enforced yet. Sign-in accounts are on Engine users.
    </NotePanel>
  </div>
);

type Tab = "PEOPLE" | "ACCESS";

export default function UsersRoles() {
  const { can, user, refreshStaff } = useAuth();
  const manage = can(ACT.usersManage);
  const [tab, setTab] = useState<Tab>("PEOPLE");
  const directory = useAsyncData(() => maybe(staffApi.list()));
  // The engine's logins need its ADMIN role; without it the page shows the directory alone.
  const engine = useAsyncData(() => tokenConsole.adminUsers());
  const roles = useAsyncData(() => staffApi.roles().catch(() => [] as StaffRoleDef[]));

  const unavailable = directory.data && !directory.data.available;
  const reload = () => { void directory.reload(); void engine.reload(); };
  const afterOwnChange = (email: string) => { if (user && lower(user.email) === lower(email)) void refreshStaff(); };

  return (
    <div>
      <PageHeader
        eyebrow="KTDA · Admin"
        title="Users & roles"
        subtitle="Who can sign in to this back office, their roles, and what each role may see and do. Sign-in accounts are the engine's; roles and permissions are the staff directory's."
      />
      {directory.error ? <SourceError what="the staff directory" error={directory.error} onRetry={directory.reload} /> : unavailable ? <NotAvailable /> : (
        <>
          <Tabs className="mb-4" active={tab} onChange={(k) => setTab(k as Tab)} tabs={[{ key: "PEOPLE", label: "People" }, { key: "ACCESS", label: "Access" }]} />
          {!manage && (
            <p className="mb-3 text-[12.5px] text-text-soft" data-testid="read-only">You can see users and roles. Changing them needs the permission to manage users.</p>
          )}
          {tab === "PEOPLE" ? (
            <People
              staff={directory.data?.available ? directory.data.data : null}
              engine={engine.data}
              engineError={engine.error}
              roleDefs={roles.data ?? []}
              manage={manage}
              me={user?.email ?? ""}
              onChanged={(email) => { reload(); if (email) afterOwnChange(email); }}
            />
          ) : (
            <Access roleDefs={roles.data ?? []} manage={manage} myRoles={user?.staff?.roles ?? []} onOwnChange={() => void refreshStaff()} />
          )}
        </>
      )}
    </div>
  );
}

/* ---- People ---- */

type Dialog =
  | { kind: "invite" }
  | { kind: "edit"; row: Row }
  | { kind: "approveWithRoles"; row: Row }
  | { kind: "confirm"; row: Row; action: "reject" | "disable" | "revoke" };

function People({ staff, engine, engineError, roleDefs, manage, me, onChanged }: {
  staff: StaffView[] | null; engine: AdminUserResponse[] | null; engineError: string | null; roleDefs: StaffRoleDef[];
  manage: boolean; me: string; onChanged: (email?: string) => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const rows = useMemo(() => (staff ? joinRows(staff, engine ?? []) : null), [staff, engine]);
  const shown = (rows ?? []).filter((r) => !q.trim() || `${r.name} ${r.email}`.toLowerCase().includes(q.trim().toLowerCase()));

  /* Each step in turn: the engine first (so a disabled person cannot sign in
     at all), then the directory. A failure says which step stopped it. */
  const steps = useAction(async (row: Row, list: { what: string; run: () => Promise<unknown> }[]) => {
    for (const s of list) {
      try {
        await s.run();
      } catch (e) {
        throw new Error(`${s.what} failed: ${e instanceof Error ? e.message : "something went wrong"}`);
      }
    }
    return row;
  });
  const go = async (row: Row, done: string, list: { what: string; run: () => Promise<unknown> }[]) => {
    const r = await steps.run(row, list);
    setDialog(null);
    onChanged(row.email);
    if (r) toast.push(`${row.email}: ${done}.`);
  };

  const engineStep = (row: Row, action: "approve" | "reject" | "enable" | "disable") =>
    ({ what: `The engine's ${action}`, run: () => tokenConsole.userAction(row.engine!.id!, action) });
  const statusStep = (row: Row, status: "ACTIVE" | "DISABLED") =>
    ({ what: "The directory", run: () => staffApi.setStatus(row.staff!.id, status) });

  const approve = (row: Row) => void go(row, "approved; they become active at their first sign-in", [engineStep(row, "approve")]);
  const enable = (row: Row) => void go(row, "enabled", [
    ...(row.engine?.id && row.engine.status === "DISABLED" ? [engineStep(row, "enable")] : []),
    ...(row.staff && row.staff.status === "DISABLED" ? [statusStep(row, "ACTIVE")] : []),
  ]);
  const confirmed = (row: Row, action: "reject" | "disable" | "revoke") => {
    if (action === "revoke") return void go(row, "invite revoked", [statusStep(row, "DISABLED")]);
    if (action === "reject") return void go(row, "rejected", [
      engineStep(row, "reject"),
      ...(row.staff && row.staff.status !== "DISABLED" ? [statusStep(row, "DISABLED")] : []),
    ]);
    return void go(row, "disabled", [
      ...(row.engine?.id && row.engine.status === "ACTIVE" && !row.engine.root ? [engineStep(row, "disable")] : []),
      ...(row.staff && row.staff.status !== "DISABLED" ? [statusStep(row, "DISABLED")] : []),
    ]);
  };

  const actions = (r: Row) => {
    const self = lower(r.email) === lower(me);
    const busy = steps.pending;
    const edit = r.staff && <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "edit", row: r })}>Edit roles</Button>;
    const disable = !self && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ kind: "confirm", row: r, action: "disable" })}>Disable</Button>;
    switch (r.kind) {
      case "invited": return <>{edit}<Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ kind: "confirm", row: r, action: "revoke" })}>Revoke</Button></>;
      case "awaiting": return <>
        {r.engine?.id && <Button size="sm" disabled={busy} onClick={() => approve(r)}>Approve</Button>}
        {r.engine?.id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ kind: "confirm", row: r, action: "reject" })}>Reject</Button>}
      </>;
      case "noInvite": return <>
        <Button size="sm" disabled={busy} onClick={() => setDialog({ kind: "approveWithRoles", row: r })}>Approve with roles</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ kind: "confirm", row: r, action: "reject" })}>Reject</Button>
      </>;
      case "approved": case "active": case "legacy": return <>{edit}{disable}</>;
      case "engineOnly": return r.engine?.root ? null : <>{disable}</>;
      case "disabled": return <Button size="sm" variant="outline" disabled={busy} onClick={() => enable(r)}>Enable</Button>;
      default: return null;
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Name or email" />
        <span className="flex-1" />
        {manage && <Button onClick={() => setDialog({ kind: "invite" })}>Invite a user</Button>}
      </div>
      {engineError && (
        <div className="mb-3" data-testid="engine-unavailable">
          <NotePanel tone="info">Sign-ups and sign-in accounts could not be read ({engineError}). They need the ADMIN role on the engine; the directory shows alone.</NotePanel>
        </div>
      )}
      {steps.error && <p role="alert" className="mb-3 text-[13px] text-danger" data-testid="users-error">{steps.error}</p>}

      {!rows ? <Skeleton className="h-48" /> : shown.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="users-empty">{q.trim() ? "Nobody matches." : "No users yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full text-[13px]" data-testid="users-table">
            <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Roles</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last sign-in</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.email} className="border-t border-border/60 align-top" data-email={r.email}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{r.name}</div>
                    <div className="text-[12px] text-text-soft">{r.email}{lower(r.email) === lower(me) ? " · you" : ""}</div>
                  </td>
                  <td className="px-3 py-2">{r.staff ? rolesText(r.staff.roles, roleDefs) : <span className="text-text-soft">—</span>}</td>
                  <td className="px-3 py-2"><Badge tone={KIND[r.kind].tone} className="whitespace-nowrap">{KIND[r.kind].label}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12.5px] text-text-soft">{r.staff?.lastSignInAt ? dateTime(r.staff.lastSignInAt) : "—"}</td>
                  <td className="px-3 py-2">
                    {manage && <div className="flex flex-wrap justify-end gap-1.5" data-testid="row-actions">{actions(r)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "invite" && (
        <MemberModal mode="invite" roleDefs={roleDefs} onClose={() => setDialog(null)} onDone={(s) => { setDialog(null); toast.push(`${s.email} invited.`); onChanged(); }} />
      )}
      {dialog?.kind === "edit" && (
        <MemberModal mode="edit" row={dialog.row} roleDefs={roleDefs} onClose={() => setDialog(null)} onDone={(s) => { setDialog(null); toast.push(`${s.email}: roles saved.`); onChanged(s.email); }} />
      )}
      {dialog?.kind === "approveWithRoles" && (
        <MemberModal mode="approve" row={dialog.row} roleDefs={roleDefs} onClose={() => setDialog(null)} onDone={(s) => { setDialog(null); toast.push(`${s.email}: approved with ${rolesText(s.roles, roleDefs)}.`); onChanged(); }} />
      )}
      {dialog?.kind === "confirm" && (
        <ActionModal
          title={dialog.action === "reject" ? "Reject this sign-up?" : dialog.action === "revoke" ? "Revoke this invite?" : "Disable this user?"}
          description={dialog.action === "disable"
            ? `${dialog.row.email} is signed out and cannot sign in again until enabled, on the engine and in the directory.`
            : dialog.action === "reject" ? `${dialog.row.email} will not be able to sign in.` : `${dialog.row.email} will not be able to use the invite.`}
          submitLabel={dialog.action === "reject" ? "Reject" : dialog.action === "revoke" ? "Revoke" : "Disable"}
          tone="danger"
          pending={steps.pending}
          error={null}
          onSubmit={() => confirmed(dialog.row, dialog.action)}
          onClose={() => setDialog(null)}
          size="sm"
        />
      )}
    </>
  );
}

function RolePicker({ roleDefs, value, onChange }: { roleDefs: StaffRoleDef[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-2" data-testid="role-picker">
      <legend className="mb-1 text-[13px] font-medium text-text">Roles</legend>
      {roleDefs.map((d) => (
        <label key={d.role} className="flex cursor-pointer items-center gap-2.5 text-sm text-text">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--primary-600)]"
            checked={value.includes(d.role)}
            onChange={() => onChange(value.includes(d.role) ? value.filter((r) => r !== d.role) : [...value, d.role])}
          />
          {d.label}
        </label>
      ))}
    </fieldset>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite (POST /staff), edit roles (PUT /staff/{id}), or approve a sign-up
 *  that had no invite (POST /staff with roles, then the engine's approve). */
function MemberModal({ mode, row, roleDefs, onClose, onDone }: {
  mode: "invite" | "edit" | "approve"; row?: Row; roleDefs: StaffRoleDef[]; onClose: () => void; onDone: (s: StaffView) => void;
}) {
  const [email, setEmail] = useState(row?.email ?? "");
  const [name, setName] = useState(row?.staff?.fullName ?? row?.engine?.fullName ?? "");
  const [picked, setPicked] = useState<string[]>(row?.staff?.roles ?? []);
  const save = useAction(async () => {
    const body = { fullName: name.trim(), roles: picked };
    if (mode === "edit") return staffApi.update(row!.staff!.id, body);
    const created = await staffApi.invite({ email: email.trim().toLowerCase(), ...body });
    if (mode === "approve") {
      try {
        await tokenConsole.userAction(row!.engine!.id!, "approve");
      } catch (e) {
        throw new Error(`The roles are saved, but the engine's approve failed: ${e instanceof Error ? e.message : "something went wrong"}`);
      }
    }
    return created;
  });
  const problem = mode === "invite" && !EMAIL.test(email.trim()) ? "An email address."
    : !name.trim() ? "A full name."
    : picked.length === 0 ? "At least one role." : undefined;
  const submit = async () => {
    const s = await save.run();
    if (s) onDone(s);
  };
  return (
    <ActionModal
      title={mode === "invite" ? "Invite a user" : mode === "edit" ? `Roles of ${row!.email}` : `Approve ${row!.email}`}
      description={mode === "invite"
        ? "They sign up on the sign-in page with this email; once approved, their first sign-in makes them active with these roles."
        : mode === "approve" ? "They signed up without an invite. Give them roles, then approve their sign-in." : undefined}
      submitLabel={mode === "invite" ? "Invite" : mode === "edit" ? "Save" : "Approve"}
      problem={problem}
      pending={save.pending}
      error={save.error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {mode === "invite" && (
        <Field label="Email" required>
          <Input type="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      )}
      <Field label="Full name" required>
        <Input aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <RolePicker roleDefs={roleDefs} value={picked} onChange={setPicked} />
    </ActionModal>
  );
}

/* ---- Access: the role-to-key matrix ---- */

function Access({ roleDefs, manage, myRoles, onOwnChange }: { roleDefs: StaffRoleDef[]; manage: boolean; myRoles: string[]; onOwnChange: () => void }) {
  const toast = useToast();
  const perms = useAsyncData(() => staffApi.permissions());
  const matrix = useAsyncData(() => staffApi.access());
  const [draft, setDraft] = useState<AccessMatrix | null>(null);
  useEffect(() => { if (matrix.data) setDraft(matrix.data); }, [matrix.data]);
  const save = useAction((role: string, keys: string[]) => staffApi.setAccess(role, keys));

  if (perms.error) return <SourceError what="the permissions" error={perms.error} onRetry={perms.reload} />;
  if (matrix.error) return <SourceError what="the access matrix" error={matrix.error} onRetry={matrix.reload} />;
  if (!perms.data || !draft || !matrix.data) return <Skeleton className="h-64" />;

  const roles = roleDefs.length ? roleDefs.map((d) => d.role) : Object.keys(matrix.data);
  const labelOf = (role: string) => roleDefs.find((d) => d.role === role)?.label ?? role;
  const has = (role: string, key: string) => role === "ADMIN" || (draft[role] ?? []).includes(key);
  const changed = (role: string) => {
    const a = [...(draft[role] ?? [])].sort().join();
    const b = [...(matrix.data![role] ?? [])].sort().join();
    return a !== b;
  };
  const toggle = (role: string, key: string) => setDraft((d) => {
    const cur = d?.[role] ?? [];
    return { ...d, [role]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
  });
  const submit = async (role: string) => {
    const next = await save.run(role, draft[role] ?? []);
    if (!next) return;
    matrix.setData(next);
    toast.push(`${labelOf(role)}: access saved.`);
    if (myRoles.includes(role)) onOwnChange();
  };
  const groups: { title: string; items: StaffPermission[] }[] = [
    { title: "Pages", items: perms.data.filter((p) => p.group === "page") },
    { title: "Actions", items: perms.data.filter((p) => p.group === "action") },
  ];

  return (
    <div>
      <p className="mb-3 text-[12.5px] text-text-soft">What each role may see and do. A person holds every key of every role they have. Administrators always keep every key.</p>
      {save.error && <p role="alert" className="mb-3 text-[13px] text-danger">{save.error}</p>}
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
        <table className="w-full text-[13px]" data-testid="access-matrix">
          <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
            <tr>
              <th className="px-3 py-2 font-medium">Permission</th>
              {roles.map((r) => <th key={r} className="px-3 py-2 text-center font-medium" data-role={r}>{labelOf(r)}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              [
                <tr key={g.title} className="border-t border-border bg-surface-sunken/50">
                  <td colSpan={roles.length + 1} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">{g.title}</td>
                </tr>,
                ...g.items.map((p) => (
                  <tr key={p.key} className="border-t border-border/60" data-key={p.key}>
                    <td className="px-3 py-1.5">
                      <div className="text-text">{p.label}</div>
                      <div className="font-mono text-[11px] text-text-faint">{p.key}</div>
                    </td>
                    {roles.map((r) => (
                      <td key={r} className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${labelOf(r)}: ${p.label}`}
                          className="h-4 w-4 accent-[var(--primary-600)]"
                          checked={has(r, p.key)}
                          disabled={!manage || r === "ADMIN" || save.pending}
                          onChange={() => toggle(r, p.key)}
                        />
                      </td>
                    ))}
                  </tr>
                )),
              ]
            ))}
          </tbody>
          {manage && (
            <tfoot>
              <tr className="border-t border-border">
                <td className="px-3 py-2 text-[12px] text-text-soft">Save one role at a time.</td>
                {roles.map((r) => (
                  <td key={r} className="px-3 py-2 text-center">
                    {r !== "ADMIN" && changed(r) && (
                      <div className="flex flex-col items-center gap-1">
                        <Button size="sm" disabled={save.pending} onClick={() => void submit(r)}>Save {labelOf(r)}</Button>
                        <button type="button" className="text-[11.5px] text-text-soft hover:underline" onClick={() => setDraft((d) => ({ ...d, [r]: matrix.data![r] ?? [] }))}>Undo</button>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
