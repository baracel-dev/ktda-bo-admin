import type { SubFundCode } from "./fund";

/** Compliance & KYC domain — the Investcent SOP checklist made concrete:
 * client lifecycle (onboard → documents → identity/UBO → screen → risk rate →
 * EDD → Compliance approval → activate → ongoing monitoring), unified case
 * management (AML / fraud / ABC / SAR), complaints, and the
 * Customer → Wallet → Token → Transaction chain. Key control: nothing
 * activates or transacts until the whole pipeline is complete and approved. */

// ---- Client compliance profile (joins CLIENTS by clientId) ----

export type RiskRating = "low" | "medium" | "high";

/** Client KYC status reads as three states per Compliance review:
 * Active / Inactive / Pending Activation. */
export const KYC_STATUS_LABELS: Record<string, string> = {
  not_started: "Inactive",
  in_progress: "Pending Activation",
  pending_review: "Pending Activation",
  verified: "Active",
  rejected: "Inactive",
  suitability_exception: "Pending Activation",
};

/** Risk-factor catalogue — the selectable factors on a customer risk rating.
 * Managed in BO Admin (Platform Settings → Risk factors); "Geography" added
 * on Compliance review. */
export type RiskFactorDef = { id: string; label: string; description: string; enabled: boolean };

export const RISK_FACTORS: RiskFactorDef[] = [
  { id: "rf_geography", label: "Geography", description: "Residence, nationality or transaction links to higher-risk jurisdictions.", enabled: true },
  { id: "rf_pep", label: "Adverse media / PEP association", description: "Screening surfaced a PEP link or adverse-media coverage.", enabled: true },
  { id: "rf_channel", label: "Acquisition channel", description: "Channel-driven risk — e.g. third-party (IFA) referral requiring reliance checks.", enabled: true },
  { id: "rf_behaviour", label: "Transaction behaviour", description: "Monitoring alerts — structuring, velocity or activity outside the expected profile.", enabled: true },
  { id: "rf_suitability", label: "Below-threshold suitability score", description: "Scored under the configured pass mark at onboarding.", enabled: true },
  { id: "rf_source_of_funds", label: "Source of funds", description: "Unclear or unverifiable origin of invested funds.", enabled: true },
  { id: "rf_occupation", label: "High-risk occupation / industry", description: "Cash-intensive or higher-ML-risk business exposure.", enabled: true },
];

export type ClientLifecycleStatus =
  | "onboarding" | "docs_pending" | "screening" | "edd_required"
  | "pending_activation" | "active" | "suspended" | "closed";

export const LIFECYCLE_LABELS: Record<ClientLifecycleStatus, string> = {
  onboarding: "Onboarding",
  docs_pending: "Documents pending",
  screening: "Screening",
  edd_required: "EDD required",
  pending_activation: "Pending activation",
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

export type ClientComplianceProfile = {
  clientId: string;
  lifecycleStatus: ClientLifecycleStatus;
  riskRating: RiskRating | null;
  riskFactors: string[];
  pepFlag: boolean;
  eddRequired: boolean;
  eddCompletedAt?: string;
  uboVerified: boolean;
  activationApprovalId?: string;
  lastScreenedAt?: string;
  nextScreeningDue?: string;
  lastKycRefreshAt?: string;
  nextKycRefreshDue?: string;
};

/** Screening runs DAILY for every customer (Compliance requirement) — the
 * nightly batch job re-screens the whole register; nextScreeningDue is
 * always the next day. uboVerified is true for individuals (no UBO records
 * needed) and reflects the register for entity clients. */
export const COMPLIANCE_PROFILES: ClientComplianceProfile[] = [
  { clientId: "inv_2891", lifecycleStatus: "active", riskRating: "low", riskFactors: [], pepFlag: false, eddRequired: false, uboVerified: true, lastScreenedAt: "2026-08-11T05:00:00Z", nextScreeningDue: "2026-08-12", lastKycRefreshAt: "2026-03-14T10:00:00Z", nextKycRefreshDue: "2028-03-14" },
  { clientId: "inv_3350", lifecycleStatus: "edd_required", riskRating: "high", riskFactors: ["Transaction behaviour", "Below-threshold suitability score"], pepFlag: false, eddRequired: true, uboVerified: true, lastScreenedAt: "2026-08-11T05:00:00Z", nextScreeningDue: "2026-08-12" },
  { clientId: "inv_3122", lifecycleStatus: "active", riskRating: "medium", riskFactors: ["Acquisition channel", "Adverse media / PEP association"], pepFlag: false, eddRequired: false, uboVerified: true, lastScreenedAt: "2026-08-11T05:00:00Z", nextScreeningDue: "2026-08-12", lastKycRefreshAt: "2026-05-02T09:00:00Z", nextKycRefreshDue: "2028-05-02" },
  { clientId: "inv_2765", lifecycleStatus: "screening", riskRating: null, riskFactors: [], pepFlag: false, eddRequired: false, uboVerified: true, lastScreenedAt: "2026-08-11T05:00:00Z", nextScreeningDue: "2026-08-12" },
  { clientId: "inv_2601", lifecycleStatus: "active", riskRating: "low", riskFactors: [], pepFlag: false, eddRequired: false, uboVerified: true, lastScreenedAt: "2026-08-10T05:00:00Z", nextScreeningDue: "2026-08-11", lastKycRefreshAt: "2026-02-11T09:00:00Z", nextKycRefreshDue: "2028-02-11" },
];

// ---- Documents (metadata register — uploads live with Smile Identity) ----

export type DocumentType = "national_id" | "selfie" | "kra_pin" | "proof_of_address" | "source_of_funds" | "ubo_declaration" | "edd_questionnaire";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  national_id: "National ID",
  selfie: "Selfie / liveness",
  kra_pin: "KRA PIN certificate",
  proof_of_address: "Proof of address",
  source_of_funds: "Source of funds",
  ubo_declaration: "UBO declaration",
  edd_questionnaire: "EDD questionnaire",
};

