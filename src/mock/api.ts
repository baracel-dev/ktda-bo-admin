import { USE_MOCK, latency, NotImplementedError } from "./config";
import { SUB_FUNDS, BOND_LADDER, navHistory, navComposition, CENTRAL_BANK_RATE, type SubFundCode } from "./fixtures/fund";
import { TRANSACTIONS, REDEMPTION_TIERS } from "./fixtures/investor";
import { APPROVAL_QUEUE, CLIENTS, LEADS, AML_ALERTS, FRAUD_ALERTS, RECONCILIATION_BREAKS, UNALLOCATED_FUNDS, SYSTEM_USERS, ROLE_PAGE_ACCESS, ROLE_LABELS, ADMIN_USERS, type AdminRole, type SystemUser, type ApprovalItem, type ApprovalStatus, type Lead } from "./fixtures/admin";
import { CONTENT_BLOCKS } from "./fixtures/cms";
import { PLATFORM_SETTINGS, FEATURE_FLAGS, REPORTS, AUDIT_EVENTS, logAudit, PENDING_CHANGES, APPROVAL_POLICIES, JURISDICTIONS, JURISDICTION_STATUS_LABELS, verifyAuditChainSync, type PlatformSetting, type FeatureFlag, type ReportDef, type PendingChange, type ApprovalPolicyRule, type Jurisdiction, type JurisdictionStatus, type AuditEvent } from "./fixtures/platform";
import { dailyFlows, aumTrend, OPS_TODAY, INDICATIVE_USD_KES, type DailyFlow, type AumPoint } from "./fixtures/ops";
import { TOKEN_ISSUANCES, LIFECYCLE_EVENTS, SMART_CONTRACTS } from "./fixtures/tokenization";
import { MARKET_ABUSE_ALERTS, CONFLICT_DECLARATIONS, EMPLOYEE_TRADES } from "./fixtures/conduct";
import { INVESTMENT_PRODUCTS, INVESTMENT_ORDERS, PORTFOLIO_TRADES, HOLDINGS_BOOK, VALUATION_RUNS, REDEMPTION_REQUESTS, CORPORATE_ACTIONS, IC_APPROVAL_QUEUE, INVESTMENT_MANDATES } from "./fixtures/investment";
import { INSTITUTIONAL_CLIENTS, INSTITUTIONAL_MANDATES, MANDATE_RESTRICTIONS, SEGREGATED_PORTFOLIOS, FEE_SCHEDULES, INSTITUTIONAL_REPORTS, MANDATE_BREACHES, COUNTERPARTIES, INSTITUTIONAL_CLIENT_COMPLIANCE } from "./fixtures/institutional";
import { DEPARTMENTS, INTEGRATIONS, SYSTEM_JOBS, MAINTENANCE_TARGETS, type Integration, type SystemJob, type MaintenanceTarget } from "./fixtures/system";
import { COMPLIANCE_PROFILES, CLIENT_DOCUMENTS, UBO_RECORDS, SCREENING_RESULTS, WALLETS, TOKEN_HOLDINGS, COMPLIANCE_CASES, COMPLAINTS, DOCUMENT_TYPE_LABELS, RISK_FACTORS, type RiskFactorDef, type ClientComplianceProfile, type ClientDocument, type UboRecord, type ScreeningResult, type Wallet, type WalletRestriction, type ComplianceCase, type CaseType, type CaseStatus, type CaseNote, type CaseEvidence, type Complaint, type RiskRating, type ClientLifecycleStatus } from "./fixtures/compliance";
import { CLASSIFIER_TYPES, assignClassifier, classifierAsOf, classifierHistory, classifierType, eligibleForProduct, type ClassifierTypeId } from "./fixtures/classifiers";
import { INSTITUTION, INSTITUTION_ACCOUNTS, INSTITUTION_ACCOUNT_LABELS, PRODUCTS, SERVICE_PACKAGES, SERVICE_PACKAGE_ITEMS, TRANSACTION_TYPES, FEE_TYPES, TARIFF_TYPES, TARIFF_DOMAINS, TARIFF_VALUES, ACCOUNTING_SCHEMES, ACCOUNT_TEMPLATES, INVESTOR_CONTRACTS, CONTRACT_STATUS_LABELS, contractsForClient, productById, productCapacity, resolveTariff, tokenizationHooks, type Currency, type DayCountConvention, type Product, type TariffValue } from "./fixtures/catalogue";
import { CHART_OF_ACCOUNTS, CLOSE_RUNS, GL_ACCOUNTS, JOURNAL_ENTRIES, JOURNAL_EVENT_LABELS, UNIT_LEDGER, ACCRUAL_RUNS, CONTRACT_ACCRUALS, BUSINESS_RULES, availableBalance, balanceOf, chartAccount, isBalanced, reverseJournal, runAccrualBatch, runDayEndClose, unitBalance, type JournalStatus } from "./fixtures/ledger";
import { ENQUIRIES, ENQUIRY_CHANNEL_LABELS, ENQUIRY_CATEGORY_LABELS, ENQUIRY_STATUS_LABELS, ENQUIRY_ROUTING, INTERACTIONS, INTERACTION_TYPE_LABELS, CRM_TASKS, TASK_SOURCE_LABELS, CAMPAIGNS, LEAD_CAMPAIGNS, OPPORTUNITIES, OPPORTUNITY_STAGE_LABELS, BID_CRITERIA, SEGMENT_LABELS, SEGMENT_SERVICE_MODEL, SEGMENT_ASSIGNMENTS, SERVICE_REVIEWS, acknowledgementSla, assignCoverage, assignSegment, bdKpis, bidScore, coverageAsOf, coverageGaps, coverageHistory, interactionsFor, leadWithCampaign, ownerName, segmentAsOf, segmentHistory, visibleInteraction, type Enquiry, type Interaction, type InteractionSubject, type InteractionType, type CrmTask, type CommercialSegment, type BidCriterion, type OpportunityStage } from "./fixtures/crm";

/** Every function here is the seam for wiring a real backend: swap the
 * body's mock branch for a `fetch(...)` call against that app's own
 * backend service once it exists, one function at a time. */

// ---- shared / fund state ----
export async function getSubFunds() {
  if (!USE_MOCK) throw new NotImplementedError("getSubFunds");
  await latency();
  return SUB_FUNDS;
}

export async function getBondLadder(subFund?: SubFundCode) {
  if (!USE_MOCK) throw new NotImplementedError("getBondLadder");
  await latency();
  return subFund ? BOND_LADDER.filter((b) => b.subFund === subFund) : BOND_LADDER;
}

export async function getNavHistory(subFund: SubFundCode, days = 90) {
  if (!USE_MOCK) throw new NotImplementedError("getNavHistory");
  await latency();
  return navHistory(subFund, days);
}

/** NAV built from its parts — positions, cash, accrued income, accrued
 * expenses — rather than read as a stored figure. Backs BO Admin's NAV review. */
export async function getNavComposition(subFund: SubFundCode) {
  if (!USE_MOCK) throw new NotImplementedError("getNavComposition");
  await latency();
  return navComposition(subFund);
}

export type FeeAccrual = {
  subFund: SubFundCode;
  currency: "KES" | "USD";
  annualRate: number;
  /** Today's accrual: AUM × rate ÷ 365. */
  dailyAccrual: number;
  /** Accrued and not yet settled — already deducted from the AUM pricing NAV. */
  accruedToDate: number;
  /** Effect of the accrued fee on NAV per unit. */
  navImpactPerUnit: number;
};

/** The management fee reduces NAV rather than debiting anyone's principal, so
 * this is the only place an investor "pays" it. Surfacing it keeps that
 * visible and auditable instead of implicit in the unit price. */
export async function getFeeAccrual(subFund: SubFundCode): Promise<FeeAccrual> {
  if (!USE_MOCK) throw new NotImplementedError("getFeeAccrual");
  await latency();
  const fund = SUB_FUNDS.find((f) => f.code === subFund)!;
  const comp = navComposition(subFund);
  const annualRate = settingNumber("management_fee_pct", 1) / 100;
  return {
    subFund,
    currency: fund.currency,
    annualRate,
    dailyAccrual: Number(((comp.totalAum * annualRate) / 365).toFixed(2)),
    accruedToDate: fund.accruedFees,
    navImpactPerUnit: Number((fund.accruedFees / fund.unitsOutstanding).toFixed(6)),
  };
}

export type WithholdingPolicy = {
  subFund: SubFundCode;
  settingKey: string;
  label: string;
  /** Rate as a fraction, e.g. 0.15. */
  rate: number;
  /** True while the treatment is still pending Tax confirmation
   * (Open Question 7). A confirmed 0% and an unconfirmed rate are different
   * states and must not be displayed the same way. */
  unconfirmed: boolean;
};

export async function getWithholdingPolicy(subFund: SubFundCode): Promise<WithholdingPolicy> {
  if (!USE_MOCK) throw new NotImplementedError("getWithholdingPolicy");
  await latency();
  const fund = SUB_FUNDS.find((f) => f.code === subFund)!;
  const setting = PLATFORM_SETTINGS.find((s) => s.key === fund.whtSettingKey);
  return {
    subFund,
    settingKey: fund.whtSettingKey,
    label: setting?.label ?? fund.whtSettingKey,
    rate: settingNumber(fund.whtSettingKey, 0) / 100,
    // Both rates are flagged pending in their own setting description; neither
    // has been signed off by Investcent Tax.
    unconfirmed: true,
  };
}

export type FacilityState = {
  subFund: SubFundCode;
  currency: "KES" | "USD";
  facilitySize: number;
  drawn: number;
  headroom: number;
  /** Concept note §5.1 — CBR + a 1.5–2.0% margin. */
  interestRate: number;
  interestAccrued: number;
  /** The facility must be at least 5% of AUM (scaling covenant). */
  covenantMinimum: number;
  covenantBreached: boolean;
  /** Share of AUM one dealing day's redemptions may reach before the gate. */
  gateThresholdValue: number;
};

export async function getFacilityState(subFund: SubFundCode): Promise<FacilityState> {
  if (!USE_MOCK) throw new NotImplementedError("getFacilityState");
  await latency();
  const fund = SUB_FUNDS.find((f) => f.code === subFund)!;
  const covenantMinimum = fund.aum * (settingNumber("liquidity_facility_floor", 5) / 100);
  return {
    subFund,
    currency: fund.currency,
    facilitySize: fund.liquidityFacility,
    drawn: fund.liquidityUsed,
    headroom: fund.liquidityFacility - fund.liquidityUsed,
    interestRate: CENTRAL_BANK_RATE + facilityMargin(),
    interestAccrued: fund.facilityInterestAccrued,
    covenantMinimum,
    covenantBreached: fund.liquidityFacility < covenantMinimum,
    gateThresholdValue: fund.aum * (settingNumber("gate_threshold_pct", 10) / 100),
  };
}

