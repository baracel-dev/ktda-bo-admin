/* Ported from apps/tokenization-web/src/lib/accounting/entityRegistry.ts.
   Lists come from the shared list store (sharedList.ts) rather than
   react-query, which BO Admin does not use; a create refreshes its list.

   Declarative specs for every reference entity the product form can point at.
   =====================================================================
   One spec per entity: how to list it, how to create it, and the fields its
   create form needs. A `ref` field names another spec, which is what lets
   the create flow recurse — a new service package needs an institution, so
   its institution field can itself create one. The recursion ends at
   entities with no ref fields (institution, the classification
   vocabularies), or at pick-only specs, which have no `useCreate`.

   The request types in types.gen.ts are precise; the generic form works on
   plain records. The two meet here and only here, through the
   `as unknown as` casts on each `useCreate`.
   ===================================================================== */

import type { AccountTemplate } from "./types.gen";
import { tokenConsole as tc } from "../api.tokenConsole";
import { invalidateList, useSharedList } from "./sharedList";
import { useAction } from "./useAction";
import type { ChangeType } from "./configChanges";
import { PENDING_CHANGES_KEY } from "./usePendingChanges";

export type FieldKind = "text" | "number" | "currency" | "enum" | "date" | "stringList" | "bool" | "ref" | "array";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** enum: the allowed values. */
  options?: readonly string[];
  /** ref: the registry key of the entity this field points at. */
  refEntity?: string;
  /** array: the fields of one row. */
  itemFields?: FieldSpec[];
  /** array: the noun on the add-row button. */
  itemLabel?: string;
  /** Span both grid columns. */
  wide?: boolean;
  /** text / stringList: send upper-cased (country and currency codes). */
  uppercase?: boolean;
  /** number: smallest accepted value. */
  min?: number;
}

type Row = Record<string, unknown>;

export interface CreateMutation {
  /** Resolves to the created row, or undefined when the call failed (see `error`). */
  run: (body: Row) => Promise<Row | undefined>;
  pending: boolean;
  error: string | null;
}

export interface EntitySpec {
  key: string;
  /** Lower-case noun: "service package". */
  label: string;
  useList: () => { data?: Row[]; isPending: boolean; error?: string };
  /** Omitted for pick-only entities. */
  useCreate?: () => CreateMutation;
  /** Maker-checker controlled: creating it stages this change instead, and it
   *  exists (and can be picked) only once someone else approves it. */
  staged?: ChangeType;
  idField: string;
  labelField: string;
  metaField?: string;
  fields: FieldSpec[];
}

export type CreatableSpec = EntitySpec & { useCreate: () => CreateMutation };
export const isCreatable = (spec: EntitySpec): spec is CreatableSpec => !!spec.useCreate;

/** Form state: strings for scalar inputs, booleans for checkboxes, row lists for arrays. */
export type FormValue = string | boolean | FormState[];
export type FormState = Record<string, FormValue>;

export const ASSET_CLASSES = ["BOND", "SUKUK", "MUTUAL_FUND", "EQUITY", "ETF", "FX", "DERIVATIVE", "MONEY_MARKET", "INDEX", "BALANCED"] as const;
/** A product can also be a loan (serviced on Loans, never offered to investors); an asset cannot —
 *  the engine refuses to register a LOAN asset. */
export const PRODUCT_ASSET_CLASSES = [...ASSET_CLASSES, "LOAN"] as const;
const ACCOUNT_ROLES: readonly NonNullable<AccountTemplate["accountRole"]>[] = [
  "PRINCIPAL", "ACCRUED_INTEREST", "TAX_WITHHELD", "SETTLEMENT_CASH", "BANK_CASH", "UNALLOCATED",
  "FEE_INCOME", "LIQUIDITY_EXPENSE", "INVESTOR_EXPENSE", "REALIZED_GAIN_LOSS",
  "LOAN_PRINCIPAL", "LOAN_INTEREST_RECEIVABLE", "INTEREST_INCOME", "PENALTY_INCOME",
];
const RATE_HINT = "A fraction: 0.05 means 5%.";

/* One shared list per entity (see sharedList.ts), and a create that refreshes it. */
const list = (key: string, fetch: () => Promise<unknown>) => () =>
  useSharedList(`tok:${key}`, fetch) as ReturnType<EntitySpec["useList"]>;