export type ClientDocument = {
  id: string;
  clientId: string;
  type: DocumentType;
  status: "missing" | "submitted" | "verified" | "rejected" | "expired";
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  note?: string;
  /** Expiry of the underlying document (System Requirements CR-003 — capture
   * issue/expiry date, and trigger review or block when expired). Absent for
   * document types that do not expire, such as a KRA PIN certificate. */
  expiresAt?: string;
};

/** Which document types carry an expiry the customer has to keep current.
 * A national ID or passport expires; a source-of-funds statement is a
 * point-in-time evidence file and does not. */
export const EXPIRING_DOCUMENT_TYPES: DocumentType[] = ["national_id", "proof_of_address"];

export const CLIENT_DOCUMENTS: ClientDocument[] = [
  { id: "doc_1", clientId: "inv_2891", type: "national_id", status: "verified", submittedAt: "2026-03-14T09:00:00Z", reviewedAt: "2026-03-14T09:40:00Z", reviewedBy: "Peter Otieno", expiresAt: "2031-03-13" },
  { id: "doc_2", clientId: "inv_2891", type: "selfie", status: "verified", submittedAt: "2026-03-14T09:02:00Z", reviewedAt: "2026-03-14T09:40:00Z", reviewedBy: "Peter Otieno" },
  { id: "doc_3", clientId: "inv_2891", type: "kra_pin", status: "verified", submittedAt: "2026-03-14T09:05:00Z", reviewedAt: "2026-03-14T09:41:00Z", reviewedBy: "Peter Otieno" },
  { id: "doc_4", clientId: "inv_2765", type: "national_id", status: "verified", submittedAt: "2026-08-05T11:00:00Z", reviewedAt: "2026-08-05T11:30:00Z", reviewedBy: "Peter Otieno" },
  { id: "doc_5", clientId: "inv_2765", type: "selfie", status: "verified", submittedAt: "2026-08-05T11:02:00Z", reviewedAt: "2026-08-05T11:30:00Z", reviewedBy: "Peter Otieno" },
  { id: "doc_6", clientId: "inv_2765", type: "kra_pin", status: "submitted", submittedAt: "2026-08-05T11:10:00Z" },
  { id: "doc_7", clientId: "inv_2765", type: "proof_of_address", status: "missing" },
  { id: "doc_8", clientId: "inv_3350", type: "national_id", status: "verified", submittedAt: "2026-08-06T09:00:00Z", reviewedAt: "2026-08-06T09:30:00Z", reviewedBy: "Peter Otieno" },
  { id: "doc_9", clientId: "inv_3350", type: "selfie", status: "verified", submittedAt: "2026-08-06T09:01:00Z", reviewedAt: "2026-08-06T09:30:00Z", reviewedBy: "Peter Otieno" },
  { id: "doc_10", clientId: "inv_3350", type: "source_of_funds", status: "submitted", submittedAt: "2026-08-07T14:00:00Z", note: "Requested as part of EDD — payslips provided, employer verification pending." },
  { id: "doc_11", clientId: "inv_3350", type: "edd_questionnaire", status: "submitted", submittedAt: "2026-08-07T14:05:00Z" },
  { id: "doc_12", clientId: "inv_3122", type: "national_id", status: "verified", submittedAt: "2026-05-02T08:00:00Z", reviewedAt: "2026-05-02T08:30:00Z", reviewedBy: "Peter Otieno" },
  { id: "doc_13", clientId: "inv_3122", type: "ubo_declaration", status: "verified", submittedAt: "2026-05-02T08:10:00Z", reviewedAt: "2026-05-03T10:00:00Z", reviewedBy: "Peter Otieno", note: "Family trust structure — secondary UBO verified separately." },
  { id: "doc_14", clientId: "inv_2601", type: "national_id", status: "verified", submittedAt: "2026-02-11T08:00:00Z", reviewedAt: "2026-02-11T08:30:00Z", reviewedBy: "Peter Otieno", expiresAt: "2026-09-30" },
];

