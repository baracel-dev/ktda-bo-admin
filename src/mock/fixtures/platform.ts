import type { AdminRole, ApprovalKind } from "./admin";

/** Platform configuration domain — the BO Admin Panel is the single point of
 * truth for every commercial/business parameter the six front ends (and the
 * upcoming investor mobile app) consume. Nothing here changes silently: a
 * setting edit becomes a `static_data_change` approval item and only applies
 * once a second person signs it off (maker-checker), and every change lands
 * in the audit trail. */

// ---- Platform settings (business parameters) ----

export type PlatformSettingSection =
  | "fund_parameters"
  | "liquidity_policy"
  | "fees_commissions"
  | "compliance_thresholds"
  | "nav_valuation"
  | "service_standards"
  | "payments"
  | "security_policy";

export const SETTING_SECTION_LABELS: Record<PlatformSettingSection, { title: string; description: string }> = {
  fund_parameters: { title: "Fund parameters", description: "Product setup per sub-fund — minimums and dealing basics every investor surface reads." },
  liquidity_policy: { title: "Liquidity & redemption policy", description: "The gate clause and facility covenants from the concept note's liquidity framework." },
  fees_commissions: { title: "Fees, commissions & IFA programme", description: "Management fee, exit fee, the IFA commission schedule and partner-programme terms." },
  compliance_thresholds: { title: "Compliance & AML thresholds", description: "Suitability scoring and the ongoing transaction-monitoring rule parameters." },
  nav_valuation: { title: "NAV & valuation", description: "Daily NAV computation controls — cut-offs and the variance tolerance that triggers independent review." },
  service_standards: { title: "Service standards & SLAs", description: "The SOPs' client-service and operations targets — dashboards and breach alerts read these." },
  payments: { title: "Payments & channels", description: "Rail configuration the Payment Ops portal and investor apps read — formats, cut-offs, environments." },
  security_policy: { title: "Security policy", description: "Session, authentication and access-review parameters across BO and investor surfaces." },
};

/** Central pending-change registry: any configurable object can stage a
 * change behind a static_data_change approval. `decideApproval` applies
 * (or discards) the closure when the checker decides. Keyed by approval id. */
export type PendingChange = { label: string; apply: (decidedBy: string) => void; clear: () => void };
export const PENDING_CHANGES = new Map<string, PendingChange>();

export type PlatformSetting = {
  key: string;
  section: PlatformSettingSection;
  label: string;
  description: string;
  value: string;
  unit?: string;
  /** Set while a static_data_change approval for this setting is pending. */
  pendingValue?: string;
  pendingApprovalId?: string;
  updatedAt: string;
  updatedBy: string;
};

