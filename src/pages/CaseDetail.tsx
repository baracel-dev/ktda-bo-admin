import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CASE_TYPE_LABELS, CASE_STATUS_LABELS, ROLE_LABELS as MOCK_ROLE_LABELS,
  type CaseNote, type CaseEvidence,
} from "../mock";
import {
  getComplianceCase, addCaseNote, addCaseEvidence, assignCase, setCaseStatus, recordMlroDecision,
  escalateToMlro, closeCase, getStaffDirectory,
} from "../lib/api";
import {
  PageHeader, Card, Badge, Button, KeyValue, Skeleton, EmptyState, Modal, Field, Input, Textarea, Dropdown,
  useToast, formatDateTime,
} from "../ui";
import { ArrowLeft, Lock, ShieldAlert, Paperclip, Send } from "lucide-react";
import { useAuth, ADMIN_USERS, ROLE_LABELS } from "../lib/auth";
import { useAsyncData } from "../lib/useAsyncData";

const NOTE_TONE: Record<CaseNote["kind"], "neutral" | "info" | "warning" | "danger"> = {
  note: "neutral", status_change: "info", escalation: "danger", decision: "warning",
};

export default function CaseDetail() {
  const { id } = useParams();
  const { role } = useAuth();
  const toast = useToast();
  const { data: c, loading, error, reload } = useAsyncData(() => getComplianceCase(id ?? "", role ?? "compliance"));
  const { data: users } = useAsyncData(getStaffDirectory);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [mlroOpen, setMlroOpen] = useState<"file_str" | "no_filing" | null>(null);

  const me = role ? ADMIN_USERS[role].name : "";
  const myRoleLabel = role ? ROLE_LABELS[role] : "";
  const isMlro = role === "mlro";
  const isCompliance = role === "compliance";
  const isClosed = c?.status === "closed_cleared" || c?.status === "closed_reported";

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      toast.push(success, "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="h-8 w-72 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error === "restricted") {
    return (
      <Card>
        <EmptyState
          icon={<Lock size={20} />}
          title="Restricted case"
          body="Suspicious-activity reporting is visible only to Compliance and the MLRO. This access attempt has not been logged against the case."
          action={<Link to="/cases" className="text-sm text-primary-600 font-medium">Back to cases</Link>}
        />
      </Card>
    );
  }

  if (error || !c) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldAlert size={20} />}
          title="Case not found"
          body={error ?? "The case may have been removed, or the link is stale."}
          action={<Link to="/cases" className="text-sm text-primary-600 font-medium">Back to cases</Link>}
        />
      </Card>
    );
  }

  const assigneeOptions = (users ?? [])
    .filter((u) => u.role === "compliance" || u.role === "mlro")
    .map((u) => ({ value: u.name, label: `${u.name} (${MOCK_ROLE_LABELS[u.role]})` }));

  return (
    <div>
      <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm text-text-soft hover:text-text mb-4">
        <ArrowLeft size={15} /> Case management
      </Link>

      <PageHeader
        title={c.title}
        subtitle={c.summary}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={c.type === "sar" ? "danger" : "info"}>{CASE_TYPE_LABELS[c.type]}</Badge>
            <Badge tone={c.severity === "high" ? "danger" : c.severity === "medium" ? "warning" : "info"}>{c.severity}</Badge>
            <Badge tone="neutral">{CASE_STATUS_LABELS[c.status]}</Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <h2 className="text-sm font-semibold text-text">Investigation log</h2>
              <span className="text-xs text-text-faint">{c.notes.length} entries</span>
            </div>
            <ul className="divide-y divide-border max-h-[420px] overflow-y-auto">
              {c.notes.map((n) => (
                <li key={n.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text">{n.by}</span>
                    <span className="text-[11px] text-text-faint">{n.byRole}</span>
                    <Badge tone={NOTE_TONE[n.kind]}>{n.kind.replace("_", " ")}</Badge>
                    <span className="text-[11px] text-text-faint ml-auto">{formatDateTime(n.at)}</span>
                  </div>
                  <p className="text-sm text-text-soft mt-1.5 leading-relaxed">{n.text}</p>
                </li>
              ))}
            </ul>
            {!isClosed && (
              <div className="flex gap-2 p-4 border-t border-border">
                <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add an investigation note…" className="h-10" />
                <Button
                  disabled={!noteText.trim() || busy === "note"}
                  onClick={() =>
                    act("note", async () => {
                      await addCaseNote(c.id, noteText.trim(), "note", me, myRoleLabel);
                      setNoteText("");
                    }, "Note added")
                  }
                >
                  <Send size={14} />
                </Button>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <h2 className="text-sm font-semibold text-text">Evidence</h2>
              {!isClosed && (
                <Button size="sm" variant="outline" onClick={() => setEvidenceOpen(true)}>
                  <Paperclip size={13} /> Add evidence
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border">
              {c.evidence.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <Badge tone="neutral">{e.type.replace(/_/g, " ")}</Badge>
                  <span className="text-sm text-text flex-1">{e.label}{e.ref ? <span className="text-text-faint text-xs ml-1.5 tabular">({e.ref})</span> : null}</span>
                  <span className="text-[11px] text-text-faint shrink-0">{e.addedBy} · {formatDateTime(e.addedAt)}</span>
                </li>
              ))}
              {c.evidence.length === 0 && <li className="px-5 py-6 text-sm text-text-faint text-center">No evidence attached.</li>}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-24">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Case file</h2>
            <KeyValue
              rows={[
                { label: "Case ID", value: <span className="tabular">{c.id}</span> },
                { label: "About", value: c.clientId ? `${c.clientName} · ${c.clientId}` : c.clientName },
                { label: "Opened", value: `${formatDateTime(c.openedAt)} by ${c.openedBy}` },
                { label: "Due", value: c.dueAt ?? "—" },
                { label: "Linked alerts", value: c.linkedAlertIds.length ? c.linkedAlertIds.join(", ") : "None" },
                ...(c.sar?.strReference ? [{ label: "STR reference", value: <span className="tabular font-medium">{c.sar.strReference}</span> }] : []),
                ...(c.closedAt ? [{ label: "Closed", value: `${formatDateTime(c.closedAt)} by ${c.closedBy}` }] : []),
              ]}
            />
            {!isClosed && (
              <div className="mt-4 pt-4 border-t border-border">
                <Field label="Assignee">
                  <Dropdown
                    value={c.assignee ?? ""}
                    onChange={(v) => act("assign", () => assignCase(c.id, v, me), `Assigned to ${v}`)}
                    options={assigneeOptions}
                    placeholder="Unassigned"
                    disabled={busy === "assign"}
                    ariaLabel="Assignee"
                  />
                </Field>
              </div>
            )}
          </Card>

          {c.sar && !c.sar.mlroDecision && (
            <Card className="p-5 border-danger/30">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text mb-1">
                <Lock size={14} className="text-danger" /> MLRO decision
              </h2>
              {isMlro ? (
                <>
                  <p className="text-xs text-text-soft mb-3">
                    Decide within the configured SAR SLA. Filing an STR is itself maker-checker gated and closes the case as reported.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="danger" disabled={c.status === "pending_approval"} onClick={() => setMlroOpen("file_str")}>File STR</Button>
                    <Button size="sm" variant="outline" disabled={c.status === "pending_approval"} onClick={() => setMlroOpen("no_filing")}>No filing — close cleared</Button>
                    {c.status === "pending_approval" && <p className="text-[11px] text-text-faint">STR filing awaiting approval — see Approvals.</p>}
                  </div>
                </>
              ) : (
                <p className="text-xs text-text-soft">Escalated to {c.assignee ?? "the MLRO"} {formatDateTime(c.sar.escalatedAt)}. Only the MLRO can record the filing decision.</p>
              )}
            </Card>
          )}

          {!isClosed && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-text mb-3">Actions</h2>
              {c.status === "pending_approval" && !c.sar ? (
                /* Closure is maker-checker gated: this case's closure has
                   already been proposed into the Approvals queue and is
                   waiting on a SECOND Compliance user to decide it — it has
                   not actually closed yet. Same "awaiting approval" pattern
                   as the client activation gate on ClientDetail/
                   KycOnboardingDetail. */
                <p className="text-xs text-text-soft">
                  Closure proposed — awaiting a second approver. <Link to="/approvals" className="text-primary-600 font-medium">View in Approvals</Link>
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {isCompliance && !c.sar && (
                    <Button size="sm" variant="outline" onClick={() => setEscalateOpen(true)}>
                      <ShieldAlert size={14} /> Escalate to MLRO
                    </Button>
                  )}
                  {c.status === "open" && (
                    <Button size="sm" variant="outline" disabled={busy === "status"} onClick={() => act("status", () => setCaseStatus(c.id, "investigating", me, myRoleLabel), "Investigation started")}>
                      Start investigating
                    </Button>
                  )}
                  {!c.sar && (
                    <Button size="sm" variant="ghost" onClick={() => setCloseOpen(true)}>Close case…</Button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <Modal open={evidenceOpen} onClose={() => setEvidenceOpen(false)} title="Add evidence" size="md">
        <EvidenceForm
          onCancel={() => setEvidenceOpen(false)}
          onAdd={async (evidence) => {
            await addCaseEvidence(c.id, evidence, me);
            await reload();
            toast.push("Evidence added", "success");
            setEvidenceOpen(false);
          }}
        />
      </Modal>

      <Modal open={escalateOpen} onClose={() => setEscalateOpen(false)} title="Escalate to MLRO" size="md">
        <ReasonForm
          hint="Escalation converts this into a restricted suspicious-activity file — visible only to Compliance and the MLRO from here on."
          confirmLabel="Escalate"
          danger
          onCancel={() => setEscalateOpen(false)}
          onConfirm={async (note) => {
            await escalateToMlro(c.id, me, note);
            await reload();
            toast.push("Escalated to the MLRO", "warning");
            setEscalateOpen(false);
          }}
        />
      </Modal>

      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title="Close case" size="md">
        <ReasonForm
          hint="Closure needs a second approver (maker-checker) — this submits a case-closure item to the Approvals queue."
          confirmLabel="Submit closure"
          onCancel={() => setCloseOpen(false)}
          onConfirm={async (rationale) => {
            await closeCase(c.id, rationale, me, myRoleLabel);
            await reload();
            toast.push("Closure submitted for approval", "success");
            setCloseOpen(false);
          }}
        />
      </Modal>

      <Modal open={!!mlroOpen} onClose={() => setMlroOpen(null)} title={mlroOpen === "file_str" ? "File a Suspicious Transaction Report" : "Close without filing"} size="md">
        {mlroOpen && (
          <ReasonForm
            hint={mlroOpen === "file_str"
              ? "The filing rationale goes on the STR record and the approval item. Approval generates the STR reference."
              : "Document why no report is warranted — the rationale closes the case as cleared."}
            confirmLabel={mlroOpen === "file_str" ? "Submit STR filing" : "Record decision"}
            danger={mlroOpen === "file_str"}
            onCancel={() => setMlroOpen(null)}
            onConfirm={async (note) => {
              await recordMlroDecision(c.id, mlroOpen, me, note);
              await reload();
              toast.push(mlroOpen === "file_str" ? "STR filing submitted for approval" : "Case closed — no filing", "success");
              setMlroOpen(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function EvidenceForm({ onCancel, onAdd }: { onCancel: () => void; onAdd: (e: Omit<CaseEvidence, "id" | "addedAt" | "addedBy">) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CaseEvidence["type"]>("transaction_ref");
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <Field label="Label" required>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. M-Pesa statement extract, July" autoFocus />
      </Field>
      <Field label="Type">
        <Dropdown
          value={type}
          onChange={(v) => setType(v as CaseEvidence["type"])}
          options={[
            { value: "transaction_ref", label: "Transaction reference" },
            { value: "screening_ref", label: "Screening result" },
            { value: "document_ref", label: "Document" },
            { value: "external", label: "External / other" },
          ]}
          ariaLabel="Evidence type"
        />
      </Field>
      <Field label="Reference (optional)" hint="An ID this evidence points at — tx_…, scr_…, doc_….">
        <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="tx_9001" />
      </Field>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
        <Button
          disabled={saving || !label.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await onAdd({ label: label.trim(), type, ref: ref.trim() || undefined });
            } catch (e) {
              toast.push(e instanceof Error ? e.message : "Could not add evidence", "error");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Adding…" : "Add evidence"}
        </Button>
      </div>
    </div>
  );
}

function ReasonForm({ hint, confirmLabel, danger, onCancel, onConfirm }: {
  hint: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-soft">{hint}</p>
      <Field label="Rationale" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Written for the file and the regulator." autoFocus />
      </Field>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={saving || !reason.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await onConfirm(reason.trim());
            } catch (e) {
              toast.push(e instanceof Error ? e.message : "Action failed", "error");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Working…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
