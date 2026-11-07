/* The KTDA farmer journey: register, activate (a wallet opens), fund.

   The contract as omnichannel built it (branch feat/farmer-registration-
   activation; not merged or deployed everywhere yet). Everything this back
   office relies on about it lives in this file: flow names, CSV columns,
   gates, endpoint paths and shapes. Where an environment does not have it
   yet, the pages say "not available on this environment yet".

   The lifecycle (no other states; setting a PIN does not change it):
     REGISTERED  on the register, login claimable, no wallet. In real life the
                 farmer then finishes onboarding in the app or on the web.
     ACTIVATED   wallet open and linked, not paid yet. In the demo a CSV stands
                 in for the farmers' own onboarding: the app does not open a
                 wallet yet, so the file is the only way here today.
     FUNDED      the wallet has been credited at least once.
   and, off the way:
     CLASH       on the register, but the phone given is already another
                 farmer's login, so no login was made (clashReason says so).
                 Held until the phone is put right; never activated or paid. */

/** The bulk-loads flow values. ONBOARDING stays as the one-step flow. */
export type BulkFlow = "ONBOARDING" | "REGISTRATION" | "ACTIVATION" | "PAYMENT";

/** What a flow's CSV takes. REGISTRATION and ACTIVATION find their columns by
 *  header name, in any order, ignoring extra columns; ONBOARDING and PAYMENT
 *  read them by position. No value may contain a comma. */
export type FlowColumns = { required: string[]; optional: string[]; byName: boolean; notes?: string };

export const COLUMNS: Record<BulkFlow, FlowColumns> = {
  ONBOARDING: { required: ["grower_no", "national_id", "full_name", "msisdn"], optional: [], byName: false },
  REGISTRATION: {
    required: ["grower_no", "full_name", "msisdn"], optional: ["factory", "national_id"], byName: true,
  },
  ACTIVATION: {
    required: ["grower_no"], optional: ["national_id", "date_of_birth", "id_document_ref"], byName: true,
    notes: "national_id is needed unless registration gave one (a different one replaces it); date_of_birth as YYYY-MM-DD.",
  },
  PAYMENT: { required: ["grower_no", "amount_kes", "payment_ref"], optional: [], byName: false },
};

/** Every column a flow reads, required first: the template's header. */
export const BULK_COLUMNS: Record<BulkFlow, string[]> = Object.fromEntries(
  (Object.keys(COLUMNS) as BulkFlow[]).map((f) => [f, [...COLUMNS[f].required, ...COLUMNS[f].optional]]),
) as Record<BulkFlow, string[]>;

/** Flows not on every environment yet: an upload of one there says "not
 *  available on this environment yet", and never falls back to ONBOARDING. */
export const NEW_FLOWS: ReadonlySet<BulkFlow> = new Set(["REGISTRATION", "ACTIVATION"]);

/** GET /bulk-loads/onboarding-status?institutionId= . registrationCompleted
 *  is missing on an omnichannel without the journey. */
export type OnboardingStatus = {
  /** Any farmer has a wallet: a PARTIAL activation counts, so does ONBOARDING. */
  onboardingCompleted: boolean;
  /** Anyone is on the register, a farmer registered singly included. */
  registrationCompleted?: boolean;
};

/** Which answer of onboarding-status opens a step. Omnichannel refuses the
 *  upload (409) either way: ACTIVATION with nobody registered, PAYMENT with
 *  nobody activated. */
export const GATE: Partial<Record<BulkFlow, keyof OnboardingStatus>> = {
  ACTIVATION: "registrationCompleted",
  PAYMENT: "onboardingCompleted",
};

/** A REGISTRATION run posts nothing to the ledger, so it has no
 *  reconciliation (omnichannel answers 409); do not ask for one. An
 *  ACTIVATION run has one once wallets were opened (amounts 0), and answers
 *  409 when nobody was eligible. */
export const HAS_RECONCILIATION: Record<BulkFlow, boolean> = { ONBOARDING: true, REGISTRATION: false, ACTIVATION: true, PAYMENT: true };

/** The three steps, in order, as the demo walks them. */
export type JourneyStep = {
  n: 1 | 2 | 3;
  flow: BulkFlow;
  title: string;
  /** Where the step's upload page is. */
  to: string;
  /** What one processed row means for this step. */
  processed: string;
  /** What a skipped row means. */
  skipped: string;
  /** One line on what the step does, for the overview. */
  does: string;
};

export const JOURNEY: JourneyStep[] = [
  {
    n: 1, flow: "REGISTRATION", title: "Register farmers", to: "/journey/register",
    processed: "Farmers registered", skipped: "Already registered with the same phone",
    does: "Creates each farmer's record from their grower number and basic details. No wallet and no PIN yet.",
  },
  {
    n: 2, flow: "ACTIVATION", title: "Farmer onboarding (simulated)", to: "/journey/activate",
    processed: "Wallets opened", skipped: "Already activated, or named twice in the file",
    does: "Stands in for the farmers finishing onboarding themselves in the app or on the web. Opens and links each farmer's KES wallet.",
  },
  {
    n: 3, flow: "PAYMENT", title: "Fund wallets", to: "/bulk/payments",
    processed: "Wallets credited", skipped: "Already applied",
    does: "Credits the farmers' wallets. Each payment_ref is applied once, so a file is safe to send again.",
  },
];

