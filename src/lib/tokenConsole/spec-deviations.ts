/* Where the live server disagrees with its own OpenAPI document.
   =====================================================================
   types.gen.ts is generated from /v3/api-docs and must not be hand-edited —
   the next `npm run gen:types` would silently discard the edit. Corrections
   that come from OBSERVING the running service therefore live here, each one
   recording what was actually seen so the next reader can re-check it rather
   than take my word for it.

   Verified 2026-09-02 against the UAT load balancer.
   ===================================================================== */

import type { LoanView, MeResponse, RepayResult, SignupRequest } from "./types.gen";

/* 1. POST /api/auth/signup
      Spec says: no response content (the generator therefore emitted `void`).
      Actually: 201 Created with a MeResponse body —
        {"email":"…","fullName":"…","roles":["ACCOUNTANT"],"admin":false}
      Using the spec's `void` would throw away the created account's details
      and force a second round trip to learn them. */
export type SignupResponse = MeResponse;

/* 2. The `role` field of SignupRequest
      Spec says:   "ADMIN" | "DEVELOPER" | "ACCOUNTANT" | "DEVOPS"
      Actually:    ADMIN is REJECTED with 400 {"error":"Please choose a valid role"}.
      That is the server behaving correctly — self-service signup must not be
      able to mint an administrator; admin comes from the approval workflow.
      The spec is what is wrong, and a form built from the generated enum
      would offer a role that always fails.

      Only ACCOUNTANT is confirmed accepted by observation. DEVELOPER and
      DEVOPS are listed by the spec and are NOT rejected on the same grounds
      as ADMIN by inspection, but neither has been exercised — creating extra
      accounts on a shared UAT box to prove it is not worth the litter. Left
      as the spec's list minus ADMIN, which is the narrowest claim the
      evidence supports. */
/** COMPLIANCE is on UAT's SignupRequest (2026-10-01; it alone with ADMIN may
 *  decide a KYC review) but not yet in types.gen.ts. Drop the union once the
 *  types are regenerated. */
export type SelfServiceRole = Exclude<SignupRequest["role"], "ADMIN"> | "COMPLIANCE";

export interface SelfServiceSignupRequest extends Omit<SignupRequest, "role"> {
  role: SelfServiceRole;
}

/* 3. Every account starts life pending.
      POST /api/auth/signup succeeds with 201, and the immediately following
      login fails 401 with {"error":"Your account is awaiting administrator
      approval"}. A signup form that redirects to the console on success is
      therefore wrong: it must say the account needs approval, or the user is
      dropped at a login screen that rejects the credentials they just chose. */
export const PENDING_APPROVAL_HINT =
  "Your account is awaiting administrator approval";

/* 4. AssetBackingRow.rungs is NOT a Rung.
      ------------------------------------------------------------------
      The document declares both `BondLadderView.rungs` and
      `AssetBackingRow.rungs` as the same `Rung` schema. They share not one
      field. Verified against live responses:

        BondLadderView.rungs   ladderSlot, isin, tenorYears, couponRate,
                               faceValueHeld, maturityDate      (a bond rung)

        AssetBackingRow.rungs  offeringId, productId, status, pricePerUnit,
                               totalUnits, issuedUnits, claimValue, currency
                               (an OFFERING claiming against the asset)

      This is springdoc keying schemas by simple class name: two unrelated
      Java records both called `Rung` collapse into one entry. `Rung` is the
      only schema in the document referenced by more than one parent, so this
      is the only collision — I checked rather than assumed.

      It matters more than a naming quibble. Rendering an asset-backing row
      through the generated `Rung` type compiles clean and yields `undefined`
      for every field at runtime — precisely the failure the types exist to
      prevent. Use `AssetBackingRowActual` for that endpoint. */
export interface AssetOfferingClaim {
  offeringId?: string;
  productId?: string;
  status?: string;
  /** BigDecimal — a JSON number. Format, never compute. */
  pricePerUnit?: number;
  totalUnits?: number;
  issuedUnits?: number;
  claimValue?: number;
  currency?: string;
}