export async function getTransactions() {
  if (!USE_MOCK) throw new NotImplementedError("getTransactions");
  await latency();
  return [...TRANSACTIONS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/** Reads a numeric platform setting. BO Admin is the point of truth for these,
 * so nothing downstream should hardcode the value. Falls back only if the key
 * is missing or unparseable, which would be a seeding bug. */
function settingNumber(key: string, fallback: number): number {
  const raw = PLATFORM_SETTINGS.find((s) => s.key === key)?.value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `facility_pricing` is stored for humans as "CBR + 1.75", so the margin is
 * pulled out of it rather than kept as a second, drift-prone setting. */
function facilityMargin(): number {
  const raw = PLATFORM_SETTINGS.find((s) => s.key === "facility_pricing")?.value ?? "";
  const parsed = Number(/[\d.]+/.exec(raw)?.[0]);
  return (Number.isFinite(parsed) ? parsed : 1.75) / 100;
}

// ---- BO admin ----
export async function getApprovalQueue() {
  if (!USE_MOCK) throw new NotImplementedError("getApprovalQueue");
  await latency();
  return APPROVAL_QUEUE;
}

export async function decideApproval(id: string, status: ApprovalStatus, decidedBy: string): Promise<ApprovalItem> {
  if (!USE_MOCK) throw new NotImplementedError("decideApproval");
  await latency(400, 900);
  const item = APPROVAL_QUEUE.find((a) => a.id === id);
  if (!item) throw new Error("not found");
  item.status = status;
  item.decidedBy = decidedBy;
  item.decidedAt = new Date().toISOString();
  // Configuration changes (settings, tiers, approval routing, jurisdictions)
  // stage a closure in the pending-change registry — apply on approval,
  // discard on rejection, clear the "pending" marker either way.
  const pending = PENDING_CHANGES.get(id);
  if (pending) {
    if (status === "approved") pending.apply(decidedBy);
    pending.clear();
    PENDING_CHANGES.delete(id);
    logAudit({ actor: decidedBy, actorRole: "Checker", category: "approval", action: status === "approved" ? "Approved" : "Rejected", target: pending.label });
  }
  return item;
}

export async function getClients() {
  if (!USE_MOCK) throw new NotImplementedError("getClients");
  await latency();
  return CLIENTS;
}

/** Sends the application back for document re-capture. Activation is NOT a
 * direct action any more — it goes through submitActivation's maker-checker
 * approval, per the "no activation without Compliance approval" control. */
export async function decideKycApplication(clientId: string, decision: "recapture", actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("decideKycApplication");
  await latency(400, 900);
  const client = CLIENTS.find((c) => c.id === clientId);
  if (!client) throw new Error("not found");
  if (client.kycStatus !== "pending_review") throw new Error("Application is no longer pending review");
  client.kycStatus = "in_progress";
  logAudit({
    actor, actorRole: "Compliance", category: "compliance",
    action: "Sent back for re-capture", target: `${client.name} (${client.id})`,
    entityType: "client", entityId: clientId,
  });
  return { client, decision };
}

export async function getLeads() {
  if (!USE_MOCK) throw new NotImplementedError("getLeads");
  await latency();
  return LEADS;
}

/** The fraud desk's queue. A separate board from AML — same record shape and
 * the same alert → case workflow, different indicators and different reviewers
 * (Fraud Reporting; AML typologies stay on `getAmlAlerts`). */
export async function getFraudAlerts() {
  if (!USE_MOCK) throw new NotImplementedError("getFraudAlerts");
  await latency();
  return FRAUD_ALERTS;
}

export async function getAmlAlerts() {
  if (!USE_MOCK) throw new NotImplementedError("getAmlAlerts");
  await latency();
  return AML_ALERTS;
}

export async function getReconciliationBreaks() {
  if (!USE_MOCK) throw new NotImplementedError("getReconciliationBreaks");
  await latency();
  return RECONCILIATION_BREAKS;
}

export async function getUnallocatedFunds() {
  if (!USE_MOCK) throw new NotImplementedError("getUnallocatedFunds");
  await latency();
  return UNALLOCATED_FUNDS;
}

export async function matchUnallocatedFund(id: string) {
  if (!USE_MOCK) throw new NotImplementedError("matchUnallocatedFund");
  await latency(400, 900);
  const fund = UNALLOCATED_FUNDS.find((f) => f.id === id);
  if (!fund) throw new Error("not found");
  fund.status = "matched";
  return fund;
}

export async function resolveReconciliationBreak(id: string) {
  if (!USE_MOCK) throw new NotImplementedError("resolveReconciliationBreak");
  await latency(400, 900);
  const brk = RECONCILIATION_BREAKS.find((b) => b.id === id);
  if (!brk) throw new Error("not found");
  brk.status = "resolved";
  return brk;
}

export async function getSystemUsers() {
  if (!USE_MOCK) throw new NotImplementedError("getSystemUsers");
  await latency();
  return SYSTEM_USERS;
}

// ---- CMS ----
export async function getContentBlocks() {
  if (!USE_MOCK) throw new NotImplementedError("getContentBlocks");
  await latency();
  return CONTENT_BLOCKS;
}

// ---- platform configuration (BO Admin is the point of truth) ----

export async function getPlatformSettings(): Promise<PlatformSetting[]> {
  if (!USE_MOCK) throw new NotImplementedError("getPlatformSettings");
  await latency();
  return PLATFORM_SETTINGS;
}

let configApprovalCounter = 100;

/** Raises a static_data_change approval carrying a staged change closure —
 * nothing applies until a second person approves it in the queue. */
function raiseConfigApproval(title: string, detail: string, proposedBy: string, pending: PendingChange): ApprovalItem {
  const approval: ApprovalItem = {
    id: `ap_cfg_${configApprovalCounter++}`,
    kind: "static_data_change",
    title,
    detail,
    proposedBy,
    proposedAt: new Date().toISOString(),
    status: "pending",
  };
  APPROVAL_QUEUE.unshift(approval);
  PENDING_CHANGES.set(approval.id, pending);
  logAudit({ actor: proposedBy, actorRole: "Maker", category: "config", action: "Proposed change", target: pending.label });
  return approval;
}

export async function proposeSettingChange(key: string, newValue: string, proposedBy: string, reason: string): Promise<PlatformSetting> {
  if (!USE_MOCK) throw new NotImplementedError("proposeSettingChange");
  await latency(400, 900);
  const setting = PLATFORM_SETTINGS.find((s) => s.key === key);
  if (!setting) throw new Error("not found");
  if (setting.pendingApprovalId) throw new Error("A change to this setting is already awaiting approval");
  const unit = setting.unit ? ` ${setting.unit}` : "";
  const approval = raiseConfigApproval(
    `${setting.label}: ${setting.value} → ${newValue}`,
    `${reason} Current value ${setting.value}${unit}, proposed ${newValue}${unit}. Raised from Platform Settings.`,
    proposedBy,
    {
      label: `Setting change — ${setting.label}`,
      apply: (decidedBy) => {
        setting.value = newValue;
        setting.updatedAt = new Date().toISOString();
        setting.updatedBy = decidedBy;
      },
      clear: () => {
        setting.pendingValue = undefined;
        setting.pendingApprovalId = undefined;
      },
    },
  );
  setting.pendingValue = newValue;
  setting.pendingApprovalId = approval.id;
  return setting;
}

/** All tiers, both currencies — the BO configuration view. */
export async function getRedemptionTierConfig() {
  if (!USE_MOCK) throw new NotImplementedError("getRedemptionTierConfig");
  await latency();
  return REDEMPTION_TIERS;
}

export async function proposeTierChange(id: string, settlementDays: number, proposedBy: string, reason: string) {
  if (!USE_MOCK) throw new NotImplementedError("proposeTierChange");
  await latency(400, 900);
  const tier = REDEMPTION_TIERS.find((t) => t.id === id);
  if (!tier) throw new Error("not found");
  if (tier.pendingApprovalId) throw new Error("A change to this tier is already awaiting approval");
  const approval = raiseConfigApproval(
    `Redemption tier — ${tier.label}: ${tier.settlementDays} → ${settlementDays} settlement days`,
    `${reason} Investor apps quote settlement timing from this schedule (${tier.currency}).`,
    proposedBy,
    {
      label: `Redemption tier — ${tier.label}`,
      apply: () => { tier.settlementDays = settlementDays; },
      clear: () => {
        tier.pendingApprovalId = undefined;
        tier.pendingSummary = undefined;
      },
    },
  );
  tier.pendingApprovalId = approval.id;
  tier.pendingSummary = `${settlementDays} days`;
  return tier;
}

export async function getApprovalPolicies(): Promise<ApprovalPolicyRule[]> {
  if (!USE_MOCK) throw new NotImplementedError("getApprovalPolicies");
  await latency();
  return APPROVAL_POLICIES;
}

/** DoA lookup: which roles may approve this item. Falls back to "any role
 * with Approvals access" when no rule matches (permissive default). */
export function approverRolesFor(item: Pick<ApprovalItem, "kind" | "amount" | "currency">): AdminRole[] | null {
  const rules = APPROVAL_POLICIES.filter((r) => r.kind === item.kind)
    .filter((r) => !r.currency || !item.currency || r.currency === item.currency)
    .sort((a, b) => (a.maxAmount ?? Infinity) - (b.maxAmount ?? Infinity));
  const match = rules.find((r) => r.maxAmount === null || (item.amount ?? 0) <= r.maxAmount);
  return match ? match.approverRoles : null;
}

export async function proposeApprovalRouteChange(id: string, approverRoles: AdminRole[], proposedBy: string, reason: string) {
  if (!USE_MOCK) throw new NotImplementedError("proposeApprovalRouteChange");
  await latency(400, 900);
  const rule = APPROVAL_POLICIES.find((r) => r.id === id);
  if (!rule) throw new Error("not found");
  if (rule.pendingApprovalId) throw new Error("A change to this routing rule is already awaiting approval");
  if (approverRoles.length === 0) throw new Error("At least one approver role is required");
  const roleNames = (roles: AdminRole[]) => roles.map((r) => ROLE_LABELS[r]).join(", ");
  const approval = raiseConfigApproval(
    `Approval routing — ${rule.label}`,
    `${reason} Approvers change from [${roleNames(rule.approverRoles)}] to [${roleNames(approverRoles)}]. Delegation-of-Authority control.`,
    proposedBy,
    {
      label: `Approval routing — ${rule.label}`,
      apply: () => { rule.approverRoles = approverRoles; },
      clear: () => {
        rule.pendingApprovalId = undefined;
        rule.pendingSummary = undefined;
      },
    },
  );
  rule.pendingApprovalId = approval.id;
  rule.pendingSummary = roleNames(approverRoles);
  return rule;
}

export async function getJurisdictions(): Promise<Jurisdiction[]> {
  if (!USE_MOCK) throw new NotImplementedError("getJurisdictions");
  await latency();
  return JURISDICTIONS;
}

export async function proposeJurisdictionStatus(id: string, status: JurisdictionStatus, proposedBy: string, reason: string) {
  if (!USE_MOCK) throw new NotImplementedError("proposeJurisdictionStatus");
  await latency(400, 900);
  const jur = JURISDICTIONS.find((j) => j.id === id);
  if (!jur) throw new Error("not found");
  if (jur.pendingApprovalId) throw new Error("A change to this jurisdiction is already awaiting approval");
  const approval = raiseConfigApproval(
    `Tokenization whitelist — ${jur.segment}: ${JURISDICTION_STATUS_LABELS[jur.status]} → ${JURISDICTION_STATUS_LABELS[status]}`,
    `${reason} Phase 2 whitelist policy — this matrix becomes the on-chain eligibility contract, so changes carry compliance weight.`,
    proposedBy,
    {
      label: `Tokenization whitelist — ${jur.segment}`,
      apply: () => { jur.status = status; },
      clear: () => {
        jur.pendingApprovalId = undefined;
        jur.pendingSummary = undefined;
      },
    },
  );
  jur.pendingApprovalId = approval.id;
  jur.pendingSummary = JURISDICTION_STATUS_LABELS[status];
  return jur;
}

export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  if (!USE_MOCK) throw new NotImplementedError("getFeatureFlags");
  await latency();
  return FEATURE_FLAGS;
}

export async function setFeatureFlag(key: string, enabled: boolean, actor: string): Promise<FeatureFlag> {
  if (!USE_MOCK) throw new NotImplementedError("setFeatureFlag");
  await latency(200, 500);
  const flag = FEATURE_FLAGS.find((f) => f.key === key);
  if (!flag) throw new Error("not found");
  flag.enabled = enabled;
  flag.updatedAt = new Date().toISOString();
  flag.updatedBy = actor;
  logAudit({ actor, actorRole: "System Admin", category: "config", action: enabled ? "Flag enabled" : "Flag disabled", target: flag.label });
  return flag;
}

export async function getReports(role: AdminRole): Promise<ReportDef[]> {
  if (!USE_MOCK) throw new NotImplementedError("getReports");
  await latency();
  return REPORTS.filter((r) => r.restrictedTo.includes(role));
}

export async function generateReport(id: string, actor: string, columnKeys?: string[]): Promise<ReportDef> {
  if (!USE_MOCK) throw new NotImplementedError("generateReport");
  await latency(900, 1800);
  const report = REPORTS.find((r) => r.id === id);
  if (!report) throw new Error("not found");
  const valid = new Set(report.columns.map((c) => c.key));
  const chosen = columnKeys?.filter((k) => valid.has(k));
  if (chosen && chosen.length === 0) throw new Error("Select at least one column");
  const columnCount = chosen ? chosen.length : report.columns.length;
  report.lastRun = { at: new Date().toISOString(), by: actor, sizeKb: Math.round(20 + Math.random() * 400), columnCount };
  logAudit({ actor, actorRole: "Report runner", category: "report", action: "Generated", target: report.name, detail: `${columnCount}/${report.columns.length} columns.` });
  return report;
}

// ---- BO Admin dashboard metrics ----

/** Daily subscription / redemption flow, KES-equivalent across both sub-funds.
 * Generated history (see fixtures/ops.ts) — the fixtures carry current state,
 * not a time series. */
export async function getFundFlows(days = 30): Promise<DailyFlow[]> {
  if (!USE_MOCK) throw new NotImplementedError("getFundFlows");
  await latency();
  return dailyFlows(days);
}

/** AUM by sub-fund over the last N months, ending on each sub-fund's current
 * AUM so the curve and the stat tile can never disagree. */
export async function getAumTrend(months = 12): Promise<AumPoint[]> {
  if (!USE_MOCK) throw new NotImplementedError("getAumTrend");
  await latency();
  return aumTrend(months);
}

export type CouponMonth = {
  month: string;
  /** Coupon cash expected that month, per sub-fund currency. */
  kes: number;
  usd: number;
  bonds: string[];
};

/** The next twelve months of coupon receipts, derived from the ladder itself —
 * face value x coupon rate / 2 on each scheduled date, rolled forward
 * semi-annually. The staggered ladder's whole purpose is an inflow every
 * month, so this is the chart that shows whether it actually does. */
export async function getCouponCalendar(months = 12): Promise<CouponMonth[]> {
  if (!USE_MOCK) throw new NotImplementedError("getCouponCalendar");
  await latency();

  const out: CouponMonth[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(OPS_TODAY);
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    out.push({ month: d.toLocaleDateString("en-GB", { month: "short" }), kes: 0, usd: 0, bonds: [] });
  }
  const startKey = (dt: Date) => dt.getFullYear() * 12 + dt.getMonth();
  const base = startKey(new Date(OPS_TODAY.getFullYear(), OPS_TODAY.getMonth(), 1));

  for (const bond of BOND_LADDER) {
    const halfCoupon = (bond.faceValue * bond.couponRate) / 2;
    const currency = SUB_FUNDS.find((f) => f.code === bond.subFund)?.currency ?? "KES";
    const maturity = new Date(bond.maturity);
    for (const dateStr of bond.couponDates) {
      // Each listed date recurs every six months until the bond matures, so a
      // twelve-month window is covered by rolling each date forward.
      const first = new Date(dateStr);
      for (let step = 0; step < months; step++) {
        const at = new Date(first);
        at.setMonth(at.getMonth() + step * 6);
        if (at > maturity) break;
        const slot = startKey(at) - base;
        if (slot < 0 || slot >= months) continue;
        if (currency === "USD") out[slot].usd += halfCoupon;
        else out[slot].kes += halfCoupon;
        if (!out[slot].bonds.includes(bond.name)) out[slot].bonds.push(bond.name);
      }
    }
  }
  return out.map((m) => ({ ...m, kes: Math.round(m.kes), usd: Math.round(m.usd) }));
}

export type OpsSnapshot = {
  /** Client files by lifecycle status — the onboarding funnel, live. */
  lifecycle: { status: ClientLifecycleStatus; count: number }[];
  riskMix: { rating: RiskRating; count: number }[];
  cases: { status: CaseStatus; count: number }[];
  alerts: { severity: "low" | "medium" | "high"; count: number }[];
  /** Pending approvals bucketed by how long they have been waiting. Age is the
   * control that matters here: a queue of five is fine, a queue of five where
   * the oldest is nine days old is not. */
  approvalAgeing: { bucket: string; count: number }[];
  oldestApprovalDays: number;
  /** New client files per month, from `joinedAt` on the client records. */
  newClientsByMonth: { month: string; count: number }[];
  openBreaks: number;
  /** KES-equivalent: the register holds both currencies, and summing the raw
   * amounts across them would report a number that means nothing. */
  unallocatedValueKes: number;
  unallocatedCount: number;
  unresolvedScreeningMatches: number;
};

/** One read for the dashboard's derived counts. Deliberately a single call: six
 * separate round-trips for six tiles is how a dashboard ends up with panels
 * that disagree with each other mid-refresh.
 *
 * Scoped to the caller's role, the same way `getComplianceCases` is. Hiding a
 * panel client-side is not access control — a role that cannot open Cases must
 * not receive the case counts either, or the API is the leak the router was
 * built to prevent. */
export async function getOpsSnapshot(role: AdminRole): Promise<OpsSnapshot> {
  if (!USE_MOCK) throw new NotImplementedError("getOpsSnapshot");
  await latency();

  const pages = ROLE_PAGE_ACCESS[role] ?? [];
  const may = (path: string) => pages.includes(path);

  const countBy = <T extends string>(values: T[]): { key: T; count: number }[] => {
    const map = new Map<T, number>();
    for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
    return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };

  const now = OPS_TODAY.getTime();
  const dayMs = 86_400_000;
  const pending = APPROVAL_QUEUE.filter((a) => a.status === "pending");
  const ages = pending.map((a) => Math.max(0, Math.floor((now - new Date(a.proposedAt).getTime()) / dayMs)));

  // Sorted on the real date, not on fixture order — the label alone ("Mar")
  // cannot be sorted, and an out-of-order month axis reads as noise.
  const monthCounts = new Map<string, { month: string; count: number }>();
  for (const c of CLIENTS) {
    const at = new Date(c.joinedAt);
    const key = `${at.getFullYear()}-${String(at.getMonth()).padStart(2, "0")}`;
    const row = monthCounts.get(key) ?? { month: at.toLocaleDateString("en-GB", { month: "short" }), count: 0 };
    row.count += 1;
    monthCounts.set(key, row);
  }
  const newClientsByMonth = [...monthCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row)
    .slice(-6);

  const kycPages = may("/kyc-queue") || may("/kyc-periodic") || may("/kyc-dynamic") || may("/clients");

  return {
    lifecycle: kycPages
      ? countBy(COMPLIANCE_PROFILES.map((p) => p.lifecycleStatus)).map((r) => ({ status: r.key, count: r.count }))
      : [],
    riskMix: kycPages
      ? countBy(COMPLIANCE_PROFILES.map((p) => p.riskRating).filter((r): r is RiskRating => !!r))
        .map((r) => ({ rating: r.key, count: r.count }))
      : [],
    cases: may("/cases")
      ? countBy(COMPLIANCE_CASES.map((c) => c.status)).map((r) => ({ status: r.key, count: r.count }))
      : [],
    alerts: may("/aml-alerts")
      ? countBy(AML_ALERTS.filter((a) => a.status === "open" || a.status === "under_review").map((a) => a.severity))
        .map((r) => ({ severity: r.key, count: r.count }))
      : [],
    approvalAgeing: !may("/approvals") ? [] : [
      // Compact by design: these are axis labels on a narrow panel, and
      // "3–7 days" clips to "3–7 da…" at the width the card actually gets.
      { bucket: "Today", count: ages.filter((d) => d < 1).length },
      { bucket: "1–2d", count: ages.filter((d) => d >= 1 && d < 3).length },
      { bucket: "3–7d", count: ages.filter((d) => d >= 3 && d < 8).length },
      { bucket: "8+d", count: ages.filter((d) => d >= 8).length },
    ],
    oldestApprovalDays: may("/approvals") && ages.length ? Math.max(...ages) : 0,
    newClientsByMonth: may("/clients") ? newClientsByMonth : [],
    openBreaks: may("/reconciliation") ? RECONCILIATION_BREAKS.filter((b) => b.status !== "resolved").length : 0,
    unallocatedValueKes: may("/unallocated-funds")
      ? UNALLOCATED_FUNDS.filter((u) => u.status !== "matched").reduce(
        (sum, u) => sum + (u.currency === "USD" ? u.amount * INDICATIVE_USD_KES : u.amount),
        0,
      )
      : 0,
    unallocatedCount: may("/unallocated-funds") ? UNALLOCATED_FUNDS.filter((u) => u.status !== "matched").length : 0,
    unresolvedScreeningMatches: may("/screening")
      ? SCREENING_RESULTS.filter(
        (r) => (r.sanctions !== "clear" || r.pep !== "clear" || r.adverseMedia !== "clear") && !r.resolution,
      ).length
      : 0,
  };
}

export async function getAuditLog() {
  if (!USE_MOCK) throw new NotImplementedError("getAuditLog");
  await latency();
  return AUDIT_EVENTS;
}

/** The page-level RBAC matrix the router enforces. */
export async function getRolePermissionMatrix(): Promise<{ roles: AdminRole[]; access: Record<AdminRole, string[]> }> {
  if (!USE_MOCK) throw new NotImplementedError("getRolePermissionMatrix");
  await latency();
  return { roles: Object.keys(ROLE_PAGE_ACCESS) as AdminRole[], access: ROLE_PAGE_ACCESS };
}

/** Grant or revoke a page for a role — live RBAC edit, System Admin only.
 * Guards: every role keeps "/", and system_admin can never lose "/users"
 * or "/audit-log" (the recovery surfaces), so admins can't lock themselves out. */
export async function setRolePageAccess(role: AdminRole, path: string, granted: boolean, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("setRolePageAccess");
  await latency(250, 600);
  if (path === "/") throw new Error("The Dashboard page is always accessible");
  if (role === "system_admin" && !granted && (path === "/users" || path === "/audit-log")) {
    throw new Error("System Admin cannot lose access to Users & roles or the Audit log");
  }
  const allowed = ROLE_PAGE_ACCESS[role];
  const has = allowed.includes(path);
  if (granted && !has) allowed.push(path);
  if (!granted && has) ROLE_PAGE_ACCESS[role] = allowed.filter((p) => p !== path);
  logAudit({
    actor, actorRole: "System Admin", category: "security",
    action: granted ? "Granted page access" : "Revoked page access",
    target: `${ROLE_LABELS[role]} — ${path}`,
  });
  return { roles: Object.keys(ROLE_PAGE_ACCESS) as AdminRole[], access: ROLE_PAGE_ACCESS };
}

// ---- compliance & KYC lifecycle ----

const complianceAudit = (actor: string, actorRole: string, action: string, target: string, entityType: AuditEvent["entityType"], entityId: string, detail?: string) =>
  logAudit({ actor, actorRole, category: "compliance", action, target, entityType, entityId, detail });

export async function getComplianceProfiles(): Promise<ClientComplianceProfile[]> {
  if (!USE_MOCK) throw new NotImplementedError("getComplianceProfiles");
  await latency();
  return COMPLIANCE_PROFILES;
}

export async function getScreeningResults(): Promise<ScreeningResult[]> {
  if (!USE_MOCK) throw new NotImplementedError("getScreeningResults");
  await latency();
  return [...SCREENING_RESULTS].sort((a, b) => +new Date(b.runAt) - +new Date(a.runAt));
}

/** Client 360 — everything the compliance file links to one customer. */
export async function getClientComplianceDetail(clientId: string) {
  if (!USE_MOCK) throw new NotImplementedError("getClientComplianceDetail");
  await latency();
  const client = CLIENTS.find((c) => c.id === clientId);
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId);
  if (!client || !profile) throw new Error("not found");
  const wallet = WALLETS.find((w) => w.clientId === clientId) ?? null;
  const relatedIds = new Set<string>([clientId]);
  if (wallet) relatedIds.add(wallet.id);
  COMPLIANCE_CASES.filter((c) => c.clientId === clientId).forEach((c) => relatedIds.add(c.id));
  return {
    client,
    profile,
    documents: CLIENT_DOCUMENTS.filter((d) => d.clientId === clientId),
    ubos: UBO_RECORDS.filter((u) => u.clientId === clientId),
    screenings: SCREENING_RESULTS.filter((s) => s.clientId === clientId).sort((a, b) => +new Date(b.runAt) - +new Date(a.runAt)),
    cases: COMPLIANCE_CASES.filter((c) => c.clientId === clientId),
    alerts: [...AML_ALERTS, ...FRAUD_ALERTS].filter((a) => a.clientId === clientId),
    wallet,
    holdings: wallet ? TOKEN_HOLDINGS.filter((t) => t.walletId === wallet.id) : [],
    auditEvents: AUDIT_EVENTS.filter((e) => e.entityId && relatedIds.has(e.entityId)),
  };
}

export async function setDocumentStatus(docId: string, status: ClientDocument["status"], actor: string, note?: string): Promise<ClientDocument> {
  if (!USE_MOCK) throw new NotImplementedError("setDocumentStatus");
  await latency(250, 600);
  const doc = CLIENT_DOCUMENTS.find((d) => d.id === docId);
  if (!doc) throw new Error("not found");
  doc.status = status;
  doc.reviewedAt = new Date().toISOString();
  doc.reviewedBy = actor;
  if (note) doc.note = note;
  complianceAudit(actor, "Compliance", `Document ${status}`, DOCUMENT_TYPE_LABELS[doc.type], "client", doc.clientId, note);
  return doc;
}

export async function setUboStatus(uboId: string, status: UboRecord["status"], actor: string): Promise<UboRecord> {
  if (!USE_MOCK) throw new NotImplementedError("setUboStatus");
  await latency(250, 600);
  const ubo = UBO_RECORDS.find((u) => u.id === uboId);
  if (!ubo) throw new Error("not found");
  ubo.status = status;
  if (status === "verified") {
    ubo.verifiedAt = new Date().toISOString();
    ubo.verifiedBy = actor;
  }
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === ubo.clientId);
  if (profile) profile.uboVerified = UBO_RECORDS.filter((u) => u.clientId === ubo.clientId).every((u) => u.status === "verified");
  complianceAudit(actor, "Compliance", `UBO ${status}`, `${ubo.name} (${ubo.relationship})`, "client", ubo.clientId);
  return ubo;
}

