import type { EmploymentType, Gender } from "./reference";
import { isHiddenPage } from "../../lib/hiddenPages";

/** `client_services` and `head_of_bd` exist because the BD SOP names them as
 * separate functions and this app used to collapse both into `bd_officer`
 * ("BD Officer / RM"). Client Services handles first-line enquiries and holds
 * customer contact — and must NOT reach cases, screening or AML alerts, which
 * is the tipping-off boundary. Head of BD owns institutional opportunities,
 * RFPs, commercial exceptions and the IFA channel. */
export type AdminRole = "ceo" | "bd_officer" | "client_services" | "head_of_bd" | "compliance" | "mlro" | "compliance_analyst" | "operations" | "head_of_finance" | "investment_manager" | "investment_committee" | "system_admin";

export const ROLE_LABELS: Record<AdminRole, string> = {
  ceo: "Managing Director",
  bd_officer: "Farmer engagement officer",
  client_services: "Customer service",
  head_of_bd: "Head of farmer services",
  compliance: "Compliance manager",
  mlro: "MLRO",
  compliance_analyst: "Compliance analyst",
  operations: "Payments operations",
  head_of_finance: "Head of Finance",
  investment_manager: "Agent network manager",
  investment_committee: "Merchant network manager",
  system_admin: "System Admin",
};

/** Page-level RBAC — mirrors the "BO Admin Panel roles" table in the
 * architecture artifact. A route not listed for a role is not just
 * hidden from nav, ProtectedRoute below refuses it outright. */
const ALL_ROLE_PAGE_ACCESS: Record<AdminRole, string[]> = {
  bd_officer: ["/", "/clients", "/enquiries", "/tasks", "/campaigns", "/reports"],
  // Client Services reaches the customer-facing desk and nothing behind it:
  // no cases, no screening, no AML alerts, no pipeline. The redaction on
  // compliance-flagged interactions is the second half of that boundary —
  // route access alone would not stop a case reason reaching a call script.
  client_services: ["/", "/clients", "/enquiries", "/tasks", "/complaints"],
  head_of_bd: ["/", "/clients", "/enquiries", "/tasks", "/campaigns", "/complaints", "/reports"],
  // Institutional Investment Compliance belongs to this seat, not the analyst's.
  // The holder is the Institutional Funds Compliance Manager, and a mandate
  // breach carries a cure decision and a client-notification obligation —
  // manager work, not monitoring work.
  compliance: ["/", "/clients", "/kyc-queue", "/kyc-periodic", "/kyc-dynamic", "/aml-alerts", "/cases", "/fraud-alerts", "/fraud-cases", "/screening", "/complaints", "/approvals", "/reports", "/audit-log", "/settings"],
  // MLRO: everything Compliance has. Analyst: the same surface minus the
  // Approvals queue — analysts investigate, they don't act as checkers.
  mlro: ["/", "/clients", "/kyc-queue", "/kyc-periodic", "/kyc-dynamic", "/aml-alerts", "/cases", "/fraud-alerts", "/fraud-cases", "/screening", "/complaints", "/approvals", "/reports", "/audit-log", "/settings"],
  // Tokenization Compliance and Market Conduct are the analyst's two newer
  // surfaces — monitoring work, whose filing and sign-off decisions still route
  // through Approvals. Institutional Investment Compliance is deliberately NOT
  // here; it sits with the Institutional Funds Compliance Manager above.
  compliance_analyst: ["/", "/clients", "/kyc-queue", "/kyc-periodic", "/kyc-dynamic", "/aml-alerts", "/cases", "/fraud-alerts", "/fraud-cases", "/screening", "/complaints", "/reports", "/audit-log", "/settings"],
  // The CEO reads across every function and writes to none of the platform's
  // configuration — oversight, not administration. Deliberately excludes
  // Users & roles, Feature flags, Platform settings and System: an executive
  // who can silently change an approval route is a control weakness, not a
  // convenience.
  ceo: ["/", "/clients", "/complaints", "/ledger", "/approvals", "/reports", "/audit-log"],
  operations: ["/", "/clients", "/transactions", "/reconciliation", "/unallocated-funds", "/ledger", "/complaints", "/approvals", "/reports"],
  head_of_finance: ["/", "/approvals", "/ledger", "/reports", "/settings"],
  // Investment Manager runs the mandate day to day: products, orders, the book,
  // valuations and the institutional side. It does NOT hold /approvals — the
  // manager proposes into the IC queue, the Committee decides. Same
  // maker-checker split the payment side already has.
  investment_manager: ["/", "/reports"],
  investment_committee: ["/", "/approvals", "/reports"],
  // System Admin reaches every page. The SAR restriction it used to carry lives
  // where it actually holds: `canSeeCase` filters restricted cases seam-side by
  // role, so opening the Cases page to System Admin shows the register without
  // suspicious-activity matters — the control is on the data, not the route.
  system_admin: ["/", "/bulk/onboarding", "/bulk/payments", "/clients", "/complaints", "/kyc-queue", "/kyc-periodic", "/kyc-dynamic", "/aml-alerts", "/cases", "/fraud-alerts", "/fraud-cases", "/screening", "/approvals", "/transactions", "/reconciliation", "/unallocated-funds", "/enquiries", "/tasks", "/campaigns", "/ledger", "/reports", "/settings", "/feature-flags", "/users", "/system", "/audit-log", "/token-console/overview", "/token-console/investors", "/token-console/accounts", "/token-console/journals", "/token-console/trial-balance", "/token-console/reconciliation", "/token-console/runs", "/token-console/policies", "/token-console/compliance", "/token-console/funds", "/token-console/tariffs", "/token-console/configuration", "/token-console/changes", "/token-console/loans", "/token-console/kyc", "/token-console/customers", "/token-console/customer-approvals", "/token-console/transactions", "/token-console/users"],
};