const create = (key: string, post: (body: never) => Promise<unknown>) => (): CreateMutation => {
  const action = useAction(async (body: Row) => {
    const created = (await post(body as never)) as Row;
    invalidateList(`tok:${key}`);
    return created;
  });
  return { run: action.run, pending: action.pending, error: action.error };
};
/* A create that goes through the change queue (configChanges.ts). Resolves to
   the change request, not a row: nothing exists until it is approved, so the
   list is left alone and the pending queue refreshed instead. */
const stage = (type: ChangeType) => (): CreateMutation => {
  const action = useAction(async (body: Row) => {
    const staged = (await tc.stageChange(type, body as never)) as unknown as Row;
    invalidateList(PENDING_CHANGES_KEY);
    return staged;
  });
  return { run: action.run, pending: action.pending, error: action.error };
};

/** Two-field vocabularies: a client-chosen id and a display name. */
function vocabulary(
  key: string, label: string, idField: string, nameField: string, idPlaceholder: string, namePlaceholder: string,
  fetchList: () => Promise<unknown>, post: (body: never) => Promise<unknown>,
  extra: FieldSpec[] = [],
): EntitySpec {
  return {
    key, label, idField, labelField: nameField, metaField: idField,
    useList: list(key, fetchList),
    useCreate: create(key, post),
    fields: [
      { key: idField, label: "ID", kind: "text", required: true, placeholder: idPlaceholder },
      { key: nameField, label: "Name", kind: "text", required: true, placeholder: namePlaceholder },
      ...extra,
    ],
  };
}