export const stepFor = (flow: BulkFlow) => JOURNEY.find((s) => s.flow === flow) ?? null;

/* ---- Farmers (omnichannel, scoped to this back office's institution) ---- */

export type FarmerState = "REGISTERED" | "ACTIVATED" | "FUNDED" | "CLASH";
/** The three steps of the way, in order. CLASH is not one of them. */
export const FARMER_STATES: FarmerState[] = ["REGISTERED", "ACTIVATED", "FUNDED"];
/** Every state a farmer can be in, the held one last. */
export const ALL_FARMER_STATES: FarmerState[] = [...FARMER_STATES, "CLASH"];
export const STATE_LABEL: Record<FarmerState, string> = {
  REGISTERED: "Registered",
  ACTIVATED: "Activated",
  FUNDED: "Funded",
  CLASH: "Clash",
};
export const STATE_MEANS: Record<FarmerState, string> = {
  REGISTERED: "On the register, still has to onboard: no wallet yet",
  ACTIVATED: "Wallet open, not paid yet",
  FUNDED: "Wallet credited at least once",
  CLASH: "Held: the phone given is already another farmer's login, so no login was made",
};
export const STATE_TONE: Record<FarmerState, "neutral" | "info" | "success" | "warning"> = {
  REGISTERED: "neutral", ACTIVATED: "info", FUNDED: "success", CLASH: "warning",
};

/** One farmer. The national ID is never returned. */
export type Farmer = {
  growerNo: string;
  fullName: string | null;
  /** E.164, "+2547…". */
  phone: string | null;
  factory: string | null;
  status: FarmerState;
  registeredAt: string | null;
  activatedAt: string | null;
  lastFundedAt: string | null;
  /** The farmer's omnichannel profile, once they have one (the Customer
   *  desk's id); null before. Older omnichannel leaves it out. */
  customerId?: string | null;
  /** Why a CLASH farmer is held; null otherwise. Older omnichannel leaves it out. */
  clashReason?: string | null;
  /** Where the farmer's KYC stands. Older omnichannel leaves it out. */
  kyc?: FarmerKyc | null;
};

/* ---- Farmer KYC ----
   Opening a farmer's wallet puts their register details (names, national ID,
   date of birth) through the population registry and screening and marks
   them PENDING; compliance then decides. A farmer the check could not start
   for (no national ID, no date of birth, the check failed) stays NONE with
   the reason in `note`, and can be started again. KYC does not hold payments
   back for now. */

export type KycStatus = "NONE" | "PENDING" | "VERIFIED" | "REJECTED";
export const KYC_STATUSES: KycStatus[] = ["NONE", "PENDING", "VERIFIED", "REJECTED"];
export const KYC_LABEL: Record<KycStatus, string> = { NONE: "Not started", PENDING: "To decide", VERIFIED: "Verified", REJECTED: "Rejected" };
export const KYC_TONE: Record<KycStatus, "neutral" | "warning" | "success" | "danger"> = { NONE: "neutral", PENDING: "warning", VERIFIED: "success", REJECTED: "danger" };

/** What the population registry said. UNCHECKED where no registry is set up. */
export type KycIdentityResult = "MATCH" | "MISMATCH" | "NOT_FOUND" | "DECEASED" | "UNCHECKED";
export const IDENTITY_LABEL: Record<KycIdentityResult, string> = {
  MATCH: "Matches the registry", MISMATCH: "Differs from the registry", NOT_FOUND: "Not in the registry",
  DECEASED: "Registry records them as deceased", UNCHECKED: "Registry not checked",
};
export const IDENTITY_TONE: Record<KycIdentityResult, "success" | "danger" | "warning" | "neutral"> = {
  MATCH: "success", MISMATCH: "danger", NOT_FOUND: "danger", DECEASED: "danger", UNCHECKED: "warning",
};

/** `note`: why it has not started (NONE), or compliance's note on the decision. */
export type FarmerKyc = {
  status: KycStatus;
  identityResult: KycIdentityResult | null;
  startedAt: string | null;
  decidedAt: string | null;
  note: string | null;
};

/** POST /farmers/{growerNo}/kyc/decision. note up to 300 characters. 409
 *  when KYC has not started (the message says why). */
export type KycDecisionBody = { decision: "VERIFIED" | "REJECTED"; note?: string };
export const KYC_NOTE_MAX = 300;

/** POST /farmers/kyc/sweep (202) starts KYC, in the background, for every
 *  activated farmer still at NONE: the backlog activated before KYC existed.
 *  409 with code KYC_SWEEP_RUNNING while one runs for this institution. GET
 *  answers the latest sweep, 404 when none has run. INTERRUPTED: the service
 *  restarted mid-run; a new sweep carries on where it left off. `started`
 *  are now PENDING; `notStarted` are still NONE, each with the reason on
 *  their own record. Both grow while RUNNING. */
