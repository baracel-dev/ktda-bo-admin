import { SUB_FUNDS, type SubFundCode } from "./fund";
import { HOLDINGS } from "./investor";

/** Configuration + party layer, modelled on `docs/platform-data-specification-
 * presentation.html` — the data & accounting spec for the *live* platform
 * database. Until now the apps modelled two sub-funds directly; the real
 * schema hangs everything off a configuration chain:
 *
 *   Institution → Product → Contract → (unit ledger, general ledger)
 *
 * with service packages, accounting schemes and tariff domains as reusable
 * objects a product points at. Adding a product is meant to be a data change,
 * never a code change, which only works if the chain actually exists.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHANGE: NAV and AUM stay computed per
 * sub-fund in `fund.ts`. The spec gives each product its own bond ladder and
 * its own NAV; this fund's income and growth variants share one ladder and one
 * published price, and diverge only in what a distribution does (pay cash vs.
 * capitalise). Splitting the published NAV per variant would change every
 * investor-visible number for a modelling nicety, so units are split across
 * the sibling products and the price stays the sub-fund's. Flagged rather than
 * guessed — see "Where the apps and the docs still diverge" in CLAUDE.md. */

export type Currency = "KES" | "USD";

// ---- Institution (the tenant root) ----

export type Institution = {
  id: string;
  name: string;
  /** Legal parentage. Separate from `configParentId` on purpose: a
   * subsidiary's legal parent and its configuration source need not match. */
  parentInstitutionId: string | null;
  /** Configuration inheritance — provisioning a new institution copies a
   * bundle from this one; the link can stay live or be broken. */
  configParentId: string | null;
  localCurrency: Currency;
  country: string;
  defaultTariffDomainId: string;
};

export const INSTITUTION: Institution = {
  id: "INSTC-KE",
  name: "Nawiri",
  parentInstitutionId: null,
  configParentId: null,
  localCurrency: "KES",
  country: "KE",
  defaultTariffDomainId: "TD-INSTC-DEFAULT",
};

/** Ledger positions that belong to the institution rather than to any one
 * investor: its own cash, the unallocated funds register, fee income, and the
 * two expense accounts. One row per (institution, currency, purpose) — the
 * institution-side counterpart to an investor's contract, so no GL account is
 * ever an unowned bucket. */
export type InstitutionAccountPurpose =
  | "BANK_CASH" | "UNALLOCATED" | "FEE_INCOME" | "LIQUIDITY_EXPENSE" | "INVESTOR_EXPENSE";

export const INSTITUTION_ACCOUNT_LABELS: Record<InstitutionAccountPurpose, string> = {
  BANK_CASH: "Bank / mirror cash",
  UNALLOCATED: "Unallocated funds register",
  FEE_INCOME: "Management fee income",
  LIQUIDITY_EXPENSE: "Liquidity facility expense",
  INVESTOR_EXPENSE: "Investor interest expense",
};

export type InstitutionAccount = {
  id: string;
  institutionId: string;
  currency: Currency;
  purpose: InstitutionAccountPurpose;
};

const PURPOSES: InstitutionAccountPurpose[] =
  ["BANK_CASH", "UNALLOCATED", "FEE_INCOME", "LIQUIDITY_EXPENSE", "INVESTOR_EXPENSE"];

export const INSTITUTION_ACCOUNTS: InstitutionAccount[] = PURPOSES.flatMap((purpose) =>
  (["KES", "USD"] as Currency[]).map((currency) => ({
    id: `IA-${purpose}-${currency}`,
    institutionId: INSTITUTION.id,
    currency,
    purpose,
  })),
);

// ---- Tariffs ----

export type TariffValueKind = "percentage" | "amount";

export type TariffType = { id: string; role: string; valueKind: TariffValueKind; description: string };

export const TARIFF_TYPES: TariffType[] = [
  { id: "TT-COUPON", role: "Coupon rate", valueKind: "percentage", description: "What the fund pays investors on their balance — the input to nightly accrual." },
  { id: "TT-MGMT-FEE", role: "Management fee", valueKind: "percentage", description: "Annual fee accrued against NAV." },
  { id: "TT-REDEEM", role: "Redemption fee", valueKind: "percentage", description: "Early-exit charge inside the soft lock-up." },
  { id: "TT-LIQ-RATE", role: "Liquidity facility rate", valueKind: "percentage", description: "What the bank charges the fund on drawn facility — an expense, not investor income." },
];

