import type { Page, Route } from "@playwright/test";
import type * as T from "../src/lib/tokenConsole/types.gen";
import type { AssetBackingRowActual } from "../src/lib/tokenConsole/spec-deviations";
import type { ConfigChange } from "../src/lib/tokenConsole/configChanges";
import type { BondTerms, MarketQuote } from "../src/lib/tokenConsole/prices";
import type {
  CheckedApplication, CustomerSummary, CustomerTransactionEntry, Intervention,
  PaymentIssue, QueuedDocument, ReportingRun, SurveillanceAlert, TransactionTotals,
} from "../src/lib/omniApi";
import { OTHER, json, signIn } from "./stubs";

/* Representative Baracel Unyt data in the services' own response shapes.
 * Every fixture is typed with the type the page's API client reads it as
 * (types.gen.ts, spec-deviations.ts, omniApi.ts), and `tsc -p tsconfig.e2e.json`
 * checks it, so a field the services do not send cannot slip in here. */

export const IDS = {
  institution: "INST-KE",
  investor: "INV-77",
  investorName: "Wanjiru Kamau",
  fundProduct: "BRF-KES-INC",
  fundProductName: "BRF-KES Income Fund",
  loanProduct: "LOAN-KES-TERM",
  fundContract: "AC-FUND-1",
  loanContract: "AC-LOAN-1",
  asset: "ASSET-IFB-17",
  assetName: "IFB1/2023/17",
  offering: "OF-IFB-17",
  journal: "JE-20261028-001",
  fund: "FUND-BRF",
  subFund: "SF-BRF-KES",
  profile: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

const AT = "2026-10-28T08:00:00Z";

const institutions: T.Institution[] = [
  { institutionId: IDS.institution, name: "Investcent Kenya", localCurrency: "KES", country: "KE", defaultTariffDomainId: "TD-DEFAULT" },
];

const investors: T.Investor[] = [
  { investorId: IDS.investor, institutionId: IDS.institution, externalRef: "APP-77", displayName: IDS.investorName, investorCategory: "INDIVIDUAL", lifecycleStatus: "ACTIVE", onboardedAt: AT },
  { investorId: "INV-78", institutionId: IDS.institution, externalRef: "APP-78", displayName: "Otieno Ochieng", investorCategory: "INDIVIDUAL", lifecycleStatus: "UNDER_REVIEW", onboardedAt: AT },
];

const products: T.Product[] = [
  { productId: IDS.fundProduct, institutionId: IDS.institution, name: IDS.fundProductName, currency: "KES", assetClass: "BOND", structureType: "POOLED_UNITIZED", schemeId: "SCH-BOND", packageId: "PKG-RETAIL", distributionType: "INCOME", tokenClassId: "TC-BRF-KES", subFundId: IDS.subFund, status: "ACTIVE", active: true },
  { productId: IDS.loanProduct, institutionId: IDS.institution, name: "KES Term Loan", currency: "KES", assetClass: "LOAN", structureType: "POOLED_UNITIZED", schemeId: "SCH-LOAN", packageId: "PKG-RETAIL", status: "ACTIVE", active: true },
];

const contracts: T.InvestorContract[] = [
  { contractId: IDS.fundContract, institutionId: IDS.institution, investorRef: IDS.investor, investorId: IDS.investor, productId: IDS.fundProduct, currency: "KES", contractStatus: "ACTIVE", openedAt: "2026-10-01" },
  { contractId: IDS.loanContract, institutionId: IDS.institution, investorRef: IDS.investor, investorId: IDS.investor, productId: IDS.loanProduct, currency: "KES", contractStatus: "ACTIVE", openedAt: "2026-10-02" },
];

const trialBalance: T.TrialBalanceLine[] = [
  { glAccountId: "GL-1", accountCode: "1000", accountName: "Bank cash", currency: "KES", totalDebit: 250000, totalCredit: 0, balance: 250000 },
  { glAccountId: "GL-2", accountCode: "2100", accountName: "Investor principal", currency: "KES", totalDebit: 0, totalCredit: 250000, balance: -250000 },
];

const glBalances: T.GlBalanceRow[] = [
  { glAccountId: "GL-1", accountCode: "1000", accountName: "Bank cash", accountType: "ASSET", normalBalance: "DEBIT", ownerType: "INSTITUTION", ownerId: IDS.institution, ownerLabel: "Investcent Kenya", currency: "KES", totalDebit: 250000, totalCredit: 0, balance: 250000 },
];

const reconciliation: T.ReconciliationResult[] = [
  { productId: IDS.fundProduct, tokenClassId: "TC-BRF-KES", contractCount: 1, unitsOutstanding: 2500, pricePerUnit: 100, unitLedgerValue: 250000, glPrincipal: 250000, difference: 0, matched: true, note: "Agrees" },
];

const journals: T.LedgerEntryView[] = [
  {
    journalId: IDS.journal, eventType: "SUBSCRIPTION", currency: "KES", status: "POSTED", description: "Subscription by Wanjiru Kamau",
    valueDate: "2026-10-28", occurredAt: AT, postedAt: AT, referenceTxId: "SUB-1", contractId: IDS.fundContract, productId: IDS.fundProduct,
    offeringId: IDS.offering, amount: 250000,
    lines: [
      { accountCode: "1000", accountName: "Bank cash", glAccountId: "GL-1", side: "DEBIT", amount: 250000, contractId: IDS.fundContract, productId: IDS.fundProduct },
      { accountCode: "2100", accountName: "Investor principal", glAccountId: "GL-2", side: "CREDIT", amount: 250000, contractId: IDS.fundContract, productId: IDS.fundProduct },
    ],
  },
];

const offerings: T.OfferingResponse[] = [
  { offeringId: IDS.offering, assetId: IDS.asset, productId: IDS.fundProduct, pricePerUnit: 100, totalUnits: 100000, reservedUnits: 0, outstandingUnits: 2500, remainingUnits: 97500, minUnits: 10, maxUnits: 50000, currency: "KES", status: "OPEN", tokenClassId: "TC-BRF-KES", createdAt: AT },
];

const trades: T.TradeResponse[] = [
  { tradeId: "TR-9", offeringId: IDS.offering, sellerInvestorId: IDS.investor, buyerInvestorId: "INV-78", quantity: 100, pricePerUnit: 101, parValue: 10000, consideration: 10100, premium: 100, currency: "KES", sellerContractId: IDS.fundContract, buyerContractId: "AC-FUND-2", journalId: "JE-TR-9", createdAt: AT },
];

const assets: T.AssetResponse[] = [
  { assetId: IDS.asset, name: IDS.assetName, assetClass: "BOND", description: "Infrastructure bond", currency: "KES", appreciationRate: 0.14, valuationAmount: 10_000_000, status: "OFFERED", createdAt: AT, updatedAt: AT },
];

const assetBacking: AssetBackingRowActual[] = [
  {
    assetId: IDS.asset, name: IDS.assetName, assetClass: "BOND", status: "OFFERED", currency: "KES", valuation: 10_000_000, appreciationRate: 0.14,
    claims: 250000, headroom: 9_750_000, utilization: 0.025, overSubscribed: false,
    rungs: [{ offeringId: IDS.offering, productId: IDS.fundProduct, status: "OPEN", pricePerUnit: 100, totalUnits: 100000, issuedUnits: 2500, claimValue: 250000, currency: "KES" }],
  },
];

const bondPriceChange: ConfigChange = {
  requestId: "CR-PRICE-1", changeType: "BOND_PRICE_SET", targetId: IDS.fundProduct, summary: "Price BRF-KES-INC at 101.25",
  payload: { productId: IDS.fundProduct, midPrice: 101.25, quoteSpread: 0.01 }, status: "PENDING", maker: "brian@baracel.ae", madeAt: AT,
};
const tariffChange: ConfigChange = {
  requestId: "CR-RATE-1", changeType: "TARIFF_VALUE_CREATE", targetId: null, summary: "Management fee 2%",
  payload: { tariffTypeId: "TT-MGMT-FEE", tariffDomainId: "TD-DEFAULT", currency: "KES", rate: 0.02, dayCount: "ACTUAL_365", effectiveFrom: "2026-11-01" },
  status: "PENDING", maker: "brian@baracel.ae", madeAt: AT,
};
const configChanges: ConfigChange[] = [bondPriceChange, tariffChange];

const bondTerms: BondTerms[] = [
  { productId: IDS.fundProduct, isin: "KE7000001234", issuer: "Republic of Kenya", faceValue: 100, couponRate: 0.14, maturityDate: "2030-06-15", anchorYield: 0.135, anchorSetAt: AT, anchorSetBy: "brian@baracel.ae", quoteSpread: 0.01 },
];
const quotes: MarketQuote[] = [
  { offeringId: IDS.offering, bid: 100.75, offer: 101.75, yield: 0.135, accruedInterest: 1.2, currency: "KES", asOf: AT, source: "DESK", status: "OPEN" },
];

const unitLedger: T.UnitHoldingRow[] = [
  { investorId: IDS.investor, investorRef: IDS.investor, offeringId: IDS.offering, productId: IDS.fundProduct, tokenClassId: "TC-BRF-KES", source: "PRIMARY", quantity: 2500, pricePerUnit: 100, value: 250000, currency: "KES" },
];
const unitActivity: T.UnitLedgerActivityView[] = [
  { occurredAt: AT, action: "MINT", reference: "SUB-1", tokenClassId: "TC-BRF-KES", investorRef: IDS.investor, quantity: 2500, currency: "KES" },
];

const accrualRuns: T.AccrualRun[] = [
  { runId: "RUN-ACC-1", periodStart: "2026-10-27", periodEnd: "2026-10-27", valueDate: "2026-10-27", status: "COMPLETED", contractCount: 1, failureCount: 0, totalAccrued: 95.89, startedAt: AT, completedAt: AT, message: "ok" },
];
const distributionRuns: T.DistributionRun[] = [
  { runId: "RUN-DIST-1", periodEnd: "2026-09-30", valueDate: "2026-10-01", status: "PARTIAL", contractCount: 2, failureCount: 1, totalDistributed: 2876.71, totalTax: 431.51, startedAt: AT, completedAt: AT, message: "1 contract skipped" },
];
const feeRuns: T.FeeRun[] = [];
const taxRuns: T.TaxRemittanceRun[] = [];

const accrualPolicies: T.AccrualPolicyResponse[] = [
  { policyId: "AP-1", scope: "PRODUCT", scopeRef: IDS.fundProduct, method: "SIMPLE_DAILY", rateSource: "TARIFF", dayCount: "ACTUAL_365", currency: "KES", effectiveFrom: "2026-01-01", approved: true, active: true, cron: "0 0 1 * * *", zone: "Africa/Nairobi", scheduleEnabled: true, lastRunAt: AT, lastStatus: "COMPLETED", lastAccruedTo: "2026-10-27", nextRunAt: "2026-10-29T01:00:00Z", createdAt: AT },
];
const distributionPolicies: T.DistributionPolicyResponse[] = [
  { policyId: "DP-1", scope: "PRODUCT", scopeRef: IDS.fundProduct, mode: "INCOME", whtRate: 0.15, currency: "KES", effectiveFrom: "2026-01-01", approved: true, active: true, createdAt: AT },
];
const schedules: T.ScheduleResponse[] = [
  { scheduleId: "SCHED-NAV", jobType: "NAV", cron: "0 30 18 * * MON-FRI", zone: "Africa/Nairobi", enabled: true, description: "Daily NAV strike", lastRunAt: AT, lastStatus: "COMPLETED", nextRunAt: "2026-10-29T15:30:00Z", createdAt: AT },
];

const reviews: T.ComplianceReviewItem[] = [
  { queueId: "Q-1", investorId: "INV-78", reason: "Name partially matches a sanctions list", status: "OPEN", openedAt: AT },
];

const funds: T.FundResponse[] = [{ fundId: IDS.fund, institutionId: IDS.institution, name: "Bond Retail Fund", registrationRef: "CMA/CIS/2026/01", status: "ACTIVE" }];
const subFunds: T.SubFundResponse[] = [
  { subFundId: IDS.subFund, fundId: IDS.fund, name: "BRF KES sub-fund", baseCurrency: "KES", assetId: IDS.asset, appreciationRate: 0.14, inceptionDate: "2026-01-01", minInvestmentAmount: 1000, lockUpDays: 30, exitFeeRate: 0.01, gatePct: 0.1, facilitySize: 50_000_000, status: "ACTIVE" },
];
const ladders: T.BondLadderView[] = [
  {
    subFundId: IDS.subFund, subFundName: "BRF KES sub-fund", currency: "KES", blendedCoupon: 0.1375, capacity: 20_000_000, claims: 250000, headroom: 19_750_000,
    utilization: 0.0125, everyMonthCovered: false, couponMonths: [6, 12],
    rungs: [{ ladderSlot: 1, isin: "KE7000001234", tenorYears: 5, couponRate: 0.1375, couponMonths: "6,12", faceValueHeld: 20_000_000, maturityDate: "2030-06-15" }],
  },
];
const institutionAccounts: T.InstitutionAccount[] = [{ institutionAccountId: "IA-1", institutionId: IDS.institution, currency: "KES", purpose: "BANK_CASH" }];

const tariffDomains: T.TariffDomain[] = [{ tariffDomainId: "TD-DEFAULT", institutionId: IDS.institution, name: "Retail default", domainCategory: "RETAIL" }];
const tariffTypes: T.TariffType[] = [{ tariffTypeId: "TT-MGMT-FEE", name: "Management fee", valueKind: "PERCENTAGE" }];
const tariffValues: T.TariffValue[] = [
  { tariffValueId: "TV-1", tariffTypeId: "TT-MGMT-FEE", tariffDomainId: "TD-DEFAULT", currency: "KES", rate: 0.015, dayCount: "ACTUAL_365", effectiveFrom: "2026-01-01", approved: true },
];

const schemes: T.AccountingScheme[] = [{ schemeId: "SCH-BOND", institutionId: IDS.institution, name: "Bond fund scheme" }];
const servicePackages: T.ServicePackage[] = [{ packageId: "PKG-RETAIL", institutionId: IDS.institution, name: "Retail package", packageType: "PRODUCT", distributionFrequency: "MONTHLY", tariffDomainId: "TD-DEFAULT" }];
const contractSubtypes: T.ContractSubtype[] = [{ contractSubtypeId: "CST-STD", subtypeName: "Standard holding" }];
const chart: T.ChartOfAccount[] = [{ accountCode: "1000", accountName: "Bank cash", accountType: "ASSET", normalBalance: "DEBIT", sortOrder: 1 }];
const classifierTypes: T.ClassifierType[] = [{ classifierTypeId: "CT-RISK", name: "Risk band", appliesTo: "INVESTOR" }];

const nav: T.NavView = { productId: IDS.fundProduct, navPerUnit: 101.2345 };
const navHistory: T.NavSnapshotView[] = [
  { navId: "NAV-1", productId: IDS.fundProduct, subFundId: IDS.subFund, asOf: "2026-10-27", basePrice: 100, appreciationFactor: 1.012345, unitsOutstanding: 2500, navPerUnit: 101.2345, netAssets: 253086.25, status: "PUBLISHED" },
];

const adminUsers: T.AdminUserResponse[] = [
  { id: "U-1", email: "amina@baracel.ae", fullName: "Amina Ops", status: "ACTIVE", roles: ["ADMIN"], root: true, createdAt: AT },
  { id: "U-2", email: "peter@baracel.ae", fullName: "Peter Pending", status: "PENDING", roles: ["ACCOUNTANT"], root: false, createdAt: AT },
];
const activeSessions: T.ActiveSessionResponse[] = [{ email: "amina@baracel.ae", sessionCount: 1, lastRequest: AT }];
const loginAudit: T.LoginAuditResponse[] = [{ id: "LA-1", email: "amina@baracel.ae", event: "LOGIN_SUCCESS", detail: "ok", ipAddress: "10.0.0.7", userAgent: "Chrome", occurredAt: AT }];
const adminConfig: T.ConfigResponse = { maxConcurrentSessions: 2 };

const application = (identityResult: CheckedApplication["identityResult"]): CheckedApplication => ({
  id: `app-${identityResult.toLowerCase()}`, profileId: IDS.profile, fullName: "Otieno Ochieng", dateOfBirth: "1990-04-02", nationality: "KE",
  identityResult, identityMismatches: identityResult === "MISMATCH" ? ["dateOfBirth"] : null, identitySource: "IPRS", identityCheckedAt: AT,
  screeningClear: true, product: "TOKENIZATION", externalRef: "INV-78", submittedAt: AT,
});
const documents: QueuedDocument[] = [
  { id: "DOC-1", profileId: IDS.profile, type: "SELFIE", contentType: "image/jpeg", sizeBytes: 120_000, status: "PENDING_REVIEW", reviewNote: null, reviewedBy: null, reviewedAt: null, uploadedAt: AT },
];

const transactions: CustomerTransactionEntry[] = [
  { id: "TX-1", profileId: IDS.profile, customer: IDS.investorName, occurredAt: AT, source: "MPESA", kind: "TOP_UP", label: "M-Pesa top-up", direction: "IN", amount: 5000, currency: "KES", status: "PAID", reference: "QWE123RTY", detail: null },
];
const transactionTotals: TransactionTotals[] = [
  { currency: "KES", collected: { count: 1, amount: 5000 }, paidOut: { count: 0, amount: 0 }, failed: { count: 0, amount: 0 }, pending: { count: 0, amount: 0 } },
];
const paymentIssues: PaymentIssue[] = [];

const interventions: Intervention[] = [
  { id: "99999999-9999-4999-8999-999999999999", profileId: IDS.profile, customer: "Alice Wanjiru", action: "REINSTATE", note: "False alarm", status: "PENDING", proposedBy: OTHER, proposedAt: AT, decidedBy: null, decidedAt: null, decisionNote: null, profileStatus: "SUSPENDED" },
];

export const surveillanceAlerts: SurveillanceAlert[] = [
  {
    id: "abababab-abab-4bab-8bab-abababababab", rule: "CAP_STRUCTURING", severity: "HIGH", subject_type: "PROFILE", subject_id: IDS.profile,
    offering_id: null, period_date: "2026-10-28", status: "OPEN", summary: "4 payments in totalling 39,600 KES on 2026-10-28, each under 10,000",
    details: "threshold 10000, min count 3", assigned_to: null, closed_by: null, close_note: null, created_at: AT, updated_at: AT, closed_at: null,
  },
];
export const reportingRuns: ReportingRun[] = [
  { id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", kind: "REPORT", subject: "transactions-2026-10-01-to-2026-10-28", started_at: AT, finished_at: AT, status: "DONE", detail: "12 rows" },
  { id: "efefefef-efef-4fef-8fef-efefefefefef", kind: "SNAPSHOT", subject: "2026-10-28", started_at: AT, finished_at: AT, status: "DONE", detail: "47 holdings" },
];

export const customerSummary: CustomerSummary = {
  profileId: IDS.profile, displayName: "Alice", legalName: "Alice Wanjiru", status: "ACTIVE", registeredAt: AT, contacts: [], links: [], account: null, activeDevices: 1, pushEnabled: true,
};

/* -------------------------------------------------------------------------- */

type Answer = { body: unknown; paged?: boolean };

/** The engine's GET routes (path after /tok) and what each answers with data. */
const TOK: [RegExp, Answer][] = [
  [/^\/accounting\/trial-balance$/, { body: trialBalance }],
  [/^\/accounting\/gl-balances$/, { body: glBalances }],
  [/^\/accounting\/reconciliation$/, { body: reconciliation }],
  [/^\/accounting\/investors$/, { body: investors }],
  [/^\/accounting\/products$/, { body: products }],
  [/^\/accounting\/journals$/, { body: journals }],
  [/^\/accounting\/contracts$/, { body: contracts }],
  [/^\/accounting\/offerings$/, { body: offerings }],
  [/^\/accounting\/trades$/, { body: trades }],
  [/^\/accounting\/assets$/, { body: assets }],
  [/^\/accounting\/asset-backing$/, { body: assetBacking }],
  [/^\/accounting\/config\/changes$/, { body: configChanges }],
  [/^\/accounting\/bond-terms$/, { body: bondTerms }],
  [/^\/accounting\/quotes$/, { body: quotes }],
  [/^\/accounting\/unit-ledger$/, { body: unitLedger }],
  [/^\/accounting\/unit-ledger\/activity$/, { body: unitActivity }],
  [/^\/accounting\/accrual\/runs$/, { body: accrualRuns }],
  [/^\/accounting\/distribution\/runs$/, { body: distributionRuns }],
  [/^\/accounting\/fees\/runs$/, { body: feeRuns }],
  [/^\/accounting\/tax-remittance\/runs$/, { body: taxRuns }],
  [/^\/accounting\/policies\/accrual$/, { body: accrualPolicies }],
  [/^\/accounting\/policies\/distribution$/, { body: distributionPolicies }],
  [/^\/accounting\/policies\/schedules$/, { body: schedules }],
  [/^\/accounting\/compliance\/reviews$/, { body: reviews }],
  [/^\/accounting\/funds$/, { body: funds }],
  [/^\/accounting\/sub-funds$/, { body: subFunds }],
  [/^\/accounting\/ladders$/, { body: ladders }],
  [/^\/accounting\/institutions$/, { body: institutions }],
  [/^\/accounting\/institution-accounts$/, { body: institutionAccounts }],
  [/^\/accounting\/tariffs\/domains$/, { body: tariffDomains }],
  [/^\/accounting\/tariffs\/types$/, { body: tariffTypes }],
  [/^\/accounting\/tariffs\/values$/, { body: tariffValues }],
  [/^\/accounting\/schemes$/, { body: schemes }],
  [/^\/accounting\/service-packages$/, { body: servicePackages }],
  [/^\/accounting\/contract-subtypes$/, { body: contractSubtypes }],
  [/^\/accounting\/chart$/, { body: chart }],
  [/^\/accounting\/classifiers\/types$/, { body: classifierTypes }],
  [/^\/accounting\/nav\/BRF-KES-INC$/, { body: nav }],
  [/^\/accounting\/nav\/BRF-KES-INC\/history$/, { body: navHistory }],
  [/^\/admin\/users$/, { body: adminUsers }],
  [/^\/admin\/active-sessions$/, { body: activeSessions }],
  [/^\/admin\/audit$/, { body: loginAudit }],
  [/^\/admin\/config$/, { body: adminConfig }],
];

/** A KTDA farmer waiting on a KYC decision (the KYC desk). */
const kycFarmer = {
  growerNo: "GRW-0078", fullName: "Otieno Ochieng", phone: "+254711000078", factory: "Test Factory A", status: "FUNDED",
  registeredAt: AT, activatedAt: AT, lastFundedAt: AT, customerId: IDS.profile, clashReason: null,
  kyc: { status: "PENDING", identityResult: "MISMATCH", startedAt: AT, decidedAt: null, note: null },
};
const farmersSummary = { registered: 0, activated: 0, funded: 1, total: 1, kycPending: 1, kyc: { none: 0, pending: 1, verified: 0, rejected: 0 } };

/** Omnichannel's operator GET routes (path after /omni/api/operator). */
const OMNI: [RegExp, Answer][] = [
  [/^\/farmers$/, { body: [kycFarmer], paged: true }],
  [/^\/farmers\/summary$/, { body: farmersSummary }],
  [/^\/onboarding\/applications\/screening-hits$/, { body: [application("MISMATCH")], paged: true }],
  [/^\/onboarding\/applications$/, { body: null, paged: true }], // by identityResult, below
  [/^\/onboarding\/documents$/, { body: documents, paged: true }],
  [/^\/transactions$/, { body: transactions, paged: true }],
  [/^\/transactions\/summary$/, { body: transactionTotals }],
  [/^\/payments\/issues$/, { body: paymentIssues, paged: true }],
  [/^\/customers\/interventions$/, { body: interventions, paged: true }],
  [/^\/customers$/, { body: [customerSummary], paged: true }],
  [new RegExp(`^/customers/${IDS.profile}$`), { body: customerSummary }],
  [/^\/reporting\/alerts$/, { body: surveillanceAlerts }],
  [/^\/reporting\/runs$/, { body: reportingRuns }],
];

/** What an object endpoint answers when there is nothing to show; every list answers []. */
const EMPTY_OBJECTS: [RegExp, unknown][] = [
  [/^\/admin\/config$/, { maxConcurrentSessions: 0 }],
  [/^\/farmers\/summary$/, { registered: 0, activated: 0, funded: 0, total: 0, kycPending: 0, kyc: { none: 0, pending: 0, verified: 0, rejected: 0 } }],
];

export type Mode = "empty" | "data" | "fail";

/** Messages the failing services answer with, so a test can look for them. */
export const FAIL = { tok: "The ledger is unavailable (stubbed 500)", omni: "Omnichannel is unavailable (stubbed 500)" };

const paged = (route: Route, items: unknown[]) =>
  route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(items),
    headers: { "X-Total-Count": String(items.length), "X-Total-Pages": String(items.length ? 1 : 0), "X-Page": "1", "X-Size": "100" },
  });