/** What each role reaches in the KTDA back office: the lists above without
 *  the hidden investment pages (lib/hiddenPages.ts). */
export const ROLE_PAGE_ACCESS = Object.fromEntries(
  Object.entries(ALL_ROLE_PAGE_ACCESS).map(([role, paths]) => [role, paths.filter((p) => !isHiddenPage(p))]),
) as Record<AdminRole, string[]>;

export const ADMIN_USERS: Record<AdminRole, { name: string; initials: string; email: string }> = {
  ceo: { name: "Charles Mburu", initials: "CM", email: "charles.mburu@ktda.example" },
  bd_officer: { name: "Faith Kamau", initials: "FK", email: "faith.kamau@ktda.example" },
  client_services: { name: "Mercy Wanjala", initials: "MW", email: "mercy.wanjala@ktda.example" },
  head_of_bd: { name: "Anthony Mwenda", initials: "AM", email: "anthony.mwenda@ktda.example" },
  compliance: { name: "Kevin Baraka", initials: "KB", email: "kevin.baraka@ktda.example" },
  mlro: { name: "Josephine Muthoni", initials: "JM", email: "josephine.muthoni@ktda.example" },
  compliance_analyst: { name: "Peter Otieno", initials: "PO", email: "peter.otieno@ktda.example" },
  operations: { name: "Grace Mumbi", initials: "GM", email: "grace.mumbi@ktda.example" },
  head_of_finance: { name: "Daniel Kiptoo", initials: "DK", email: "daniel.kiptoo@ktda.example" },
  investment_manager: { name: "Ruth Nyambura", initials: "RN", email: "ruth.nyambura@ktda.example" },
  investment_committee: { name: "Susan Achieng", initials: "SA", email: "susan.achieng@ktda.example" },
  system_admin: { name: "IT Admin", initials: "IT", email: "admin@ktda.example" },
};