// ---- Attempted-activity monitoring feed ----

/** Why a monitoring event was raised from the investor apps.
 *
 * Kenyan law and the Transaction Monitoring procedure both cover **attempted**
 * transactions, not just completed ones: POCAMLA requires monitoring of
 * complex, unusual, suspicious and large transactions "including attempted
 * transactions" (TM §4), §3 puts completed, pending, failed *and attempted*
 * activity in scope, and §15 requires attempted transactions to be considered
 * for reporting. AML/CFT Appendix II lists "repeated failed KYC / screening /
 * payment attempts" as a red flag in its own right.
 *
 * A subscription that a control stopped, a payment the customer abandoned, or
 * a run of failed verification attempts therefore all have to reach the
 * monitoring feed. Before this existed the investor apps emitted nothing at
 * all, so the KES 100 channel — the one most exposed to structuring — was the
 * one the engine could see least. */
export type AttemptKind =
  | "subscription_blocked"
  | "redemption_blocked"
  | "subscription_failed"
  | "redemption_failed"
  | "subscription_abandoned"
  | "redemption_abandoned"
  | "otp_failed"
  | "screening_unavailable"
  | "payout_name_mismatch";

export const ATTEMPT_KIND_LABELS: Record<AttemptKind, string> = {
  subscription_blocked: "Subscription blocked by control",
  redemption_blocked: "Redemption blocked by control",
  subscription_failed: "Subscription failed",
  redemption_failed: "Redemption failed",
  subscription_abandoned: "Subscription abandoned",
  redemption_abandoned: "Redemption abandoned",
  otp_failed: "Failed OTP attempt",
  screening_unavailable: "Screening provider unavailable",
  payout_name_mismatch: "Payout account name mismatch",
};

export type AttemptEvent = {
  id: string;
  clientId: string | null;
  kind: AttemptKind;
  at: string;
  /** Where it happened — "investor-web" or "investor-mobile". */
  surface: string;
  subFund?: SubFundCode;
  amount?: number;
  currency?: "KES" | "USD";
  /** Operator-facing detail. Internal only. */
  detail?: string;
};

export const ATTEMPT_EVENTS: AttemptEvent[] = [];

// ---- Requests for Information (RFI) ----

/** A Compliance request for supporting information.
 *
 * Transaction Monitoring §12: where activity is inconsistent with the
 * customer's profile, Compliance obtains evidence to understand it. §12.1 is
 * explicit that the request must be in **neutral language** and must not state
 * that the customer has been flagged, reported or is under investigation — so
 * `subject` and `message` are drafted copy, never a case summary, and this
 * type deliberately carries no link back to the case that raised it.
 *
 * §12.2 sets the operating targets this models: individuals 5 calendar days
 * to respond, reminder at day 7, escalation by day 10. */
export type RfiStatus = "open" | "responded" | "closed";

export const RFI_STATUS_LABELS: Record<RfiStatus, string> = {
  open: "Awaiting your reply",
  responded: "Reply received",
  closed: "Closed",
};

export type Rfi = {
  id: string;
  clientId: string;
  /** Neutral subject line. */
  subject: string;
  /** Neutral body. Reviewed by Compliance before sending. */
  message: string;
  /** What the customer can usefully attach, in plain words. */
  examples: string[];
  requestedAt: string;
  /** Response target — individuals get 5 calendar days (TM §12.2). */
  dueAt: string;
  status: RfiStatus;
  response?: { text: string; at: string; attachments: number };
};

export const RFIS: Rfi[] = [
  {
    id: "rfi_2891_1",
    clientId: "inv_2891",
    subject: "A quick question about a recent deposit",
    message:
      "As part of our routine account checks, we'd like to understand a little more about the funds you " +
      "recently added. Could you share where they came from? Anything that shows the source is helpful.",
    examples: ["A payslip or employment letter", "A bank statement showing the transfer", "A sale agreement or invoice"],
    requestedAt: "2026-08-14T09:00:00Z",
    dueAt: "2026-08-19",
    status: "open",
  },
];

