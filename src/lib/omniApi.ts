/* Omnichannel's staff (operator) endpoints — the only part of omnichannel a
 * back office uses. Omnichannel owns the customer's identity and channels, not
 * their records, so most of what BO Admin *shows* comes from the tokenization
 * service (tokApi.ts). The reads that are omnichannel's own: for compliance,
 * the applications the population-registry check flagged and the selfie and
 * ID photos (the queue waiting for a decision, and every photo one customer
 * sent); for support, one customer's standing, money, messages and activity.
 *
 * Same-origin `/omni/*` (Vite proxy / functions/omni / nginx), which forwards
 * only these calls and only for a caller with a live BO Admin session. */

export class OmniApiError extends Error {
  readonly status: number;
  /** The request field omnichannel blamed (a 400 on `haltedOfferings`, say). */
  readonly field: string | null;
  /** Omnichannel's stable error code (`CHANGE_PENDING`, …), when it sent one. */
  readonly code: string | null;
  constructor(status: number, message: string, field: string | null = null, code: string | null = null) {
    super(message);
    this.name = "OmniApiError";
    this.status = status;
    this.field = field;
    this.code = code;
  }
}

/** A 401 from omnichannel or the proxy in front of it: the BO Admin session
 *  has ended, or the call did not say who is acting (the payment
 *  decisions refuse to act for nobody). Either way signing in again fixes it;
 *  the raw message ("No authenticated subject") would not tell anyone that. */
const SIGN_IN_AGAIN = "Omnichannel could not tell who you are, so nothing was done. Please sign out, sign in again and retry.";

/** Omnichannel's 403 for a call that names no institution: every operator
 *  call is scoped to one, which the proxy in front of it sets from this back
 *  office's configuration (OMNI_INSTITUTION_ID). */
export const INSTITUTION_REQUIRED = "OPERATOR_INSTITUTION_REQUIRED";
const NO_INSTITUTION =
  "This back office has no institution configured, so omnichannel answered nothing. Ask whoever runs it to set OMNI_INSTITUTION_ID.";

/** The error for a failed response, from omnichannel's envelope
 *  ({message, code, field}) or the proxies' ({error}). */
function errorFrom(status: number, data: unknown): OmniApiError {
  const env = (data && typeof data === "object" ? data : {}) as {
    error?: string; message?: string; detail?: string; field?: string; code?: string;
  };
  const message = status === 401 ? SIGN_IN_AGAIN
    : env.code === INSTITUTION_REQUIRED ? NO_INSTITUTION
    : env.detail ?? env.message ?? env.error ?? `Request failed (${status}).`;
  return new OmniApiError(status, message, env.field ?? null, env.code ?? null);
}

const BASE = `${import.meta.env.VITE_OMNI_BASE ?? "/omni"}/api/operator`;

/* Who is acting, for omnichannel's audit (`reviewedBy`) and its maker-checker
   (a payment run's submitter and releaser must differ): UAT omnichannel takes
   it from X-Dev-Subject. The dev proxy and functions/omni set that header
   themselves from the verified engine session and drop any a browser sends.
   The UAT box's nginx cannot read the session, so every call also carries the
   signed-in staff member's subject as X-Operator-Subject, which that nginx
   forwards as X-Dev-Subject (deploy/nginx/ktda-bo-admin.conf). That is a
   UAT-only convenience: the browser states who it is. Production must use
   omnichannel's secured profile with real staff tokens. */
export const OPERATOR_HEADER = "X-Operator-Subject";
let operatorSubject: string | null = null;

/** Who the calls below act as: the signed-in staff member (auth.tsx), or
 *  nobody once they sign out. */
export function setOmniOperator(email: string | null | undefined) {
  operatorSubject = email ? omniSubjectFor(email) : null;
}

/** What omnichannel records when a call carries no X-Dev-Subject. */
const NO_SUBJECT = "dev-operator";

/** The subject omnichannel records for this staff member: the value the
 *  proxies set as X-Dev-Subject from the session.
 *  Compare a record's `proposedBy` / `decidedBy` with this, never with the
 *  bare email. */
export function omniSubjectFor(email: string | null | undefined): string {
  return email ? `staff:${email}` : NO_SUBJECT;
}