export type ApprovalKind =
  | "payment_release" | "nav_publication" | "static_data_change" | "distribution_batch"
  | "liquidity_gate_extension" | "kyc_exception"
  | "account_activation" | "account_closure" | "edd_signoff" | "str_filing" | "case_closure";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalItem = {
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  amount?: number;
  currency?: "KES" | "USD";
  proposedBy: string;
  proposedAt: string;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: string;
  /** Deep-link to the record this approval governs (client, case, wallet…). */
  entityRef?: { entityType: string; entityId: string };
};

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  payment_release: "Payment release",
  nav_publication: "NAV publication",
  static_data_change: "Static data change",
  distribution_batch: "Distribution batch",
  liquidity_gate_extension: "Liquidity gate extension",
  kyc_exception: "KYC / suitability exception",
  account_activation: "Account activation",
  account_closure: "Account closure",
  edd_signoff: "EDD sign-off",
  str_filing: "STR filing",
  case_closure: "Case closure",
};

export const APPROVAL_QUEUE: ApprovalItem[] = [
  { id: "ap_onb_inv_3402", kind: "account_activation", title: "Review & activate — Kevin Mwangi", detail: "Self-service onboarding. Risk MEDIUM. Queued because: medium risk rating. Verify documents and screening before approving.", proposedBy: "System", proposedAt: "2026-08-16T07:12:00Z", status: "pending", entityRef: { entityType: "client", entityId: "inv_3402" } },
  { id: "ap_cls_inv_2601", kind: "account_closure", title: "Account closure request — Esther Chebet", detail: "Customer-initiated closure (CLS-40318827). Reason given: \"Moving my savings to a bank product.\" Run exit screening, review open monitoring alerts and investigations, settle remaining holdings and confirm the payout destination before disabling access (Customer Exit \u00a77, \u00a710, \u00a712).", proposedBy: "Esther Chebet", proposedAt: "2026-08-16T06:40:00Z", status: "pending", entityRef: { entityType: "client", entityId: "inv_2601" } },
  { id: "ap_1", kind: "nav_publication", title: "Publish NAV — KES Fixed Income Fund, 2026-08-06", detail: "NAV derived as 12.4857 from AUM 878,744,000 ÷ 70,380,000 units — bond ladder 858,100,000 mark to market, cash 12,400,000, accrued coupon income 9,850,000, less 1,606,000 accrued fees and facility interest. +0.0160% vs the published 12.4837. All 6 bond prices sourced from custodian statement, no variance flags.", proposedBy: "System (NAV Engine)", proposedAt: "2026-08-06T16:02:00Z", status: "pending" },
  { id: "ap_2", kind: "payment_release", title: "Redemption payout — RDM-2201-KES", detail: "KES 20,000 redemption for investor inv_2891, tier: 2-day settlement, no gate triggered (AUM utilisation 2.18%).", amount: 20_000, currency: "KES", proposedBy: "Grace Mumbi (Operations)", proposedAt: "2026-08-05T15:00:00Z", status: "pending" },
  { id: "ap_3", kind: "distribution_batch", title: "July 2026 distribution batch — both sub-funds", detail: "KES 4.82M to reinvest, KES 1.94M to pay out; USD 8,200 to reinvest, USD 3,100 to pay out. Withholding tax applied at 15%.", proposedBy: "System (Distribution Engine)", proposedAt: "2026-07-31T17:30:00Z", status: "approved", decidedBy: "Daniel Kiptoo", decidedAt: "2026-07-31T17:55:00Z" },
  { id: "ap_4", kind: "static_data_change", title: "Update bank transfer reference format", detail: "Change USD wire reference pattern from BRF-{investorId} to BRF-USD-{investorId}-{ddmmyy} to reduce unmatched receipts.", proposedBy: "Grace Mumbi (Operations)", proposedAt: "2026-08-04T10:12:00Z", status: "pending" },
  { id: "ap_5", kind: "kyc_exception", title: "Suitability exception — investor inv_3350", detail: "Self-service onboarding scored 38/100 (below the 40 threshold for the KES Fixed Income packaged product). Flagged for BD Officer discovery call before activation, per suitability SOP.", proposedBy: "System (Suitability Engine)", proposedAt: "2026-08-06T09:14:00Z", status: "pending" },
  { id: "ap_6", kind: "liquidity_gate_extension", title: "No active gate — informational", detail: "AUM utilisation for KES Fixed Income Fund at 2.18% of the 10% gate threshold. No action required.", proposedBy: "System", proposedAt: "2026-08-06T00:00:00Z", status: "approved", decidedBy: "—", decidedAt: "2026-08-06T00:00:00Z" },
  { id: "ap_7", kind: "payment_release", title: "Redemption payout — RDM-2308-USD", detail: "USD 500 redemption for investor inv_2601, USD Eurobond Fund, tier: 7-day settlement, bank wire payout.", amount: 500, currency: "USD", proposedBy: "Samuel Kariuki (Payment Ops)", proposedAt: "2026-08-07T13:20:00Z", status: "pending" },
  { id: "ap_8", kind: "payment_release", title: "Subscription refund — duplicate STK Push", detail: "Investor inv_2891 was charged twice by a duplicated Daraja callback for the same subscription — KES 50,000 refund pending reversal approval.", amount: 50_000, currency: "KES", proposedBy: "Grace Mumbi (Operations)", proposedAt: "2026-08-08T08:05:00Z", status: "pending" },
];