// ---- UBO register ----

export type UboRecord = {
  id: string;
  clientId: string;
  name: string;
  relationship: string;
  ownershipPct: number | null;
  status: "unverified" | "verified" | "flagged";
  verifiedAt?: string;
  verifiedBy?: string;
};

/** UBO verification applies to entity clients only (trusts, companies) —
 * individual clients carry no UBO records, per Compliance review. */
export const UBO_RECORDS: UboRecord[] = [
  { id: "ubo_3", clientId: "inv_3122", name: "Cynthia Njeri", relationship: "Self / trust settlor", ownershipPct: 75, status: "verified", verifiedAt: "2026-05-03T10:00:00Z", verifiedBy: "Peter Otieno" },
  { id: "ubo_4", clientId: "inv_3122", name: "Njeri Family Trust", relationship: "Trust — 25% beneficial interest", ownershipPct: 25, status: "verified", verifiedAt: "2026-05-03T10:05:00Z", verifiedBy: "Peter Otieno" },
];

// ---- Screening results (full history retained) ----

export type ScreeningOutcome = "clear" | "potential_match" | "match";

export type ScreeningResult = {
  id: string;
  clientId: string;
  runAt: string;
  runBy: string;
  trigger: "onboarding" | "periodic" | "on_demand" | "edd";
  sanctions: ScreeningOutcome;
  pep: ScreeningOutcome;
  adverseMedia: "clear" | "potential_match";
  matchDetail?: string;
  resolution?: { outcome: "false_positive" | "true_match_accepted" | "true_match_rejected"; note: string; by: string; at: string };
};

export const SCREENING_RESULTS: ScreeningResult[] = [
  { id: "scr_1", clientId: "inv_2891", runAt: "2026-03-14T09:10:00Z", runBy: "System (Smile Identity)", trigger: "onboarding", sanctions: "clear", pep: "clear", adverseMedia: "clear" },
  { id: "scr_2", clientId: "inv_3122", runAt: "2026-05-02T08:20:00Z", runBy: "System (Smile Identity)", trigger: "onboarding", sanctions: "clear", pep: "potential_match", adverseMedia: "clear", matchDetail: "Name similarity with a county assembly member — 71% match confidence.", resolution: { outcome: "false_positive", note: "Different DOB and ID number; assembly member is C. Njeri Kamande. Documented and cleared.", by: "Peter Otieno", at: "2026-05-02T15:00:00Z" } },
  { id: "scr_3", clientId: "inv_3122", runAt: "2026-08-01T08:00:00Z", runBy: "System (scheduled)", trigger: "periodic", sanctions: "clear", pep: "clear", adverseMedia: "clear" },
  { id: "scr_4", clientId: "inv_2765", runAt: "2026-08-05T12:00:00Z", runBy: "System (Smile Identity)", trigger: "onboarding", sanctions: "clear", pep: "clear", adverseMedia: "clear" },
  { id: "scr_5", clientId: "inv_3350", runAt: "2026-08-06T09:20:00Z", runBy: "System (Smile Identity)", trigger: "onboarding", sanctions: "clear", pep: "clear", adverseMedia: "potential_match", matchDetail: "Local news mention in a 2024 betting-syndicate story — same name, unconfirmed identity." },
  { id: "scr_6", clientId: "inv_2601", runAt: "2026-02-11T08:10:00Z", runBy: "System (Smile Identity)", trigger: "onboarding", sanctions: "clear", pep: "clear", adverseMedia: "clear" },
];

// ---- Wallets & token holdings (Customer → Wallet → Token → Transaction) ----

// "Jurisdiction locked" removed on Compliance review — the product is
// Kenya-only until the Phase 2 tokenization whitelist opens other markets.
export type WalletRestriction = "no_transfers" | "redemptions_only";

export const WALLET_RESTRICTION_LABELS: Record<WalletRestriction, string> = {
  no_transfers: "No transfers",
  redemptions_only: "Redemptions only",
};

export type Wallet = {
  id: string;
  clientId: string;
  ownership: string;
  status: "pending_activation" | "active" | "frozen" | "closed";
  restrictions: WalletRestriction[];
  createdAt: string;
  activatedAt?: string;
  statusReason?: string;
};