export const PLATFORM_SETTINGS: PlatformSetting[] = [
  { key: "kes_min_investment", section: "fund_parameters", label: "Minimum investment — KES Fixed Income", description: "Smallest initial subscription the investor apps accept for the KES sub-fund.", value: "100", unit: "KES", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "usd_min_investment", section: "fund_parameters", label: "Minimum investment — USD Eurobond", description: "Smallest initial subscription the investor apps accept for the USD sub-fund.", value: "10", unit: "USD", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "distribution_day", section: "fund_parameters", label: "Distribution day", description: "When monthly coupon income is paid out or reinvested.", value: "Last business day of month", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "lockup_days", section: "fund_parameters", label: "Soft lock-up period", description: "Applies to the launch cohort — investors subscribing within this window of the fund's launch date pay the early-exit fee if they redeem inside it.", value: "180", unit: "days from launch", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },

  { key: "gate_threshold_pct", section: "liquidity_policy", label: "Redemption gate threshold", description: "If one dealing day's redemption requests exceed this share of AUM, the excess defers FIFO to the next day.", value: "10", unit: "% of AUM", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "gate_max_days", section: "liquidity_policy", label: "Maximum consecutive gate days", description: "Beyond this the gate needs a trustee-approved extension.", value: "5", unit: "dealing days", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "liquidity_facility_floor", section: "liquidity_policy", label: "Liquidity facility covenant", description: "The bank facility backing redemptions must stay at or above this share of AUM as the fund scales.", value: "5", unit: "% of AUM", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "facility_pricing", section: "liquidity_policy", label: "Liquidity facility pricing", description: "Arm's-length rate charged to the fund for the bank facility (concept note band CBR + 1.5–2.0%).", value: "CBR + 1.75", unit: "% p.a.", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "liquidity_review_cadence", section: "liquidity_policy", label: "Liquidity review cadence", description: "Fund-manager liquidity adequacy review presented to the trustee.", value: "Quarterly", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },

  { key: "management_fee_pct", section: "fees_commissions", label: "Management fee", description: "Annual fee accrued daily against NAV (concept note band 0.75–1.25%).", value: "1.00", unit: "% of NAV p.a.", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "exit_fee_pct", section: "fees_commissions", label: "Early-exit fee", description: "Charged on redemptions inside the soft lock-up period.", value: "1.5", unit: "%", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "ifa_commission_pct", section: "fees_commissions", label: "IFA commission rate", description: "Trailing commission on referred AUM — accrued monthly, paid quarterly. The IFA Portal reads this schedule.", value: "0.5", unit: "% of referred AUM p.a.", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "ifa_certification_validity", section: "fees_commissions", label: "IFA certification validity", description: "How long an advisor's certification lasts before recertification — the IFA Portal shows expiry from this.", value: "12", unit: "months", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Faith Kamau" },
  { key: "ifa_dd_review_cadence", section: "fees_commissions", label: "IFA due-diligence review", description: "Ongoing due-diligence and screening refresh for contracted advisors, per the BD SOP.", value: "Annual", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Faith Kamau" },
  { key: "wht_infra_bonds", section: "fees_commissions", label: "Withholding tax — infrastructure bond income", description: "Kenya infrastructure bonds are WHT-exempt per the concept note; income passes through untaxed. Final treatment is Open Question 7 — confirm with Investcent Tax before launch.", value: "0", unit: "%", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "wht_eurobonds", section: "fees_commissions", label: "Withholding tax — Eurobond coupon income", description: "Applied to USD sub-fund coupon income before distribution (Open Question 7 — rate pending Tax confirmation).", value: "15", unit: "%", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },

  { key: "straight_through_activation", section: "compliance_thresholds", label: "Straight-through activation", description: "When enabled, an application that is Low risk, screening-clear and EDD-free activates without a Compliance officer — the KYC/CDD Policy §10 approval table permits system approval for Low risk, subject to controls. Disable to route every application to the Compliance queue. Any other combination is queued regardless of this setting.", value: "enabled", updatedAt: "2026-08-16T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "suitability_pass_score", section: "compliance_thresholds", label: "Suitability pass score", description: "Self-service onboarding below this 0–100 score routes to the BD Officer exception queue instead of auto-activating.", value: "40", unit: "/ 100", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "aml_structuring_window", section: "compliance_thresholds", label: "Structuring detection window", description: "Rolling window the AML engine scans for split-deposit (smurfing) patterns near reporting thresholds.", value: "48", unit: "hours", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "aml_review_threshold", section: "compliance_thresholds", label: "Deposit review threshold", description: "Deposits at or above this trigger the structuring rule's near-threshold scan — the seeded alerts reference splits just under it.", value: "10,000", unit: "KES", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "aml_velocity_max_tx", section: "compliance_thresholds", label: "Velocity rule — daily transaction count", description: "Subscriptions per client per day above this raise a velocity alert against the 90-day average.", value: "3", unit: "tx / day", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "kyc_refresh_cadence", section: "compliance_thresholds", label: "KYC / tax refresh cadence", description: "Periodic re-verification of client KYC and tax status, per the BD SOP's ongoing-servicing controls.", value: "24", unit: "months", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "risk_band_low_max", section: "compliance_thresholds", label: "Risk band — Low ceiling", description: "Customer risk scores at or below this rate as Low risk.", value: "30", unit: "/ 100", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "risk_band_medium_max", section: "compliance_thresholds", label: "Risk band — Medium ceiling", description: "Scores above the Low ceiling up to this rate as Medium; anything above is High.", value: "60", unit: "/ 100", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "edd_trigger_rating", section: "compliance_thresholds", label: "EDD trigger rating", description: "Customers at or above this risk rating require Enhanced Due Diligence before activation.", value: "high", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "screening_cadence", section: "compliance_thresholds", label: "Sanctions / PEP screening cadence", description: "Every customer is re-screened this often by the nightly batch, regardless of risk band (Compliance requirement: daily).", value: "Daily", updatedAt: "2026-08-11T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "aml_review_threshold_high_risk", section: "compliance_thresholds", label: "Deposit review threshold — High risk", description: "Tighter near-threshold scan for High-risk customers (base threshold applies to other bands).", value: "5,000", unit: "KES", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "aml_velocity_max_tx_high_risk", section: "compliance_thresholds", label: "Velocity rule — High-risk daily count", description: "Daily transaction count that raises a velocity alert for High-risk customers.", value: "1", unit: "tx / day", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "sar_decision_sla", section: "compliance_thresholds", label: "SAR decision SLA", description: "MLRO must decide file/no-file within this window after escalation.", value: "5", unit: "business days", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "abc_gift_threshold", section: "compliance_thresholds", label: "ABC gift & hospitality threshold", description: "Gifts or hospitality at or above this value are an anti-bribery risk indicator requiring escalation.", value: "20,000", unit: "KES", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "complaint_ack_sla", section: "service_standards", label: "Complaint acknowledgement SLA", description: "Complaints must be acknowledged within this window of receipt.", value: "1", unit: "business day", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Faith Kamau" },
  { key: "complaint_resolution_sla", section: "service_standards", label: "Complaint resolution SLA", description: "Target window to resolve a complaint; breaches escalate to the Head of BD.", value: "10", unit: "business days", updatedAt: "2026-08-09T09:00:00Z", updatedBy: "Faith Kamau" },

  { key: "nav_variance_tolerance", section: "nav_valuation", label: "NAV variance tolerance", description: "Day-over-day NAV movement beyond this triggers the independent nav-variance review before publication. Indicative — confirm with Fund Accounting.", value: "0.50", unit: "%", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "nav_cutoff_time", section: "nav_valuation", label: "NAV computation cut-off", description: "Daily cut-off for bond prices, cash and accruals entering that dealing day's NAV.", value: "16:00", unit: "EAT", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },
  { key: "dealing_cutoff_time", section: "nav_valuation", label: "Dealing cut-off", description: "Subscriptions and redemptions received after this land on the next dealing day.", value: "15:00", unit: "EAT", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Daniel Kiptoo" },

  { key: "enquiry_ack_days", section: "service_standards", label: "Enquiry acknowledgement", description: "Client Services must acknowledge every enquiry within this window (BD SOP core service standard).", value: "1", unit: "business day", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Faith Kamau" },
  { key: "statement_delivery_days", section: "service_standards", label: "Statement delivery", description: "Client statements delivered within this many business days of period-end (BD SOP).", value: "5", unit: "business days", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Faith Kamau" },
  { key: "record_retention_years", section: "service_standards", label: "Record retention", description: "Minimum secure retention for client records — longer where regulation requires (BD SOP).", value: "7", unit: "years", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Peter Otieno" },
  { key: "break_escalation_age", section: "service_standards", label: "Reconciliation break escalation age", description: "Open breaks older than this escalate to the Head of Operations. Indicative placeholder — the Ops SOP mandates age-based escalation without fixing the number.", value: "5", unit: "business days", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Grace Mumbi" },
  { key: "break_materiality", section: "service_standards", label: "Reconciliation materiality threshold", description: "Breaks at or above this escalate immediately regardless of age. Indicative placeholder pending Ops confirmation.", value: "100,000", unit: "KES", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Grace Mumbi" },

  { key: "wire_ref_format_usd", section: "payments", label: "USD wire reference format", description: "Reference pattern investors must quote on USD wires — unmatched formats land in the Unallocated Funds Register. A change to this pattern is pending in Approvals.", value: "BRF-{investorId}", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "Grace Mumbi" },
  { key: "mpesa_stk_environment", section: "payments", label: "M-Pesa STK Push environment", description: "Daraja environment the investor apps' STK collection runs against.", value: "production", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },
  { key: "mpesa_b2c_environment", section: "payments", label: "M-Pesa B2C environment", description: "Daraja environment for outbound payouts (redemptions, cash distributions).", value: "production", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },
  { key: "ussd_shortcode", section: "payments", label: "USSD shortcode", description: "The dial string the feature-phone channel answers on. Pending Safaricom allocation — the channel cannot open until this is real.", value: "Not allocated", updatedAt: "2026-08-20T09:00:00Z", updatedBy: "IT Admin" },
  { key: "ussd_session_timeout", section: "payments", label: "USSD session timeout", description: "Idle seconds before a USSD session drops. Shorter than a web session by an order of magnitude — the carrier closes it regardless, so this is what the app must plan for.", value: "90", unit: "seconds", updatedAt: "2026-08-20T09:00:00Z", updatedBy: "IT Admin" },
  { key: "settlement_retry_limit", section: "payments", label: "Settlement retry limit", description: "Failed settlement callbacks retried this many times before flagging manual review in Payment Ops.", value: "3", unit: "attempts", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },

  { key: "bo_session_timeout", section: "security_policy", label: "BO session timeout", description: "Idle minutes before a back-office session requires re-authentication.", value: "30", unit: "minutes", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "IT Admin" },
  { key: "access_recert_cadence", section: "security_policy", label: "Access recertification cadence", description: "How often every role's page access is recertified against the permission matrix.", value: "Quarterly", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "IT Admin" },
  { key: "investor_pin_length", section: "security_policy", label: "Investor PIN length", description: "PIN digits required by the investor web and mobile apps.", value: "6", unit: "digits", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "IT Admin" },
  { key: "pin_lockout_attempts", section: "security_policy", label: "PIN lockout threshold", description: "Failed PIN attempts before the investor account locks pending re-verification.", value: "5", unit: "attempts", updatedAt: "2026-06-02T09:00:00Z", updatedBy: "IT Admin" },
];

// ---- Feature flags (per platform, incl. the upcoming investor mobile app) ----

export type FlagPlatform = "investor_web" | "investor_mobile" | "investor_ussd" | "ifa_portal" | "trustee_portal" | "payment_ops" | "bo_admin";

export const FLAG_PLATFORM_LABELS: Record<FlagPlatform, { title: string; note?: string }> = {
  investor_web: { title: "Investor Web / PWA" },
  investor_mobile: { title: "Investor Mobile", note: "Native app in build — flags are pre-staged so launch is a config change, not a deploy." },
  investor_ussd: { title: "Investor USSD", note: "Feature-phone channel (proposal §4.2, Phase 1b). Not built — flags are staged so the shortcode can be opened without a deploy once Safaricom allocates it." },
  ifa_portal: { title: "IFA Portal" },
  trustee_portal: { title: "Trustee Portal" },
  payment_ops: { title: "Payment Ops Portal" },
  bo_admin: { title: "KTDA Back Office" },
};

export type FeatureFlag = {
  key: string;
  platform: FlagPlatform;
  label: string;
  description: string;
  enabled: boolean;
  stage: "ga" | "beta" | "planned";
  updatedAt: string;
  updatedBy: string;
};

export const FEATURE_FLAGS: FeatureFlag[] = [
  { key: "web_usd_subscriptions", platform: "investor_web", label: "USD Eurobond subscriptions", description: "Expose the USD sub-fund for subscription (bank wire rail).", enabled: true, stage: "ga", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },
  { key: "web_redemption_gate_banner", platform: "investor_web", label: "Redemption gate notice", description: "Show the gate explainer on the redeem screen when utilisation crosses the watch level.", enabled: true, stage: "ga", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },
  { key: "web_swahili_locale", platform: "investor_web", label: "Swahili locale", description: "Serve the sw content blocks where the CMS has translations.", enabled: false, stage: "beta", updatedAt: "2026-08-01T10:00:00Z", updatedBy: "IT Admin" },
  { key: "web_statement_downloads", platform: "investor_web", label: "Statement downloads", description: "Monthly PDF statements from the investor dashboard.", enabled: true, stage: "ga", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },

  { key: "mob_biometric_login", platform: "investor_mobile", label: "Biometric login", description: "Face/fingerprint unlock instead of PIN on supported devices.", enabled: true, stage: "planned", updatedAt: "2026-08-05T09:00:00Z", updatedBy: "IT Admin" },
  { key: "mob_push_notifications", platform: "investor_mobile", label: "Push notifications", description: "Distribution, settlement and gate notices as native push.", enabled: true, stage: "planned", updatedAt: "2026-08-05T09:00:00Z", updatedBy: "IT Admin" },
  { key: "mob_mpesa_stk", platform: "investor_mobile", label: "In-app M-Pesa STK Push", description: "Subscribe with an in-app STK prompt rather than a Paybill reference.", enabled: true, stage: "planned", updatedAt: "2026-08-05T09:00:00Z", updatedBy: "IT Admin" },
  { key: "mob_token_waitlist", platform: "investor_mobile", label: "Tokenized units waitlist", description: "Phase-2 teaser: register diaspora interest ahead of the ERC-3643 launch.", enabled: false, stage: "planned", updatedAt: "2026-08-05T09:00:00Z", updatedBy: "IT Admin" },

  /* USSD is a third access point onto the same investor identity, not a
     cut-down product: a USSD subscription is subject to exactly the same
     eligibility checks as an app subscription. The flags exist now so the
     channel's scope is a decision Compliance and Ops can make in config rather
     than discover at build time. */
  { key: "ussd_balance_enquiry", platform: "investor_ussd", label: "Balance enquiry", description: "Holdings and NAV over USSD. Read-only, so it can open ahead of the transactional menus.", enabled: true, stage: "planned", updatedAt: "2026-08-20T09:00:00Z", updatedBy: "IT Admin" },
  { key: "ussd_subscribe", platform: "investor_ussd", label: "Subscribe / top-up", description: "Initiate a subscription over USSD, settling via an M-Pesa STK prompt. Reads the same entitlement check as the app.", enabled: false, stage: "planned", updatedAt: "2026-08-20T09:00:00Z", updatedBy: "IT Admin" },
  { key: "ussd_redeem", platform: "investor_ussd", label: "Redemption request", description: "Request a redemption over USSD. Tier and gate rules apply identically — the channel does not change the notice period.", enabled: false, stage: "planned", updatedAt: "2026-08-20T09:00:00Z", updatedBy: "IT Admin" },
  { key: "ussd_pin_confirmation", platform: "investor_ussd", label: "PIN transaction confirmation", description: "Confirm money-moving actions with the investor PIN in-session, since a feature phone has no biometric fallback.", enabled: true, stage: "planned", updatedAt: "2026-08-20T09:00:00Z", updatedBy: "IT Admin" },

  { key: "ifa_client_invites", platform: "ifa_portal", label: "Client invite links", description: "Let advisors send tracked onboarding invites by SMS/email.", enabled: true, stage: "ga", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },
  { key: "trustee_nav_variance_view", platform: "trustee_portal", label: "NAV variance review", description: "Surface day-over-day NAV variance flags for trustee sign-off.", enabled: true, stage: "ga", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },
  { key: "payops_auto_retry", platform: "payment_ops", label: "Auto-retry failed settlements", description: "Retry failed Daraja callbacks up to 3 times before flagging manual review.", enabled: false, stage: "beta", updatedAt: "2026-08-02T14:00:00Z", updatedBy: "IT Admin" },
  { key: "bo_leads_register", platform: "bo_admin", label: "Manual lead register", description: "Interim pre-CRM lead capture for BD Officers.", enabled: true, stage: "ga", updatedAt: "2026-07-18T08:30:00Z", updatedBy: "IT Admin" },
];

// ---- Reports centre ----

export type ReportCategory = "regulatory" | "finance" | "operations" | "compliance" | "distributions" | "processes" | "audit_mis" | "miscellaneous";

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  regulatory: "Regulatory",
  finance: "Finance",
  operations: "Operations",
  compliance: "Compliance",
  distributions: "Distributions",
  processes: "Processes",
  audit_mis: "Audit MIS",
  miscellaneous: "Miscellaneous",
};

export type ReportColumn = { key: string; label: string; description?: string };

export type ReportDef = {
  id: string;
  name: string;
  category: ReportCategory;
  description: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "on_demand";
  format: "PDF" | "XLSX" | "CSV";
  /** Roles allowed to see/run this report — the Reports page filters by the signed-in role. */
  restrictedTo: AdminRole[];
  /** Every column the report can emit — users pick a subset at generation. */
  columns: ReportColumn[];
  lastRun?: { at: string; by: string; sizeKb: number; columnCount?: number };
  generating?: boolean;
};

export const REPORTS: ReportDef[] = [
  { id: "rp_cma_quarterly", name: "CMA quarterly CIS return", category: "regulatory", description: "Prescribed Capital Markets Authority return — AUM, unit-holder register summary, liquidity position.", frequency: "quarterly", format: "PDF", restrictedTo: ["head_of_finance", "compliance", "system_admin", "ceo"], columns: [
    { key: "period", label: "Reporting period" },
    { key: "sub_fund", label: "Sub-fund" },
    { key: "aum_opening", label: "AUM — opening" },
    { key: "aum_closing", label: "AUM — closing" },
    { key: "net_flows", label: "Net subscriptions / redemptions" },
    { key: "unit_holders", label: "Unit-holder count" },
    { key: "nav_per_unit", label: "NAV per unit (period-end)" },
    { key: "facility_size", label: "Liquidity facility size" },
    { key: "facility_utilisation", label: "Facility utilisation %" },
    { key: "gate_events", label: "Gate events in period" },
    { key: "breaches", label: "Breaches & exceptions", description: "Covenant, mandate or regulatory breaches with remediation status." },
  ], lastRun: { at: "2026-07-05T10:00:00Z", by: "Daniel Kiptoo", sizeKb: 812 } },
  { id: "rp_nav_pack", name: "Daily NAV pack", category: "finance", description: "Per-sub-fund NAV computation with bond price sources and independent-review sign-off trail.", frequency: "daily", format: "PDF", restrictedTo: ["head_of_finance", "investment_committee", "system_admin", "ceo", "investment_manager"], columns: [
    { key: "dealing_date", label: "Dealing date" },
    { key: "sub_fund", label: "Sub-fund" },
    { key: "isin", label: "Bond ISIN" },
    { key: "market_price", label: "Market price" },
    { key: "price_source", label: "Price source" },
    { key: "accrued_interest", label: "Accrued interest" },
    { key: "cash_balance", label: "Cash balance" },
    { key: "expense_accrual", label: "Expense accrual" },
    { key: "total_nav", label: "Total NAV" },
    { key: "units_in_issue", label: "Units in issue" },
    { key: "nav_per_unit", label: "NAV per unit" },
    { key: "day_change_pct", label: "Day change %" },
    { key: "variance_flag", label: "Variance flag", description: "Set when the day move exceeds the configured tolerance." },
    { key: "reviewed_by", label: "Independent reviewer" },
  ], lastRun: { at: "2026-08-08T16:10:00Z", by: "System (NAV Engine)", sizeKb: 240 } },
  { id: "rp_dist_batch", name: "Distribution batch summary", category: "distributions", description: "Monthly coupon distribution — reinvest vs payout split, withholding tax, per-channel payout totals.", frequency: "monthly", format: "XLSX", restrictedTo: ["head_of_finance", "operations", "system_admin", "ceo"], columns: [
    { key: "batch_id", label: "Batch ID" },
    { key: "period", label: "Distribution period" },
    { key: "sub_fund", label: "Sub-fund" },
    { key: "investor_id", label: "Investor ID" },
    { key: "investor_name", label: "Investor name" },
    { key: "units_held", label: "Units held (record date)" },
    { key: "gross_income", label: "Gross income" },
    { key: "wht_rate", label: "WHT rate", description: "Per-instrument withholding rate from Platform Settings." },
    { key: "wht_amount", label: "WHT amount" },
    { key: "net_income", label: "Net income" },
    { key: "election", label: "Election (reinvest / payout)" },
    { key: "payout_channel", label: "Payout channel" },
    { key: "payout_reference", label: "Payout reference" },
    { key: "status", label: "Status" },
  ], lastRun: { at: "2026-07-31T18:00:00Z", by: "System (Distribution Engine)", sizeKb: 154 } },
  { id: "rp_aml_str", name: "AML monitoring & STR summary", category: "compliance", description: "Open alerts by rule and severity, escalations, and suspicious-transaction reports filed in the period.", frequency: "monthly", format: "PDF", restrictedTo: ["compliance", "mlro", "system_admin"], columns: [
    { key: "alert_id", label: "Alert ID" },
    { key: "raised_at", label: "Raised at" },
    { key: "client_id", label: "Client ID" },
    { key: "client_name", label: "Client name" },
    { key: "rule", label: "Rule triggered" },
    { key: "severity", label: "Severity" },
    { key: "status", label: "Status" },
    { key: "disposition", label: "Disposition", description: "Cleared, escalated, or pending investigation outcome." },
    { key: "escalated_to", label: "Escalated to" },
    { key: "str_filed", label: "STR filed (Y/N)" },
    { key: "str_reference", label: "STR reference" },
    { key: "days_open", label: "Days open" },
  ], lastRun: { at: "2026-08-01T09:00:00Z", by: "Peter Otieno", sizeKb: 96 } },
  { id: "rp_recon_ageing", name: "Reconciliation break ageing", category: "operations", description: "Open breaks by type and age bucket across cash, unit-holding, NAV and custodian reconciliations.", frequency: "weekly", format: "XLSX", restrictedTo: ["operations", "head_of_finance", "system_admin"], columns: [
    { key: "break_id", label: "Break ID" },
    { key: "type", label: "Reconciliation type" },
    { key: "detected_at", label: "Detected at" },
    { key: "age_days", label: "Age (days)" },
    { key: "age_bucket", label: "Age bucket", description: "0–1, 2–5, 6–10, 10+ business days." },
    { key: "description", label: "Description" },
    { key: "variance", label: "Variance amount" },
    { key: "currency", label: "Currency" },
    { key: "status", label: "Status" },
    { key: "owner", label: "Assigned owner" },
    { key: "escalation_level", label: "Escalation level", description: "Driven by the configured age and materiality thresholds." },
  ], lastRun: { at: "2026-08-04T07:30:00Z", by: "Grace Mumbi", sizeKb: 64 } },
  { id: "rp_unallocated", name: "Unallocated funds register", category: "operations", description: "Unmatched receipts with age, investigation notes and return/match outcomes — mirrors the Ops SOP register.", frequency: "weekly", format: "CSV", restrictedTo: ["operations", "compliance", "system_admin"], columns: [
    { key: "receipt_id", label: "Receipt ID" },
    { key: "reference", label: "Payment reference" },
    { key: "received_at", label: "Received at" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "channel", label: "Channel" },
    { key: "reason", label: "Reason unmatched" },
    { key: "age_days", label: "Age (days)" },
    { key: "investigation_note", label: "Investigation note" },
    { key: "outcome", label: "Outcome (matched / returned)" },
    { key: "resolved_at", label: "Resolved at" },
  ], lastRun: { at: "2026-08-04T07:35:00Z", by: "Grace Mumbi", sizeKb: 18 } },
  { id: "rp_liquidity_stress", name: "Liquidity stress test", category: "finance", description: "Facility headroom and gate distance under the concept note's AUM stress scenarios.", frequency: "monthly", format: "PDF", restrictedTo: ["head_of_finance", "investment_committee", "system_admin", "ceo", "investment_manager"], columns: [
    { key: "scenario", label: "Stress scenario", description: "AUM level with assumed daily redemption pressure (concept note §5.4)." },
    { key: "sub_fund", label: "Sub-fund" },
    { key: "aum", label: "AUM" },
    { key: "daily_redemption_pct", label: "Assumed daily redemption %" },
    { key: "facility_size", label: "Facility size" },
    { key: "facility_utilisation", label: "Facility utilisation %" },
    { key: "days_covered", label: "Days facility covers" },
    { key: "gate_distance", label: "Distance to gate threshold" },
    { key: "covenant_status", label: "5% scaling covenant status" },
  ], lastRun: { at: "2026-07-28T11:00:00Z", by: "Daniel Kiptoo", sizeKb: 310 } },
  { id: "rp_ifa_commissions", name: "IFA commission statement", category: "finance", description: "Per-advisor accrual and payment schedule at the configured commission rate.", frequency: "quarterly", format: "XLSX", restrictedTo: ["head_of_finance", "system_admin"], columns: [
    { key: "advisor_id", label: "Advisor ID" },
    { key: "advisor_name", label: "Advisor name" },
    { key: "firm", label: "Firm" },
    { key: "certification_status", label: "Certification status" },
    { key: "period", label: "Accrual period" },
    { key: "referred_clients", label: "Referred client count" },
    { key: "referred_aum", label: "Referred AUM" },
    { key: "rate", label: "Commission rate", description: "From Platform Settings — fees & commissions." },
    { key: "accrued", label: "Accrued amount" },
    { key: "paid", label: "Paid amount" },
    { key: "payment_status", label: "Payment status" },
  ], lastRun: { at: "2026-07-01T09:00:00Z", by: "Daniel Kiptoo", sizeKb: 42 } },
  { id: "rp_kyc_status", name: "Client KYC status extract", category: "compliance", description: "Full register by KYC state, channel and suitability score — feeds the compliance MI pack.", frequency: "on_demand", format: "CSV", restrictedTo: ["compliance", "bd_officer", "system_admin"], columns: [
    { key: "client_id", label: "Client ID" },
    { key: "name", label: "Full name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "channel", label: "Acquisition channel" },
    { key: "kyc_status", label: "KYC status" },
    { key: "suitability_score", label: "Suitability score (0–100)" },
    { key: "risk_rating", label: "Risk rating" },
    { key: "pep_flag", label: "PEP flag" },
    { key: "sanctions_result", label: "Sanctions screening result" },
    { key: "onboarded_at", label: "Onboarding date" },
    { key: "last_refresh", label: "Last KYC refresh" },
    { key: "next_refresh_due", label: "Next refresh due", description: "Driven by the configured KYC refresh cadence." },
  ] },
  { id: "rp_tx_ledger", name: "Transaction ledger extract", category: "operations", description: "Append-only ledger entries for a period — subscriptions, redemptions, distributions, fees.", frequency: "on_demand", format: "CSV", restrictedTo: ["operations", "head_of_finance", "compliance", "system_admin"], columns: [
    { key: "entry_id", label: "Ledger entry ID" },
    { key: "timestamp", label: "Timestamp" },
    { key: "investor_id", label: "Investor ID" },
    { key: "investor_name", label: "Investor name" },
    { key: "sub_fund", label: "Sub-fund" },
    { key: "type", label: "Entry type" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "units", label: "Units" },
    { key: "nav_applied", label: "NAV applied" },
    { key: "channel", label: "Channel" },
    { key: "reference", label: "Reference" },
    { key: "status", label: "Status" },
    { key: "settled_at", label: "Settled at" },
  ], lastRun: { at: "2026-08-06T15:00:00Z", by: "Grace Mumbi", sizeKb: 388 } },

  // ---- Regulatory pack additions (Compliance review) ----
  { id: "rp_kyc_refresh", name: "KYC refresh report", category: "regulatory", description: "Clients due, overdue and completed for periodic KYC/tax re-verification in the period.", frequency: "monthly", format: "XLSX", restrictedTo: ["compliance", "mlro", "system_admin"], columns: [
    { key: "client_id", label: "Client ID" },
    { key: "name", label: "Client name" },
    { key: "risk_rating", label: "Risk rating" },
    { key: "last_refresh", label: "Last refresh" },
    { key: "next_refresh_due", label: "Next refresh due" },
    { key: "status", label: "Refresh status", description: "Due / overdue / completed in period." },
    { key: "days_overdue", label: "Days overdue" },
    { key: "assigned_to", label: "Assigned officer" },
  ] },
  { id: "rp_case_listing", name: "Case listing report", category: "regulatory", description: "All compliance cases in the period — AML, fraud, ABC and SAR — with status and outcome.", frequency: "monthly", format: "XLSX", restrictedTo: ["compliance", "mlro", "system_admin"], columns: [
    { key: "case_id", label: "Case ID" },
    { key: "type", label: "Case type" },
    { key: "client_id", label: "Client ID" },
    { key: "client_name", label: "Client name" },
    { key: "severity", label: "Severity" },
    { key: "status", label: "Status" },
    { key: "assignee", label: "Assignee" },
    { key: "opened_at", label: "Opened" },
    { key: "closed_at", label: "Closed" },
    { key: "outcome", label: "Outcome / rationale" },
    { key: "days_open", label: "Days open" },
  ] },
  { id: "rp_pep_customers", name: "PEP identified customer details", category: "regulatory", description: "Customers with confirmed or potential PEP status, their screening resolutions and applied controls.", frequency: "monthly", format: "PDF", restrictedTo: ["compliance", "mlro", "system_admin"], columns: [
    { key: "client_id", label: "Client ID" },
    { key: "name", label: "Client name" },
    { key: "pep_status", label: "PEP status", description: "Confirmed / potential match / cleared false positive." },
    { key: "position", label: "Prominent position / association" },
    { key: "screening_ref", label: "Screening reference" },
    { key: "resolution", label: "Resolution & rationale" },
    { key: "risk_rating", label: "Risk rating" },
    { key: "edd_status", label: "EDD status" },
    { key: "approved_by", label: "Senior approval" },
    { key: "controls", label: "Applied controls", description: "Enhanced monitoring, source-of-wealth checks, review cadence." },
  ] },
  { id: "rp_str_listing", name: "STR listing report", category: "regulatory", description: "Suspicious transaction reports filed in the period with FRC references and case linkage. Restricted to the MLRO function.", frequency: "monthly", format: "PDF", restrictedTo: ["mlro", "system_admin"], columns: [
    { key: "str_reference", label: "STR reference" },
    { key: "filed_at", label: "Filed" },
    { key: "case_id", label: "Case ID" },
    { key: "client_id", label: "Client ID" },
    { key: "client_name", label: "Client name" },
    { key: "trigger", label: "Triggering activity" },
    { key: "amount_involved", label: "Amount involved" },
    { key: "mlro", label: "Filing MLRO" },
    { key: "frc_ack", label: "FRC acknowledgement" },
    { key: "post_filing_action", label: "Post-filing action", description: "Account restriction, exit, or continued monitoring." },
  ] },
  { id: "rp_scenario_violations", name: "Scenario-wise violations report", category: "regulatory", description: "Alert volumes and dispositions per monitoring scenario (structuring, velocity, geo-mismatch, large redemption).", frequency: "monthly", format: "XLSX", restrictedTo: ["compliance", "mlro", "system_admin"], columns: [
    { key: "scenario", label: "Monitoring scenario" },
    { key: "rule_parameters", label: "Rule parameters", description: "Thresholds in force during the period, from Platform Settings." },
    { key: "alerts_raised", label: "Alerts raised" },
    { key: "alerts_cleared", label: "Cleared" },
    { key: "alerts_escalated", label: "Escalated to case" },
    { key: "strs_filed", label: "STRs filed" },
    { key: "false_positive_rate", label: "False-positive rate %" },
    { key: "top_clients", label: "Most-flagged clients" },
    { key: "avg_days_to_close", label: "Avg days to disposition" },
  ] },

  // ---- Processes ----
  { id: "rp_onboarding_tat", name: "Onboarding turnaround report", category: "processes", description: "Time from application to activation per pipeline stage — documents, screening, risk rating, approval.", frequency: "weekly", format: "XLSX", restrictedTo: ["compliance", "operations", "bd_officer", "system_admin", "ceo"], columns: [
    { key: "client_id", label: "Client ID" },
    { key: "channel", label: "Channel" },
    { key: "applied_at", label: "Applied" },
    { key: "docs_complete_at", label: "Documents complete" },
    { key: "screened_at", label: "Screened" },
    { key: "rated_at", label: "Risk rated" },
    { key: "approved_at", label: "Activation approved" },
    { key: "total_tat_days", label: "Total TAT (days)" },
    { key: "sla_breach", label: "SLA breach flag" },
  ] },
  { id: "rp_approval_tat", name: "Approval turnaround report", category: "processes", description: "Maker-checker queue performance — time from proposal to decision by approval kind and role.", frequency: "weekly", format: "XLSX", restrictedTo: ["operations", "head_of_finance", "compliance", "system_admin", "ceo"], columns: [
    { key: "approval_id", label: "Approval ID" },
    { key: "kind", label: "Kind" },
    { key: "proposed_by", label: "Proposed by" },
    { key: "proposed_at", label: "Proposed" },
    { key: "decided_by", label: "Decided by" },
    { key: "decided_at", label: "Decided" },
    { key: "tat_hours", label: "TAT (hours)" },
    { key: "outcome", label: "Outcome" },
  ] },

  // ---- Audit MIS ----
  { id: "rp_audit_mis", name: "Audit trail MIS", category: "audit_mis", description: "Audit-event volumes by category, actor and entity, with hash-chain integrity attestation for the period.", frequency: "monthly", format: "PDF", restrictedTo: ["compliance", "mlro", "system_admin", "ceo"], columns: [
    { key: "period", label: "Period" },
    { key: "category", label: "Event category" },
    { key: "event_count", label: "Event count" },
    { key: "actor", label: "Actor" },
    { key: "entity_type", label: "Entity type" },
    { key: "chain_status", label: "Chain integrity", description: "Result of the hash-chain re-walk at generation time." },
    { key: "first_event", label: "First event" },
    { key: "last_event", label: "Last event" },
  ] },
  { id: "rp_access_review", name: "User access review", category: "audit_mis", description: "Role-by-page access matrix, user list with last sign-in, and changes since the last recertification.", frequency: "quarterly", format: "XLSX", restrictedTo: ["system_admin", "compliance"], columns: [
    { key: "user_id", label: "User ID" },
    { key: "name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "status", label: "Status" },
    { key: "last_login", label: "Last sign-in" },
    { key: "pages_granted", label: "Pages granted" },
    { key: "changes_in_period", label: "Access changes in period" },
    { key: "recertified_by", label: "Recertified by" },
  ] },

  // ---- Miscellaneous ----
  { id: "rp_adhoc_extract", name: "Ad-hoc data extract", category: "miscellaneous", description: "On-demand extract builder output — choose the columns you need across clients, transactions and cases.", frequency: "on_demand", format: "CSV", restrictedTo: ["compliance", "operations", "head_of_finance", "system_admin"], columns: [
    { key: "client_id", label: "Client ID" },
    { key: "client_name", label: "Client name" },
    { key: "lifecycle", label: "Lifecycle status" },
    { key: "risk_rating", label: "Risk rating" },
    { key: "aum", label: "AUM" },
    { key: "tx_count", label: "Transaction count" },
    { key: "tx_value", label: "Transaction value" },
    { key: "open_cases", label: "Open cases" },
    { key: "open_complaints", label: "Open complaints" },
    { key: "wallet_status", label: "Wallet status" },
  ] },
];

// ---- Delegation of Authority — approval routing (Open Question 8) ----

/** Who may act as checker for each approval kind, banded by amount. A rule
 * with maxAmount null is the unbounded band. The Approvals page enforces
 * this: a role outside approverRoles can see the item but not decide it.
 * Seed values are indicative — real DoA limits are Open Question 8. */
export type ApprovalPolicyRule = {
  id: string;
  kind: ApprovalKind;
  label: string;
  currency?: "KES" | "USD";
  /** Upper bound of this band (inclusive); null = no upper bound. */
  maxAmount: number | null;
  approverRoles: AdminRole[];
  pendingApprovalId?: string;
  pendingSummary?: string;
};

export const APPROVAL_POLICIES: ApprovalPolicyRule[] = [
  { id: "pol_pay_kes_s", kind: "payment_release", label: "Payment release — KES up to 100,000", currency: "KES", maxAmount: 100_000, approverRoles: ["operations", "head_of_finance"] },
  { id: "pol_pay_kes_l", kind: "payment_release", label: "Payment release — KES above 100,000", currency: "KES", maxAmount: null, approverRoles: ["head_of_finance"] },
  { id: "pol_pay_usd", kind: "payment_release", label: "Payment release — USD (any amount)", currency: "USD", maxAmount: null, approverRoles: ["head_of_finance"] },
  { id: "pol_nav", kind: "nav_publication", label: "NAV publication", maxAmount: null, approverRoles: ["head_of_finance", "investment_committee"] },
  { id: "pol_static", kind: "static_data_change", label: "Static data / configuration change", maxAmount: null, approverRoles: ["operations", "compliance", "head_of_finance", "system_admin"] },
  { id: "pol_dist", kind: "distribution_batch", label: "Distribution batch", maxAmount: null, approverRoles: ["head_of_finance"] },
  { id: "pol_gate", kind: "liquidity_gate_extension", label: "Liquidity gate extension", maxAmount: null, approverRoles: ["head_of_finance", "investment_committee"] },
  { id: "pol_kyc", kind: "kyc_exception", label: "KYC / suitability exception", maxAmount: null, approverRoles: ["compliance"] },
  { id: "pol_activation", kind: "account_activation", label: "Account / wallet activation", maxAmount: null, approverRoles: ["compliance", "mlro"] },
  { id: "pol_closure", kind: "account_closure", label: "Customer-initiated account closure", maxAmount: null, approverRoles: ["compliance", "mlro"] },
  { id: "pol_edd", kind: "edd_signoff", label: "EDD sign-off", maxAmount: null, approverRoles: ["compliance", "mlro"] },
  { id: "pol_str", kind: "str_filing", label: "STR filing", maxAmount: null, approverRoles: ["mlro"] },
  { id: "pol_case_close", kind: "case_closure", label: "Compliance case closure", maxAmount: null, approverRoles: ["compliance", "mlro"] },
];

// ---- Tokenization whitelist — Phase 2 jurisdiction matrix ----

export type JurisdictionStatus = "open" | "planned" | "under_review" | "excluded";

export const JURISDICTION_STATUS_LABELS: Record<JurisdictionStatus, string> = {
  open: "Open",
  planned: "Planned",
  under_review: "Under review",
  excluded: "Excluded",
};

/** Concept note §6.3 — investor-segment priority for tokenized (Phase 2)
 * subscriptions. When the whitelist smart contract ships, this matrix IS its
 * policy, so it lives under BO governance from day one. */
export type Jurisdiction = {
  id: string;
  segment: string;
  priority: "highest" | "high" | "medium_high" | "medium" | "low" | "excluded";
  rationale: string;
  timing: string;
  status: JurisdictionStatus;
  kycTier: "standard" | "enhanced";
  pendingApprovalId?: string;
  pendingSummary?: string;
};

export const JURISDICTIONS: Jurisdiction[] = [
  { id: "jur_ke", segment: "Kenya (domestic)", priority: "highest", rationale: "Home market — live from Phase 1 via the traditional register.", timing: "Live (Phase 1)", status: "open", kycTier: "standard" },
  { id: "jur_diaspora", segment: "Kenyan Diaspora (global)", priority: "highest", rationale: "CBK and CMA actively support diaspora products; USD fund removes the FX barrier.", timing: "Phase 2 launch", status: "planned", kycTier: "standard" },
  { id: "jur_eac", segment: "East Africa Regional", priority: "high", rationale: "EAC capital-market harmonization; technically trivial with tokenization.", timing: "6–12 months post-Phase 2", status: "planned", kycTier: "standard" },
  { id: "jur_gulf", segment: "Gulf / UAE", priority: "medium_high", rationale: "Growing appetite for African sovereign debt; ADGM/DIFC pathway available.", timing: "12–18 months post-Phase 2", status: "under_review", kycTier: "enhanced" },
  { id: "jur_africa", segment: "Rest of Africa", priority: "medium", rationale: "Jurisdiction-by-jurisdiction securities-law review required.", timing: "18–24 months post-Phase 2", status: "under_review", kycTier: "enhanced" },
  { id: "jur_eu_uk", segment: "EU / UK", priority: "low", rationale: "AIFMD and MiFID II compliance complex and costly.", timing: "Long-term only", status: "excluded", kycTier: "enhanced" },
  { id: "jur_us", segment: "United States", priority: "excluded", rationale: "SEC jurisdiction; Reg S / Reg D structuring required — separate structure needed.", timing: "Not planned", status: "excluded", kycTier: "enhanced" },
];

// ---- Audit trail ----

export type AuditCategory = "config" | "security" | "approval" | "data" | "report" | "compliance";

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  config: "Configuration",
  security: "Security",
  approval: "Approval",
  data: "Data",
  report: "Report",
  compliance: "Compliance",
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  actorRole: string;
  category: AuditCategory;
  action: string;
  target: string;
  detail?: string;
  /** Entity linkage — lets the trail be filtered to one client/case/wallet. */
  entityType?: "client" | "case" | "alert" | "complaint" | "screening" | "wallet";
  entityId?: string;
  /** Tamper-evident chain: hash of (prevHash + event fields). Demo-grade —
   * a real backend would use an HMAC over an append-only store. */
  hash: string;
  prevHash: string;
};

let auditCounter = 100;

function chainHash(prev: string, e: { id: string; at: string; actor: string; action: string; target: string; entityType?: string; entityId?: string }): string {
  const s = `${prev}|${e.id}|${e.at}|${e.actor}|${e.action}|${e.target}|${e.entityType ?? ""}|${e.entityId ?? ""}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

const AUDIT_SEEDS: Omit<AuditEvent, "hash" | "prevHash">[] = [
  { id: "au_99", at: "2026-11-09T06:30:00Z", actor: "System (Fraud monitoring)", actorRole: "System", category: "compliance", action: "Raised alert", target: "PIN attempts then a new device: GN-171206", entityType: "alert", entityId: "fr_5" },
  { id: "au_98", at: "2026-11-08T08:05:00Z", actor: "Peter Otieno", actorRole: "Compliance analyst", category: "compliance", action: "Opened case", target: "One farmer cashed out repeatedly: agent AG-2041", entityType: "case", entityId: "cs_5" },
  { id: "au_97", at: "2026-11-08T08:00:00Z", actor: "Peter Otieno", actorRole: "Compliance analyst", category: "data", action: "Suspended agent float", target: "Kiprotich Agencies (AG-2041)" },
  { id: "au_96", at: "2026-11-07T11:30:00Z", actor: "Peter Otieno", actorRole: "Compliance analyst", category: "compliance", action: "Opened case", target: "Cash-outs split across agents: GN-163842", entityType: "case", entityId: "cs_1" },
  { id: "au_95", at: "2026-11-06T09:05:00Z", actor: "Daniel Kiptoo", actorRole: "Head of Finance", category: "approval", action: "Approved", target: "Payment run PR-2026-11-06: Litein, Momul, Kapkoros", detail: "18,240 farmers, KES 136.4M." },
  { id: "au_94", at: "2026-11-06T07:12:00Z", actor: "Grace Mumbi", actorRole: "Payments operations", category: "approval", action: "Proposed", target: "Payment run PR-2026-11-06", detail: "October green leaf payment from three factory files." },
  { id: "au_93", at: "2026-11-05T19:40:00Z", actor: "Kevin Baraka", actorRole: "Compliance manager", category: "compliance", action: "Held payment", target: "October bonus for GN-120955", detail: "Number changed two days before the bonus run." },
  { id: "au_92", at: "2026-11-05T13:00:00Z", actor: "Mercy Wanjala", actorRole: "Customer service", category: "data", action: "Acknowledged enquiry", target: "Payment notice went to my old number", detail: "GN-142078 via call centre." },
  { id: "au_91", at: "2026-11-04T11:40:00Z", actor: "Mercy Wanjala", actorRole: "Customer service", category: "config", action: "Updated voucher list", target: "Othaya Farm Inputs (M-10233)", detail: "Added NPK 23:23:0." },
  { id: "au_90", at: "2026-11-03T08:00:00Z", actor: "Faith Kamau", actorRole: "Farmer engagement officer", category: "data", action: "Sent campaign", target: "Fertiliser vouchers: where to redeem", detail: "6,412 farmers at Chinga, Gitugi and Ndima." },
  { id: "au_89", at: "2026-11-02T10:00:00Z", actor: "IT Admin", actorRole: "System Admin", category: "security", action: "Completed", target: "Monthly access review", detail: "All roles checked against the page-access list." },
  { id: "au_88", at: "2026-11-01T06:00:00Z", actor: "Daniel Kiptoo", actorRole: "Head of Finance", category: "report", action: "Generated", target: "October transactions summary", detail: "Payments, cash-outs, Pay to M-PESA and merchant sales." },
];

/** Seeds chained oldest→newest at module load — never hand-write hashes. */
export const AUDIT_EVENTS: AuditEvent[] = (() => {
  const chained: AuditEvent[] = [];
  let prev = "genesis";
  for (let i = AUDIT_SEEDS.length - 1; i >= 0; i--) {
    const hash = chainHash(prev, AUDIT_SEEDS[i]);
    chained.unshift({ ...AUDIT_SEEDS[i], hash, prevHash: prev });
    prev = hash;
  }
  return chained;
})();

export function logAudit(event: Omit<AuditEvent, "id" | "at" | "hash" | "prevHash">): AuditEvent {
  const prevHash = AUDIT_EVENTS[0]?.hash ?? "genesis";
  const base = { id: `au_${auditCounter++}`, at: new Date().toISOString(), ...event };
  const entry: AuditEvent = { ...base, prevHash, hash: chainHash(prevHash, base) };
  AUDIT_EVENTS.unshift(entry);
  return entry;
}

/** Re-walks the chain oldest→newest; any edited or removed event breaks it. */
export function verifyAuditChainSync(): { intact: boolean; length: number; brokenAtId?: string } {
  let prev = "genesis";
  for (let i = AUDIT_EVENTS.length - 1; i >= 0; i--) {
    const e = AUDIT_EVENTS[i];
    if (e.prevHash !== prev || e.hash !== chainHash(prev, e)) {
      return { intact: false, length: AUDIT_EVENTS.length, brokenAtId: e.id };
    }
    prev = e.hash;
  }
  return { intact: true, length: AUDIT_EVENTS.length };
}
