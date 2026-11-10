/* Merchants and agents: omnichannel's staff API (v1), /api/operator/merchants
   and /api/operator/agents, each scoped to this back office's institution.
   After KTDA requirements 5.6 and the prototype back office 3.8 and 3.9
   (docs/ktda). Lists are paged by the X-Total-* headers, page from 1, size up
   to 100, newest first. Money is KES; rates are decimals (0.0050 is 0.50%).
   Phones may be typed 07…, 2547… or +2547… and come back in E.164. Errors: 400
   with `field`, 404 for a reference that is not this institution's, 409 with
   a stable `code` (below). */

export const PAGE_MAX = 100;

/* ---- Merchants ---- */

export type MerchantType = "AGRO_DEALER" | "SHOP" | "OTHER";
export const MERCHANT_TYPES: MerchantType[] = ["AGRO_DEALER", "SHOP", "OTHER"];
export const MERCHANT_TYPE_LABEL: Record<MerchantType, string> = { AGRO_DEALER: "Agro-dealer", SHOP: "Shop", OTHER: "Other" };

/** The Business Registration Service's answer. */
export type BrsStatus = "UNCHECKED" | "VERIFIED" | "NOT_FOUND" | "MISMATCH";
export const BRS_LABEL: Record<BrsStatus, string> = { UNCHECKED: "Not checked", VERIFIED: "Verified", NOT_FOUND: "Not registered", MISMATCH: "Name differs" };
export const BRS_TONE: Record<BrsStatus, "neutral" | "success" | "danger" | "warning"> = { UNCHECKED: "neutral", VERIFIED: "success", NOT_FOUND: "danger", MISMATCH: "warning" };

export type KybStatus = "IN_REVIEW" | "NEEDS_DOCUMENTS" | "APPROVED" | "REJECTED";
export const KYB_STATUSES: KybStatus[] = ["IN_REVIEW", "NEEDS_DOCUMENTS", "APPROVED", "REJECTED"];
export const KYB_LABEL: Record<KybStatus, string> = { IN_REVIEW: "In review", NEEDS_DOCUMENTS: "Needs documents", APPROVED: "Approved", REJECTED: "Rejected" };
export const KYB_TONE: Record<KybStatus, "info" | "warning" | "success" | "danger"> = { IN_REVIEW: "info", NEEDS_DOCUMENTS: "warning", APPROVED: "success", REJECTED: "danger" };

/** Always all four, in this order. */
export type MerchantDocumentType = "CERTIFICATE_OF_REGISTRATION" | "KRA_PIN_CERTIFICATE" | "DIRECTOR_ID_COPIES" | "BANK_LETTER";
export const DOCUMENT_LABEL: Record<MerchantDocumentType, string> = {
  CERTIFICATE_OF_REGISTRATION: "Certificate of registration",
  KRA_PIN_CERTIFICATE: "KRA PIN certificate",
  DIRECTOR_ID_COPIES: "Director ID copies",
  BANK_LETTER: "Bank letter for settlement account",
};

/** The fixed list. Accepting vouchers with no category is a 400. */
export const VOUCHER_CATEGORIES = ["FERTILISER", "SEEDLINGS", "AGROCHEMICALS", "FARM_TOOLS", "ANIMAL_FEED", "FUEL"] as const;

export type Merchant = {
  /** The channel-api's id, where the merchant comes from there: its detail page is /merchants/{id}. */
  id?: string | null;
  reference: string;
  name: string;
  type: MerchantType;
  town: string | null;
  county: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  tillNo: string | null;
  brs: { registrationNo: string; status: BrsStatus; registeredName: string | null; registeredType: string | null; registeredOwner: string | null; checkedAt: string | null };
  kyb: { status: KybStatus; decidedAt: string | null; decidedBy: string | null; note: string | null };
  /** The account is kept encrypted and returned masked ("****1234"). */
  settlement: { bank: string | null; accountMasked: string | null };
  commissionRate: number | null;
  vouchers: { accepts: boolean; categories: string[] };
  documents: { type: MerchantDocumentType; received: boolean; receivedAt: string | null; reference: string | null }[];
  /** Spend at merchants is not wired yet: null, not 0. */
  sales30d: number | null;
  transactions30d: number | null;
  joinedAt: string;
  updatedAt: string | null;
};

export type MerchantsSummary = {
  approved: number;
  /** Approved agro-dealers. */
  agroDealers: number;
  /** In review plus needs documents. */
  waitingForKyb: number;
  /** Approved and accepting vouchers. */
  acceptVouchers: number;
  sales30d: number | null;
  byStatus: { inReview: number; needsDocuments: number; approved: number; rejected: number };
};
export const KYB_COUNT_KEY: Record<KybStatus, keyof MerchantsSummary["byStatus"]> = {
  IN_REVIEW: "inReview", NEEDS_DOCUMENTS: "needsDocuments", APPROVED: "approved", REJECTED: "rejected",
};

/** POST /merchants (201). The Business Registration Service is checked at
 *  once and KYB starts IN_REVIEW. 409 MERCHANT_TILL_TAKEN. */
export type RegisterMerchant = {
  name: string; type: MerchantType; town: string; county: string; ownerName: string; ownerPhone: string; tillNo: string;
  registrationNo: string; settlement: { bank: string; account: string }; commissionRate?: number;
  vouchers?: { accepts: boolean; categories: string[] };
};

/** PUT /merchants/{ref}: the register body without registrationNo. A changed
 *  till keeps the uniqueness rule (409 MERCHANT_TILL_TAKEN); a rejected
 *  merchant is refused (409 MERCHANT_REJECTED). The settlement account is
 *  sent only when staff type a new one: the page only ever sees it masked. */