export type ClientRow = {
  id: string;
  name: string;
  /** Optional — many Kenyan IDs carry three names, some carry two. */
  middleName?: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender | null;
  /** Town or city of residence, from the controlled `CITIES` list. */
  city: string | null;
  nationality: string;
  /** National ID or passport number, captured alongside the KRA PIN. */
  idNumber: string | null;
  /* --- Profile questions, answered after the account is created. Null until
     the customer completes the post-signup profile step, which is why every
     one of them is nullable rather than defaulted. --- */
  employmentType: EmploymentType | null;
  industry: string | null;
  /** Monthly income band — a key from `INCOME_RANGES`, not a free figure. */
  incomeRange: string | null;
  kycStatus: string;
  /** Legacy — the suitability questionnaire was retired from the investor
   * apps, so this is null for anyone who onboarded after that. Retained so the
   * scores already on file stay visible to Compliance. */
  suitabilityScore: number | null;
  aum: number;
  currency: "KES" | "USD";
  channel: string;
  /** Onboarding date — when the application was submitted. */
  joinedAt: string;
};

export const CLIENTS: ClientRow[] = [
  { id: "inv_2891", name: "Amina Wanjiru", middleName: "Njoki", email: "amina.wanjiru@example.com", phone: "+254 712 334 455", dateOfBirth: "1991-06-23", gender: "female", city: "Nairobi", nationality: "Kenyan", idNumber: "31245678", employmentType: "employed", industry: "Retail & wholesale trade", incomeRange: "150k_300k", kycStatus: "verified", suitabilityScore: 72, aum: 474_000, currency: "KES", channel: "Self-service", joinedAt: "2026-03-14" },
  { id: "inv_3350", name: "Brian Otieno", email: "brian.otieno@example.com", phone: "+254 733 221 100", dateOfBirth: "1998-11-04", gender: "male", city: "Nairobi", nationality: "Kenyan", idNumber: "34112907", employmentType: "self_employed", industry: "Retail & wholesale trade", incomeRange: "50k_150k", kycStatus: "suitability_exception", suitabilityScore: 38, aum: 0, currency: "KES", channel: "Self-service", joinedAt: "2026-08-06" },
  { id: "inv_3122", name: "Cynthia Njeri", middleName: "Wangui", email: "cynthia.njeri@example.com", phone: "+254 722 908 771", dateOfBirth: "1979-02-15", gender: "female", city: "Nakuru", nationality: "Kenyan", idNumber: "22884401", employmentType: "self_employed", industry: "Transport & logistics", incomeRange: "over_1m", kycStatus: "verified", suitabilityScore: 81, aum: 1_240_000, currency: "KES", channel: "IFA referral", joinedAt: "2026-05-02" },
  { id: "inv_2765", name: "David Mwangi", email: "david.mwangi@example.com", phone: "+254 701 445 902", dateOfBirth: "1995-09-30", gender: "male", city: "Nairobi", nationality: "Kenyan", idNumber: "29903115", employmentType: "employed", industry: "ICT & technology", incomeRange: "300k_1m", kycStatus: "pending_review", suitabilityScore: null, aum: 0, currency: "KES", channel: "Self-service", joinedAt: "2026-08-05" },
  { id: "inv_2601", name: "Esther Chebet", email: "esther.chebet@example.com", phone: "+254 728 660 143", dateOfBirth: "1984-12-08", gender: "female", city: "Other", nationality: "Kenyan", idNumber: "A1129045", employmentType: "employed", industry: "Healthcare", incomeRange: "300k_1m", kycStatus: "verified", suitabilityScore: 66, aum: 8_400, currency: "USD", channel: "BD officer", joinedAt: "2026-02-11" },
];