/** A recorded subject as a person reads it: the email without `staff:`. */
export function staffName(subject: string | null | undefined): string {
  if (!subject) return "—";
  return subject.startsWith("staff:") ? subject.slice("staff:".length) : subject;
}

/** A FormData body goes as multipart: the browser sets Content-Type with
 *  its boundary, so it is never set here. Anything else goes as JSON. */
async function send(method: "GET" | "POST" | "PUT", path: string, body?: unknown, accept?: string): Promise<Response> {
  const form = body instanceof FormData;
  const headers: Record<string, string> = {};
  if (body !== undefined && !form) headers["Content-Type"] = "application/json";
  if (operatorSubject) headers[OPERATOR_HEADER] = operatorSubject;
  if (accept) headers.Accept = accept;
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new OmniApiError(0, "Cannot reach the omnichannel service. Check your connection and try again.");
  }
}

async function failure(res: Response): Promise<OmniApiError> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return errorFrom(res.status, data);
}

/* Every omnichannel list is paged: `page` from 1, `size` 20 by default and at
 * most 100, the body a plain array, the totals in X-Total-Pages and friends.
 * The compliance screens need whole lists (they join and count them), so
 * this walks the pages. */
const PAGE_SIZE = 100;

async function getAll<T>(path: string, onPage?: (res: Response) => void): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await send("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${PAGE_SIZE}`);
    if (!res.ok) throw await failure(res);
    onPage?.(res);
    const items = (await res.json()) as T[];
    all.push(...items);
    // No header means a service (or proxy) that does not page: it sent the whole list.
    const pages = Number(res.headers.get("X-Total-Pages"));
    if (!res.headers.has("X-Total-Pages") || !Number.isFinite(pages) || page >= pages || items.length < PAGE_SIZE) return all;
  }
}

/** One page of a list, and how many pages there are. */
export type Page<T> = { items: T[]; page: number; pages: number; total: number };

async function getPage<T>(path: string, page: number, size: number): Promise<Page<T>> {
  const res = await send("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${size}`);
  if (!res.ok) throw await failure(res);
  const items = (await res.json()) as T[];
  const num = (name: string, fallback: number) => {
    const v = Number(res.headers.get(name));
    return res.headers.has(name) && Number.isFinite(v) ? v : fallback;
  };
  // Without the headers (a service that does not page) this is the whole list.
  return { items, page, pages: num("X-Total-Pages", page), total: num("X-Total-Count", items.length) };
}

async function postWithStatus<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await send("POST", path, body);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw errorFrom(res.status, data);
  return { status: res.status, data: data as T };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return (await postWithStatus<T>(path, body)).data;
}

/** The tokenization product, as omnichannel names it; `externalRef` is the
 *  accounting investor id. */
const PRODUCT = "TOKENIZATION";

export type LinkCode = { id: string; product: string; externalRef: string; code: string; expiresAt: string };
export type SentNotification = { id: string; type: string; delivery: string };
export type InvestorStanding = { investorId: string; legalName: string; kycStatus: string };

export type IdentityResult = "MATCH" | "MISMATCH" | "UNCHECKED";

/** An application as compliance sees it, with the population-registry result.
 *  `identityMismatches` names the fields that differ ("name", …); the
 *  customer never sees it. `externalRef` is the accounting investor id. */
export type CheckedApplication = {
  id: string;
  profileId: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  identityResult: IdentityResult;
  identityMismatches: string[] | null;
  identitySource: string | null;
  identityCheckedAt: string | null;
  screeningClear: boolean;
  product: string;
  externalRef: string;
  submittedAt: string;
  /** When they were last re-screened after onboarding; null until the first
   *  refresh. */
  rescreenedAt?: string | null;
  /** What the last re-screen said; null until the first refresh. */
  rescreenClear?: boolean | null;
  rescreenReference?: string | null;
};

/** What one re-screening sweep did. */
export type RescreenResult = { screened: number; hits: number };

/** A support request on the desk: the customer's ticket with their name. */
export type DeskTicket = {
  id: string;
  /** What the customer quotes: `SR-` and six characters. */
  reference: string;
  profileId: string;
  customer: string | null;
  category: string;
  subject: string;
  description: string;
  status: "NEW" | "ACKNOWLEDGED" | "INVESTIGATING" | "RESOLVED" | "CLOSED" | string;
  assignedTo: string | null;
  submittedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
};