export const WALLETS: Wallet[] = [
  { id: "wal_2891", clientId: "inv_2891", ownership: "Self — individual", status: "active", restrictions: [], createdAt: "2026-03-14T10:00:00Z", activatedAt: "2026-03-14T10:00:00Z" },
  { id: "wal_3350", clientId: "inv_3350", ownership: "Self — individual", status: "pending_activation", restrictions: ["no_transfers"], createdAt: "2026-08-06T09:30:00Z", statusReason: "Held pending EDD sign-off and Compliance activation approval." },
  { id: "wal_3122", clientId: "inv_3122", ownership: "Self + family trust (75/25)", status: "active", restrictions: [], createdAt: "2026-05-03T10:10:00Z", activatedAt: "2026-05-03T10:10:00Z" },
  { id: "wal_2765", clientId: "inv_2765", ownership: "Self — individual", status: "pending_activation", restrictions: [], createdAt: "2026-08-05T12:30:00Z" },
  { id: "wal_2601", clientId: "inv_2601", ownership: "Self — individual", status: "active", restrictions: [], createdAt: "2026-02-11T09:00:00Z", activatedAt: "2026-02-11T09:00:00Z" },
];

// ---- Investor-facing projection of all of the above ----

/** Customer-safe notice codes.
 *
 * TIPPING-OFF CONTROL (Transaction Monitoring §17, STR §14, Customer Exit
 * §14/15): this code is derived **only** from the account's control status —
 * never from the reason a restriction was applied, never from a case, alert,
 * screening match or STR. `Wallet.statusReason` and `ComplianceCase` fields
 * are BO-Admin-only and must never reach the investor apps. The copy each
 * code maps to is CMS-editable per app; the code itself is the contract.
 *
 * Adding a code that encodes *why* (e.g. `sanctions_hit`) would be a
 * regulatory breach, not just a design smell. */
export type InvestorNotice =
  | "pending_activation"
  | "under_review"
  | "suitability_call"
  | "rejected"
  | "restricted_no_subscriptions"
  | "restricted_no_transactions"
  | "suspended"
  | "closed";

/** Everything the investor apps need to decide what the customer may do.
 *
 * One object, computed server-side (mocked here), so entitlement is never
 * re-derived from loose flags at the call site — the investor app asks "may
 * I?", it does not reason about lifecycle or wallet state itself. */
export type InvestorComplianceState = {
  lifecycleStatus: ClientLifecycleStatus;
  walletStatus: Wallet["status"] | null;
  restrictions: WalletRestriction[];
  /** May the customer place a new subscription right now? */
  canSubscribe: boolean;
  /** May the customer place a redemption right now? Deliberately separate:
   * `redemptions_only` withholds one and not the other. */
  canRedeem: boolean;
  /** Null when the account is fully active and unrestricted. */
  notice: InvestorNotice | null;
};

export type TokenHolding = {
  id: string;
  walletId: string;
  product: SubFundCode;
  quantity: number;
  issuer: string;
  restrictions: WalletRestriction[];
};

export const TOKEN_HOLDINGS: TokenHolding[] = [
  { id: "tok_1", walletId: "wal_2891", product: "KES_FIXED_INCOME", quantity: 40128.6203, issuer: "Investcent — Bond Retail Fund", restrictions: [] },
  { id: "tok_2", walletId: "wal_2891", product: "USD_EUROBOND", quantity: 412.885, issuer: "Investcent — Bond Retail Fund", restrictions: [] },
  { id: "tok_3", walletId: "wal_3122", product: "KES_FIXED_INCOME", quantity: 99327.41, issuer: "Investcent — Bond Retail Fund", restrictions: [] },
  { id: "tok_4", walletId: "wal_2601", product: "USD_EUROBOND", quantity: 769.62, issuer: "Investcent — Bond Retail Fund", restrictions: [] },
];

// ---- Case management (unified AML / fraud / ABC / SAR) ----

export type CaseType = "aml" | "fraud" | "abc" | "sar";

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  aml: "AML",
  fraud: "Fraud",
  abc: "Anti-bribery & corruption",
  sar: "SAR",
};

export type CaseStatus = "open" | "investigating" | "pending_approval" | "escalated_mlro" | "closed_cleared" | "closed_reported";

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  pending_approval: "Pending approval",
  escalated_mlro: "Escalated to MLRO",
  closed_cleared: "Closed — cleared",
  closed_reported: "Closed — reported",
};

export type CaseNote = { id: string; at: string; by: string; byRole: string; text: string; kind: "note" | "decision" | "status_change" | "escalation" };
export type CaseEvidence = { id: string; label: string; type: "transaction_ref" | "screening_ref" | "document_ref" | "external"; ref?: string; addedAt: string; addedBy: string };