export async function setRiskRating(clientId: string, rating: RiskRating, factors: string[], actor: string): Promise<ClientComplianceProfile> {
  if (!USE_MOCK) throw new NotImplementedError("setRiskRating");
  await latency(300, 700);
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId);
  if (!profile) throw new Error("not found");
  const previous = profile.riskRating;
  profile.riskRating = rating;
  profile.riskFactors = factors;
  const eddTrigger = PLATFORM_SETTINGS.find((s) => s.key === "edd_trigger_rating")?.value ?? "high";
  profile.eddRequired = rating === eddTrigger;
  if (profile.eddRequired && !profile.eddCompletedAt && profile.lifecycleStatus !== "active") profile.lifecycleStatus = "edd_required";
  // The rating on the profile is the *current* value; the dated window is the
  // history. Writing both is what closes the gap the proposal (§4.6) flags —
  // on the live system the risk-history table is empty and the real history
  // survives only in classifier assignments, so "what was their tier on date
  // X" has no answer without knowing to look elsewhere. Here there is one
  // writer and one place to read it back.
  assignClassifier(clientId, "risk_tier", rating, actor, factors.join("; ") || undefined);
  complianceAudit(actor, "Compliance", "Risk rating assigned", `${rating.toUpperCase()}${previous ? ` (was ${previous})` : ""}`, "client", clientId, factors.join("; ") || undefined);
  return profile;
}

let screeningCounter = 100;

export async function runScreening(clientId: string, trigger: ScreeningResult["trigger"], actor: string): Promise<ScreeningResult> {
  if (!USE_MOCK) throw new NotImplementedError("runScreening");
  await latency(900, 1800);
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId);
  if (!profile) throw new Error("not found");
  // Deterministic mock outcome: PEP-flagged profiles hit a potential match,
  // everyone else screens clear — repeatable for demos.
  const result: ScreeningResult = {
    id: `scr_${screeningCounter++}`,
    clientId,
    runAt: new Date().toISOString(),
    runBy: actor,
    trigger,
    sanctions: "clear",
    pep: profile.pepFlag ? "potential_match" : "clear",
    adverseMedia: "clear",
    matchDetail: profile.pepFlag ? "PEP register similarity — manual resolution required." : undefined,
  };
  SCREENING_RESULTS.unshift(result);
  profile.lastScreenedAt = result.runAt;
  // Screening is daily for every customer — the next run is always tomorrow.
  const due = new Date(result.runAt);
  due.setDate(due.getDate() + 1);
  profile.nextScreeningDue = due.toISOString().slice(0, 10);
  complianceAudit(actor, "Compliance", "Screening run", `${trigger} — sanctions ${result.sanctions}, PEP ${result.pep}`, "screening", result.id, `Client ${clientId}`);
  return result;
}

/** End-of-day batch: re-screens every customer on the register at once —
 * the manual trigger for the nightly 05:00 job. */