export type Lead = {
  id: string;
  name: string;
  phone: string;
  source: string;
  stage: "new" | "contacted" | "discovery_scheduled" | "converted" | "lost";
  suitabilityScore: number | null;
  /** Suitability-review context (Compliance review additions). */
  geography: string;
  product: string;
  deliveryChannel: "Mobile app" | "Web" | "Branch" | "IFA";
  customerRisk: "low" | "medium" | "high" | null;
  createdAt: string;
};

export const LEADS: Lead[] = [
  { id: "ld_1", name: "Brian Otieno", phone: "+254733221100", source: "Self-service signup", stage: "discovery_scheduled", suitabilityScore: 38, geography: "Nairobi, KE", product: "KES Fixed Income", deliveryChannel: "Mobile app", customerRisk: "high", createdAt: "2026-08-06T09:14:00Z" },
  { id: "ld_2", name: "Felix Ndungu", phone: "+254711220099", source: "Website form", stage: "new", suitabilityScore: null, geography: "Mombasa, KE", product: "KES Fixed Income", deliveryChannel: "Web", customerRisk: null, createdAt: "2026-08-06T08:02:00Z" },
  { id: "ld_3", name: "Grace Wairimu", phone: "+254722334455", source: "Referral — Kevin Mutuku (IFA)", stage: "contacted", suitabilityScore: null, geography: "Nakuru, KE", product: "USD Eurobond", deliveryChannel: "IFA", customerRisk: null, createdAt: "2026-08-05T14:20:00Z" },
  { id: "ld_4", name: "Hassan Ali", phone: "+254700112233", source: "Branch walk-in", stage: "converted", suitabilityScore: 74, geography: "Nairobi, KE", product: "KES Fixed Income", deliveryChannel: "Branch", customerRisk: "low", createdAt: "2026-08-01T11:00:00Z" },
];

export type AmlAlert = {
  id: string;
  clientId?: string;
  clientName: string;
  rule: string;
  detail: string;
  severity: "low" | "medium" | "high";
  status: "open" | "under_review" | "cleared" | "escalated";
  assignee?: string;
  caseId?: string;
  raisedAt: string;
  /** Which board the alert belongs to. Same record shape, same workflow, two
   * queues: money-laundering typologies are reviewed by Compliance, fraud
   * indicators (account takeover, third-party payment, replayed callbacks) by
   * the fraud desk. Absent means `aml` — every alert that predates the fraud
   * board is one. */
  kind?: "aml" | "fraud";
};

export const AML_ALERTS: AmlAlert[] = [
  { id: "aml_1", clientId: "GN-163842", clientName: "Wilson Kipngeno Rotich", rule: "Cash-outs split across agents", detail: "Five cash-outs of KES 9,800 to 9,950 at three agents in Bomet inside 36 hours, just under the KES 10,000 review line, the day after a KES 48,600 payment.", severity: "high", status: "under_review", assignee: "Peter Otieno", caseId: "cs_1", raisedAt: "2026-11-07T11:00:00Z" },
  { id: "aml_2", clientId: "GN-192774", clientName: "Mary Njeri Kariuki", rule: "Many senders into one wallet", detail: "Eleven wallet transfers in from eleven different farmers in two days, then one Pay to M-PESA of KES 61,000.", severity: "medium", status: "open", raisedAt: "2026-11-08T09:40:00Z" },
  { id: "aml_3", clientId: "GN-150311", clientName: "Agnes Moraa Nyaboke", rule: "Payment far above deliveries", detail: "KES 212,400 credited against 1,180 kg; Nyansiongo's average is KES 18.50 a kg. Checked against the factory's payment file.", severity: "low", status: "cleared", raisedAt: "2026-11-03T09:40:00Z" },
];