/** The subject omnichannel gives a customer's own closure request. */
export const CLOSURE_SUBJECT = "Account closure request";

export type DocumentType = "SELFIE" | "ID_FRONT" | "ID_BACK";

/** A selfie or ID photo: waiting for compliance, or decided. */
export type QueuedDocument = {
  id: string;
  profileId: string;
  type: DocumentType;
  contentType: string;
  sizeBytes: number;
  status: "PENDING_REVIEW" | "PASSED" | "FAILED";
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  uploadedAt: string;
};

export type ContactView = {
  id: string;
  type: "MOBILE" | "EMAIL" | "WHATSAPP" | string;
  value: string;
  verified: boolean;
  primary: boolean;
  createdAt: string;
};

export type ProductLinkView = { id: string; product: string; externalRef: string; status: string; linkedAt: string };

/** One customer as support sees them: profile, contacts in full, product
 *  links and the live standing in the product, and whether push reaches them. */
export type CustomerSummary = {
  profileId: string;
  displayName: string | null;
  legalName: string | null;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "CLOSED" | string;
  registeredAt: string;
  contacts: ContactView[];
  links: ProductLinkView[];
  account: { linked: boolean; investorId: string | null; legalName: string | null; kycStatus: string; canInvest: boolean } | null;
  activeDevices: number;
  pushEnabled: boolean;
};

/** A reinstatement or closure proposed under dual control (BRD FR-ADM-03).
 *  `customer` is the profile's display name; `profileStatus` its standing
 *  now, so a decided row shows whether it took effect. */
export type Intervention = {
  id: string;
  profileId: string;
  customer: string | null;
  action: "REINSTATE" | "CLOSE" | string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | string;
  proposedBy: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  profileStatus: CustomerSummary["status"] | null;
};

/** M-Pesa payments and payouts (`MPESA`) merged with the product's own
 *  movements (`PRODUCT`), newest first. `direction` is from the customer's
 *  side: OUT is money leaving them. */
export type TimelineEntry = {
  occurredAt: string;
  source: "MPESA" | "PRODUCT" | string;
  kind: string;
  label: string;
  direction: "IN" | "OUT" | string;
  amount: number | null;
  currency: string | null;
  status: string | null;
  reference: string | null;
  detail: string | null;
};

/** One M-Pesa payment or payout in the list across customers: a timeline
 *  entry with whose it is. `customer` is null only for a profile that has
 *  since been removed. */
export type CustomerTransactionEntry = TimelineEntry & { id: string; profileId: string; customer: string | null };

/** What the Transactions page asks for; every part is optional. `from` is
 *  inclusive and `to` exclusive, both ISO instants. */
export type TransactionQuery = { status?: string; kind?: string; from?: string; to?: string; q?: string };

export type TransactionTotal = { count: number; amount: number };
/** The matching payments added up, one entry per currency. */
export type TransactionTotals = { currency: string; collected: TransactionTotal; paidOut: TransactionTotal; failed: TransactionTotal; pending: TransactionTotal };