/**
 * Signs in and answers every Unyt read in `mode`. Writes are refused with 405
 * and recorded in the returned list: rendering a page must never write.
 */
export async function stubUnyt(page: Page, mode: Mode) {
  const writes: string[] = [];
  await signIn(page);
  await page.route(/\/(tok|omni)\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const isOmni = url.pathname.startsWith("/omni/");
    const path = isOmni ? url.pathname.replace(/^\/omni\/api\/operator/, "") : url.pathname.replace(/^\/tok/, "");
    if (path === "/auth/me") return route.fallback();
    if (req.method() !== "GET") {
      writes.push(`${req.method()} ${url.pathname}`);
      return json(route, { error: "Writes are not expected here" }, 405);
    }
    if (mode === "fail") {
      return isOmni
        ? json(route, { timestamp: AT, status: 500, error: "Internal Server Error", message: FAIL.omni, code: "INTERNAL" }, 500)
        : json(route, { error: FAIL.tok }, 500);
    }
    if (mode === "empty") {
      const obj = EMPTY_OBJECTS.find(([re]) => re.test(path));
      if (obj) return json(route, obj[1]);
      return isOmni ? paged(route, []) : json(route, []);
    }
    const hit = (isOmni ? OMNI : TOK).find(([re]) => re.test(path));
    if (!hit) return isOmni ? paged(route, []) : json(route, []);
    if (path === "/onboarding/applications") {
      const result = url.searchParams.get("identityResult") as CheckedApplication["identityResult"];
      return paged(route, result === "MISMATCH" ? [application(result)] : []);
    }
    if (path === "/onboarding/documents" && url.searchParams.get("status") === "PASSED") return paged(route, []);
    return hit[1].paged ? paged(route, hit[1].body as unknown[]) : json(route, hit[1].body);
  });
  // signIn's /auth/me stub was added first; re-add it so it wins over the catch-all above.
  await page.route(/\/tok\/auth\/me$/, (route) => json(route, { email: "amina@baracel.ae", fullName: "Amina Ops", roles: ["ADMIN"], admin: true }));
  return { writes };
}

/** Picks `option` in the searchable picker labelled `group` inside `scope`. */
export async function pick(scope: import("@playwright/test").Locator, group: string, option: string | RegExp) {
  await scope.getByRole("group", { name: group }).getByRole("button").first().click();
  await scope.page().getByRole("option", { name: option }).first().click();
}

/** A write the page sent: method, path after the service prefix, and its JSON body. */
export type Sent = { method: string; path: string; query: string; body: unknown; subject?: string };

export function sentFrom(route: Route): Sent {
  const req = route.request();
  const url = new URL(req.url());
  let body: unknown = null;
  try { body = req.postDataJSON(); } catch { body = req.postData(); }
  return {
    method: req.method(),
    path: url.pathname.replace(/^\/omni\/api\/operator|^\/tok/, ""),
    query: url.search,
    body,
    subject: req.headers()["x-dev-subject"],
  };
}