/** Fraud-desk alerts. Same shape and workflow as the AML board — raised by the
 * rules engine, triaged, then escalated into a case — but the indicators are
 * fraud rather than laundering typologies. */
export const FRAUD_ALERTS: AmlAlert[] = [
  { id: "fr_1", kind: "fraud", clientId: "GN-118407", clientName: "Grace Chepkemoi Koech", rule: "Duplicate grower number", detail: "GN-118407 is registered twice: at Momul with ID 2847****, and at Litein with a different ID and phone. Both lines are in the 6 November payment file.", severity: "high", status: "open", raisedAt: "2026-11-06T06:20:00Z" },
  { id: "fr_2", kind: "fraud", clientId: "GN-120955", clientName: "Samuel Mwangi Gichuki", rule: "Number changed before a bonus", detail: "The farmer's phone number was changed through an agent two days before the October bonus run. The new line was registered to someone else a week ago.", severity: "high", status: "under_review", assignee: "Kevin Baraka", caseId: "cs_2", raisedAt: "2026-11-05T19:05:00Z" },
  { id: "fr_3", kind: "fraud", clientId: "AG-2041", clientName: "Kiprotich Agencies (agent)", rule: "Agent cashing out one farmer repeatedly", detail: "Agent AG-2041 cashed out farmer GN-104233 nine times in four days, each just after midnight, for KES 2,000 to 3,000.", severity: "medium", status: "under_review", assignee: "Peter Otieno", caseId: "cs_5", raisedAt: "2026-11-08T07:15:00Z" },
  { id: "fr_4", kind: "fraud", clientId: "M-10251", clientName: "Meru Fertiliser Depot (merchant)", rule: "Merchant sales spike", detail: "Till 512417 took KES 1.84M in voucher payments on 7 November, nine times its daily average, mostly from farmers at one buying centre.", severity: "medium", status: "open", raisedAt: "2026-11-08T13:40:00Z" },
  { id: "fr_5", kind: "fraud", clientId: "GN-171206", clientName: "Esther Wangari Muriuki", rule: "PIN attempts then a new device", detail: "Three wrong PIN attempts on USSD, then a sign-in from a new phone and a Pay to M-PESA request to an unknown number.", severity: "high", status: "open", raisedAt: "2026-11-09T06:30:00Z" },
  { id: "fr_6", kind: "fraud", clientId: "GN-185590", clientName: "Daniel Ombati Nyakundi", rule: "Same M-PESA line on several farmers", detail: "The M-PESA line on this farmer's Pay to M-PESA is the payout line of two other farmers at Kiamokama.", severity: "low", status: "cleared", raisedAt: "2026-11-02T10:30:00Z" },
];

export type ReconciliationBreak = {
  id: string;
  type: "cash" | "unit_holding" | "nav" | "custodian_statement";
  description: string;
  variance: number;
  currency: "KES" | "USD";
  status: "open" | "resolved";
  detectedAt: string;
};

export const RECONCILIATION_BREAKS: ReconciliationBreak[] = [
  { id: "rc_1", type: "custodian_statement", description: "Coupon receipt for IFB1/2023/6.5Yr posted a day early vs. custodian statement", variance: 0, currency: "KES", status: "resolved", detectedAt: "2026-08-05T07:00:00Z" },
  { id: "rc_2", type: "cash", description: "M-Pesa settlement batch total is KES 1,240 short of Daraja's confirmation report", variance: -1240, currency: "KES", status: "open", detectedAt: "2026-08-06T06:30:00Z" },
];