function transactionParams(query: TransactionQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** A body that is not the list asked for: an older omnichannel answers 404,
 *  but a proxy that does not know the path may hand back the app's own page. */
async function listOf<T>(res: Response): Promise<T[]> {
  const data: unknown = await res.json().catch(() => null);
  if (!Array.isArray(data)) throw new OmniApiError(404, "This list is not available on this server yet.");
  return data as T[];
}

export type SentMessage = {
  id: string;
  type: string;
  title: string;
  body: string;
  reference: string | null;
  /** Whether the push went out; the inbox always has the message. */
  delivery: "PENDING" | "SENT" | "NO_DEVICE" | "FAILED" | "MUTED" | string;
  readAt: string | null;
  createdAt: string;
};

/** A payment as omnichannel holds it (M-Pesa, or a bank transfer). */
export type PaymentView = {
  id: string;
  direction: "IN" | "OUT" | string;
  status: "PENDING" | "PAID" | "SENT" | "FAILED" | string;
  method: string;
  phone: string | null;
  amount: number;
  currency: string;
  reference: string | null;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Whether the customer was prompted in the app (newer omnichannel). */
  promptInApp?: boolean | null;
};

/** Something on the payments side that needs a person (BRD FR-STL-05):
 *  a payout the provider refused, a reported transfer still unmatched after
 *  the wait, or a payout still PENDING with no answer from the gateway after
 *  PAYMENT_UNCONFIRMED_AFTER (PAYOUT_UNCONFIRMED: it may or may not have been
 *  paid, so it is confirmed sent or not sent after checking with the gateway,
 *  never retried first). `why` is written to be read. */
export type PaymentIssue = {
  profileId: string;
  payment: PaymentView;
  kind: "PAYOUT_FAILED" | "TRANSFER_WAITING" | "PAYOUT_UNCONFIRMED" | string;
  why: string;
};

/** The whole queue; `truncated` when omnichannel cut a kind at its cap, so
 *  the queue holds more than `items`. */
export type PaymentIssueList = { items: PaymentIssue[]; truncated: boolean };

/** A surveillance alert as the reporting service keeps it; omnichannel passes
 *  it through unchanged, so the fields are snake_case. `subject_id` is the
 *  customer's profile id; `offering_id` is set for wash trading only. */
export type SurveillanceAlert = {
  id: string;
  rule: "CAP_STRUCTURING" | "ABNORMAL_VOLUME" | "WASH_TRADING" | string;
  severity: "LOW" | "MEDIUM" | "HIGH" | string;
  subject_type: "PROFILE" | string;
  subject_id: string;
  offering_id: string | null;
  period_date: string;
  status: "OPEN" | "ASSIGNED" | "CLOSED" | string;
  summary: string;
  /** The thresholds that tripped, written to be read. */
  details: string | null;
  assigned_to: string | null;
  closed_by: string | null;
  close_note: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type AlertStatus = "OPEN" | "ASSIGNED" | "CLOSED";

/** One snapshot, rule run or report the reporting service did. */
export type ReportingRun = {
  id: string;
  kind: "SNAPSHOT" | "RULES" | "REPORT" | string;
  /** The day it ran over, or the report's name. */
  subject: string | null;
  started_at: string;
  finished_at: string | null;
  status: "RUNNING" | "DONE" | "FAILED" | string;
  detail: string | null;
};

export type ReportName = "transactions" | "holdings" | "token-supply" | "suspicious-activity";

/** A report as the service produced it, ready to save. */
export type CsvDownload = { filename: string; blob: Blob };

/** The file name in a Content-Disposition header, or null without one. */
function filenameOf(disposition: string | null): string | null {
  const m = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1].trim()) : null;
}

export type CustomerAction = { id: string; action: string; target: string | null; outcome: number | null; requestId: string | null; occurredAt: string };

export type CustomerQuery = { phone: string } | { email: string } | { investorId: string } | { profileId: string };

async function getOne<T>(path: string): Promise<T> {
  const res = await send("GET", path);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** The plain calls, for clients of omnichannel's operator API kept in their
 *  own module (api.bulkLoad.ts). `post` with a FormData sends a multipart
 *  upload. */
export const omniCall = {
  get: getOne,
  /** A file omnichannel answers with (a CSV), named as its Content-Disposition says.
   *  `accept` asks a path that answers JSON or CSV for the CSV. */
  download: async (path: string, fallbackName: string, accept?: string): Promise<CsvDownload> => {
    const res = await send("GET", path, undefined, accept);
    if (!res.ok) throw await failure(res);
    return { filename: filenameOf(res.headers.get("Content-Disposition")) ?? fallbackName, blob: await res.blob() };
  },
  list: async <T>(path: string): Promise<T[]> => {
    const res = await send("GET", path);
    if (!res.ok) throw await failure(res);
    return listOf<T>(res);
  },
  /** One page of a paged list (X-Total-* headers), page from 1. */
  page: getPage,
  post,
  /** A POST whose success status matters (201 created vs 200 already there). */
  postWithStatus,
  put: async <T>(path: string, body: unknown): Promise<T> => (await putWithStatus<T>(path, body)).data,
  /** A PUT whose success status matters (202 staged for approval vs 200 applied). */
  putWithStatus,
};

async function putWithStatus<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await send("PUT", path, body);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw errorFrom(res.status, data);
  return { status: res.status, data: data as T };
}

const paymentPath = (id: string) => `/payments/${encodeURIComponent(id)}`;
const interventionPath = (id: string) => `/customers/interventions/${encodeURIComponent(id)}`;
const reportingPath = "/reporting";
const alertPath = (id: string) => `${reportingPath}/alerts/${encodeURIComponent(id)}`;