export interface AssetBackingRowActual
  extends Omit<import("./types.gen").AssetBackingRow, "rungs"> {
  rungs?: AssetOfferingClaim[];
}

/* 5. Three primitive booleans the spec marks optional.
      ------------------------------------------------------------------
      CreateAccrualPolicyRequest.approved
      CreateAccrualPolicyRequest.scheduleEnabled
      CreateDistributionPolicyRequest.approved

      are `boolean` primitives in the Java records, not `Boolean`. The spec
      leaves them out of `required`, so the generator made them optional —
      but a primitive cannot be null, so Jackson fills an absent field with
      `false` instead of rejecting the request.

      That is the dangerous shape of this bug: omitting `approved` does NOT
      fail with a 400 that someone would notice. It silently creates an
      UNAPPROVED policy, and the only symptom is an accrual or distribution
      run that later does nothing. Requiring them here forces the form to
      make the choice explicit. */
type Required_<TObj, K extends keyof TObj> = Omit<TObj, K> & { [P in K]-?: TObj[P] };

export type CreateAccrualPolicyBody = Required_<
  import("./types.gen").CreateAccrualPolicyRequest,
  "approved" | "scheduleEnabled"
>;
export type CreateDistributionPolicyBody = Required_<
  import("./types.gen").CreateDistributionPolicyRequest,
  "approved"
>;

/* 6. The loan endpoints answer more than types.gen.ts knows.
      ------------------------------------------------------------------
      types.gen.ts carries LoanView / RepayResult from an earlier engine
      branch that never shipped. The engine's /api/accounting/loans/* (added
      2026-10-29, package A of the no-mocks work) answers the same fields plus:

        productId        the loan product
        pendingApproval  a posting on this loan is held for approval (at or
                         above the engine's approval threshold); it moves the
                         position only once approved on Journals
        annualRate, dayCount, rateSource
                         the TT-LOAN-RATE tariff in force today and the
                         tariff domain it resolved from; all null when no
                         rate resolves (an accrual is then refused)

      status is PENDING (nothing disbursed) · ACTIVE · SETTLED (nothing owed)
      · FROZEN · CLOSED. Drop this once the types are regenerated. */
export interface LoanViewActual extends LoanView {
  productId?: string;
  pendingApproval?: boolean;
  /** BigDecimal — a JSON number; a fraction (0.15 = 15%). */
  annualRate?: number | null;
  dayCount?: string | null;
  rateSource?: string | null;
}

export interface RepayResultActual extends Omit<RepayResult, "loan"> {
  loan?: LoanViewActual;
}

/* 7. Console paging (apps/PAGINATION-CONTRACT.md, 2026-11-12).
      ------------------------------------------------------------------
      Built to the contract the engine is implementing now, ahead of the
      regenerated spec. The list endpoints keep their row shapes and gain
      filter params (q, status, productId, ids, …) that apply in the database
      once page/size is sent; those are request-side and live in
      api.tokenConsole.ts. The aggregate endpoints the types do not know yet:

        GET /accounting/console/summary      ConsoleSummary
        GET /accounting/contracts/summary    ContractsSummary (?productId=…, repeatable)

      so no page has to read a whole table to show a total. Drop these once the
      types are regenerated. */

/** Status → how many, as the engine counts them. */
export type StatusCounts = Partial<Record<string, number>>;

/** One currency's books: every account in it and its total debits and credits. */
export interface CurrencyTotals {
  currency?: string | null;
  accounts?: number;
  totalDebit?: number;
  totalCredit?: number;
}

export interface ConsoleSummary {
  investors?: { total?: number; byStatus?: StatusCounts };
  products?: { total?: number };
  contracts?: { total?: number; byStatus?: StatusCounts };
  booksByCurrency?: CurrencyTotals[];
}

export interface ContractsSummary {
  total?: number;
  byStatus?: StatusCounts;
}
