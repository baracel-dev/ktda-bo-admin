import { Link } from "react-router-dom";
import { NotePanel } from "../ui";
import { APPROVAL_REF, approvalLink, type Approval } from "../lib/approvalsContract";

/** What a controlled write shows when it was staged (202): nothing has
 *  changed yet, someone has to approve it. */
export function SentForApproval({ approval, className }: { approval: Approval; className?: string }) {
  return (
    <div className={className} data-testid="sent-for-approval">
      <NotePanel tone="info" title={`Sent for approval ${approval.reference}`}>
        {approval.title}. Nothing changes until a second person approves it on{" "}
        <Link to={approvalLink(approval.reference)} className="font-medium text-primary-600 hover:text-primary-700">Approvals</Link>.
      </NotePanel>
    </div>
  );
}

/** An error, with any approval reference in it (APPROVAL_PENDING names the
 *  open request) as a link to that request. */
export function ErrorWithApproval({ message, className = "text-[13px] text-danger" }: { message: string; className?: string }) {
  const m = message.match(APPROVAL_REF);
  if (!m || m.index === undefined) return <p role="alert" className={className}>{message}</p>;
  const ref = m[0];
  return (
    <p role="alert" className={className}>
      {message.slice(0, m.index)}
      <Link to={approvalLink(ref)} className="font-medium underline" data-testid="approval-ref-link">{ref}</Link>
      {message.slice(m.index + ref.length)}
    </p>
  );
}

/** The optional reason a controlled write carries to the checker. */
export const REASON_HINT = "Shown to whoever approves it.";