/** Omnichannel lists applications by registry result only, so this reads
 *  each result until one matches. */
async function findApplication(match: (a: CheckedApplication) => boolean): Promise<CheckedApplication | null> {
  const results: IdentityResult[] = ["MISMATCH", "UNCHECKED", "MATCH"];
  for (const result of results) {
    const found = (await omniApi.applications(result)).find((a) => a.product === PRODUCT && match(a));
    if (found) return found;
  }
  return null;
}

const customerPath = (id: string) => `/customers/${encodeURIComponent(id)}`;

export const omniApi = {
  /** A one-time code the investor enters in the app to link this record to
   *  their profile. */
  issueLinkCode: (investorId: string) =>
    post<LinkCode>("/link-codes", { product: PRODUCT, externalRef: investorId }),
  /** 404 when no app profile is linked to the record yet. */
  notifyInvestor: (investorId: string, title: string, body: string) =>
    post<SentNotification>("/notifications", { product: PRODUCT, externalRef: investorId, title, body }),
  setKycStatus: (investorId: string, kycStatus: "VERIFIED" | "PENDING" | "REJECTED") =>
    post<InvestorStanding>(`/investors/${encodeURIComponent(investorId)}/kyc-status`, { kycStatus }),

  /** Applications by registry result; omnichannel's default is MISMATCH. */
  applications: (identityResult: IdentityResult = "MISMATCH") =>
    getAll<CheckedApplication>(`/onboarding/applications?identityResult=${identityResult}`),
  /** The app application behind an accounting investor, whatever the registry
   *  said; null when they never applied through the app (staff onboarded). */
  applicationFor: (investorId: string) => findApplication((a) => a.externalRef === investorId),
  /** The app application one profile made, whatever the registry said; null
   *  when they have not applied. */
  applicationOfProfile: (profileId: string) => findApplication((a) => a.profileId === profileId),
  /** Photos waiting for a decision, oldest first. */
  pendingDocuments: () => getAll<QueuedDocument>("/onboarding/documents"),
  /** Every accepted photo, across customers, newest first. */
  acceptedDocuments: () => getAll<QueuedDocument>("/onboarding/documents?status=PASSED"),
  /** Every photo one app profile sent, decided ones included, newest first. */
  customerDocuments: (profileId: string) =>
    getAll<QueuedDocument>(`/onboarding/documents?profileId=${encodeURIComponent(profileId)}`),
  /** The image itself. Each view is audited (DOCUMENT_VIEWED), so screens load
   *  it only when someone opens that applicant. */
  documentImage: async (id: string): Promise<Blob> => {
    const res = await send("GET", `/onboarding/documents/${encodeURIComponent(id)}/content`);
    if (!res.ok) throw await failure(res);
    return res.blob();
  },
  /** Customers by a verified phone (international format), a verified email,
   *  their investor id or their profile id; empty when nothing matches. */
  findCustomers: (q: CustomerQuery) => {
    const [key, value] = Object.entries(q)[0];
    return getAll<CustomerSummary>(`/customers?${key}=${encodeURIComponent(value)}`);
  },
  customer: async (profileId: string): Promise<CustomerSummary> => {
    const res = await send("GET", customerPath(profileId));
    if (!res.ok) throw await failure(res);
    return (await res.json()) as CustomerSummary;
  },
  customerTimeline: (profileId: string, page: number, size = 20) =>
    getPage<TimelineEntry>(`${customerPath(profileId)}/timeline`, page, size),
  customerMessages: (profileId: string, page: number, size = 20) =>
    getPage<SentMessage>(`${customerPath(profileId)}/messages`, page, size),
  customerActivity: (profileId: string, page: number, size = 20) =>
    getPage<CustomerAction>(`${customerPath(profileId)}/activity`, page, size),
  /** Every customer's M-Pesa payments and payouts, newest first. 404 when
   *  omnichannel (or the proxy in front of it) predates the list. */
  transactions: async (query: TransactionQuery, page: number, size = 50): Promise<Page<CustomerTransactionEntry>> => {
    const qs = transactionParams(query);
    const res = await send("GET", `/transactions?${qs ? `${qs}&` : ""}page=${page}&size=${size}`);
    if (!res.ok) throw await failure(res);
    const items = await listOf<CustomerTransactionEntry>(res);
    const num = (name: string, fallback: number) => {
      const v = Number(res.headers.get(name));
      return res.headers.has(name) && Number.isFinite(v) ? v : fallback;
    };
    return { items, page, pages: num("X-Total-Pages", page), total: num("X-Total-Count", items.length) };
  },
  /** The same payments added up per currency; empty when nothing matches. */
  transactionTotals: async (query: TransactionQuery): Promise<TransactionTotals[]> => {
    const qs = transactionParams(query);
    const res = await send("GET", `/transactions/summary${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw await failure(res);
    return listOf<TransactionTotals>(res);
  },
  /** Stops the profile acting; every money call answers 409 until it is
   *  reinstated. 409 unless the profile is active. Audited. */
  suspendCustomer: (profileId: string, note?: string) =>
    post<CustomerSummary>(`${customerPath(profileId)}/suspend`, note ? { note } : {}),
  /** Proposes lifting a suspension (BRD FR-ADM-03): 202 with the proposal,
   *  PENDING; the profile is unchanged until someone else approves. 409
   *  unless suspended, or CHANGE_PENDING while another proposal waits. */
  proposeReinstate: (profileId: string, note?: string) =>
    post<Intervention>(`${customerPath(profileId)}/reinstate`, note ? { note } : {}),
  /** Proposes closing the app profile for good, normally from the
   *  customer's own closure request: 202 PENDING until someone else
   *  approves. The investor is offboarded on the engine separately. 409 when
   *  already closed, or CHANGE_PENDING while another proposal waits. */
  proposeClose: (profileId: string, note?: string) =>
    post<Intervention>(`${customerPath(profileId)}/close`, note ? { note } : {}),
  /** One customer's proposals, newest first, every page (the service pages
   *  this list; an older one that does not sends it whole). */
  customerInterventions: (profileId: string) => getAll<Intervention>(`${customerPath(profileId)}/interventions`),
  /** The queue waiting for a second person (oldest first), or the whole
   *  log (`ALL`, newest first), a page at a time. */
  interventions: (status: "PENDING" | "ALL", page: number, size = 20) =>
    getPage<Intervention>(`/customers/interventions?status=${status}`, page, size),
  /** Carried out now: the profile moves and the customer is told. 409
   *  SECOND_APPROVER_REQUIRED for the proposer, CHANGE_DECIDED once decided. */
  approveIntervention: (id: string, note?: string) =>
    post<Intervention>(`${interventionPath(id)}/approve`, note ? { note } : {}),
  /** Turned down by anyone, the proposer included; nothing changes. */
  rejectIntervention: (id: string, note?: string) =>
    post<Intervention>(`${interventionPath(id)}/reject`, note ? { note } : {}),
  /** Customers a nightly re-screening referred, latest first; each is back
   *  under review on the engine. 404 where omnichannel predates it. */
  screeningHits: (page: number, size = 20) =>
    getPage<CheckedApplication>("/onboarding/applications/screening-hits", page, size),
  /** Runs the re-screening sweep now instead of at night. */
  rescreen: () => post<RescreenResult>("/onboarding/applications/rescreen", {}),
  /** One customer's support requests in every status, latest updated first. */
  customerTickets: (profileId: string, page: number, size = 20) =>
    getPage<DeskTicket>(`/support/tickets?profileId=${encodeURIComponent(profileId)}`, page, size),
  /** The queue of requests: everything not closed, longest waiting first,
   *  narrowed to what `q` finds in the reference and the subject. */
  tickets: (q: string, page: number, size = 20) =>
    getPage<DeskTicket>(`/support/tickets?q=${encodeURIComponent(q)}`, page, size),
  /** Refused payouts and transfers unmatched after the wait, oldest first,
   *  every page. Omnichannel lists at most 500 of each kind and says so with
   *  `X-Truncated: true`; without the header (older omnichannel too) the
   *  list is taken as whole. */
  paymentIssues: async (): Promise<PaymentIssueList> => {
    let truncated = false;
    const items = await getAll<PaymentIssue>("/payments/issues", (res) => {
      if (res.headers.get("X-Truncated")?.trim().toLowerCase() === "true") truncated = true;
    });
    return { items, truncated };
  },
  /** A failed payout sent again to the same phone; 201 with the new payment.
   *  409 for anything else or when already handled. */
  retryPayout: (id: string) => post<PaymentView>(`${paymentPath(id)}/retry`, {}),
  /** A failed payout paid another way; the note is required. 409 for a
   *  transfer (match or mark it unmatched instead) or when already handled. */
  resolvePayment: (id: string, note: string) => post<PaymentView>(`${paymentPath(id)}/resolve`, { note }),
  /** The transfer arrived: PAID with the bank's reference, balance credited. */
  matchTransfer: (id: string, bankReference: string) => post<PaymentView>(`${paymentPath(id)}/match`, { bankReference }),
  /** The transfer never came: FAILED with the reason the customer reads. */
  markTransferUnmatched: (id: string, reason: string) => post<PaymentView>(`${paymentPath(id)}/unmatched`, { reason }),
  /** A payout the gateway never answered for, which the gateway says it paid:
   *  SENT with its receipt (at most 64 characters). 409 unless still PENDING. */
  confirmPayoutSent: (id: string, receipt: string) => post<PaymentView>(`${paymentPath(id)}/confirm-sent`, { receipt }),
  /** …which the gateway says it did not pay: FAILED, then a PAYOUT_FAILED to
   *  retry or resolve. The note (at most 300) says how it was confirmed. */
  confirmPayoutNotSent: (id: string, note: string) => post<PaymentView>(`${paymentPath(id)}/confirm-not-sent`, { note }),
  /** FAILED needs a note: the customer receives it as a message. 409 when it
   *  is no longer pending (someone else decided). */
  reviewDocument: (id: string, decision: "PASSED" | "FAILED", note?: string) =>
    post<QueuedDocument>(`/onboarding/documents/${encodeURIComponent(id)}/review`, { decision, note }),

  /* Reports and surveillance, from the reporting service through omnichannel
   * (/reporting). Until the service is switched on every call is a 503 saying
   * so; an unreachable service or a refused key is a 503 too. Audited. */

  /** A report as CSV. Dates are days (YYYY-MM-DD), inclusive, at most 400
   *  days apart (else 400); 404 for holdings on a day with no snapshot. */
  report: async (name: ReportName, params: Record<string, string | undefined> = {}): Promise<CsvDownload> => {
    const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
    const res = await send("GET", `${reportingPath}/reports/${name}.csv${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw await failure(res);
    return { filename: filenameOf(res.headers.get("Content-Disposition")) ?? `${name}.csv`, blob: await res.blob() };
  },
  /** The alert queue, newest first; every status when none is given. The
   *  service returns at most `limit` (it caps it at 500) and does not page. */
  alerts: async (status?: AlertStatus, limit = 100): Promise<SurveillanceAlert[]> => {
    const res = await send("GET", `${reportingPath}/alerts?${status ? `status=${status}&` : ""}limit=${limit}`);
    if (!res.ok) throw await failure(res);
    return listOf<SurveillanceAlert>(res);
  },
  alert: (id: string) => getOne<SurveillanceAlert>(alertPath(id)),
  /** Assigned to the staff member calling, taking it from anyone holding it.
   *  409 once closed. */
  assignAlert: (id: string) => post<SurveillanceAlert>(`${alertPath(id)}/assign`, {}),
  /** Closed by the staff member calling, with what was found (at most 500
   *  characters). 409 when already closed. */
  closeAlert: (id: string, note?: string) => post<SurveillanceAlert>(`${alertPath(id)}/close`, note ? { note } : {}),
  /** What ran lately, newest first; the service caps `limit` at 500. */
  reportingRuns: async (limit = 50): Promise<ReportingRun[]> => {
    const res = await send("GET", `${reportingPath}/runs?limit=${limit}`);
    if (!res.ok) throw await failure(res);
    return listOf<ReportingRun>(res);
  },
  /** Takes (or retakes) the end-of-day holdings snapshot for a day. */
  runSnapshot: (asOf: string) =>
    post<{ asOf: string; rows: number }>(`${reportingPath}/runs/snapshot?asOf=${encodeURIComponent(asOf)}`, undefined),
  /** Runs the three surveillance rules over a day; an alert is never raised twice. */
  runSurveillance: (day: string) =>
    post<{ day: string; newAlerts: number }>(`${reportingPath}/runs/surveillance?day=${encodeURIComponent(day)}`, undefined),
};