export type ComplianceCase = {
  id: string;
  type: CaseType;
  title: string;
  summary: string;
  clientId?: string;
  clientName: string;
  linkedAlertIds: string[];
  severity: "low" | "medium" | "high";
  status: CaseStatus;
  assignee?: string;
  openedAt: string;
  openedBy: string;
  dueAt?: string;
  notes: CaseNote[];
  evidence: CaseEvidence[];
  sar?: { escalatedAt: string; escalatedBy: string; mlroDecision?: "file_str" | "no_filing"; strReference?: string; decidedAt?: string; approvalId?: string };
  closedAt?: string;
  closedBy?: string;
  closeRationale?: string;
};

export const COMPLIANCE_CASES: ComplianceCase[] = [
  {
    id: "cs_1", type: "aml", title: "Cash-outs split across agents: Wilson Kipngeno Rotich", summary: "Five cash-outs of KES 9,800 to 9,950 at three Bomet agents inside 36 hours, each just under the review line, the day after the October payment.",
    clientId: "GN-163842", clientName: "Wilson Kipngeno Rotich", linkedAlertIds: ["aml_1"], severity: "high", status: "investigating", assignee: "Peter Otieno",
    openedAt: "2026-11-07T11:30:00Z", openedBy: "Peter Otieno", dueAt: "2026-11-14",
    notes: [
      { id: "cn_1", at: "2026-11-07T11:30:00Z", by: "Peter Otieno", byRole: "Compliance", text: "Case opened from alert aml_1. All five cash-outs were late evening; asking the three agents for their cash-out registers.", kind: "note" },
      { id: "cn_2", at: "2026-11-08T09:15:00Z", by: "Peter Otieno", byRole: "Compliance", text: "Kapkoros factory confirms 2,630 kg delivered in October, so the KES 48,600 payment is right. The question is who collected the cash.", kind: "note" },
    ],
    evidence: [
      { id: "ce_1", label: "Alert aml_1: cash-outs split across agents", type: "external", ref: "aml_1", addedAt: "2026-11-07T11:30:00Z", addedBy: "Peter Otieno" },
      { id: "ce_2", label: "Kapkoros October delivery record", type: "document_ref", addedAt: "2026-11-08T09:10:00Z", addedBy: "Peter Otieno" },
    ],
  },
  {
    id: "cs_2", type: "fraud", title: "Number changed before the bonus: Samuel Mwangi Gichuki", summary: "The farmer's line was changed through an agent two days before the October bonus run, to a line registered to someone else. The bonus is held until the farmer is seen at Gitugi factory.",
    clientId: "GN-120955", clientName: "Samuel Mwangi Gichuki", linkedAlertIds: ["fr_2"], severity: "high", status: "investigating", assignee: "Kevin Baraka",
    openedAt: "2026-11-05T19:40:00Z", openedBy: "Kevin Baraka", dueAt: "2026-11-12",
    notes: [
      { id: "cn_3", at: "2026-11-05T19:40:00Z", by: "Kevin Baraka", byRole: "Fraud", text: "Bonus of KES 21,300 held. Called the farmer's old number; he says he never asked for a change.", kind: "note" },
      { id: "cn_4", at: "2026-11-06T11:20:00Z", by: "Peter Otieno", byRole: "Compliance", text: "The change was made by agent AG-2077. Its other number changes this month are being checked.", kind: "decision" },
    ],
    evidence: [
      { id: "ce_3", label: "Alert fr_2: number changed before a bonus", type: "external", ref: "fr_2", addedAt: "2026-11-05T19:40:00Z", addedBy: "Kevin Baraka" },
      { id: "ce_4", label: "Number change request by agent AG-2077", type: "transaction_ref", addedAt: "2026-11-06T11:15:00Z", addedBy: "Peter Otieno" },
    ],
  },
  {
    id: "cs_5", type: "fraud", title: "One farmer cashed out repeatedly: agent Kiprotich Agencies", summary: "Agent AG-2041 cashed out farmer GN-104233 nine times in four days, just after midnight each time. The farmer says he has not been to the agent this month.",
    clientId: "AG-2041", clientName: "Kiprotich Agencies (agent)", linkedAlertIds: ["fr_3"], severity: "medium", status: "open", assignee: "Peter Otieno",
    openedAt: "2026-11-08T08:05:00Z", openedBy: "Peter Otieno", dueAt: "2026-11-15",
    notes: [
      { id: "cn_8", at: "2026-11-08T08:05:00Z", by: "Peter Otieno", byRole: "Compliance", text: "Agent float suspended pending a visit by the Litein field officer.", kind: "note" },
    ],
    evidence: [
      { id: "ce_7", label: "Alert fr_3: agent cashing out one farmer repeatedly", type: "external", ref: "fr_3", addedAt: "2026-11-08T08:05:00Z", addedBy: "Peter Otieno" },
    ],
  },
  {
    id: "cs_3", type: "abc", title: "Gift declaration: agro-dealer hospitality", summary: "A field officer declared a hamper from an agro-dealer applying to accept vouchers. Reviewed against the gifts register.",
    clientName: "Internal", linkedAlertIds: [], severity: "low", status: "closed_cleared", assignee: "Peter Otieno",
    openedAt: "2026-11-02T10:00:00Z", openedBy: "Faith Kamau",
    notes: [
      { id: "cn_4b", at: "2026-11-02T10:00:00Z", by: "Faith Kamau", byRole: "Field operations", text: "Declared a KES 6,000 hamper from Meru Fertiliser Depot.", kind: "note" },
      { id: "cn_5", at: "2026-11-03T16:00:00Z", by: "Peter Otieno", byRole: "Compliance", text: "The officer has no part in approving merchants. Recorded in the gifts register; no further action.", kind: "decision" },
    ],
    evidence: [{ id: "ce_5", label: "Gifts register entry GR-2026-031", type: "external", addedAt: "2026-11-02T10:05:00Z", addedBy: "Faith Kamau" }],
    closedAt: "2026-11-03T16:00:00Z", closedBy: "Peter Otieno", closeRationale: "Register entry is enough; the officer has no say in the merchant's approval.",
  },
  {
    id: "cs_4", type: "sar", title: "Cash-outs collected for others: Bomet agents", summary: "Case cs_1 escalated: the same three agents show split cash-outs for four more Kapkoros farmers. Awaiting the MLRO's decision on a suspicious transaction report.",
    clientId: "GN-163842", clientName: "Wilson Kipngeno Rotich", linkedAlertIds: ["aml_1"], severity: "high", status: "escalated_mlro", assignee: "Josephine Muthoni",
    openedAt: "2026-11-08T10:00:00Z", openedBy: "Peter Otieno", dueAt: "2026-11-13",
    notes: [
      { id: "cn_6", at: "2026-11-08T10:00:00Z", by: "Peter Otieno", byRole: "Compliance", text: "Escalating to the MLRO: the pattern goes beyond one farmer.", kind: "escalation" },
      { id: "cn_7", at: "2026-11-08T15:40:00Z", by: "Josephine Muthoni", byRole: "MLRO", text: "Reviewing the agents' registers. Decision within the standard.", kind: "note" },
    ],
    evidence: [
      { id: "ce_6", label: "Case cs_1 file", type: "external", ref: "cs_1", addedAt: "2026-11-08T10:00:00Z", addedBy: "Peter Otieno" },
    ],
    sar: { escalatedAt: "2026-11-08T10:00:00Z", escalatedBy: "Peter Otieno" },
  },
];