export async function runEodScreening(actor: string): Promise<{ screened: number; matches: number }> {
  if (!USE_MOCK) throw new NotImplementedError("runEodScreening");
  await latency(1200, 2200);
  let matches = 0;
  const now = new Date();
  const due = new Date(now);
  due.setDate(due.getDate() + 1);
  for (const profile of COMPLIANCE_PROFILES) {
    const result: ScreeningResult = {
      id: `scr_${screeningCounter++}`,
      clientId: profile.clientId,
      runAt: now.toISOString(),
      runBy: `${actor} (EOD batch)`,
      trigger: "periodic",
      sanctions: "clear",
      pep: profile.pepFlag ? "potential_match" : "clear",
      adverseMedia: "clear",
      matchDetail: profile.pepFlag ? "PEP register similarity — manual resolution required." : undefined,
    };
    if (result.pep !== "clear") matches++;
    SCREENING_RESULTS.unshift(result);
    profile.lastScreenedAt = result.runAt;
    profile.nextScreeningDue = due.toISOString().slice(0, 10);
  }
  logAudit({ actor, actorRole: "Compliance", category: "compliance", action: "End-of-day screening run", target: `${COMPLIANCE_PROFILES.length} customers screened, ${matches} matches` });
  return { screened: COMPLIANCE_PROFILES.length, matches };
}

export async function resolveScreeningMatch(screeningId: string, outcome: NonNullable<ScreeningResult["resolution"]>["outcome"], note: string, actor: string): Promise<ScreeningResult> {
  if (!USE_MOCK) throw new NotImplementedError("resolveScreeningMatch");
  await latency(300, 700);
  const result = SCREENING_RESULTS.find((s) => s.id === screeningId);
  if (!result) throw new Error("not found");
  result.resolution = { outcome, note, by: actor, at: new Date().toISOString() };
  complianceAudit(actor, "Compliance", "Screening match resolved", outcome.replace(/_/g, " "), "screening", result.id, note);
  return result;
}

/** THE key technology control: nothing activates until the whole pipeline is
 * complete — and even then only via a Compliance-approved maker-checker item. */
export function activationBlockers(clientId: string): string[] {
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId);
  if (!profile) return ["No compliance profile"];
  const blockers: string[] = [];
  const docs = CLIENT_DOCUMENTS.filter((d) => d.clientId === clientId);
  if (docs.length === 0 || docs.some((d) => d.status !== "verified")) blockers.push("All submitted documents must be verified");
  // UBO verification applies to entity clients only — individuals carry no
  // UBO records and skip this check.
  const ubos = UBO_RECORDS.filter((u) => u.clientId === clientId);
  if (ubos.length > 0 && !ubos.every((u) => u.status === "verified")) blockers.push("UBO verification incomplete");
  const latest = SCREENING_RESULTS.filter((s) => s.clientId === clientId).sort((a, b) => +new Date(b.runAt) - +new Date(a.runAt))[0];
  if (!latest) blockers.push("No screening on record");
  else if ((latest.sanctions !== "clear" || latest.pep !== "clear" || latest.adverseMedia !== "clear") && !latest.resolution) blockers.push("Unresolved screening match");
  if (!profile.riskRating) blockers.push("Risk rating not assigned");
  if (profile.eddRequired && !profile.eddCompletedAt) blockers.push("EDD sign-off outstanding");
  if (profile.activationApprovalId) blockers.push("Activation already awaiting approval");
  if (profile.lifecycleStatus === "active") blockers.push("Already active");
  return blockers;
}

export async function submitActivation(clientId: string, actor: string): Promise<ApprovalItem> {
  if (!USE_MOCK) throw new NotImplementedError("submitActivation");
  await latency(400, 900);
  const blockers = activationBlockers(clientId);
  if (blockers.length > 0) throw new Error(`Not eligible: ${blockers[0]}`);
  const client = CLIENTS.find((c) => c.id === clientId)!;
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId)!;
  const wallet = WALLETS.find((w) => w.clientId === clientId);
  const approval: ApprovalItem = {
    id: `ap_act_${clientId}`,
    kind: "account_activation",
    title: `Activate account & wallet — ${client.name}`,
    detail: `KYC pipeline complete: documents verified, UBO verified, screening clear/resolved, risk rating ${profile.riskRating?.toUpperCase()}${profile.eddRequired ? ", EDD signed off" : ""}. Approval activates the account and wallet together.`,
    proposedBy: actor,
    proposedAt: new Date().toISOString(),
    status: "pending",
    entityRef: { entityType: "client", entityId: clientId },
  };
  APPROVAL_QUEUE.unshift(approval);
  profile.activationApprovalId = approval.id;
  profile.lifecycleStatus = "pending_activation";
  PENDING_CHANGES.set(approval.id, {
    label: `Account activation — ${client.name}`,
    apply: (decidedBy) => {
      profile.lifecycleStatus = "active";
      client.kycStatus = "verified";
      if (wallet) {
        wallet.status = "active";
        wallet.activatedAt = new Date().toISOString();
        wallet.restrictions = [];
        wallet.statusReason = undefined;
      }
      complianceAudit(decidedBy, "Compliance", "Account & wallet activated", client.name, "client", clientId);
    },
    clear: () => {
      profile.activationApprovalId = undefined;
      if (profile.lifecycleStatus === "pending_activation") profile.lifecycleStatus = "screening";
    },
  });
  complianceAudit(actor, "Compliance", "Activation submitted for approval", client.name, "client", clientId);
  return approval;
}

export async function completeEdd(clientId: string, actor: string, note: string): Promise<ApprovalItem> {
  if (!USE_MOCK) throw new NotImplementedError("completeEdd");
  await latency(400, 900);
  const client = CLIENTS.find((c) => c.id === clientId);
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId);
  if (!client || !profile) throw new Error("not found");
  if (!profile.eddRequired) throw new Error("EDD is not required for this client");
  if (profile.eddCompletedAt) throw new Error("EDD is already signed off");
  const approval: ApprovalItem = {
    id: `ap_edd_${clientId}`,
    kind: "edd_signoff",
    title: `EDD sign-off — ${client.name}`,
    detail: `${note} Risk rating ${profile.riskRating?.toUpperCase()}; factors: ${profile.riskFactors.join("; ") || "—"}.`,
    proposedBy: actor,
    proposedAt: new Date().toISOString(),
    status: "pending",
    entityRef: { entityType: "client", entityId: clientId },
  };
  APPROVAL_QUEUE.unshift(approval);
  PENDING_CHANGES.set(approval.id, {
    label: `EDD sign-off — ${client.name}`,
    apply: (decidedBy) => {
      profile.eddCompletedAt = new Date().toISOString();
      if (profile.lifecycleStatus === "edd_required") profile.lifecycleStatus = "screening";
      complianceAudit(decidedBy, "Compliance", "EDD signed off", client.name, "client", clientId);
    },
    clear: () => undefined,
  });
  complianceAudit(actor, "Compliance", "EDD submitted for sign-off", client.name, "client", clientId, note);
  return approval;
}

/** Periodic KYC review completed — restamps the refresh cycle from the
 * configured cadence. */
export async function markKycRefreshed(clientId: string, actor: string, note?: string) {
  if (!USE_MOCK) throw new NotImplementedError("markKycRefreshed");
  await latency(400, 900);
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId);
  const client = CLIENTS.find((c) => c.id === clientId);
  if (!profile || !client) throw new Error("not found");
  const months = Number(PLATFORM_SETTINGS.find((s) => s.key === "kyc_refresh_cadence")?.value ?? 24);
  const now = new Date();
  profile.lastKycRefreshAt = now.toISOString();
  const due = new Date(now);
  due.setMonth(due.getMonth() + (Number.isFinite(months) ? months : 24));
  profile.nextKycRefreshDue = due.toISOString().slice(0, 10);
  complianceAudit(actor, "Compliance", "Periodic KYC review completed", client.name, "client", clientId, note);
  return profile;
}

/** Suspend / reactivate the customer account — distinct from a wallet
 * freeze: suspension halts the whole relationship, not just the wallet. */
export async function setClientSuspended(clientId: string, suspended: boolean, actor: string, reason: string) {
  if (!USE_MOCK) throw new NotImplementedError("setClientSuspended");
  await latency(300, 700);
  const profile = COMPLIANCE_PROFILES.find((p) => p.clientId === clientId);
  const client = CLIENTS.find((c) => c.id === clientId);
  if (!profile || !client) throw new Error("not found");
  if (suspended && profile.lifecycleStatus !== "active") throw new Error("Only active accounts can be suspended");
  if (!suspended && profile.lifecycleStatus !== "suspended") throw new Error("Account is not suspended");
  profile.lifecycleStatus = suspended ? "suspended" : "active";
  complianceAudit(actor, "Compliance", suspended ? "Account suspended" : "Account reactivated", client.name, "client", clientId, reason);
  return profile;
}

// ---- risk-factor catalogue (BO-managed) ----

let riskFactorCounter = 100;

export async function getRiskFactors(): Promise<RiskFactorDef[]> {
  if (!USE_MOCK) throw new NotImplementedError("getRiskFactors");
  await latency();
  return RISK_FACTORS;
}

export async function addRiskFactor(label: string, description: string, actor: string): Promise<RiskFactorDef> {
  if (!USE_MOCK) throw new NotImplementedError("addRiskFactor");
  await latency(300, 700);
  const trimmed = label.trim();
  if (!trimmed) throw new Error("A label is required");
  if (RISK_FACTORS.some((f) => f.label.toLowerCase() === trimmed.toLowerCase())) throw new Error("That factor already exists");
  const factor: RiskFactorDef = { id: `rf_${riskFactorCounter++}`, label: trimmed, description: description.trim(), enabled: true };
  RISK_FACTORS.push(factor);
  logAudit({ actor, actorRole: "Compliance", category: "compliance", action: "Risk factor added", target: factor.label });
  return factor;
}

export async function setRiskFactorEnabled(id: string, enabled: boolean, actor: string): Promise<RiskFactorDef> {
  if (!USE_MOCK) throw new NotImplementedError("setRiskFactorEnabled");
  await latency(250, 600);
  const factor = RISK_FACTORS.find((f) => f.id === id);
  if (!factor) throw new Error("not found");
  factor.enabled = enabled;
  logAudit({ actor, actorRole: "Compliance", category: "compliance", action: enabled ? "Risk factor enabled" : "Risk factor disabled", target: factor.label });
  return factor;
}

// ---- wallets ----

export async function setWalletStatus(walletId: string, status: "active" | "frozen", actor: string, reason: string): Promise<Wallet> {
  if (!USE_MOCK) throw new NotImplementedError("setWalletStatus");
  await latency(300, 700);
  const wallet = WALLETS.find((w) => w.id === walletId);
  if (!wallet) throw new Error("not found");
  if (wallet.status === "pending_activation") throw new Error("Wallet has never been activated — use the activation flow");
  wallet.status = status;
  wallet.statusReason = status === "frozen" ? reason : undefined;
  complianceAudit(actor, "Compliance", status === "frozen" ? "Wallet frozen" : "Wallet unfrozen", wallet.id, "wallet", wallet.id, reason);
  return wallet;
}

export async function setWalletRestrictions(walletId: string, restrictions: WalletRestriction[], actor: string): Promise<Wallet> {
  if (!USE_MOCK) throw new NotImplementedError("setWalletRestrictions");
  await latency(300, 700);
  const wallet = WALLETS.find((w) => w.id === walletId);
  if (!wallet) throw new Error("not found");
  wallet.restrictions = restrictions;
  complianceAudit(actor, "Compliance", "Wallet restrictions updated", restrictions.join(", ") || "none", "wallet", wallet.id);
  return wallet;
}

// ---- case management (AML / fraud / ABC / SAR) ----

/** SAR visibility: a case is restricted once it is a SAR or escalated to the
 * MLRO — only Compliance and the MLRO may see it, enforced here (seam-side)
 * so no RBAC-matrix edit can expose it. */
function caseRestricted(c: ComplianceCase): boolean {
  return c.type === "sar" || c.status === "escalated_mlro";
}

function canSeeCase(c: ComplianceCase, role: AdminRole): boolean {
  return !caseRestricted(c) || role === "compliance" || role === "mlro";
}

export async function getComplianceCases(role: AdminRole): Promise<ComplianceCase[]> {
  if (!USE_MOCK) throw new NotImplementedError("getComplianceCases");
  await latency();
  return COMPLIANCE_CASES.filter((c) => canSeeCase(c, role));
}

export async function getComplianceCase(id: string, role: AdminRole): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("getComplianceCase");
  await latency();
  const c = COMPLIANCE_CASES.find((x) => x.id === id);
  if (!c) throw new Error("not found");
  if (!canSeeCase(c, role)) throw new Error("restricted");
  return c;
}

let caseCounter = 7;
let caseNoteCounter = 100;
let caseEvidenceCounter = 100;

export async function createCase(input: { type: CaseType; clientId?: string; clientName: string; title: string; summary: string; severity: ComplianceCase["severity"] }, actor: string, actorRole: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("createCase");
  await latency(400, 900);
  const created: ComplianceCase = {
    id: `cs_${caseCounter++}`,
    ...input,
    linkedAlertIds: [],
    status: "open",
    openedAt: new Date().toISOString(),
    openedBy: actor,
    notes: [],
    evidence: [],
  };
  COMPLIANCE_CASES.unshift(created);
  complianceAudit(actor, actorRole, "Case opened", created.title, "case", created.id);
  return created;
}