export type KycSweepStatus = "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED";
export type KycSweep = {
  id: string;
  status: KycSweepStatus;
  total: number;
  started: number;
  notStarted: number;
  requestedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
};
export const KYC_SWEEP_PATH = "/farmers/kyc/sweep";
export const KYC_SWEEP_RUNNING = "KYC_SWEEP_RUNNING";
export const SWEEP_LABEL: Record<KycSweepStatus, string> = { RUNNING: "Running", COMPLETED: "Finished", FAILED: "Failed", INTERRUPTED: "Interrupted" };
export const SWEEP_TONE: Record<KycSweepStatus, "info" | "success" | "danger" | "warning"> = { RUNNING: "info", COMPLETED: "success", FAILED: "danger", INTERRUPTED: "warning" };

/** GET /farmers/summary: over the whole institution, not a filtered list.
 *  activated leaves out the funded, so the counts add up to total. `clash`
 *  (farmers held as CLASH) is missing on an older omnichannel. */
export type FarmersSummary = {
  registered: number; activated: number; funded: number; total: number; clash?: number; kycPending?: number;
  /** Farmers per KYC status; missing on an omnichannel before the sweep. */
  kyc?: { none: number; pending: number; verified: number; rejected: number };
};
export const SUMMARY_KEY: Record<FarmerState, "registered" | "activated" | "funded" | "clash"> = { REGISTERED: "registered", ACTIVATED: "activated", FUNDED: "funded", CLASH: "clash" };

/** POST /farmers. Only growerNo, fullName and phone are required; phone may
 *  be 07…, 2547… or +2547…. 201 when this call registered the farmer, 200
 *  when they were already registered with the same phone, 409 when the grower
 *  number is held with a different phone or national ID, 400 for a bad value
 *  (no code beyond the status; the message says what). */
export type RegisterFarmer = { growerNo: string; fullName: string; phone: string; nationalId?: string; factory?: string };

/** GET /farmers?state=&kyc=&q=&page=&size= : a plain array, paged by the X-Total-*
 *  headers, page from 1, size up to 100. q matches grower number and name
 *  (contains, any case) and the phone however it is typed. */
export const FARMERS_PATH = "/farmers";
export const FARMERS_SUMMARY_PATH = "/farmers/summary";
export const farmerPath = (growerNo: string) => `${FARMERS_PATH}/${encodeURIComponent(growerNo)}`;
/** GET: the farmer behind an omnichannel profile; 404 when it is not one of this institution's farmers. */
export const farmerByCustomerPath = (customerId: string) => `${FARMERS_PATH}/by-customer/${encodeURIComponent(customerId)}`;
export const FARMERS_MAX_SIZE = 100;

/** GET /farmers/{growerNo}/wallet. `balances` is empty and `walletOpen` false
 *  for a farmer who is only registered; 404 for a grower that is not this
 *  institution's. */
export type FarmerWallet = {
  growerNo: string;
  status: FarmerState;
  walletOpen: boolean;
  balances: { currency: string; available: number; updatedAt: string | null }[];
};

/** GET /farmers/{growerNo}/wallet/movements?currency=&page=&size= : a plain
 *  array, newest first, paged by the X-Total-* headers; empty before the
 *  wallet is open. The amount is always positive: `type` says CREDIT (in) or
 *  DEBIT (out). currency defaults to KES on omnichannel's side. */
export type WalletMovement = {
  reference: string;
  type: "CREDIT" | "DEBIT";
  event: string | null;
  amount: number;
  currency: string;
  description: string | null;
  occurredAt: string;
};

/* ---- Not on this environment yet ---- */

/** What the page says when this environment's omnichannel has no such flow
 *  or endpoint. */
export const NOT_AVAILABLE = "Not available on this environment yet: omnichannel here does not have the farmer journey. It needs the omnichannel release with registration and activation.";

/** Whether a failed call means "this environment does not have it": an
 *  unknown path or method (404, 405, 501), or an omnichannel without the new
 *  flows answering 400 "Parameter 'flow' must be a valid BulkFlow". A 404 for
 *  one farmer (GET /farmers/{growerNo}) is an ordinary not-found, not this. */
export function notBuiltYet(status: number, message: string | null | undefined): boolean {
  if (status === 404 || status === 405 || status === 501) return true;
  return status === 400 && /parameter 'flow'|bulkflow/i.test(message ?? "");
}

/* ---- Template and samples ---- */

/** A header-only CSV for the flow: required columns, then the optional ones. */
export const templateCsv = (flow: BulkFlow) => `${BULK_COLUMNS[flow].join(",")}\n`;

export const templateName = (flow: BulkFlow) => `ktda-${flow.toLowerCase()}-template.csv`;

/** Five test farmers, the same growers through all three steps (public/demo). */
export const SAMPLE_FILES: Partial<Record<BulkFlow, string>> = {
  REGISTRATION: "demo/ktda-journey/1-register.csv",
  ACTIVATION: "demo/ktda-journey/2-activate.csv",
  PAYMENT: "demo/ktda-journey/3-fund.csv",
};
