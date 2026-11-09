/* Maker-checker: omnichannel's approvals queue (/api/operator/approvals),
   scoped to this back office's institution. "Every change that moves money
   or loosens a control needs a second person" (prototype 3.4). A controlled
   write no longer acts: it stages a request and answers 202 { approval }; a
   checker's approval replays it through the same service. On UAT a switch
   lets the maker approve their own request (one demo user), so the page
   never blocks the maker; it shows who made it.

   Controlled writes (each body gains an optional `reason`, max 300; the same
   write on the same target while one is pending is 409 APPROVAL_PENDING
   naming it):
   - agent float top-up, suspend, reinstate;
   - a merchant PUT that changes the settlement bank or account, the
     commission rate or the till;
   - a merchant decision APPROVED, or REJECTED on an approved one (revoking);
   - a farmer KYC decision VERIFIED when the registry's answer was not MATCH;
   - a bulk KYC decision, except verifying only the registry's matches. */

export type ApprovalType = "AGENT_FLOAT_TOP_UP" | "AGENT_SUSPEND" | "AGENT_REINSTATE" | "MERCHANT_UPDATE" | "MERCHANT_DECISION" | "FARMER_KYC_OVERRIDE" | "FARMER_KYC_BULK_DECISION";
export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  AGENT_FLOAT_TOP_UP: "Float top-up",
  AGENT_SUSPEND: "Agent suspension",
  AGENT_REINSTATE: "Agent reinstatement",
  MERCHANT_UPDATE: "Settlement change",
  MERCHANT_DECISION: "Merchant KYB",
  FARMER_KYC_OVERRIDE: "KYC override",
  FARMER_KYC_BULK_DECISION: "Bulk KYC decision",
};

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "FAILED";
export const DECIDED_STATUSES: Exclude<ApprovalStatus, "PENDING">[] = ["APPROVED", "REJECTED", "CANCELLED", "FAILED"];
export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled", FAILED: "Failed",
};
export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral", FAILED: "danger",
};

export type ApprovalTargetKind = "AGENT" | "MERCHANT" | "FARMER";

export type Approval = {
  id: string;
  /** "AP-10001", unique per institution. */
  reference: string;
  type: ApprovalType;
  /** One line for the row. */
  title: string;
  target: { kind: ApprovalTargetKind; reference: string; name: string | null };
  /** May be empty. */
  changes: { setting: string; now: string | null; proposed: string | null }[];
  reason: string | null;
  payload: unknown;
  status: ApprovalStatus;
  maker: string;
  madeAt: string;
  checker: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedAt: string | null;
  /** Why the replay was refused, when FAILED. */
  error: string | null;
  /** Informational: omnichannel does not enforce roles yet. */
  checkerRoles: string[];
};

export type ApprovalsSummary = { pending: number; decidedToday: number };

export const APPROVALS_PATH = "/approvals";
export const approvalPath = (idOrRef: string) => `${APPROVALS_PATH}/${encodeURIComponent(idOrRef)}`;
/** The Approvals page, open on one request. */
export const approvalLink = (reference: string) => `/approvals?open=${encodeURIComponent(reference)}`;
export const REASON_MAX = 300;

/** What a controlled write answers: the record as it is now (applied at
 *  once), or the request it staged (202). */
export type Staged<T> = { applied: T; approval?: undefined } | { approval: Approval; applied?: undefined };

/** Where a request's target lives in this back office. */
export function targetLink(t: Approval["target"], type?: ApprovalType): string {
  // A bulk KYC decision is about many farmers: the KYC desk's waiting list.
  if (type === "FARMER_KYC_BULK_DECISION") return "/token-console/kyc?kyc=PENDING";
  if (t.kind === "AGENT") return `/agents?focus=${encodeURIComponent(t.reference)}`;
  if (t.kind === "MERCHANT") return `/merchants/${encodeURIComponent(t.reference)}`;
  return `/farmers/${encodeURIComponent(t.reference)}`;
}

/** An approval reference inside a message (APPROVAL_PENDING names the open one). */
export const APPROVAL_REF = /\bAP-\d+\b/;
