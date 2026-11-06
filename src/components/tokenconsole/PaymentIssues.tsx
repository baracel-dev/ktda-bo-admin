import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, DataTable, Field, GlassPanel, Input, NotePanel, Skeleton, Textarea, useToast } from "../../ui";
import { omniApi, type PaymentIssue, type PaymentIssueList } from "../../lib/omniApi";
import { useAction } from "../../lib/tokenConsole/useAction";
import { dateTime, money, shortId } from "../../lib/tokenConsole/format";
import { Code, SourceError } from "./ConsoleTable";
import { ActionModal } from "./ActionModal";

/* The payments that need a person (BRD FR-STL-05), from omnichannel, oldest
   first: a payout the provider refused after the money left the product, and
   a reported bank transfer still unmatched after the wait, and a payout the
   gateway took and never answered for (PAYOUT_UNCONFIRMED: it may or may not
   have been paid, so staff check with the gateway and confirm it sent or not
   sent; it is never retried first, which could pay twice). Each row offers
   only what omnichannel accepts for its kind; it still answers 409 when
   someone else got there first, and that message is shown as it came. */

export type IssuesSource = {
  data: PaymentIssueList | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

type Action = "retry" | "resolve" | "match" | "unmatched" | "confirmSent" | "confirmNotSent";
type Pending = { action: Action; issue: PaymentIssue };

const ACTIONS_FOR: Record<string, Action[]> = {
  PAYOUT_FAILED: ["retry", "resolve"],
  // A transfer is never resolved: it is credited (match) or failed (unmatched),
  // so it cannot leave the queue while the money could still arrive.
  TRANSFER_WAITING: ["match", "unmatched"],
  // No Retry: the gateway may have paid it, and a retry is a new payment.
  // Omnichannel refuses one (409) until it is confirmed not sent.
  PAYOUT_UNCONFIRMED: ["confirmSent", "confirmNotSent"],
};

const KIND_LABEL: Record<string, string> = { PAYOUT_FAILED: "Payout failed", TRANSFER_WAITING: "Transfer waiting", PAYOUT_UNCONFIRMED: "Payout unconfirmed" };
const KIND_TONE: Record<string, "danger" | "warning" | "info"> = { PAYOUT_FAILED: "danger", TRANSFER_WAITING: "warning", PAYOUT_UNCONFIRMED: "info" };

const ACTION_LABEL: Record<Action, string> = {
  retry: "Retry", resolve: "Resolve", match: "Match", unmatched: "Unmatched", confirmSent: "Confirm sent", confirmNotSent: "Confirm not sent",
};

/** Required text per action, and its limit (the service's). Retry takes none. */
const TEXT: Record<Exclude<Action, "retry">, { label: string; hint: string; max: number; missing: string }> = {
  resolve: { label: "Note", hint: "Required. How the customer was paid instead.", max: 300, missing: "Say how it was dealt with." },
  match: { label: "Bank reference", hint: "Required. From the bank statement line the money arrived on.", max: 64, missing: "Enter the bank's reference." },
  unmatched: { label: "Reason", hint: "Required. The customer reads it.", max: 200, missing: "Say why it is marked as never received." },
  confirmSent: { label: "Gateway receipt", hint: "Required. The receipt the gateway gave for this payout.", max: 64, missing: "Enter the gateway's receipt." },
  confirmNotSent: { label: "Note", hint: "Required. How the gateway confirmed it was not paid (who, when). Kept in the audit trail.", max: 300, missing: "Say how you confirmed it was not paid." },
};

function describe(p: Pending): { title: string; body: string; submit: string; done: string; tone: "primary" | "danger" } {
  const amount = money(p.issue.payment.amount, p.issue.payment.currency);
  switch (p.action) {
    case "retry":
      return {
        title: "Send this payout again?",
        body: `A new payout of ${amount} goes to ${p.issue.payment.phone ?? "the same phone"}. This one leaves the queue; if the new one fails too it comes back as its own row.`,
        submit: "Retry payout", done: "Sent again as a new payout.", tone: "primary",
      };
    case "resolve":
      return {
        title: "Resolve this issue?",
        body: "It leaves the queue with your note, and nothing is sent. Use it when the customer was paid another way.",
        submit: "Resolve", done: "Resolved. It has left the queue.", tone: "primary",
      };
    case "match":
      return {
        title: "Match this transfer?",
        body: `The ${amount} transfer is marked as received and the customer's balance is credited.`,
        submit: "Match transfer", done: "Matched. The customer's balance is credited.", tone: "primary",
      };
    case "unmatched":
      return {
        title: "Mark this transfer as never received?",
        body: "It fails with your reason, which the customer reads. Nothing is credited.",
        submit: "Mark unmatched", done: "Marked as never received.", tone: "danger",
      };
    case "confirmSent":
      return {
        title: "Confirm this payout was sent?",
        body: `Only once the gateway has told you it paid ${amount} to ${p.issue.payment.phone ?? "the customer"}. The payout becomes SENT with the gateway's receipt and the customer is told it was sent. Nothing is sent again.`,
        submit: "Confirm sent", done: "Confirmed sent. It has left the queue.", tone: "primary",
      };
    case "confirmNotSent":
      return {
        title: "Confirm this payout was not sent?",
        body: `Only once the gateway has told you it did not pay ${amount}. The payout fails and comes back on this queue as a failed payout, to retry or resolve. Nothing is sent now.`,
        submit: "Confirm not sent", done: "Confirmed not sent. It is now a failed payout to retry or resolve.", tone: "danger",
      };
  }
}

function run(p: Pending, text: string) {
  const id = p.issue.payment.id;
  switch (p.action) {
    case "retry": return omniApi.retryPayout(id);
    case "resolve": return omniApi.resolvePayment(id, text);
    case "match": return omniApi.matchTransfer(id, text);
    case "unmatched": return omniApi.markTransferUnmatched(id, text);
    case "confirmSent": return omniApi.confirmPayoutSent(id, text);
    case "confirmNotSent": return omniApi.confirmPayoutNotSent(id, text);
  }
}

/** Customer names for the profiles in the queue, through the customer lookup
 *  (one audited read per customer, each once). A failed lookup leaves the id. */
function useCustomerNames(profileIds: string[]) {
  const [names, setNames] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = [...new Set(profileIds)].sort().join(",");
  useEffect(() => {
    for (const id of key ? key.split(",") : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      omniApi.customer(id).then(
        (c) => { if (alive.current) setNames((n) => ({ ...n, [id]: c.legalName ?? c.displayName ?? null })); },
        () => { if (alive.current) setNames((n) => ({ ...n, [id]: null })); },
      );
    }
  }, [key]);
  return names;
}

type Row = PaymentIssue & { id: string };

export function PaymentIssues({ source }: { source: IssuesSource }) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const act = useAction((p: Pending, t: string) => run(p, t));

  const rows = useMemo<Row[]>(() => (source.data?.items ?? []).map((i) => ({ ...i, id: i.payment.id })), [source.data]);
  const names = useCustomerNames(rows.map((r) => r.profileId));

  const start = (p: Pending) => {
    act.reset();
    setText("");
    setPending(p);
  };
  const submit = async () => {
    if (!pending || act.pending) return;
    const done = await act.run(pending, text.trim());
    // Handled or refused, the queue may have moved: read it again.
    void source.reload();
    if (!done) return; // the service's message is on the dialog
    toast.push(describe(pending).done);
    setPending(null);
  };

  const words = pending ? describe(pending) : null;
  const field = pending && pending.action !== "retry" ? TEXT[pending.action] : null;

  return (
    <div>
      {source.error && <SourceError what="the payment issues" error={source.error} onRetry={source.reload} />}
      {!source.data && source.loading && !source.error && <Skeleton className="h-48" />}

      {source.data && (
        <>
          {source.data.truncated && (
            <NotePanel tone="warning" className="mb-3" title="This list is cut short">
              Omnichannel lists at most 500 of each kind and there are more waiting, so {rows.length} is a minimum. Work through
              these (oldest first) and refresh to see the rest.
            </NotePanel>
          )}
          <p className="mb-2 text-[12.5px] text-text-faint" role="status">
            {rows.length === 0 ? "Nothing needs a person right now." : `${source.data.truncated ? "At least " : ""}${rows.length} ${rows.length === 1 ? "payment needs" : "payments need"} a person, oldest first.`}
          </p>
          <GlassPanel className="p-1" sheen={false}>
            <DataTable<Row>
              rows={rows}
              emptyLabel="No refused or unconfirmed payouts and no transfers waiting"
              columns={[
                { key: "when", header: "When", className: "whitespace-nowrap", render: (r) => <span className="tabular text-xs text-text-soft">{dateTime(r.payment.createdAt)}</span> },
                { key: "customer", header: "Customer", render: (r) => (
                  <Link to={`/token-console/customers?id=${encodeURIComponent(r.profileId)}`} className="font-medium text-text hover:text-primary-600" title="Open on the Customer desk">
                    {names[r.profileId] ?? (r.profileId in names ? `Customer ${shortId(r.profileId)}` : "…")}
                  </Link>
                ) },
                { key: "kind", header: "Kind", className: "whitespace-nowrap", render: (r) => (
                  <Badge tone={KIND_TONE[r.kind] ?? "warning"}>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                ) },
                { key: "amount", header: "Amount", className: "tabular text-right whitespace-nowrap", render: (r) => (
                  <div>
                    <div className="text-text">{money(r.payment.amount, r.payment.currency)}</div>
                    {r.payment.reference && <div title={r.payment.reference}><Code>{r.payment.reference.length > 24 ? shortId(r.payment.reference) : r.payment.reference}</Code></div>}
                  </div>
                ) },
                { key: "why", header: "Why", className: "min-w-[240px]", render: (r) => (
                  <div className="text-[13px] text-text-soft">
                    {r.kind === "PAYOUT_UNCONFIRMED" && (
                      <p className="mb-1 font-medium text-text" data-testid={`unconfirmed-${r.payment.id}`}>May or may not have been paid: check with the gateway first.</p>
                    )}
                    <span>{r.why}</span>
                  </div>
                ) },
                { key: "actions", header: "", className: "whitespace-nowrap text-right", render: (r) => (
                  <div className="flex flex-wrap justify-end gap-1.5" data-testid={`issue-actions-${r.payment.id}`}>
                    {(ACTIONS_FOR[r.kind] ?? []).map((a) => (
                      <Button key={a} size="sm" variant={a === "retry" || a === "match" || a === "confirmSent" ? "primary" : "outline"} disabled={act.pending} onClick={() => start({ action: a, issue: r })}>
                        {ACTION_LABEL[a]}
                      </Button>
                    ))}
                  </div>
                ) },
              ]}
            />
          </GlassPanel>
          <p className="mt-6 max-w-3xl text-xs leading-relaxed text-text-faint">
            A refused payout means the money has left the product and the customer has not received it. Retry sends it again to the
            same phone; Resolve takes it off the queue when it was paid another way. A transfer waits here once it has gone unmatched
            past omnichannel's wait, until it is matched or marked as never received. An unconfirmed payout is one the gateway took
            and never answered for: it may or may not have been paid, so check with the gateway first, then confirm it sent (with the
            receipt) or not sent (it then becomes a failed payout to retry or resolve); it is never retried before that, which could pay
            twice. Omnichannel lists at most 500 of each kind.
            Every action is recorded against you.
          </p>
        </>
      )}

      {pending && words && (
        <ActionModal
          title={words.title}
          description={words.body}
          submitLabel={words.submit}
          pendingLabel="Working…"
          tone={words.tone}
          problem={field && !text.trim() ? field.missing : undefined}
          showProblem={text.length > 0}
          pending={act.pending}
          error={act.error}
          onSubmit={() => void submit()}
          onClose={() => setPending(null)}
          size="sm"
        >
          {field && (
            <Field label={field.label} required hint={`${field.hint} ${text.length}/${field.max}`}>
              {pending.action === "resolve" || pending.action === "confirmNotSent"
                ? <Textarea rows={3} value={text} maxLength={field.max} onChange={(e) => setText(e.target.value)} />
                : <Input value={text} maxLength={field.max} onChange={(e) => setText(e.target.value)} />}
            </Field>
          )}
        </ActionModal>
      )}
    </div>
  );
}