// ---- Complaints ----

export type ComplaintStatus = "new" | "acknowledged" | "investigating" | "resolved" | "closed";

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  resolved: "Resolved",
  closed: "Closed",
};

export type ComplaintCategory = "transaction" | "service" | "fees" | "onboarding" | "data_privacy" | "other";

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  transaction: "Payment",
  service: "Service",
  fees: "Charges",
  onboarding: "Registration",
  data_privacy: "Data & privacy",
  other: "Other",
};

export type ComplaintChannel = "ussd" | "agent" | "call_centre" | "app";

export const COMPLAINT_CHANNEL_LABELS: Record<ComplaintChannel, string> = {
  ussd: "USSD",
  agent: "agent",
  call_centre: "call centre",
  app: "app",
};

export type Complaint = {
  id: string;
  clientId?: string;
  clientName: string;
  channel: ComplaintChannel;
  category: ComplaintCategory;
  subject: string;
  description: string;
  status: ComplaintStatus;
  assignee?: string;
  submittedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolution?: string;
  history: { at: string; by: string; action: string; note?: string }[];
};

export const COMPLAINTS: Complaint[] = [
  {
    id: "cp_1", clientId: "GN-118407", clientName: "Grace Chepkemoi Koech", channel: "agent", category: "transaction",
    subject: "Cash-out taken from wallet but no cash given", description: "Agent AG-2041 said the KES 6,000 cash-out failed, but my wallet was debited. I want the money back.",
    status: "investigating", assignee: "Grace Mumbi", submittedAt: "2026-11-06T07:50:00Z", acknowledgedAt: "2026-11-06T08:20:00Z",
    history: [
      { at: "2026-11-06T07:50:00Z", by: "Grace Chepkemoi Koech", action: "Raised through agent AG-2041" },
      { at: "2026-11-06T08:20:00Z", by: "Mercy Wanjala", action: "Acknowledged", note: "Within the one-business-day standard." },
      { at: "2026-11-06T08:35:00Z", by: "Grace Mumbi", action: "Assigned to Operations", note: "Matching the agent's cash-out record with the wallet debit." },
    ],
  },
  {
    id: "cp_2", clientId: "GN-150311", clientName: "Agnes Moraa Nyaboke", channel: "call_centre", category: "fees",
    subject: "Charged for Pay to M-PESA twice", description: "I sent KES 5,000 to my M-PESA once and was charged the fee twice.",
    status: "resolved", assignee: "Grace Mumbi", submittedAt: "2026-11-03T10:00:00Z", acknowledgedAt: "2026-11-03T10:30:00Z", resolvedAt: "2026-11-03T15:00:00Z",
    resolution: "The second fee came from a retried request. KES 33 refunded to the wallet the same day.",
    history: [
      { at: "2026-11-03T10:00:00Z", by: "Agnes Moraa Nyaboke", action: "Called the call centre" },
      { at: "2026-11-03T10:30:00Z", by: "Mercy Wanjala", action: "Acknowledged" },
      { at: "2026-11-03T15:00:00Z", by: "Grace Mumbi", action: "Resolved", note: "Refund approved by a second staff member." },
    ],
  },
  {
    id: "cp_3", clientId: "GN-142078", clientName: "Peter Kimathi M'Ikiara", channel: "ussd", category: "onboarding",
    subject: "Registered with the wrong phone number", description: "My wallet was opened on my old number at bulk registration. Payment notices go to my wife's phone.",
    status: "new", submittedAt: "2026-11-09T08:40:00Z",
    history: [{ at: "2026-11-09T08:40:00Z", by: "Peter Kimathi M'Ikiara", action: "Raised on USSD" }],
  },
  {
    id: "cp_4", clientId: "GN-131620", clientName: "Lucy Wanjiku Ndirangu", channel: "app", category: "service",
    subject: "Voucher refused at the agro-dealer", description: "Othaya Farm Inputs would not take my fertiliser voucher for NPK.",
    status: "closed", assignee: "Mercy Wanjala", submittedAt: "2026-11-04T09:10:00Z", acknowledgedAt: "2026-11-04T09:22:00Z", resolvedAt: "2026-11-04T11:48:00Z",
    resolution: "NPK 23:23:0 added to the merchant's voucher list; the farmer redeemed the voucher that afternoon.",
    history: [
      { at: "2026-11-04T09:10:00Z", by: "Lucy Wanjiku Ndirangu", action: "Raised in the app" },
      { at: "2026-11-04T11:48:00Z", by: "Mercy Wanjala", action: "Resolved" },
      { at: "2026-11-05T09:00:00Z", by: "Mercy Wanjala", action: "Closed", note: "Farmer confirmed by SMS." },
    ],
  },
];