export type UpdateMerchant = Omit<RegisterMerchant, "registrationNo" | "settlement"> & { settlement: { bank: string; account?: string } };

/** POST /merchants/{ref}/decision. APPROVED needs BRS VERIFIED and all four
 *  documents (409 MERCHANT_NOT_READY says what is missing); a decided
 *  merchant refuses another (409 MERCHANT_DECIDED), except revoking an
 *  approval (APPROVED → REJECTED) with a note. */
export type MerchantDecision = { decision: "APPROVED" | "REJECTED" | "NEEDS_DOCUMENTS"; note?: string };

export const MERCHANTS_PATH = "/merchants";
export const MERCHANTS_SUMMARY_PATH = "/merchants/summary";
export const merchantPath = (reference: string) => `${MERCHANTS_PATH}/${encodeURIComponent(reference)}`;

/* ---- Agents ---- */

/** LOW_FLOAT is derived: active, with a balance under 25% of the limit. */
export type AgentStatus = "ACTIVE" | "LOW_FLOAT" | "SUSPENDED";
export const AGENT_STATUSES: AgentStatus[] = ["ACTIVE", "LOW_FLOAT", "SUSPENDED"];
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = { ACTIVE: "Active", LOW_FLOAT: "Low float", SUSPENDED: "Suspended" };
export const AGENT_STATUS_TONE: Record<AgentStatus, "success" | "warning" | "danger"> = { ACTIVE: "success", LOW_FLOAT: "warning", SUSPENDED: "danger" };

export type Agent = {
  agentNo: string;
  fullName: string;
  phone: string | null;
  town: string | null;
  status: AgentStatus;
  float: { balance: number; limit: number; low: boolean };
  today: { transactions: number };
  /** Onboarding and tier upgrades this month (Africa/Nairobi). */
  onboardedThisMonth: number;
  commissionThisMonth: number;
  suspension: { reason: string; at: string; by: string } | null;
  createdAt: string;
  updatedAt: string | null;
  /* Only on a channel agent (/ktda/agents): */
  /** "channel" for an agent on the KTDA channel-api, the one the agent app signs in to. */
  source?: "channel";
  /** True while the agent has not yet replaced the starter PIN. */
  mustChangePin?: boolean;
  /** The float wallet's ledger balance (one agent only, when the ledger answered). */
  ledgerFloat?: number;
  /** On a register: where the starter PIN went by SMS, masked. */
  pinSentTo?: string;
  /** On a register, only where this environment echoes one-time codes (a demo): the starter PIN. */
  devCode?: string;
};

/** `active` is every agent not suspended, the low-float ones included;
 *  `lowFloat` is that subset. */
export type AgentsSummary = { active: number; lowFloat: number; suspended: number; onboardedThisMonth: number; commissionThisMonth: number };

/** POST /agents (201). agentNo is the institution's own if given (409
 *  AGENT_NO_TAKEN), else generated. The balance starts at 0. On the channel
 *  (/ktda/agents) agentNo is A- and 3 to 6 digits, and a phone that already
 *  belongs to an agent is 409 AGENT_PHONE_TAKEN; the starter PIN goes to the
 *  phone by SMS and the agent app asks for a new one at first sign-in. */
export type RegisterAgent = { agentNo?: string; fullName: string; phone: string; town: string; floatLimit: number };

/** CASH_IN moves the amount out of the float (409 AGENT_FLOAT_INSUFFICIENT),
 *  CASH_OUT into it; ONBOARDING and TIER_UPGRADE move nothing. A suspended
 *  agent is refused (409 AGENT_SUSPENDED); a repeated reference is 409
 *  AGENT_ACTIVITY_DUPLICATE. */
export type AgentActivityType = "CASH_IN" | "CASH_OUT" | "ONBOARDING" | "TIER_UPGRADE" | "FLOAT_TOP_UP";
export const RECORDABLE_ACTIVITIES: Exclude<AgentActivityType, "FLOAT_TOP_UP">[] = ["CASH_IN", "CASH_OUT", "ONBOARDING", "TIER_UPGRADE"];
export const ACTIVITY_LABEL: Record<AgentActivityType, string> = {
  CASH_IN: "Cash in", CASH_OUT: "Cash out", ONBOARDING: "Onboarding", TIER_UPGRADE: "Tier upgrade", FLOAT_TOP_UP: "Float top-up",
};
export const activityMovesMoney = (t: AgentActivityType) => t === "CASH_IN" || t === "CASH_OUT" || t === "FLOAT_TOP_UP";
export type RecordActivity = { type: Exclude<AgentActivityType, "FLOAT_TOP_UP">; amount?: number; growerNo?: string; reference: string };
export type AgentActivity = {
  id: string; type: AgentActivityType; amount: number | null; commission: number | null; growerNo: string | null;
  reference: string; floatAfter: number | null; occurredAt: string; recordedBy: string | null;
};
/** POST float/top-up answers 200 with the AgentView; POST activities 201
 *  with the activity row. */
export type TopUp = { amount: number; reference: string };

export const AGENTS_PATH = "/agents";
/** The KTDA channel-api's agents through omnichannel's passthrough. */
export const CHANNEL_AGENTS_PATH = "/ktda/agents";
/** A channel agent number: A- and 3 to 6 digits (the A- may be left off). */
export const CHANNEL_AGENT_NO = /^(A-)?\d{3,6}$/i;
export const AGENTS_SUMMARY_PATH = "/agents/summary";
export const agentPath = (agentNo: string) => `${AGENTS_PATH}/${encodeURIComponent(agentNo)}`;

/** "0.50% per sale" from 0.0050. */
export const ratePercent = (rate: number | null | undefined) =>
  rate === null || rate === undefined ? "—" : `${(rate * 100).toFixed(2)}%`;