const specs: EntitySpec[] = [
  /* ---------------------------------------------------------- primitives */
  {
    key: "institution", label: "institution", idField: "institutionId", labelField: "name", metaField: "country",
    useList: list("institution", tc.institutions),
    useCreate: create("institution", tc.createInstitution),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "Nawiri", wide: true },
      { key: "localCurrency", label: "Local currency", kind: "currency", required: true, placeholder: "KES" },
      { key: "country", label: "Country", kind: "text", required: true, placeholder: "KE", uppercase: true },
      { key: "additionalCurrencies", label: "Other currencies", kind: "stringList", placeholder: "USD, EUR", hint: "Comma-separated.", uppercase: true, wide: true },
    ],
  },
  vocabulary("productGroup", "product group", "productGroupId", "groupName", "PG-FIXED-INCOME", "Fixed income",
    tc.productGroups, tc.createProductGroup),
  vocabulary("productCategory", "product category", "productCategoryId", "categoryName", "PC-UNIT-TRUST", "Unit trust",
    tc.productCategories, tc.createProductCategory),
  vocabulary("clientCategory", "client category", "clientCategoryId", "categoryName", "CC-RETAIL", "Retail",
    tc.clientCategories, tc.createClientCategory),
  vocabulary("contractSubtype", "contract subtype", "contractSubtypeId", "subtypeName", "CS-DIRECT-RETAIL", "Direct retail subscription",
    tc.contractSubtypes, tc.createContractSubtype),
  vocabulary("dateScheme", "date scheme", "dateSchemeId", "schemeName", "DS-MONTHLY", "Monthly distribution",
    tc.dateSchemes, tc.createDateScheme, [
      { key: "distributionFrequency", label: "Distribution frequency", kind: "text", placeholder: "MONTHLY" },
      { key: "valuationFrequency", label: "Valuation frequency", kind: "text", placeholder: "DAILY" },
    ]),
  vocabulary("reportType", "report type", "reportTypeId", "reportName", "RT-STATEMENT", "Investor statement",
    tc.reportTypes, tc.createReportType, [
      { key: "templateRef", label: "Template ref", kind: "text", placeholder: "statement_v1", wide: true },
    ]),
  {
    key: "asset", label: "asset", idField: "assetId", labelField: "name", metaField: "status",
    useList: list("asset", () => tc.assets()),
    useCreate: create("asset", tc.registerAsset),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "Kenya IFB 2032", wide: true },
      { key: "assetClass", label: "Asset class", kind: "enum", required: true, options: ASSET_CLASSES },
      { key: "currency", label: "Currency", kind: "currency", required: true, placeholder: "KES" },
      { key: "appreciationRate", label: "Appreciation rate", kind: "number", hint: RATE_HINT },
      { key: "valuationAmount", label: "Valuation", kind: "number", min: 0 },
      { key: "description", label: "Description", kind: "text", wide: true, hint: "New assets start as Draft and need approval before they back anything." },
    ],
  },

  /* ---------------------------------------------------------- assemblies */
  {
    key: "scheme", label: "accounting scheme", idField: "schemeId", labelField: "name", metaField: "schemeId",
    useList: list("scheme", tc.schemes),
    useCreate: stage("SCHEME_CREATE"),
    staged: "SCHEME_CREATE",
    fields: [
      { key: "schemeId", label: "Scheme ID", kind: "text", required: true, placeholder: "SCH-UNIT-TRUST" },
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "Unit trust scheme" },
      { key: "institutionId", label: "Institution", kind: "ref", refEntity: "institution", required: true },
      { key: "parentSchemeId", label: "Parent scheme", kind: "ref", refEntity: "scheme" },
      {
        key: "templates", label: "Account templates", kind: "array", itemLabel: "template", wide: true,
        hint: "Map each account role to a chart-of-accounts code. Leave the code blank to use the role's default.",
        itemFields: [
          { key: "accountRole", label: "Role", kind: "enum", required: true, options: ACCOUNT_ROLES },
          { key: "accountCode", label: "Account", kind: "ref", refEntity: "chartOfAccount", placeholder: "Role default" },
          { key: "scope", label: "Scope", kind: "enum", options: ["PER_CONTRACT", "PER_INSTITUTION"] },
          { key: "availableBalance", label: "Available balance", kind: "bool" },
        ],
      },
    ],
  },
  {
    key: "servicePackage", label: "service package", idField: "packageId", labelField: "name", metaField: "packageId",
    useList: list("servicePackage", tc.servicePackages),
    useCreate: stage("SERVICE_PACKAGE_CREATE"),
    staged: "SERVICE_PACKAGE_CREATE",
    fields: [
      { key: "packageId", label: "Package ID", kind: "text", required: true, placeholder: "PKG-RETAIL" },
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "Retail package" },
      { key: "institutionId", label: "Institution", kind: "ref", refEntity: "institution", required: true },
      { key: "packageType", label: "Package type", kind: "enum", required: true, options: ["PRODUCT", "ADDITIONAL"] },
      { key: "distributionFrequency", label: "Distribution frequency", kind: "text", placeholder: "MONTHLY" },
      { key: "tariffDomainId", label: "Tariff domain", kind: "ref", refEntity: "tariffDomain" },
      { key: "parentPackageId", label: "Parent package", kind: "ref", refEntity: "servicePackage", wide: true },
    ],
  },
  {
    key: "tariffDomain", label: "tariff domain", idField: "tariffDomainId", labelField: "name", metaField: "tariffDomainId",
    useList: list("tariffDomain", tc.tariffDomains),
    useCreate: stage("TARIFF_DOMAIN_CREATE"),
    staged: "TARIFF_DOMAIN_CREATE",
    fields: [
      { key: "tariffDomainId", label: "Domain ID", kind: "text", required: true, placeholder: "TD-RETAIL-KES" },
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "Retail KES tariffs" },
      { key: "institutionId", label: "Institution", kind: "ref", refEntity: "institution", required: true },
      { key: "domainCategory", label: "Category", kind: "text", placeholder: "RETAIL" },
      { key: "parentDomainId", label: "Parent domain", kind: "ref", refEntity: "tariffDomain", wide: true },
    ],
  },
  {
    key: "fund", label: "fund", idField: "fundId", labelField: "name", metaField: "registrationRef",
    useList: list("fund", tc.funds),
    useCreate: create("fund", tc.createFund),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "Fixed Income Fund" },
      { key: "institutionId", label: "Institution", kind: "ref", refEntity: "institution", required: true },
      { key: "registrationRef", label: "Registration ref", kind: "text", placeholder: "CMA/UT/2026/014", wide: true },
    ],
  },
  {
    key: "subFund", label: "sub-fund", idField: "subFundId", labelField: "name", metaField: "baseCurrency",
    useList: list("subFund", tc.subFunds),
    useCreate: create("subFund", tc.createSubFund),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "KES Fixed Income" },
      { key: "fundId", label: "Fund", kind: "ref", refEntity: "fund", required: true },
      { key: "baseCurrency", label: "Base currency", kind: "currency", required: true, placeholder: "KES" },
      { key: "assetId", label: "Backing asset", kind: "ref", refEntity: "asset" },
      { key: "inceptionDate", label: "Inception date", kind: "date" },
      { key: "appreciationRate", label: "Appreciation rate", kind: "number", hint: RATE_HINT },
      { key: "minInvestmentAmount", label: "Minimum investment", kind: "number", min: 0 },
      { key: "lockUpDays", label: "Lock-up (days)", kind: "number", min: 0 },
      { key: "exitFeeRate", label: "Exit fee rate", kind: "number", min: 0, hint: RATE_HINT },
      { key: "gatePct", label: "Redemption gate", kind: "number", min: 0, hint: RATE_HINT },
      { key: "facilitySize", label: "Liquidity facility", kind: "number", min: 0, wide: true },
    ],
  },

  /* ---------------------------------------------------------- pick-only */
  {
    key: "chartOfAccount", label: "account", idField: "accountCode", labelField: "accountName", metaField: "accountCode",
    useList: list("chartOfAccount", tc.chart),
    fields: [],
  },
  {
    key: "product", label: "product", idField: "productId", labelField: "name", metaField: "productId",
    useList: list("product", tc.products),
    fields: [],
  },
];

