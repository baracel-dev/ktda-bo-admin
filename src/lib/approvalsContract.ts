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
   - a bulk KYC decision, except verifying only the registry's matches.

   v2 (approvals-contract-v2): what the checker sees and the way on after a
   rejection. GET /{id}/details answers the target as it stands now, per
   type (phones and ids masked to their last three characters), or null
   when the target has gone. The list filters target=<reference> and
   mine=true; the summary adds minePending and mineRejected (the caller's
   requests rejected or failed in the last 7 days). POST /{id}/resubmit
   { reason? } asks again after a REJECTED, FAILED or CANCELLED request:
   202 with the new PENDING request, whose resubmitOf names the earlier one.
   409 APPROVAL_PENDING while another request for the target is open, 409
   APPROVAL_DECIDED for an approved one. */

export type ApprovalType = "AGENT_FLOAT_TOP_UP" | "AGENT_SUSPEND" | "AGENT_REINSTATE" | "MERCHANT_UPDATE" | "MERCHANT_DECISION" | "FARMER_KYC_OVERRIDE" | "FARMER_KYC_BULK_DECISION"
  /* The same three writes on a KTDA channel agent (/ktda/agents), applied on the channel-api. */
  | "KTDA_AGENT_FLOAT_TOP_UP" | "KTDA_AGENT_SUSPEND" | "KTDA_AGENT_REINSTATE";
export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  AGENT_FLOAT_TOP_UP: "Float top-up",
  AGENT_SUSPEND: "Agent suspension",
  AGENT_REINSTATE: "Agent reinstatement",
  MERCHANT_UPDATE: "Settlement change",
  MERCHANT_DECISION: "Merchant KYB",
  FARMER_KYC_OVERRIDE: "KYC override",
  FARMER_KYC_BULK_DECISION: "Bulk KYC decision",
  KTDA_AGENT_FLOAT_TOP_UP: "Float top-up (app agent)",
  KTDA_AGENT_SUSPEND: "Agent suspension (app agent)",
  KTDA_AGENT_REINSTATE: "Agent reinstatement (app agent)",
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
  /** The earlier request this one asks again (v2; absent before). */
  resubmitOf?: string | null;
};

/** minePending and mineRejected arrive with v2. */
export type ApprovalsSummary = { pending: number; decidedToday: number; minePending?: number; mineRejected?: number };

/* ---- What the checker sees: GET /{id}/details, per type ---- */

export type AgentDetails = {
  agentNo: string; fullName: string | null; phone: string | null; town: string | null;
  status: string; floatBalance: number | null; floatLimit: number | null; floatLow: boolean | null;
  suspensionReason: string | null; suspendedAt: string | null; suspendedBy: string | null; joinedAt: string | null;
};
/** A channel agent: the object GET /ktda/agents/{agentNo} answers. */
export type ChannelAgentDetails = {
  agentNo: string; fullName: string | null; phone: string | null; town: string | null; status: string;
  float?: { balance: number | null; limit: number | null; low: boolean | null } | null;
  today?: { transactions?: number | null } | null;
  suspension?: { reason: string | null; at: string | null; by: string | null } | null;
};
export type MerchantDetails = {
  reference: string; name: string | null; type: string | null; town: string | null; county: string | null;
  ownerName: string | null; ownerPhone: string | null; tillNo: string | null; registrationNo: string | null;
  brsStatus: string | null; brsRegisteredName: string | null; brsRegisteredOwner: string | null; brsCheckedAt: string | null;
  kybStatus: string | null; kybNote: string | null; kybDecidedAt: string | null;
  settlementBank: string | null; settlementAccount: string | null; commissionRate: number | null;
  acceptsVouchers: boolean | null; joinedAt: string | null;
};
export type FarmerDetails = {
  growerNo: string; fullName: string | null; factory: string | null; phone: string | null; nationalId: string | null;
  state: string | null; kycStatus: string | null; identityResult: string | null; kycStartedAt: string | null;
  kycNote: string | null; onboardingChannel: string | null; onboardingAgentNo: string | null;
  activatedAt: string | null; lastFundedAt: string | null;
};
export type BulkScope = "ALL_PENDING" | "REGISTRY_MATCH" | "GROWERS";
export type BulkDecisionDetails = {
  decision: string; scope: BulkScope; note: string | null;
  /** How many grower numbers were given (GROWERS only). */
  listed: number | null;
  /** How many farmers the selection covers now. */
  total: number;
  sampleSize: number;
  /** The first farmers by grower number. */
  sample: { growerNo: string; fullName: string | null; factory: string | null; kycStatus: string | null; identityResult: string | null }[];
};

export type ApprovalDetails = AgentDetails | ChannelAgentDetails | MerchantDetails | FarmerDetails | BulkDecisionDetails;

/** The types /details answers for; any other answers null. */
export const DETAILED_TYPES: ApprovalType[] = [
  "AGENT_FLOAT_TOP_UP", "AGENT_SUSPEND", "AGENT_REINSTATE", "KTDA_AGENT_FLOAT_TOP_UP", "KTDA_AGENT_SUSPEND", "KTDA_AGENT_REINSTATE",
  "MERCHANT_UPDATE", "MERCHANT_DECISION", "FARMER_KYC_OVERRIDE", "FARMER_KYC_BULK_DECISION",
];

/** Statuses a request can be asked again from. */
export const RESUBMITTABLE: ApprovalStatus[] = ["REJECTED", "FAILED", "CANCELLED"];

export const APPROVALS_PATH = "/approvals";
export const approvalPath = (idOrRef: string) => `${APPROVALS_PATH}/${encodeURIComponent(idOrRef)}`;
/** The Approvals page, open on one request. */
export const approvalLink = (reference: string) => `/approvals?open=${encodeURIComponent(reference)}`;
export const REASON_MAX = 300;

/** What a controlled write answers: the record as it is now (applied at
 *  once), or the request it staged (202). */
export type Staged<T> = { applied: T; approval?: undefined } | { approval: Approval; applied?: undefined };

/** Where a request's target lives in this back office. */
export function targetLink(t: Approval["target"], type?: ApprovalType, details?: BulkDecisionDetails | null): string {
  // A bulk KYC decision is about many farmers: the KYC desk's waiting list,
  // narrowed to the one grower when only one was listed.
  if (type === "FARMER_KYC_BULK_DECISION") {
    const one = details?.scope === "GROWERS" && details.listed === 1 ? details.sample[0]?.growerNo : null;
    return `/token-console/kyc?kyc=PENDING${one ? `&q=${encodeURIComponent(one)}` : ""}`;
  }
  if (t.kind === "AGENT") return `/agents?focus=${encodeURIComponent(t.reference)}`;
  if (t.kind === "MERCHANT") return `/merchants/${encodeURIComponent(t.reference)}`;
  return `/farmers/${encodeURIComponent(t.reference)}`;
}

/** The target in words, for "Nothing was changed on …". */
export function targetPhrase(t: Approval["target"], type?: ApprovalType): string {
  if (type === "FARMER_KYC_BULK_DECISION") return "any farmer's KYC";
  const kind = t.kind === "AGENT" ? "agent" : t.kind === "MERCHANT" ? "merchant" : "farmer";
  return `${kind} ${t.reference}${t.name ? ` (${t.name})` : ""}`;
}

/** An approval reference inside a message (APPROVAL_PENDING names the open one). */
export const APPROVAL_REF = /\bAP-\d+\b/;