export async function openCaseFromAlert(alertId: string, actor: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("openCaseFromAlert");
  await latency(400, 900);
  const alert = [...AML_ALERTS, ...FRAUD_ALERTS].find((a) => a.id === alertId);
  if (!alert) throw new Error("not found");
  if (alert.caseId) throw new Error("A case already exists for this alert");
  const created: ComplianceCase = {
    id: `cs_${caseCounter++}`,
    // The board the alert came from decides the case type — a fraud alert must
    // not open an AML case, or the case listing and the STR path both lie.
    type: alert.kind === "fraud" ? "fraud" : "aml",
    title: `${alert.rule} — ${alert.clientName}`,
    summary: alert.detail,
    clientId: alert.clientId,
    clientName: alert.clientName,
    linkedAlertIds: [alert.id],
    severity: alert.severity,
    status: "open",
    assignee: actor,
    openedAt: new Date().toISOString(),
    openedBy: actor,
    notes: [{ id: `cn_${caseNoteCounter++}`, at: new Date().toISOString(), by: actor, byRole: "Compliance", text: `Case opened from alert ${alert.id}.`, kind: "note" }],
    evidence: [{ id: `ce_${caseEvidenceCounter++}`, label: `Alert ${alert.id} — ${alert.rule}`, type: "external", ref: alert.id, addedAt: new Date().toISOString(), addedBy: actor }],
  };
  COMPLIANCE_CASES.unshift(created);
  alert.status = "under_review";
  alert.assignee = actor;
  alert.caseId = created.id;
  complianceAudit(actor, "Compliance", "Case opened from alert", created.title, "case", created.id, `Alert ${alert.id}`);
  return created;
}

export async function assignAmlAlert(alertId: string, assignee: string, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("assignAmlAlert");
  await latency(250, 600);
  const alert = [...AML_ALERTS, ...FRAUD_ALERTS].find((a) => a.id === alertId);
  if (!alert) throw new Error("not found");
  alert.assignee = assignee;
  complianceAudit(actor, "Compliance", "Alert assigned", `${alert.rule} — ${alert.clientName}`, "alert", alert.id, `Assignee: ${assignee}`);
  return alert;
}

export async function addCaseNote(caseId: string, text: string, kind: CaseNote["kind"], actor: string, actorRole: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("addCaseNote");
  await latency(250, 600);
  const c = COMPLIANCE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("not found");
  c.notes.push({ id: `cn_${caseNoteCounter++}`, at: new Date().toISOString(), by: actor, byRole: actorRole, text, kind });
  complianceAudit(actor, actorRole, "Case note added", c.title, "case", c.id);
  return c;
}

export async function addCaseEvidence(caseId: string, evidence: Omit<CaseEvidence, "id" | "addedAt" | "addedBy">, actor: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("addCaseEvidence");
  await latency(250, 600);
  const c = COMPLIANCE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("not found");
  c.evidence.push({ ...evidence, id: `ce_${caseEvidenceCounter++}`, addedAt: new Date().toISOString(), addedBy: actor });
  complianceAudit(actor, "Compliance", "Evidence added", `${evidence.label} → ${c.title}`, "case", c.id);
  return c;
}

export async function assignCase(caseId: string, assignee: string, actor: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("assignCase");
  await latency(250, 600);
  const c = COMPLIANCE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("not found");
  c.assignee = assignee;
  complianceAudit(actor, "Compliance", "Case assigned", c.title, "case", c.id, `Assignee: ${assignee}`);
  return c;
}

export async function setCaseStatus(caseId: string, status: CaseStatus, actor: string, actorRole: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("setCaseStatus");
  await latency(250, 600);
  const c = COMPLIANCE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("not found");
  c.status = status;
  c.notes.push({ id: `cn_${caseNoteCounter++}`, at: new Date().toISOString(), by: actor, byRole: actorRole, text: `Status changed to ${status.replace(/_/g, " ")}.`, kind: "status_change" });
  complianceAudit(actor, actorRole, "Case status changed", `${c.title} → ${status.replace(/_/g, " ")}`, "case", c.id);
  return c;
}

export async function escalateToMlro(caseId: string, actor: string, note: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("escalateToMlro");
  await latency(400, 900);
  const c = COMPLIANCE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("not found");
  if (c.status === "escalated_mlro") throw new Error("Already with the MLRO");
  c.status = "escalated_mlro";
  c.assignee = ADMIN_USERS.mlro.name;
  c.sar = { escalatedAt: new Date().toISOString(), escalatedBy: actor };
  c.notes.push({ id: `cn_${caseNoteCounter++}`, at: new Date().toISOString(), by: actor, byRole: "Compliance", text: note, kind: "escalation" });
  complianceAudit(actor, "Compliance", "Escalated to MLRO", c.title, "case", c.id, note);
  return c;
}

let strCounter = 41;

export async function recordMlroDecision(caseId: string, decision: "file_str" | "no_filing", actor: string, note: string): Promise<ComplianceCase> {
  if (!USE_MOCK) throw new NotImplementedError("recordMlroDecision");
  await latency(400, 900);
  const c = COMPLIANCE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("not found");
  if (!c.sar) throw new Error("Case has not been escalated to the MLRO");
  if (c.sar.mlroDecision) throw new Error("MLRO decision already recorded");
  c.notes.push({ id: `cn_${caseNoteCounter++}`, at: new Date().toISOString(), by: actor, byRole: "MLRO", text: note, kind: "decision" });
  if (decision === "no_filing") {
    c.sar.mlroDecision = "no_filing";
    c.sar.decidedAt = new Date().toISOString();
    c.status = "closed_cleared";
    c.closedAt = c.sar.decidedAt;
    c.closedBy = actor;
    c.closeRationale = note;
    complianceAudit(actor, "MLRO", "MLRO decision — no STR filing", c.title, "case", c.id, note);
    return c;
  }
  // Filing an STR is itself maker-checker gated (str_filing → MLRO-only DoA).
  const approval: ApprovalItem = {
    id: `ap_str_${c.id}`,
    kind: "str_filing",
    title: `File STR — ${c.title}`,
    detail: `${note} Filing generates the STR reference and closes the case as reported. Restricted to the MLRO function.`,
    proposedBy: actor,
    proposedAt: new Date().toISOString(),
    status: "pending",
    entityRef: { entityType: "case", entityId: c.id },
  };
  APPROVAL_QUEUE.unshift(approval);
  c.status = "pending_approval";
  c.sar.approvalId = approval.id;
  PENDING_CHANGES.set(approval.id, {
    label: `STR filing — ${c.title}`,
    apply: (decidedBy) => {
      const ref = `STR-2026-${String(strCounter++).padStart(3, "0")}`;
      c.sar!.mlroDecision = "file_str";
      c.sar!.strReference = ref;
      c.sar!.decidedAt = new Date().toISOString();
      c.status = "closed_reported";
      c.closedAt = c.sar!.decidedAt;
      c.closedBy = decidedBy;
      c.closeRationale = `STR filed (${ref}).`;
      complianceAudit(decidedBy, "MLRO", "STR filed", `${c.title} (${ref})`, "case", c.id);
    },
    clear: () => {
      c.sar!.approvalId = undefined;
      if (c.status === "pending_approval") c.status = "escalated_mlro";
    },
  });
  complianceAudit(actor, "MLRO", "STR filing submitted", c.title, "case", c.id);
  return c;
}

export async function closeCase(caseId: string, rationale: string, actor: string, actorRole: string): Promise<ApprovalItem> {
  if (!USE_MOCK) throw new NotImplementedError("closeCase");
  await latency(400, 900);
  const c = COMPLIANCE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("not found");
  if (c.status === "closed_cleared" || c.status === "closed_reported") throw new Error("Case is already closed");
  const approval: ApprovalItem = {
    id: `ap_close_${c.id}`,
    kind: "case_closure",
    title: `Close case — ${c.title}`,
    detail: `${rationale} Closure requires a second pair of eyes per the maker-checker control.`,
    proposedBy: actor,
    proposedAt: new Date().toISOString(),
    status: "pending",
    entityRef: { entityType: "case", entityId: c.id },
  };
  APPROVAL_QUEUE.unshift(approval);
  const previousStatus = c.status;
  c.status = "pending_approval";
  PENDING_CHANGES.set(approval.id, {
    label: `Case closure — ${c.title}`,
    apply: (decidedBy) => {
      c.status = "closed_cleared";
      c.closedAt = new Date().toISOString();
      c.closedBy = decidedBy;
      c.closeRationale = rationale;
      complianceAudit(decidedBy, "Compliance", "Case closed", c.title, "case", c.id, rationale);
    },
    clear: () => {
      if (c.status === "pending_approval") c.status = previousStatus;
    },
  });
  complianceAudit(actor, actorRole, "Case closure submitted", c.title, "case", c.id, rationale);
  return approval;
}

export async function getComplaints(): Promise<Complaint[]> {
  if (!USE_MOCK) throw new NotImplementedError("getComplaints");
  await latency();
  return COMPLAINTS;
}

export async function updateComplaint(id: string, patch: { status?: Complaint["status"]; assignee?: string; resolution?: string; note?: string }, actor: string): Promise<Complaint> {
  if (!USE_MOCK) throw new NotImplementedError("updateComplaint");
  await latency(300, 700);
  const complaint = COMPLAINTS.find((c) => c.id === id);
  if (!complaint) throw new Error("not found");
  const now = new Date().toISOString();
  if (patch.assignee && patch.assignee !== complaint.assignee) {
    complaint.assignee = patch.assignee;
    complaint.history.push({ at: now, by: actor, action: `Assigned to ${patch.assignee}` });
  }
  if (patch.status && patch.status !== complaint.status) {
    complaint.status = patch.status;
    if (patch.status === "acknowledged" && !complaint.acknowledgedAt) complaint.acknowledgedAt = now;
    if (patch.status === "resolved") complaint.resolvedAt = now;
    complaint.history.push({ at: now, by: actor, action: `Status → ${patch.status}`, note: patch.note });
  } else if (patch.note) {
    complaint.history.push({ at: now, by: actor, action: "Note added", note: patch.note });
  }
  if (patch.resolution) complaint.resolution = patch.resolution;
  complianceAudit(actor, "Client Services", "Complaint updated", complaint.subject, "complaint", complaint.id, patch.status ? `Status ${patch.status}` : patch.note);
  return complaint;
}

export async function verifyAuditChain(): Promise<{ intact: boolean; length: number; brokenAtId?: string }> {
  if (!USE_MOCK) throw new NotImplementedError("verifyAuditChain");
  await latency(200, 500);
  return verifyAuditChainSync();
}

// ---- system management ----

export async function getDepartments() {
  if (!USE_MOCK) throw new NotImplementedError("getDepartments");
  await latency();
  return DEPARTMENTS;
}

export async function getIntegrations(): Promise<Integration[]> {
  if (!USE_MOCK) throw new NotImplementedError("getIntegrations");
  await latency();
  return INTEGRATIONS;
}

export async function setIntegrationEnvironment(id: string, environment: "sandbox" | "production", actor: string): Promise<Integration> {
  if (!USE_MOCK) throw new NotImplementedError("setIntegrationEnvironment");
  await latency(300, 700);
  const integration = INTEGRATIONS.find((i) => i.id === id);
  if (!integration) throw new Error("not found");
  integration.environment = environment;
  integration.lastCheckedAt = new Date().toISOString();
  logAudit({ actor, actorRole: "System Admin", category: "config", action: `Switched to ${environment}`, target: integration.name });
  return integration;
}

export async function getSystemJobs(): Promise<SystemJob[]> {
  if (!USE_MOCK) throw new NotImplementedError("getSystemJobs");
  await latency();
  return SYSTEM_JOBS;
}

export async function setSystemJobEnabled(id: string, enabled: boolean, actor: string): Promise<SystemJob> {
  if (!USE_MOCK) throw new NotImplementedError("setSystemJobEnabled");
  await latency(250, 600);
  const job = SYSTEM_JOBS.find((j) => j.id === id);
  if (!job) throw new Error("not found");
  job.enabled = enabled;
  logAudit({ actor, actorRole: "System Admin", category: "config", action: enabled ? "Job enabled" : "Job disabled", target: job.name });
  return job;
}

export async function runSystemJob(id: string, actor: string): Promise<SystemJob> {
  if (!USE_MOCK) throw new NotImplementedError("runSystemJob");
  await latency(900, 1800);
  const job = SYSTEM_JOBS.find((j) => j.id === id);
  if (!job) throw new Error("not found");
  if (!job.enabled) throw new Error("Enable the job before running it");
  job.lastRun = { at: new Date().toISOString(), status: "success", detail: `Manual run by ${actor}.` };
  logAudit({ actor, actorRole: "System Admin", category: "data", action: "Ran job", target: job.name });
  return job;
}

export async function getMaintenanceTargets(): Promise<MaintenanceTarget[]> {
  if (!USE_MOCK) throw new NotImplementedError("getMaintenanceTargets");
  await latency();
  return MAINTENANCE_TARGETS;
}

export async function setMaintenanceMode(id: string, maintenance: boolean, actor: string): Promise<MaintenanceTarget> {
  if (!USE_MOCK) throw new NotImplementedError("setMaintenanceMode");
  await latency(250, 600);
  const target = MAINTENANCE_TARGETS.find((t) => t.id === id);
  if (!target) throw new Error("not found");
  target.maintenance = maintenance;
  logAudit({ actor, actorRole: "System Admin", category: "config", action: maintenance ? "Maintenance mode ON" : "Maintenance mode OFF", target: target.app });
  return target;
}

let userCounter = 9;