export type UnallocatedFund = {
  id: string;
  reference: string;
  amount: number;
  currency: "KES" | "USD";
  receivedAt: string;
  reason: string;
  status: "unmatched" | "matched" | "returned";
};

export const UNALLOCATED_FUNDS: UnallocatedFund[] = [
  { id: "uf_1", reference: "SHK7Q2M4XP", amount: 4_500, currency: "KES", receivedAt: "2026-11-08T10:00:00Z", reason: "M-PESA paybill deposit with account GN-10423 (one digit short of a grower number)", status: "unmatched" },
  { id: "uf_2", reference: "SHJ3P9W1KD", amount: 12_000, currency: "KES", receivedAt: "2026-11-07T15:42:00Z", reason: "Deposit with no account number, from a line not on any farmer", status: "unmatched" },
  { id: "uf_3", reference: "PR-2026-11-06/L4812", amount: 7_412, currency: "KES", receivedAt: "2026-11-06T09:05:00Z", reason: "Payment file line for GN-199001, a grower number not registered", status: "unmatched" },
  { id: "uf_4", reference: "SHG8D5T2LA", amount: 3_000, currency: "KES", receivedAt: "2026-11-04T11:05:00Z", reason: "Matched to GN-131620 after the farmer called in", status: "matched" },
  { id: "uf_5", reference: "SHF1B7N6QE", amount: 950, currency: "KES", receivedAt: "2026-11-02T08:20:00Z", reason: "Sender could not be reached in 7 days; returned to the sending line", status: "returned" },
];

export type SystemUser = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  status: "active" | "suspended" | "invited";
  /** Empty string until the user's first sign-in (e.g. freshly invited). */
  lastLogin: string;
};

export const SYSTEM_USERS: SystemUser[] = [
  { id: "u_1", name: "Faith Kamau", email: "faith.kamau@ktda.example", role: "bd_officer", status: "active", lastLogin: "2026-11-09T09:10:00Z" },
  { id: "u_2", name: "Peter Otieno", email: "peter.otieno@ktda.example", role: "compliance_analyst", status: "active", lastLogin: "2026-11-09T08:45:00Z" },
  { id: "u_3", name: "Grace Mumbi", email: "grace.mumbi@ktda.example", role: "operations", status: "active", lastLogin: "2026-11-09T07:30:00Z" },
  { id: "u_4", name: "Daniel Kiptoo", email: "daniel.kiptoo@ktda.example", role: "head_of_finance", status: "active", lastLogin: "2026-11-08T18:00:00Z" },
  { id: "u_5", name: "Susan Achieng", email: "susan.achieng@ktda.example", role: "investment_committee", status: "active", lastLogin: "2026-11-07T16:20:00Z" },
  { id: "u_6", name: "IT Admin", email: "admin@ktda.example", role: "system_admin", status: "active", lastLogin: "2026-11-09T06:00:00Z" },
  { id: "u_7", name: "Josephine Muthoni", email: "josephine.muthoni@ktda.example", role: "mlro", status: "active", lastLogin: "2026-11-08T15:30:00Z" },
  { id: "u_8", name: "Kevin Baraka", email: "kevin.baraka@ktda.example", role: "compliance", status: "active", lastLogin: "2026-11-09T08:10:00Z" },
  { id: "u_9", name: "Mercy Wanjala", email: "mercy.wanjala@ktda.example", role: "client_services", status: "active", lastLogin: "2026-11-09T06:05:00Z" },
  { id: "u_10", name: "Anthony Mwenda", email: "anthony.mwenda@ktda.example", role: "head_of_bd", status: "active", lastLogin: "2026-11-06T17:40:00Z" },
  { id: "u_11", name: "Charles Mburu", email: "charles.mburu@ktda.example", role: "ceo", status: "active", lastLogin: "2026-11-07T06:20:00Z" },
  { id: "u_12", name: "Ruth Nyambura", email: "ruth.nyambura@ktda.example", role: "investment_manager", status: "active", lastLogin: "2026-11-06T15:05:00Z" },
];