// ---- Monitoring rules register (parameters live in PLATFORM_SETTINGS) ----

export type MonitoringRule = {
  id: string;
  name: string;
  description: string;
  appliesTo: ("subscription" | "redemption" | "transfer" | "deposit")[];
  settingKeys: string[];
  enabled: boolean;
};

export const MONITORING_RULES: MonitoringRule[] = [
  { id: "mr_structuring", name: "Structuring / smurfing", description: "Clusters of deposits just under the review threshold inside the rolling window. High-risk customers use the tighter threshold.", appliesTo: ["deposit", "subscription"], settingKeys: ["aml_review_threshold", "aml_review_threshold_high_risk", "aml_structuring_window"], enabled: true },
  { id: "mr_velocity", name: "Velocity", description: "Daily transaction count above the band limit versus the customer's 90-day average.", appliesTo: ["subscription", "redemption"], settingKeys: ["aml_velocity_max_tx", "aml_velocity_max_tx_high_risk"], enabled: true },
  { id: "mr_geo", name: "Geo / device mismatch", description: "New device or location shortly before a large redemption or transfer.", appliesTo: ["redemption", "transfer"], settingKeys: [], enabled: true },
  { id: "mr_large_redemption", name: "Large redemption vs profile", description: "Redemption materially above the customer's expected activity for their risk band.", appliesTo: ["redemption"], settingKeys: ["risk_band_low_max", "risk_band_medium_max"], enabled: true },
];