export async function inviteSystemUser(input: { name: string; email: string; role: AdminRole }, invitedBy: string): Promise<SystemUser> {
  if (!USE_MOCK) throw new NotImplementedError("inviteSystemUser");
  await latency(400, 900);
  const user: SystemUser = { id: `u_${userCounter++}`, name: input.name, email: input.email, role: input.role, status: "invited", lastLogin: "" };
  SYSTEM_USERS.push(user);
  logAudit({ actor: invitedBy, actorRole: "System Admin", category: "security", action: "Invited user", target: `${input.name} (${ROLE_LABELS[input.role]})` });
  return user;
}

export async function setSystemUserStatus(id: string, status: "active" | "suspended", actor: string): Promise<SystemUser> {
  if (!USE_MOCK) throw new NotImplementedError("setSystemUserStatus");
  await latency(300, 700);
  const user = SYSTEM_USERS.find((u) => u.id === id);
  if (!user) throw new Error("not found");
  user.status = status;
  logAudit({ actor, actorRole: "System Admin", category: "security", action: status === "suspended" ? "Suspended user" : "Reactivated user", target: user.name });
  return user;
}

export async function updateSystemUserRole(id: string, role: AdminRole, actor: string): Promise<SystemUser> {
  if (!USE_MOCK) throw new NotImplementedError("updateSystemUserRole");
  await latency(300, 700);
  const user = SYSTEM_USERS.find((u) => u.id === id);
  if (!user) throw new Error("not found");
  const previous = user.role;
  user.role = role;
  logAudit({ actor, actorRole: "System Admin", category: "security", action: "Changed role", target: user.name, detail: `${ROLE_LABELS[previous]} → ${ROLE_LABELS[role]}` });
  return user;
}

export async function getInstitutionAccounts() {
  if (!USE_MOCK) throw new NotImplementedError("getInstitutionAccounts");
  await latency();
  return INSTITUTION_ACCOUNTS.map((ia) => ({
    ...ia,
    label: INSTITUTION_ACCOUNT_LABELS[ia.purpose],
    glAccountId: GL_ACCOUNTS.find((g) => g.institutionAccountId === ia.id)?.id ?? null,
    balance: balanceOf(GL_ACCOUNTS.find((g) => g.institutionAccountId === ia.id)?.id ?? ""),
  }));
}

export type ProductRow = Product & {
  packageName: string;
  schemeName: string;
  /** Resolved through the tariff chain, not read off the product — the point
   * of the domain indirection is that this can differ per product without a
   * code change. */
  managementFeePct: number | null;
  couponRatePct: number | null;
  dayCount: DayCountConvention | null;
  contractCount: number;
  capacity: ReturnType<typeof productCapacity>;
};

export async function getProducts(): Promise<ProductRow[]> {
  if (!USE_MOCK) throw new NotImplementedError("getProducts");
  await latency();
  return PRODUCTS.map((p) => {
    const pkg = SERVICE_PACKAGES.find((s) => s.id === p.servicePackageId)!;
    const ctx = {
      productDomainId: p.tariffDomainId,
      packageDomainId: pkg.tariffDomainId,
      institutionDomainId: INSTITUTION.defaultTariffDomainId,
    };
    const mgmt = resolveTariff("TT-MGMT-FEE", ctx, p.currency);
    const coupon = resolveTariff("TT-COUPON", ctx, p.currency);
    return {
      ...p,
      packageName: pkg.name,
      schemeName: ACCOUNTING_SCHEMES.find((s) => s.id === p.accountingSchemeId)!.name,
      managementFeePct: mgmt?.value ?? null,
      couponRatePct: coupon?.value ?? null,
      dayCount: coupon?.dayCount ?? null,
      contractCount: INVESTOR_CONTRACTS.filter((c) => c.productId === p.id).length,
      capacity: productCapacity(p.id),
    };
  });
}

export async function getServicePackages() {
  if (!USE_MOCK) throw new NotImplementedError("getServicePackages");
  await latency();
  return SERVICE_PACKAGES.map((pkg) => ({
    ...pkg,
    items: SERVICE_PACKAGE_ITEMS.filter((i) => i.packageId === pkg.id).map((i) => ({
      ...i,
      transactionTypeLabel: TRANSACTION_TYPES.find((t) => t.id === i.transactionTypeId)?.label ?? null,
      feeTypeLabel: FEE_TYPES.find((f) => f.id === i.feeTypeId)?.label ?? null,
      tariff: TARIFF_VALUES.find((v) => v.id === i.tariffId) ?? null,
    })),
  }));
}

export async function getTariffs() {
  if (!USE_MOCK) throw new NotImplementedError("getTariffs");
  await latency();
  const today = new Date().toISOString().slice(0, 10);
  return TARIFF_VALUES.map((v) => ({
    ...v,
    typeRole: TARIFF_TYPES.find((t) => t.id === v.tariffTypeId)!.role,
    domainName: TARIFF_DOMAINS.find((d) => d.id === v.domainId)!.name,
    domainScope: TARIFF_DOMAINS.find((d) => d.id === v.domainId)!.scope,
    /** Three real states, not two: live now, approved but not yet in force,
     * or staged and still unapproved. A UI that only showed "active" would
     * hide the whole reason effective-dating exists. */
    state: !v.approved
      ? ("awaiting_approval" as const)
      : v.effectiveFrom > today
        ? ("scheduled" as const)
        : v.effectiveTo !== null && v.effectiveTo <= today
          ? ("expired" as const)
          : ("in_force" as const),
  }));
}

export async function getAccountTemplates() {
  if (!USE_MOCK) throw new NotImplementedError("getAccountTemplates");
  await latency();
  return ACCOUNT_TEMPLATES.map((t) => ({
    ...t,
    accountName: chartAccount(t.code).name,
    instantiated: t.scope === "per_contract"
      ? INVESTOR_CONTRACTS.length
      : GL_ACCOUNTS.filter((g) => g.role === t.role).length,
  }));
}

/** Stages a rate change behind maker-checker rather than editing the number.
 * The new value lands as its own effective-dated row on approval — the
 * outgoing one is closed off, never overwritten, so the old rate stays
 * answerable for the period it applied to. */