/** A named container many products, packages or institutions can point at.
 * Changing the domain changes the rate everywhere it is referenced. */
export type TariffDomainScope = "institution" | "service_package" | "product" | "contract";
export type TariffDomain = { id: string; name: string; scope: TariffDomainScope };

export const TARIFF_DOMAINS: TariffDomain[] = [
  { id: "TD-INSTC-DEFAULT", name: "Nawiri default", scope: "institution" },
  { id: "TD-BRF-PKG-KES", name: "BRF retail package — KES", scope: "service_package" },
  { id: "TD-BRF-PKG-USD", name: "BRF retail package — USD", scope: "service_package" },
  { id: "TD-BRF-KES", name: "BRF KES sub-fund", scope: "product" },
  { id: "TD-BRF-USD", name: "BRF USD sub-fund", scope: "product" },
];

/** Day-count convention is a business decision per institution, recorded on
 * the tariff itself rather than defaulted in code (data spec §12), and it
 * plugs straight into the daily-rate divisor in `ledger.ts`. */
export type DayCountConvention = "actual/365" | "actual/360" | "30/360";

export const DAY_COUNT_LABELS: Record<DayCountConvention, string> = {
  "actual/365": "Actual / 365",
  "actual/360": "Actual / 360",
  "30/360": "30 / 360 (every month 30 days)",
};

export const DAY_COUNT_DIVISOR: Record<DayCountConvention, number> = {
  "actual/365": 365,
  "actual/360": 360,
  "30/360": 360,
};

/** The actual numbers, versioned by effective date with an approval flag, so a
 * rate change is staged ahead of the date it bites rather than edited in
 * place. `approved: false` means it is scheduled but not yet signed off —
 * `resolveTariff` will not return it. */
export type TariffValue = {
  id: string;
  tariffTypeId: string;
  domainId: string;
  currency: Currency;
  /** Percentage points, e.g. 1.0 = 1% p.a. */
  value: number;
  dayCount?: DayCountConvention;
  effectiveFrom: string;
  effectiveTo: string | null;
  approved: boolean;
  approvedBy?: string;
  /** Set while a rate change is in the maker-checker queue. */
  pendingApprovalId?: string;
  note?: string;
};