export const registry: Record<string, EntitySpec> = Object.fromEntries(specs.map((s) => [s.key, s]));

export function getSpec(key: string): EntitySpec {
  const spec = registry[key];
  if (!spec) throw new Error(`No entity spec registered for "${key}"`);
  return spec;
}

/* ------------------------------------------------------------ form state */

export function blankState(fields: FieldSpec[]): FormState {
  const state: FormState = {};
  for (const f of fields) {
    if (f.kind === "bool") state[f.key] = false;
    else if (f.kind === "array") state[f.key] = [];
    // A required enum has no "none" option, so it starts on its first value.
    else if (f.kind === "enum" && f.required && f.options?.length) state[f.key] = f.options[0];
    else state[f.key] = "";
  }
  return state;
}

const text = (v: FormValue | undefined) => (typeof v === "string" ? v.trim() : "");
const rowsOf = (v: FormValue | undefined) => (Array.isArray(v) ? v : []);

/** The first problem with the form, or undefined when it can be submitted. */
export function validate(fields: FieldSpec[], state: FormState): string | undefined {
  for (const f of fields) {
    const v = state[f.key];
    if (f.kind === "array") {
      // Rows are added explicitly, so every row is checked — none is dropped
      // for looking empty, since a role alone is a complete template.
      for (const [i, row] of rowsOf(v).entries()) {
        const problem = validate(f.itemFields ?? [], row);
        if (problem) return `${f.label}, row ${i + 1}: ${problem}`;
      }
      continue;
    }
    if (f.kind === "bool") continue;
    const s = text(v);
    if (f.required && s === "") return `${f.label} is required.`;
    if (f.kind === "number" && s !== "") {
      const n = Number(s);
      if (!Number.isFinite(n)) return `${f.label} must be a number.`;
      if (f.min !== undefined && n < f.min) return `${f.label} cannot be below ${f.min}.`;
    }
    if (f.kind === "currency" && s !== "" && !/^[A-Za-z]{3}$/.test(s)) return `${f.label} must be a three-letter code.`;
  }
  return undefined;
}

/** Turn form state into a request body: blank optionals are dropped, numbers
 *  and booleans coerced, and lists split. */
export function buildBody(fields: FieldSpec[], state: FormState): Row {
  const body: Row = {};
  for (const f of fields) {
    const v = state[f.key];
    switch (f.kind) {
      case "bool":
        body[f.key] = v === true;
        break;
      case "array": {
        const rows = rowsOf(v).map((row) => buildBody(f.itemFields ?? [], row));
        if (rows.length) body[f.key] = rows;
        break;
      }
      case "stringList": {
        const items = text(v).split(",").map((x) => x.trim()).filter(Boolean)
          .map((x) => (f.uppercase ? x.toUpperCase() : x));
        if (items.length) body[f.key] = items;
        break;
      }
      default: {
        const s = text(v);
        if (s === "") break;
        if (f.kind === "number") body[f.key] = Number(s);
        else if (f.kind === "currency" || f.uppercase) body[f.key] = s.toUpperCase();
        else body[f.key] = s;
      }
    }
  }
  return body;
}

/** The id of a just-created row: the server's, or the one the client chose. */
export function createdId(spec: EntitySpec, data: Row | undefined, body: Row): string | undefined {
  const id = data?.[spec.idField] ?? body[spec.idField];
  return typeof id === "string" && id !== "" ? id : undefined;
}