export async function proposeTariffChange(
  tariffTypeId: string, domainId: string, currency: Currency,
  value: number, effectiveFrom: string, proposedBy: string, reason: string,
) {
  if (!USE_MOCK) throw new NotImplementedError("proposeTariffChange");
  await latency(400, 900);
  const type = TARIFF_TYPES.find((t) => t.id === tariffTypeId);
  if (!type) throw new Error("Unknown tariff type");
  if (!Number.isFinite(value) || value < 0) throw new Error("A rate must be a non-negative number");
  const today = new Date().toISOString().slice(0, 10);
  if (effectiveFrom < today) throw new Error("A rate cannot be backdated — post a correction instead");

  /* The outgoing row must be found IN THIS DOMAIN, not through the resolution
     chain. `resolveTariff` falls back to the institution default when the
     target domain holds nothing — and closing that row off would silently
     retire an institution-wide rate that this change never touched. */
  const current = TARIFF_VALUES.find((v) =>
    v.tariffTypeId === tariffTypeId && v.domainId === domainId && v.currency === currency &&
    v.approved && v.effectiveFrom <= effectiveFrom && v.effectiveTo === null) ?? null;

  const slug = `${tariffTypeId}_${domainId}_${currency}_${effectiveFrom}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (TARIFF_VALUES.some((v) => v.id === `tv_${slug}`)) {
    throw new Error("A change for this rate, domain and date is already staged");
  }

  const approval: ApprovalItem = {
    id: `ap_trf_${slug}`,
    kind: "static_data_change",
    title: `${type.role} — ${TARIFF_DOMAINS.find((d) => d.id === domainId)?.name ?? domainId} (${currency})`,
    detail: `${current ? `${current.value}%` : "unset"} → ${value}% effective ${effectiveFrom}. ${reason}`,
    proposedBy,
    proposedAt: new Date().toISOString(),
    status: "pending",
  };
  APPROVAL_QUEUE.unshift(approval);

  const staged: TariffValue = {
    id: `tv_${slug}`,
    tariffTypeId, domainId, currency, value,
    dayCount: current?.dayCount ?? "actual/365",
    effectiveFrom, effectiveTo: null,
    approved: false,
    pendingApprovalId: approval.id,
    note: reason,
  };
  TARIFF_VALUES.push(staged);

  PENDING_CHANGES.set(approval.id, {
    label: `Tariff — ${type.role} ${currency} ${value}% from ${effectiveFrom}`,
    apply: (decidedBy) => {
      staged.approved = true;
      staged.approvedBy = decidedBy;
      if (current && current.effectiveTo === null) current.effectiveTo = effectiveFrom;
    },
    clear: () => {
      staged.pendingApprovalId = undefined;
      if (!staged.approved) {
        const i = TARIFF_VALUES.indexOf(staged);
        if (i >= 0) TARIFF_VALUES.splice(i, 1);
      }
    },
  });

  logAudit({ actor: proposedBy, actorRole: "Maker", category: "config", action: "Proposed tariff change", target: `${type.role} ${currency}`, detail: approval.detail });
  return approval;
}

// ---- Contracts ----

export async function getContracts(clientId?: string) {
  if (!USE_MOCK) throw new NotImplementedError("getContracts");
  await latency();
  const rows = clientId ? contractsForClient(clientId) : INVESTOR_CONTRACTS;
  return rows.map((c) => ({
    ...c,
    productName: productById(c.productId)!.name,
    distributionClass: productById(c.productId)!.distributionClass,
    units: unitBalance(c.id),
    availableBalance: availableBalance(c.id),
    statusLabel: CONTRACT_STATUS_LABELS[c.status],
  }));
}

// ---- Ledger (data spec §4, §6, §10) ----

export async function getChartOfAccounts() {
  if (!USE_MOCK) throw new NotImplementedError("getChartOfAccounts");
  await latency();
  return CHART_OF_ACCOUNTS.map((a) => ({
    ...a,
    instances: GL_ACCOUNTS.filter((g) => g.code === a.code).length,
    balanceKes: GL_ACCOUNTS.filter((g) => g.code === a.code && g.currency === "KES").reduce((s, g) => s + balanceOf(g.id), 0),
    balanceUsd: GL_ACCOUNTS.filter((g) => g.code === a.code && g.currency === "USD").reduce((s, g) => s + balanceOf(g.id), 0),
  }));
}

export async function getJournalEntries(filter?: { status?: JournalStatus; contractId?: string; currency?: Currency }) {
  if (!USE_MOCK) throw new NotImplementedError("getJournalEntries");
  await latency();
  return JOURNAL_ENTRIES
    .filter((e) => (!filter?.status || e.status === filter.status))
    .filter((e) => (!filter?.contractId || e.contractId === filter.contractId))
    .filter((e) => (!filter?.currency || e.currency === filter.currency))
    .map((e) => ({
      ...e,
      eventLabel: JOURNAL_EVENT_LABELS[e.eventType],
      amount: e.lines.reduce((s, l) => s + l.debit, 0),
      balanced: isBalanced(e),
    }))
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

export async function postCorrection(entryId: string, reason: string, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("postCorrection");
  await latency(400, 900);
  if (!reason.trim()) throw new Error("A correction needs a reason — it is the only record of why the original was wrong");
  const reversal = reverseJournal(entryId, reason.trim(), actor);
  logAudit({ actor, actorRole: "Finance", category: "data", action: "Posted correction", target: reversal.id, detail: `Reverses ${entryId} — ${reason.trim()}` });
  return reversal;
}

export async function getUnitLedger(contractId?: string) {
  if (!USE_MOCK) throw new NotImplementedError("getUnitLedger");
  await latency();
  return UNIT_LEDGER
    .filter((e) => !contractId || e.contractId === contractId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export async function getAccrualRuns() {
  if (!USE_MOCK) throw new NotImplementedError("getAccrualRuns");
  await latency();
  return [...ACCRUAL_RUNS].sort((a, b) => b.runDate.localeCompare(a.runDate));
}

export async function getContractAccruals(runId?: string) {
  if (!USE_MOCK) throw new NotImplementedError("getContractAccruals");
  await latency();
  return CONTRACT_ACCRUALS.filter((a) => !runId || a.runId === runId);
}

export async function triggerAccrualRun(runDate: string, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("triggerAccrualRun");
  await latency(700, 1400);
  /* Accrual is idempotent per value date or it is not a control. Re-running a
     night that already succeeded would post a second set of journals and
     inflate the accrued-interest payable with no trace that it was a repeat.
     A failed or partial run may be retried. */
  const done = ACCRUAL_RUNS.find((r) => r.runDate === runDate && r.status === "success");
  if (done) throw new Error(`${runDate} already accrued successfully in ${done.id} — reverse it before re-running`);
  const run = runAccrualBatch(runDate, actor);
  logAudit({
    actor, actorRole: "Finance", category: "data", action: "Ran nightly accrual",
    target: run.id,
    detail: `${run.status} — ${run.contractsProcessed} processed, ${run.contractsSkipped} skipped${run.note ? `. ${run.note}` : ""}`,
  });
  return run;
}

export async function getCloseRuns() {
  if (!USE_MOCK) throw new NotImplementedError("getCloseRuns");
  await latency();
  return [...CLOSE_RUNS].sort((a, b) => b.date.localeCompare(a.date));
}

/** Re-runs the cross-book check. A blocked close is a returned result, never
 * a thrown error — Finance needs to see the variance to investigate it, and an
 * exception would hand them a message instead of the numbers. */
export async function runClose(date: string, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("runClose");
  await latency(600, 1200);
  const close = runDayEndClose(date, actor);
  logAudit({
    actor, actorRole: "Finance", category: "data",
    action: close.status === "closed" ? "Closed the day" : "Day-end close blocked",
    target: close.id,
    detail: close.blockedReason ?? "Unit ledger and general ledger agree within tolerance.",
  });
  return close;
}

export async function getBusinessRules() {
  if (!USE_MOCK) throw new NotImplementedError("getBusinessRules");
  await latency();
  return BUSINESS_RULES;
}

export async function getTokenizationReadiness() {
  if (!USE_MOCK) throw new NotImplementedError("getTokenizationReadiness");
  await latency();
  return tokenizationHooks(UNIT_LEDGER.length, UNIT_LEDGER.filter((e) => e.onchainTxHash).length);
}

// ---- Classifiers (data spec §8) ----

export async function getClassifierTypes() {
  if (!USE_MOCK) throw new NotImplementedError("getClassifierTypes");
  await latency();
  return CLASSIFIER_TYPES;
}

export async function getClassifierHistory(clientId: string, typeId?: ClassifierTypeId) {
  if (!USE_MOCK) throw new NotImplementedError("getClassifierHistory");
  await latency();
  return classifierHistory(clientId, typeId).map((a) => ({
    ...a,
    typeLabel: classifierType(a.typeId).label,
    valueLabel: classifierType(a.typeId).values.find((v) => v.value === a.value)?.label ?? a.value,
    current: a.validTo === null,
  }));
}

/** The query the empty `investor_risk_history` table made unanswerable. */
export async function getClassifiersAsOf(clientId: string, asOf: string) {
  if (!USE_MOCK) throw new NotImplementedError("getClassifiersAsOf");
  await latency();
  return CLASSIFIER_TYPES.map((t) => {
    const found = classifierAsOf(clientId, t.id, asOf);
    return {
      typeId: t.id,
      label: t.label,
      value: found?.value ?? null,
      valueLabel: found ? t.values.find((v) => v.value === found.value)?.label ?? found.value : null,
      since: found?.validFrom ?? null,
      reason: found?.reason ?? null,
    };
  });
}

export async function getProductEligibility(clientId: string, asOf?: string) {
  if (!USE_MOCK) throw new NotImplementedError("getProductEligibility");
  await latency();
  return eligibleForProduct(clientId, asOf);
}

export async function setClassifier(clientId: string, typeId: ClassifierTypeId, value: string, actor: string, reason?: string) {
  if (!USE_MOCK) throw new NotImplementedError("setClassifier");
  await latency(300, 700);
  const assigned = assignClassifier(clientId, typeId, value, actor, reason);
  if (!assigned) return null;
  complianceAudit(actor, "Compliance", `${classifierType(typeId).label} reassigned`,
    `${assigned.previousValue ?? "unset"} → ${value}`, "client", clientId, reason);
  return assigned;
}

// ---- CRM: enquiries, interactions, tasks, coverage, pipeline (BD SOP) ----

function ackSlaDays(): number {
  return Number(PLATFORM_SETTINGS.find((s) => s.key === "enquiry_ack_days")?.value ?? 1);
}

const crmAudit = (actor: string, actorRole: string, action: string, target: string, detail?: string) =>
  logAudit({ actor, actorRole, category: "data", action, target, detail });

export type EnquiryRow = Enquiry & {
  channelLabel: string;
  categoryLabel: string;
  statusLabel: string;
  routing: { queue: string; note: string };
  sla: ReturnType<typeof acknowledgementSla>;
  ownerName: string | null;
};

export async function getEnquiries(): Promise<EnquiryRow[]> {
  if (!USE_MOCK) throw new NotImplementedError("getEnquiries");
  await latency();
  const sla = ackSlaDays();
  return ENQUIRIES
    .map((e) => ({
      ...e,
      channelLabel: ENQUIRY_CHANNEL_LABELS[e.channel],
      categoryLabel: ENQUIRY_CATEGORY_LABELS[e.category],
      statusLabel: ENQUIRY_STATUS_LABELS[e.status],
      routing: ENQUIRY_ROUTING[e.category],
      sla: acknowledgementSla(e, sla),
      ownerName: e.ownerId ? ownerName(e.ownerId) : null,
    }))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** Acknowledgement is the SOP's first control and the one the service standard
 * measures, so it is its own action rather than a side effect of assignment —
 * an enquiry can be acknowledged before anyone knows who will own it. */
export async function acknowledgeEnquiry(id: string, actor: string): Promise<Enquiry> {
  if (!USE_MOCK) throw new NotImplementedError("acknowledgeEnquiry");
  await latency(300, 700);
  const enquiry = ENQUIRIES.find((e) => e.id === id);
  if (!enquiry) throw new Error("not found");
  if (enquiry.acknowledgedAt) throw new Error("Already acknowledged");
  enquiry.acknowledgedAt = new Date().toISOString();
  if (enquiry.status === "new") enquiry.status = "acknowledged";
  crmAudit(actor, "Client Services", "Acknowledged enquiry", enquiry.subject,
    `${enquiry.name} via ${ENQUIRY_CHANNEL_LABELS[enquiry.channel]}`);
  return enquiry;
}

export async function assignEnquiry(id: string, ownerId: string | null, actor: string): Promise<Enquiry> {
  if (!USE_MOCK) throw new NotImplementedError("assignEnquiry");
  await latency(250, 600);
  const enquiry = ENQUIRIES.find((e) => e.id === id);
  if (!enquiry) throw new Error("not found");
  if (ownerId && !SYSTEM_USERS.some((u) => u.id === ownerId)) throw new Error("Unknown owner");
  enquiry.ownerId = ownerId;
  if (enquiry.status === "acknowledged" && ownerId) enquiry.status = "in_progress";
  crmAudit(actor, "Client Services", "Assigned enquiry", enquiry.subject, ownerId ? ownerName(ownerId) : "Unassigned");
  return enquiry;
}

export async function resolveEnquiry(id: string, resolution: string, actor: string): Promise<Enquiry> {
  if (!USE_MOCK) throw new NotImplementedError("resolveEnquiry");
  await latency(300, 700);
  const enquiry = ENQUIRIES.find((e) => e.id === id);
  if (!enquiry) throw new Error("not found");
  if (!resolution.trim()) throw new Error("A resolution needs to say what was actually done");
  // Resolving without acknowledging would leave the SLA unmeasurable — the
  // standard is about the customer hearing back, and a silent fix is not that.
  if (!enquiry.acknowledgedAt) enquiry.acknowledgedAt = new Date().toISOString();
  enquiry.status = "resolved";
  enquiry.resolvedAt = new Date().toISOString();
  enquiry.resolution = resolution.trim();
  crmAudit(actor, "Client Services", "Resolved enquiry", enquiry.subject, resolution.trim());
  return enquiry;
}

/** Conversion is traceable in both directions: the enquiry keeps the lead id,
 * and the lead's source names the enquiry. A lead that appears with no
 * provenance is exactly what the manual register already does badly. */
export async function convertEnquiryToLead(id: string, actor: string): Promise<{ enquiry: Enquiry; lead: Lead }> {
  if (!USE_MOCK) throw new NotImplementedError("convertEnquiryToLead");
  await latency(400, 900);
  const enquiry = ENQUIRIES.find((e) => e.id === id);
  if (!enquiry) throw new Error("not found");
  if (enquiry.convertedLeadId) throw new Error("Already converted");
  if (enquiry.clientId) throw new Error("This enquirer is already a client — no lead to create");

  const lead: Lead = {
    id: `ld_${Math.floor(100 + Math.random() * 899)}`,
    name: enquiry.name,
    phone: enquiry.contact,
    source: `Enquiry ${enquiry.id} — ${ENQUIRY_CHANNEL_LABELS[enquiry.channel]}`,
    stage: "contacted",
    // The suitability questionnaire was retired from the investor apps, so a
    // new lead has no score and must not be given a placeholder one.
    suitabilityScore: null,
    geography: "—",
    product: "Farmer wallet",
    deliveryChannel: enquiry.channel === "app" ? "Mobile app" : "Branch",
    customerRisk: null,
    createdAt: new Date().toISOString(),
  };
  LEADS.unshift(lead);
  if (enquiry.campaignId) LEAD_CAMPAIGNS[lead.id] = enquiry.campaignId;

  enquiry.convertedLeadId = lead.id;
  enquiry.status = "converted";
  if (!enquiry.acknowledgedAt) enquiry.acknowledgedAt = new Date().toISOString();

  INTERACTIONS.unshift({
    id: `int_${Date.now()}`,
    subjectType: "lead", subjectId: lead.id, type: "system",
    summary: `Converted from enquiry ${enquiry.id}`,
    detail: enquiry.subject,
    byId: SYSTEM_USERS.find((u) => u.name === actor)?.id ?? "u_6",
    occurredAt: new Date().toISOString(),
  });

  crmAudit(actor, "Client Services", "Converted enquiry to lead", enquiry.name, `${enquiry.id} → ${lead.id}`);
  return { enquiry, lead };
}

// ---- Interactions ----

/** `canSeeComplianceDetail` defaults to FALSE: a caller that forgets the flag
 * redacts rather than leaks. Only Compliance, MLRO and System Admin pass true. */
export async function getInteractions(
  subjectType: InteractionSubject, subjectId: string, canSeeComplianceDetail = false,
) {
  if (!USE_MOCK) throw new NotImplementedError("getInteractions");
  await latency();
  return interactionsFor(subjectType, subjectId)
    .map((i) => visibleInteraction(i, canSeeComplianceDetail))
    .map((i) => ({ ...i, typeLabel: INTERACTION_TYPE_LABELS[i.type], byName: ownerName(i.byId) }));
}

export async function getRecentInteractions(limit = 20, canSeeComplianceDetail = false) {
  if (!USE_MOCK) throw new NotImplementedError("getRecentInteractions");
  await latency();
  return [...INTERACTIONS]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
    .map((i) => visibleInteraction(i, canSeeComplianceDetail))
    .map((i) => ({ ...i, typeLabel: INTERACTION_TYPE_LABELS[i.type], byName: ownerName(i.byId) }));
}

export async function logInteraction(input: {
  subjectType: InteractionSubject;
  subjectId: string;
  type: InteractionType;
  summary: string;
  detail?: string;
  outcome?: string;
  nextAction?: string;
  nextActionDue?: string;
  byId: string;
  actor: string;
}) {
  if (!USE_MOCK) throw new NotImplementedError("logInteraction");
  await latency(300, 800);
  if (!input.summary.trim()) throw new Error("An interaction needs a summary");
  if (input.nextAction && !input.nextActionDue) throw new Error("A next action needs a date, or it will never surface in anyone's queue");

  const interaction: Interaction = {
    id: `int_${Date.now()}`,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    type: input.type,
    summary: input.summary.trim(),
    ...(input.detail?.trim() ? { detail: input.detail.trim() } : {}),
    ...(input.outcome?.trim() ? { outcome: input.outcome.trim() } : {}),
    ...(input.nextAction?.trim() ? { nextAction: input.nextAction.trim() } : {}),
    ...(input.nextActionDue ? { nextActionDue: input.nextActionDue } : {}),
    byId: input.byId,
    occurredAt: new Date().toISOString(),
  };
  INTERACTIONS.unshift(interaction);

  /* A next action becomes a real task rather than a note somebody has to
     remember to read. This is the whole difference between an activity log
     and a system that makes follow-up happen. */
  if (interaction.nextAction && interaction.nextActionDue) {
    CRM_TASKS.unshift({
      id: `tsk_${Date.now()}`,
      title: interaction.nextAction,
      ownerId: input.byId,
      dueDate: interaction.nextActionDue,
      status: "open",
      source: "interaction",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      createdAt: new Date().toISOString(),
    });
  }

  crmAudit(input.actor, "Client Services", `Logged ${INTERACTION_TYPE_LABELS[input.type].toLowerCase()}`, input.summary.trim());
  return interaction;
}

// ---- Tasks ----

export async function getCrmTasks(ownerId?: string) {
  if (!USE_MOCK) throw new NotImplementedError("getCrmTasks");
  await latency();
  const today = new Date().toISOString().slice(0, 10);
  return CRM_TASKS
    .filter((t) => !ownerId || t.ownerId === ownerId)
    .map((t) => ({
      ...t,
      ownerLabel: ownerName(t.ownerId),
      sourceLabel: TASK_SOURCE_LABELS[t.source],
      overdue: t.status === "open" && t.dueDate < today,
      dueToday: t.status === "open" && t.dueDate === today,
    }))
    .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || a.dueDate.localeCompare(b.dueDate));
}

export async function createCrmTask(input: { title: string; detail?: string; ownerId: string; dueDate: string; subjectType?: InteractionSubject; subjectId?: string; actor: string }) {
  if (!USE_MOCK) throw new NotImplementedError("createCrmTask");
  await latency(250, 600);
  if (!input.title.trim()) throw new Error("A task needs a title");
  if (!input.dueDate) throw new Error("A task needs a due date");
  if (!SYSTEM_USERS.some((u) => u.id === input.ownerId)) throw new Error("Unknown owner");
  const task: CrmTask = {
    id: `tsk_${Date.now()}`,
    title: input.title.trim(),
    ...(input.detail?.trim() ? { detail: input.detail.trim() } : {}),
    ownerId: input.ownerId,
    dueDate: input.dueDate,
    status: "open",
    source: "manual",
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    createdAt: new Date().toISOString(),
  };
  CRM_TASKS.unshift(task);
  crmAudit(input.actor, "Client Services", "Created task", task.title, `Owner ${ownerName(task.ownerId)}, due ${task.dueDate}`);
  return task;
}

export async function setCrmTaskStatus(id: string, status: "done" | "cancelled" | "open", actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("setCrmTaskStatus");
  await latency(200, 500);
  const task = CRM_TASKS.find((t) => t.id === id);
  if (!task) throw new Error("not found");
  task.status = status;
  task.completedAt = status === "done" ? new Date().toISOString() : undefined;
  crmAudit(actor, "Client Services", `Task ${status}`, task.title);
  return task;
}

// ---- Coverage & segmentation ----

export async function getCoverageBook() {
  if (!USE_MOCK) throw new NotImplementedError("getCoverageBook");
  await latency();
  return coverageGaps().map((row) => ({
    ...row,
    id: row.clientId,
    ownerLabel: row.ownerId ? ownerName(row.ownerId) : null,
    segmentLabel: row.segment ? SEGMENT_LABELS[row.segment] : null,
    serviceModel: row.segment ? SEGMENT_SERVICE_MODEL[row.segment] : null,
  }));
}

export async function getClientCrmProfile(clientId: string) {
  if (!USE_MOCK) throw new NotImplementedError("getClientCrmProfile");
  await latency();
  const coverage = coverageAsOf(clientId);
  const segment = segmentAsOf(clientId);
  return {
    clientId,
    ownerId: coverage?.value ?? null,
    ownerLabel: coverage ? ownerName(coverage.value) : null,
    ownerSince: coverage?.validFrom ?? null,
    segment: segment?.value ?? null,
    segmentLabel: segment ? SEGMENT_LABELS[segment.value] : null,
    segmentSince: segment?.validFrom ?? null,
    serviceModel: segment ? SEGMENT_SERVICE_MODEL[segment.value] : null,
    coverageHistory: coverageHistory(clientId).map((a) => ({ ...a, valueLabel: ownerName(a.value), current: a.validTo === null })),
    segmentHistory: segmentHistory(clientId).map((a) => ({ ...a, valueLabel: SEGMENT_LABELS[a.value], current: a.validTo === null })),
    reviews: SERVICE_REVIEWS.filter((r) => r.clientId === clientId).map((r) => ({ ...r, ownerLabel: ownerName(r.ownerId) })),
  };
}

export async function setClientOwner(clientId: string, ownerId: string, actor: string, reason?: string) {
  if (!USE_MOCK) throw new NotImplementedError("setClientOwner");
  await latency(300, 700);
  const assigned = assignCoverage(clientId, ownerId, actor, reason);
  if (assigned) crmAudit(actor, "Business Development", "Reassigned coverage", clientId, `${assigned.previousValue ? ownerName(assigned.previousValue) : "unassigned"} → ${ownerName(ownerId)}${reason ? ` — ${reason}` : ""}`);
  return assigned;
}

export async function setClientSegment(clientId: string, segment: CommercialSegment, actor: string, reason?: string) {
  if (!USE_MOCK) throw new NotImplementedError("setClientSegment");
  await latency(300, 700);
  const assigned = assignSegment(clientId, segment, actor, reason);
  if (assigned) crmAudit(actor, "Business Development", "Reassigned commercial segment", clientId, `${assigned.previousValue ? SEGMENT_LABELS[assigned.previousValue] : "unassigned"} → ${SEGMENT_LABELS[segment]}${reason ? ` — ${reason}` : ""}`);
  return assigned;
}

export async function getSegmentModel() {
  if (!USE_MOCK) throw new NotImplementedError("getSegmentModel");
  await latency();
  return (Object.keys(SEGMENT_LABELS) as CommercialSegment[]).map((key) => ({
    key,
    label: SEGMENT_LABELS[key],
    ...SEGMENT_SERVICE_MODEL[key],
    clients: SEGMENT_ASSIGNMENTS.filter((a) => a.validTo === null && a.value === key).length,
  }));
}

// ---- Campaigns ----

export async function getCampaigns() {
  if (!USE_MOCK) throw new NotImplementedError("getCampaigns");
  await latency();
  return CAMPAIGNS.map((c) => {
    const leadIds = Object.entries(LEAD_CAMPAIGNS).filter(([, cid]) => cid === c.id).map(([lid]) => lid);
    const leads = LEADS.filter((l) => leadIds.includes(l.id));
    const converted = leads.filter((l) => l.stage === "converted").length;
    const enquiries = ENQUIRIES.filter((e) => e.campaignId === c.id).length;
    return {
      ...c,
      enquiries,
      leads: leads.length,
      converted,
      conversionPct: leads.length ? Number(((converted / leads.length) * 100).toFixed(0)) : null,
      // Cost per converted client, or null where there is no attributable
      // spend — dividing by nothing and printing 0 would read as "free".
      costPerConversion: c.spendKes !== null && converted > 0 ? Math.round(c.spendKes / converted) : null,
    };
  });
}

export async function getLeadsWithCampaign() {
  if (!USE_MOCK) throw new NotImplementedError("getLeadsWithCampaign");
  await latency();
  return LEADS.map(leadWithCampaign);
}

// ---- Institutional pipeline ----

export async function getOpportunities() {
  if (!USE_MOCK) throw new NotImplementedError("getOpportunities");
  await latency();
  return OPPORTUNITIES.map((o) => ({
    ...o,
    stageLabel: OPPORTUNITY_STAGE_LABELS[o.stage],
    ownerLabel: ownerName(o.ownerId),
    ...bidScore(o),
  })).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export async function getBidCriteria() {
  if (!USE_MOCK) throw new NotImplementedError("getBidCriteria");
  await latency();
  return BID_CRITERIA;
}

export async function scoreOpportunity(id: string, scores: Partial<Record<BidCriterion, number>>, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("scoreOpportunity");
  await latency(300, 700);
  const opp = OPPORTUNITIES.find((o) => o.id === id);
  if (!opp) throw new Error("not found");
  for (const [key, value] of Object.entries(scores)) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 5)) {
      throw new Error(`${key} must be a whole number from 1 to 5`);
    }
  }
  opp.scores = { ...opp.scores, ...scores };
  if (opp.stage === "qualifying") opp.stage = "bid_no_bid";
  crmAudit(actor, "Head of BD", "Scored Bid/No-Bid", opp.counterparty, `${bidScore(opp).scored}/${BID_CRITERIA.length} criteria scored`);
  return opp;
}

/** The decision is recorded with a note, always. A no-bid with no reason is
 * the one every post-mortem asks about, and a bid with no reason is how a
 * framework becomes a rubber stamp. */
export async function decideOpportunity(id: string, decision: "bid" | "no_bid", note: string, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("decideOpportunity");
  await latency(400, 900);
  const opp = OPPORTUNITIES.find((o) => o.id === id);
  if (!opp) throw new Error("not found");
  if (!note.trim()) throw new Error("A Bid/No-Bid decision needs a written rationale");
  const { scored, total } = bidScore(opp);
  if (scored < total) throw new Error(`All ${total} criteria must be scored before deciding (${scored} done)`);
  opp.decision = decision;
  opp.decisionBy = actor;
  opp.decisionNote = note.trim();
  opp.stage = decision === "bid" ? "proposal" : "no_bid";
  if (decision === "no_bid") opp.closedAt = new Date().toISOString().slice(0, 10);
  crmAudit(actor, "Head of BD", `Opportunity ${decision === "bid" ? "bid" : "no-bid"}`, opp.counterparty, note.trim());
  return opp;
}

export async function setOpportunityStage(id: string, stage: OpportunityStage, actor: string) {
  if (!USE_MOCK) throw new NotImplementedError("setOpportunityStage");
  await latency(250, 600);
  const opp = OPPORTUNITIES.find((o) => o.id === id);
  if (!opp) throw new Error("not found");
  if ((stage === "proposal" || stage === "negotiation" || stage === "won") && opp.decision !== "bid") {
    throw new Error("Cannot advance past Bid/No-Bid without a recorded bid decision");
  }
  opp.stage = stage;
  if (stage === "won" || stage === "lost") opp.closedAt = new Date().toISOString().slice(0, 10);
  crmAudit(actor, "Head of BD", "Moved opportunity stage", opp.counterparty, OPPORTUNITY_STAGE_LABELS[stage]);
  return opp;
}

// ---- BD performance ----

export async function getBdKpis() {
  if (!USE_MOCK) throw new NotImplementedError("getBdKpis");
  await latency();
  return bdKpis(ackSlaDays());
}

export async function getCrmOwners() {
  if (!USE_MOCK) throw new NotImplementedError("getCrmOwners");
  await latency();
  return SYSTEM_USERS.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name, role: u.role, roleLabel: ROLE_LABELS[u.role] }));
}

// ---- Tokenization compliance ----

export async function getTokenIssuances() {
  if (!USE_MOCK) throw new NotImplementedError("getTokenIssuances");
  await latency();
  return TOKEN_ISSUANCES;
}

export async function getLifecycleEvents() {
  if (!USE_MOCK) throw new NotImplementedError("getLifecycleEvents");
  await latency();
  return LIFECYCLE_EVENTS;
}

export async function getSmartContracts() {
  if (!USE_MOCK) throw new NotImplementedError("getSmartContracts");
  await latency();
  return SMART_CONTRACTS;
}

// ---- Market conduct ----

export async function getMarketAbuseAlerts() {
  if (!USE_MOCK) throw new NotImplementedError("getMarketAbuseAlerts");
  await latency();
  return MARKET_ABUSE_ALERTS;
}

export async function getConflictDeclarations() {
  if (!USE_MOCK) throw new NotImplementedError("getConflictDeclarations");
  await latency();
  return CONFLICT_DECLARATIONS;
}

export async function getEmployeeTrades() {
  if (!USE_MOCK) throw new NotImplementedError("getEmployeeTrades");
  await latency();
  return EMPLOYEE_TRADES;
}

// ---- Investment management ----

export async function getInvestmentProducts() {
  if (!USE_MOCK) throw new NotImplementedError("getInvestmentProducts");
  await latency();
  return INVESTMENT_PRODUCTS;
}

export async function getInvestmentOrders() {
  if (!USE_MOCK) throw new NotImplementedError("getInvestmentOrders");
  await latency();
  return INVESTMENT_ORDERS;
}

export async function getPortfolioTrades() {
  if (!USE_MOCK) throw new NotImplementedError("getPortfolioTrades");
  await latency();
  return PORTFOLIO_TRADES;
}

export async function getHoldingsBook() {
  if (!USE_MOCK) throw new NotImplementedError("getHoldingsBook");
  await latency();
  return HOLDINGS_BOOK;
}

export async function getValuationRuns() {
  if (!USE_MOCK) throw new NotImplementedError("getValuationRuns");
  await latency();
  return VALUATION_RUNS;
}

export async function getRedemptionRequests() {
  if (!USE_MOCK) throw new NotImplementedError("getRedemptionRequests");
  await latency();
  return REDEMPTION_REQUESTS;
}

export async function getCorporateActions() {
  if (!USE_MOCK) throw new NotImplementedError("getCorporateActions");
  await latency();
  return CORPORATE_ACTIONS;
}

export async function getIcApprovalQueue() {
  if (!USE_MOCK) throw new NotImplementedError("getIcApprovalQueue");
  await latency();
  return IC_APPROVAL_QUEUE;
}

export async function getInvestmentMandates() {
  if (!USE_MOCK) throw new NotImplementedError("getInvestmentMandates");
  await latency();
  return INVESTMENT_MANDATES;
}

// ---- Institutional funds ----

export async function getInstitutionalClients() {
  if (!USE_MOCK) throw new NotImplementedError("getInstitutionalClients");
  await latency();
  return INSTITUTIONAL_CLIENTS;
}

export async function getInstitutionalMandates() {
  if (!USE_MOCK) throw new NotImplementedError("getInstitutionalMandates");
  await latency();
  return INSTITUTIONAL_MANDATES;
}

export async function getMandateRestrictions() {
  if (!USE_MOCK) throw new NotImplementedError("getMandateRestrictions");
  await latency();
  return MANDATE_RESTRICTIONS;
}

export async function getSegregatedPortfolios() {
  if (!USE_MOCK) throw new NotImplementedError("getSegregatedPortfolios");
  await latency();
  return SEGREGATED_PORTFOLIOS;
}

export async function getFeeSchedules() {
  if (!USE_MOCK) throw new NotImplementedError("getFeeSchedules");
  await latency();
  return FEE_SCHEDULES;
}

export async function getInstitutionalReports() {
  if (!USE_MOCK) throw new NotImplementedError("getInstitutionalReports");
  await latency();
  return INSTITUTIONAL_REPORTS;
}

// ---- Institutional investment compliance ----

export async function getMandateBreaches() {
  if (!USE_MOCK) throw new NotImplementedError("getMandateBreaches");
  await latency();
  return MANDATE_BREACHES;
}

export async function getCounterparties() {
  if (!USE_MOCK) throw new NotImplementedError("getCounterparties");
  await latency();
  return COUNTERPARTIES;
}

export async function getInstitutionalClientCompliance() {
  if (!USE_MOCK) throw new NotImplementedError("getInstitutionalClientCompliance");
  await latency();
  return INSTITUTIONAL_CLIENT_COMPLIANCE;
}



// ---- Added to CORE API after this mock layer was retired (2026-09-16) ----
// The demo build (no CORE API) still needs them wherever a page calls one.

export async function getActivationBlockers(clientId: string) {
  if (!USE_MOCK) throw new NotImplementedError("getActivationBlockers");
  await latency();
  return activationBlockers(clientId);
}

/** Who a case or complaint can be assigned to: active staff only. */
export async function getStaffDirectory(): Promise<{ id: string; name: string; role: AdminRole }[]> {
  if (!USE_MOCK) throw new NotImplementedError("getStaffDirectory");
  await latency();
  return SYSTEM_USERS.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

/** CORE names the coverage pair apart from the client-file pair; in the demo
 * both write the same dated coverage/segment assignment. */
export const setCoverageOwner = (clientId: string, ownerId: string, actor = "System Admin", reason?: string) =>
  setClientOwner(clientId, ownerId, actor, reason);
export const setCoverageSegment = (clientId: string, segment: CommercialSegment, actor = "System Admin", reason?: string) =>
  setClientSegment(clientId, segment, actor, reason);