export const TARIFF_VALUES: TariffValue[] = [
  // Coupon — what accrual pays the investor. Set per sub-fund because the two
  // ladders yield differently; day-count is actual/365 across both.
  { id: "tv_coupon_kes", tariffTypeId: "TT-COUPON", domainId: "TD-BRF-KES", currency: "KES", value: 13.64, dayCount: "actual/365", effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo", note: "Tracks the KES ladder's 7-day yield; reviewed monthly against realised coupon receipts." },
  { id: "tv_coupon_usd", tariffTypeId: "TT-COUPON", domainId: "TD-BRF-USD", currency: "USD", value: 10.42, dayCount: "actual/365", effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo" },

  // Management fee — one rate across both currencies, priced at the package
  // domain. This is the link the data spec calls out as previously missing:
  // the package item below points at `tv_mgmt_*` by id, not by naming convention.
  { id: "tv_mgmt_kes", tariffTypeId: "TT-MGMT-FEE", domainId: "TD-BRF-PKG-KES", currency: "KES", value: 1.0, dayCount: "actual/365", effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo" },
  { id: "tv_mgmt_usd", tariffTypeId: "TT-MGMT-FEE", domainId: "TD-BRF-PKG-USD", currency: "USD", value: 1.0, dayCount: "actual/365", effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo" },

  { id: "tv_redeem_kes", tariffTypeId: "TT-REDEEM", domainId: "TD-BRF-PKG-KES", currency: "KES", value: 1.5, effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo", note: "Early-exit fee, charged only inside the soft lock-up window." },
  { id: "tv_redeem_usd", tariffTypeId: "TT-REDEEM", domainId: "TD-BRF-PKG-USD", currency: "USD", value: 1.5, effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo" },

  { id: "tv_liq_kes", tariffTypeId: "TT-LIQ-RATE", domainId: "TD-INSTC-DEFAULT", currency: "KES", value: 12.5, dayCount: "actual/365", effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo", note: "CBR 10.75% + 1.75% — restate whenever the CBK rate moves." },
  { id: "tv_liq_usd", tariffTypeId: "TT-LIQ-RATE", domainId: "TD-INSTC-DEFAULT", currency: "USD", value: 8.25, dayCount: "actual/365", effectiveFrom: "2026-04-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo" },

  // A staged change: signed off, dated forward. This is the whole point of
  // effective-dating — the new rate is already in the table and simply is not
  // the resolved one yet.
  { id: "tv_mgmt_kes_2027", tariffTypeId: "TT-MGMT-FEE", domainId: "TD-BRF-PKG-KES", currency: "KES", value: 0.9, dayCount: "actual/365", effectiveFrom: "2027-01-01", effectiveTo: null, approved: true, approvedBy: "Daniel Kiptoo", note: "Scaled fee agreed at the AUM covenant review — takes effect 1 Jan 2027." },
  // And one staged but unapproved, so the approval flag is visible as a real state.
  { id: "tv_coupon_kes_pending", tariffTypeId: "TT-COUPON", domainId: "TD-BRF-KES", currency: "KES", value: 13.9, dayCount: "actual/365", effectiveFrom: "2026-09-01", effectiveTo: null, approved: false, note: "Proposed after the September ladder re-price — awaiting Head of Finance sign-off." },
];

/** Resolution walks most-specific-first: a contract override, then the
 * product's domain, then the service package's, then the institution default.
 * First domain holding an approved value effective on that date wins.
 *
 * NOTE (data spec §5): contract-level overrides are modelled in the order but
 * no override table exists yet — every contract today resolves through its
 * product's configuration. The parameter is here so adding one later is a data
 * change, not a rewrite of every caller. */
export function resolveTariff(
  tariffTypeId: string,
  ctx: { contractDomainId?: string | null; productDomainId?: string | null; packageDomainId?: string | null; institutionDomainId?: string | null },
  currency: Currency,
  asOf: string = new Date().toISOString().slice(0, 10),
): TariffValue | null {
  const order = [ctx.contractDomainId, ctx.productDomainId, ctx.packageDomainId, ctx.institutionDomainId ?? INSTITUTION.defaultTariffDomainId];
  for (const domainId of order) {
    if (!domainId) continue;
    const candidates = TARIFF_VALUES.filter((v) =>
      v.tariffTypeId === tariffTypeId &&
      v.domainId === domainId &&
      v.currency === currency &&
      v.approved &&
      v.effectiveFrom <= asOf &&
      (v.effectiveTo === null || v.effectiveTo > asOf),
    );
    if (candidates.length) {
      // No uniqueness constraint on (type, domain, currency) — the spec is
      // explicit that two products in one domain can need different rates —
      // so take the latest effective one rather than assuming a single row.
      return candidates.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    }
  }
  return null;
}

// ---- Service packages ----

export type TransactionTypeDef = { id: string; label: string };

export const TRANSACTION_TYPES: TransactionTypeDef[] = [
  { id: "TXN-SUBSCRIPTION", label: "Subscription" },
  { id: "TXN-REDEMPTION", label: "Redemption" },
  { id: "TXN-TRANSFER", label: "Transfer" },
  { id: "TXN-DISTRIBUTION", label: "Distribution" },
];

export type FeeTypeDef = { id: string; label: string; tariffTypeId: string | null };

export const FEE_TYPES: FeeTypeDef[] = [
  { id: "FEE-MGMT", label: "Management fee", tariffTypeId: "TT-MGMT-FEE" },
  { id: "FEE-REDEEM", label: "Redemption fee", tariffTypeId: "TT-REDEEM" },
];

export type PackageType = "product" | "additional";

export type ServicePackage = {
  id: string;
  institutionId: string;
  name: string;
  packageType: PackageType;
  currency: Currency;
  tariffDomainId: string;
  distributionFrequency: string;
  minSubscription: number;
  liquidityFacility: number;
};

export const SERVICE_PACKAGES: ServicePackage[] = [
  { id: "SP-BRF-KES", institutionId: INSTITUTION.id, name: "BRF retail — KES", packageType: "product", currency: "KES", tariffDomainId: "TD-BRF-PKG-KES", distributionFrequency: "Monthly — last business day", minSubscription: 100, liquidityFacility: 100_000_000 },
  { id: "SP-BRF-USD", institutionId: INSTITUTION.id, name: "BRF retail — USD", packageType: "product", currency: "USD", tariffDomainId: "TD-BRF-PKG-USD", distributionFrequency: "Monthly — last business day", minSubscription: 10, liquidityFacility: 500_000 },
];

/** One operating rule inside a package. `itemRole` used to be the only
 * meaning-carrier (a free-text string); it now sits beside real lookups —
 * which transaction the rule applies to, what kind of fee it is, and the
 * tariff row carrying the actual rate. */
export type ServicePackageItem = {
  id: string;
  packageId: string;
  itemRole: string;
  label: string;
  transactionTypeId: string | null;
  feeTypeId: string | null;
  tariffId: string | null;
  note?: string;
};

export const SERVICE_PACKAGE_ITEMS: ServicePackageItem[] = [
  { id: "spi_mgmt_kes", packageId: "SP-BRF-KES", itemRole: "MANAGEMENT_FEE", label: "Management fee", transactionTypeId: null, feeTypeId: "FEE-MGMT", tariffId: "tv_mgmt_kes", note: "Periodic, not transaction-triggered — accrued nightly against NAV." },
  { id: "spi_mgmt_usd", packageId: "SP-BRF-USD", itemRole: "MANAGEMENT_FEE", label: "Management fee", transactionTypeId: null, feeTypeId: "FEE-MGMT", tariffId: "tv_mgmt_usd" },
  { id: "spi_exit_kes", packageId: "SP-BRF-KES", itemRole: "EARLY_EXIT_FEE", label: "Early-exit fee (inside lock-up)", transactionTypeId: "TXN-REDEMPTION", feeTypeId: "FEE-REDEEM", tariffId: "tv_redeem_kes" },
  { id: "spi_exit_usd", packageId: "SP-BRF-USD", itemRole: "EARLY_EXIT_FEE", label: "Early-exit fee (inside lock-up)", transactionTypeId: "TXN-REDEMPTION", feeTypeId: "FEE-REDEEM", tariffId: "tv_redeem_usd" },
  // The redemption tiers deliberately carry no fee type. Their direction is
  // paid_to_investor — they are notice-period/payout bands, not the
  // REDEMPTION_FEE charge FEE-REDEEM represents. Linking them would be a
  // plausible-looking but wrong connection (data spec §3).
  { id: "spi_tiers_kes", packageId: "SP-BRF-KES", itemRole: "REDEMPTION_TIERS", label: "Redemption notice tiers (4 bands)", transactionTypeId: "TXN-REDEMPTION", feeTypeId: null, tariffId: null, note: "Notice periods, not a charge — see REDEMPTION_TIERS in investor.ts." },
  { id: "spi_tiers_usd", packageId: "SP-BRF-USD", itemRole: "REDEMPTION_TIERS", label: "Redemption notice tiers (4 bands)", transactionTypeId: "TXN-REDEMPTION", feeTypeId: null, tariffId: null },
  { id: "spi_liq_kes", packageId: "SP-BRF-KES", itemRole: "LIQUIDITY_FACILITY", label: "Liquidity facility", transactionTypeId: null, feeTypeId: null, tariffId: "tv_liq_kes", note: "A capacity limit, not a transaction. The rate prices the fund's own cost of the facility." },
  { id: "spi_liq_usd", packageId: "SP-BRF-USD", itemRole: "LIQUIDITY_FACILITY", label: "Liquidity facility", transactionTypeId: null, feeTypeId: null, tariffId: "tv_liq_usd" },
  // No transfer fee has ever been priced here. TXN-TRANSFER exists as a lookup
  // so one can be added later, not because a rate exists today.
];

// ---- Accounting schemes ----

export type AccountRole =
  | "PRINCIPAL" | "ACCRUED_INTEREST" | "TAX_WITHHELD"
  | "BANK_CASH" | "UNALLOCATED" | "FEE_INCOME" | "LIQUIDITY_EXPENSE" | "INVESTOR_EXPENSE";

export type AccountingScheme = {
  id: string;
  institutionId: string;
  name: string;
  parentSchemeId: string | null;
};

export const ACCOUNTING_SCHEMES: AccountingScheme[] = [
  { id: "AS-BRF-STD", institutionId: INSTITUTION.id, name: "Retail bond fund, standard scheme", parentSchemeId: null },
];

/** Maps an abstract account role to a chart-of-accounts code for one scheme —
 * what turns a product configuration into actual, named ledger accounts.
 *
 * `scope` is the queryable answer to "one account per contract, or one shared
 * per institution?" rather than something inferred from seeding code.
 * `isAvailableBalance` is recorded (true only for PRINCIPAL and BANK_CASH) and
 * is read by `availableBalance()` in ledger.ts. */
export type AccountTemplate = {
  schemeId: string;
  role: AccountRole;
  code: string;
  scope: "per_contract" | "per_institution";
  isAvailableBalance: boolean;
};

export const ACCOUNT_TEMPLATES: AccountTemplate[] = [
  { schemeId: "AS-BRF-STD", role: "PRINCIPAL", code: "2000", scope: "per_contract", isAvailableBalance: true },
  { schemeId: "AS-BRF-STD", role: "ACCRUED_INTEREST", code: "2100", scope: "per_contract", isAvailableBalance: false },
  { schemeId: "AS-BRF-STD", role: "TAX_WITHHELD", code: "2200", scope: "per_contract", isAvailableBalance: false },
  { schemeId: "AS-BRF-STD", role: "BANK_CASH", code: "1000", scope: "per_institution", isAvailableBalance: true },
  { schemeId: "AS-BRF-STD", role: "UNALLOCATED", code: "1100", scope: "per_institution", isAvailableBalance: false },
  { schemeId: "AS-BRF-STD", role: "FEE_INCOME", code: "3000", scope: "per_institution", isAvailableBalance: false },
  { schemeId: "AS-BRF-STD", role: "LIQUIDITY_EXPENSE", code: "3100", scope: "per_institution", isAvailableBalance: false },
  { schemeId: "AS-BRF-STD", role: "INVESTOR_EXPENSE", code: "3200", scope: "per_institution", isAvailableBalance: false },
];

// ---- Products ----

export type AssetClass = "bond" | "equity" | "fx" | "derivative" | "money_market";
export type StructureType = "pooled_unitized" | "discretionary_mandate";
/** What a distribution *does*. The only thing separating the sibling products:
 * income pays cash out, growth capitalises the same accrual into principal and
 * new units. One accrual engine, two payout behaviours. */
export type DistributionClass = "income" | "growth";

export type Product = {
  id: string;
  name: string;
  institutionId: string;
  currency: Currency;
  /** Which sub-fund's ladder and published NAV price this product. Not in the
   * live schema — there, the ladder links to the product directly. Here the
   * two variants share one ladder, so this is the link back to `fund.ts`. */
  subFund: SubFundCode;
  distributionClass: DistributionClass;
  /** Growth is a variant of its income sibling — one entity defines what an
   * investor can subscribe to, rather than a separate unit-class table. */
  parentProductId: string | null;
  assetClass: AssetClass;
  structureType: StructureType;
  servicePackageId: string;
  accountingSchemeId: string;
  tariffDomainId: string;
  unitsOutstanding: number;
  /** Tokenization Level 1 hook (data spec §10). NULL on all four products —
   * the column exists so Phase 2 deploys a token contract and sets it, rather
   * than migrating a live ledger holding real investor money. */
  onchainTokenId: string | null;
  status: "open" | "closed_to_new" | "retired";
};

/** Units split across the sibling products. The sub-fund totals in `fund.ts`
 * are the source of truth and must not move — NAV composition is derived from
 * them — so the growth leg is the remainder, not a second rounded figure. */
function splitUnits(code: SubFundCode, incomeShare: number) {
  const total = SUB_FUNDS.find((f) => f.code === code)!.unitsOutstanding;
  const income = Math.round(total * incomeShare);
  return { income, growth: total - income };
}

const KES_UNITS = splitUnits("KES_FIXED_INCOME", 0.62);
const USD_UNITS = splitUnits("USD_EUROBOND", 0.44);

export const PRODUCTS: Product[] = [
  {
    id: "BRF-KES-INC", name: "BRF — KES Income Fund", institutionId: INSTITUTION.id, currency: "KES",
    subFund: "KES_FIXED_INCOME", distributionClass: "income", parentProductId: null,
    assetClass: "bond", structureType: "pooled_unitized",
    servicePackageId: "SP-BRF-KES", accountingSchemeId: "AS-BRF-STD", tariffDomainId: "TD-BRF-KES",
    unitsOutstanding: KES_UNITS.income, onchainTokenId: null, status: "open",
  },
  {
    id: "BRF-KES-GRW", name: "BRF — KES Growth Fund", institutionId: INSTITUTION.id, currency: "KES",
    subFund: "KES_FIXED_INCOME", distributionClass: "growth", parentProductId: "BRF-KES-INC",
    assetClass: "bond", structureType: "pooled_unitized",
    servicePackageId: "SP-BRF-KES", accountingSchemeId: "AS-BRF-STD", tariffDomainId: "TD-BRF-KES",
    unitsOutstanding: KES_UNITS.growth, onchainTokenId: null, status: "open",
  },
  {
    id: "BRF-USD-INC", name: "BRF — USD Income Fund", institutionId: INSTITUTION.id, currency: "USD",
    subFund: "USD_EUROBOND", distributionClass: "income", parentProductId: null,
    assetClass: "bond", structureType: "pooled_unitized",
    servicePackageId: "SP-BRF-USD", accountingSchemeId: "AS-BRF-STD", tariffDomainId: "TD-BRF-USD",
    unitsOutstanding: USD_UNITS.income, onchainTokenId: null, status: "open",
  },
  {
    id: "BRF-USD-GRW", name: "BRF — USD Growth Fund", institutionId: INSTITUTION.id, currency: "USD",
    subFund: "USD_EUROBOND", distributionClass: "growth", parentProductId: "BRF-USD-INC",
    assetClass: "bond", structureType: "pooled_unitized",
    servicePackageId: "SP-BRF-USD", accountingSchemeId: "AS-BRF-STD", tariffDomainId: "TD-BRF-USD",
    unitsOutstanding: USD_UNITS.growth, onchainTokenId: null, status: "open",
  },
];

/** The investor apps ask "which sub-fund, paying out or reinvesting?"; the
 * ledger asks "which product?". This is the one translation between them —
 * an election *is* a choice of sibling product, which is exactly what the data
 * spec means by modelling income/growth as products rather than unit classes. */
export function productFor(subFund: SubFundCode, election: "reinvest" | "payout"): Product {
  const wanted: DistributionClass = election === "reinvest" ? "growth" : "income";
  return PRODUCTS.find((p) => p.subFund === subFund && p.distributionClass === wanted)!;
}

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/** A product should never issue more units than its ladder can back. The data
 * spec is explicit that nothing enforces this at the database level today —
 * it is a documented rule, not a constraint. Modelled here as a readable
 * check so a capacity breach is at least visible rather than silent. */
export function productCapacity(productId: string): { capacityUnits: number; issuedUnits: number; withinCapacity: boolean } {
  const product = productById(productId)!;
  const fund = SUB_FUNDS.find((f) => f.code === product.subFund)!;
  const siblings = PRODUCTS.filter((p) => p.subFund === product.subFund);
  const siblingUnits = siblings.reduce((s, p) => s + p.unitsOutstanding, 0);
  // A product family with no units issued has no share to compute — return a
  // zero capacity rather than NaN, which would render as "—" everywhere and
  // silently read as "unknown" instead of "nothing issued".
  const share = siblingUnits > 0 ? product.unitsOutstanding / siblingUnits : 0;
  const capacityUnits = Math.round((fund.aum / fund.nav) * share);
  return { capacityUnits, issuedUnits: product.unitsOutstanding, withinCapacity: product.unitsOutstanding <= capacityUnits };
}

// ---- Contracts (the party layer; the contract is the wallet) ----

/** Frequent and operational, so a plain current-value column — unlike the
 * investor lifecycle, which needs point-in-time regulatory reconstruction and
 * lives in `classifiers.ts` as dated assignments. */
export type ContractStatus = "active" | "dormant" | "closing" | "closed";

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  active: "Active",
  dormant: "Dormant",
  closing: "Closing",
  closed: "Closed",
};

/** One investor identity, one contract per product. Currency is fixed at the
 * contract from the product, never at the investor — which is what lets one
 * identity hold a KES and a USD position without a second onboarding.
 *
 * There is no separate wallet object: the contract *is* the wallet. (The
 * `Wallet` in compliance.ts is a different thing — the account-status/
 * restriction record per client, which is what gates transacting.) */
export type InvestorContract = {
  id: string;
  clientId: string;
  productId: string;
  currency: Currency;
  status: ContractStatus;
  openedAt: string;
  /** Reserved for a future joint or umbrella relationship. Not required for a
   * single-product retail contract. */
  parentContractId: string | null;
  /** Tokenization Level 2 hook (data spec §10) — the investor's own on-chain
   * address. Column exists, unpopulated: a referral or an address never
   * substitutes for the investor's own onboarding and screening. */
  address: string | null;
  referredByIfaId: string | null;
};

/** Seeded from the current investor's holdings so the ledger has real
 * contracts to post against. A holding's election picks the product, so
 * switching election in the app moves the contract to the sibling product —
 * see `moveContractToSibling` in api.ts. */
export const INVESTOR_CONTRACTS: InvestorContract[] = HOLDINGS.map((h, i) => {
  const product = productFor(h.subFund, h.distributionElection);
  return {
    // The id deliberately does not embed the product: an election switch moves
    // the contract to its sibling product, and an id that named the old one
    // would be quietly wrong from that moment on.
    id: `CTR-${product.currency}-${String(i + 1).padStart(4, "0")}`,
    clientId: "inv_2891",
    productId: product.id,
    currency: product.currency,
    status: "active" as ContractStatus,
    openedAt: h.firstSubscribedAt,
    parentContractId: null,
    address: null,
    referredByIfaId: null,
  };
});

export function contractsForClient(clientId: string): InvestorContract[] {
  return INVESTOR_CONTRACTS.filter((c) => c.clientId === clientId);
}

export function contractForHolding(clientId: string, subFund: SubFundCode): InvestorContract | undefined {
  return INVESTOR_CONTRACTS.find((c) => c.clientId === clientId && productById(c.productId)?.subFund === subFund);
}

// ---- Tokenization readiness ----

export type TokenizationHook = {
  level: "product" | "investor" | "settlement";
  what: string;
  column: string;
  populated: number;
  total: number;
};

/** What Phase 2 activation would have to fill in. Reported rather than
 * asserted: every one of these is dormant today, and the honest count is what
 * makes "hooks present, not deployed" checkable instead of a claim. */
export function tokenizationHooks(entryCount: number, hashedCount: number): TokenizationHook[] {
  return [
    { level: "product", what: "The whole unit supply, issued once as a single token contract", column: "products.onchainTokenId", populated: PRODUCTS.filter((p) => p.onchainTokenId).length, total: PRODUCTS.length },
    { level: "investor", what: "The fraction of that supply an investor holds, in their own address", column: "investorContracts.address", populated: INVESTOR_CONTRACTS.filter((c) => c.address).length, total: INVESTOR_CONTRACTS.length },
    { level: "settlement", what: "On-chain proof that a specific mint or transfer happened", column: "ledgerEntries.onchainTxHash", populated: hashedCount, total: entryCount },
  ];
}
