import { CLIENTS, LEADS, SYSTEM_USERS, type Lead } from "./admin";
import { COMPLAINTS } from "./compliance";

/** CRM domain — the Business Development & Client Services SOP made concrete.
 *
 * The SOP is explicit that this is a known gap: "All enquiries are captured in
 * a controlled lead register **until a CRM is implemented**." That register is
 * `LEADS` in `admin.ts`; everything here is what the SOP assumes sits around
 * it — enquiry intake with a measurable acknowledgement SLA, an interaction
 * history, relationship ownership, commercial segmentation, the institutional
 * Bid/No-Bid pipeline, campaign attribution and the BD KPI set.
 *
 * TWO BOOKS, ONE DOMAIN. The retail book is thousands of self-service
 * contracts from KES 100 where no relationship exists per client — it needs a
 * service desk (enquiries, interactions, tasks, SLAs). The named book (HNWI,
 * institutional, IFA-introduced) is the only part with a pipeline. Both are
 * modelled here; the pipeline deliberately carries far fewer rows because it
 * is the smaller half of the problem, not the headline.
 *
 * TIPPING-OFF (Transaction Monitoring §17, STR §14): interaction notes and
 * enquiry text are written by, and read back to, staff who talk to customers.
 * They must never carry the reason an account is restricted. `complianceOnly`
 * below is the control — a non-Compliance user reads *that* an account is
 * restricted, never *why*. Adding a free-text field that leaks a case reason
 * would be a regulatory breach with a friendlier UI than the last one. */

export type CrmOwnerId = string;

export function ownerName(id: CrmOwnerId): string {
  return SYSTEM_USERS.find((u) => u.id === id)?.name ?? "Unassigned";
}

// ---- Enquiries ----

/** The object `enquiry_ack_days` finally has something to measure. Before
 * this, the SOP's one-business-day acknowledgement standard was a number in
 * Platform Settings with nothing to hold it against. */
export type EnquiryChannel = "ussd" | "agent" | "call_centre" | "app";
export type EnquiryCategory =
  | "missing_payment" | "wrong_number" | "agent_cashout" | "voucher_rejected"
  | "pin_reset" | "statement_request" | "other";
export type EnquiryStatus = "new" | "acknowledged" | "in_progress" | "resolved" | "converted" | "closed";

export const ENQUIRY_CHANNEL_LABELS: Record<EnquiryChannel, string> = {
  ussd: "USSD",
  agent: "Agent",
  call_centre: "Call centre",
  app: "App",
};

export const ENQUIRY_CATEGORY_LABELS: Record<EnquiryCategory, string> = {
  missing_payment: "Missing payment",
  wrong_number: "Wrong number",
  agent_cashout: "Cash-out not received",
  voucher_rejected: "Voucher not accepted",
  pin_reset: "PIN or access",
  statement_request: "Statement",
  other: "Other",
};

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  converted: "Converted",
  closed: "Closed",
};

/** Routing is a rule, not a habit: the SOP requires enquiries be "acknowledged,
 * classified and routed according to client type and issue". Keeping the map
 * as data means Client Services can see *why* something landed where it did. */
export const ENQUIRY_ROUTING: Record<EnquiryCategory, { queue: string; note: string }> = {
  missing_payment: { queue: "Payments desk", note: "Check the farmer's line in the payment run first: paid, failed at M-PESA, or not in the file." },
  wrong_number: { queue: "Customer desk", note: "A number change needs the farmer's ID and a second staff member's approval before any payment goes to it." },
  agent_cashout: { queue: "Agent network", note: "Match the agent's cash-out record against the farmer's wallet debit before speaking to the agent." },
  voucher_rejected: { queue: "Merchant desk", note: "Check the voucher's balance and expiry, then the merchant's till and its input list." },
  pin_reset: { queue: "Customer desk", note: "Verify the farmer by ID and grower number before any PIN reset." },
  statement_request: { queue: "Customer desk", note: "Send the wallet statement by SMS link; the farmer can also print it at the factory." },
  other: { queue: "Customer desk", note: "Triage and reclassify; Other should stay rare." },
};

export type Enquiry = {
  id: string;
  /** Set when the enquirer is already a client; null for a cold enquiry. */
  clientId: string | null;
  name: string;
  contact: string;
  channel: EnquiryChannel;
  category: EnquiryCategory;
  subject: string;
  body: string;
  status: EnquiryStatus;
  ownerId: CrmOwnerId | null;
  receivedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolution?: string;
  /** Set once this enquiry becomes a lead, so conversion is traceable rather
   * than the lead simply appearing from nowhere. */
  convertedLeadId?: string;
  campaignId?: string;
};

export const ENQUIRIES: Enquiry[] = [
  { id: "enq_1", clientId: "GN-104233", name: "Joseph Kiprotich Langat", contact: "+254 722 104 233", channel: "ussd", category: "missing_payment", subject: "October bonus not received", body: "Neighbours at Litein were paid the October green leaf payment on Friday. Nothing has reached my wallet.", status: "new", ownerId: null, receivedAt: "2026-11-09T05:40:00Z" },
  { id: "enq_2", clientId: "GN-118407", name: "Grace Chepkemoi Koech", contact: "+254 711 418 407", channel: "agent", category: "agent_cashout", subject: "Cash-out at agent not received", body: "Agent AG-2041 in Litein says the KES 6,000 cash-out failed, but my wallet shows it was taken.", status: "in_progress", ownerId: "u_3", receivedAt: "2026-11-06T08:05:00Z", acknowledgedAt: "2026-11-06T08:20:00Z" },
  { id: "enq_3", clientId: "GN-131620", name: "Lucy Wanjiku Ndirangu", contact: "+254 710 316 200", channel: "call_centre", category: "voucher_rejected", subject: "Fertiliser voucher refused at Othaya Farm Inputs", body: "The shop's till said the voucher is not valid for NPK. I was told it covers fertiliser.", status: "resolved", ownerId: "u_9", receivedAt: "2026-11-04T09:15:00Z", acknowledgedAt: "2026-11-04T09:22:00Z", resolvedAt: "2026-11-04T11:48:00Z", resolution: "The merchant's input list was missing NPK 23:23:0. Added it; the farmer redeemed the voucher the same afternoon." },
  { id: "enq_4", clientId: "GN-142078", name: "Peter Kimathi M'Ikiara", contact: "+254 724 142 078", channel: "call_centre", category: "wrong_number", subject: "Payment notice went to my old number", body: "I changed my line in September. The November payment notice came to my wife's phone, which was my old number.", status: "acknowledged", ownerId: "u_9", receivedAt: "2026-11-05T11:30:00Z", acknowledgedAt: "2026-11-05T13:00:00Z" },
  { id: "enq_5", clientId: "GN-150311", name: "Agnes Moraa Nyaboke", contact: "+254 715 150 311", channel: "app", category: "statement_request", subject: "Statement for the SACCO loan", body: "The SACCO wants six months of tea payments. Can I get a statement from the wallet?", status: "resolved", ownerId: "u_9", receivedAt: "2026-11-02T10:00:00Z", acknowledgedAt: "2026-11-02T10:35:00Z", resolvedAt: "2026-11-02T14:20:00Z", resolution: "Statement link sent by SMS; printed copy left at Nyansiongo factory office." },
  // Deliberately breached: received Thursday, still not acknowledged.
  { id: "enq_6", clientId: "GN-185590", name: "Daniel Ombati Nyakundi", contact: "+254 708 185 590", channel: "agent", category: "missing_payment", subject: "Paid for fewer kilos than delivered", body: "My payment notice shows 412 kg for October. The buying centre record says 486 kg.", status: "new", ownerId: null, receivedAt: "2026-11-05T15:50:00Z" },
  { id: "enq_7", clientId: "GN-171206", name: "Esther Wangari Muriuki", contact: "+254 712 171 206", channel: "ussd", category: "pin_reset", subject: "Locked out of the USSD menu", body: "Locked out after three wrong PIN attempts on the USSD menu.", status: "new", ownerId: null, receivedAt: "2026-11-09T06:10:00Z" },
];

/** Business days between two instants. The SLA is stated in business days by
 * the SOP, so counting calendar days would report weekend breaches that are
 * not breaches and let a genuine Friday-to-Tuesday lapse look like one day. */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

export type SlaState = "within" | "due_today" | "breached" | "met" | "met_late";

/** An enquiry that has been acknowledged is judged on what actually happened;
 * one still waiting is judged against now. Collapsing those two into a single
 * "overdue?" boolean loses the difference between a live problem and a
 * historical one, which is the difference between a queue and a report. */
export function acknowledgementSla(enquiry: Enquiry, slaBusinessDays: number, now = new Date().toISOString()): { state: SlaState; elapsed: number } {
  if (enquiry.acknowledgedAt) {
    const elapsed = businessDaysBetween(enquiry.receivedAt, enquiry.acknowledgedAt);
    return { state: elapsed > slaBusinessDays ? "met_late" : "met", elapsed };
  }
  const elapsed = businessDaysBetween(enquiry.receivedAt, now);
  if (elapsed > slaBusinessDays) return { state: "breached", elapsed };
  if (elapsed === slaBusinessDays) return { state: "due_today", elapsed };
  return { state: "within", elapsed };
}

// ---- Interactions ----

/** The timeline. Every conversation with a lead, client, IFA or institutional
 * counterparty lands here, so "what have we already told this person" has an
 * answer before the next call starts. */
export type InteractionType = "call_inbound" | "call_outbound" | "email" | "meeting" | "note" | "system";
export type InteractionSubject = "lead" | "client" | "enquiry" | "opportunity" | "ifa";

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  call_inbound: "Inbound call",
  call_outbound: "Outbound call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
  system: "System event",
};

export type Interaction = {
  id: string;
  subjectType: InteractionSubject;
  subjectId: string;
  type: InteractionType;
  summary: string;
  detail?: string;
  outcome?: string;
  /** What happens next, and when. An interaction with no next action on an
   * open relationship is how pipelines go quiet. */
  nextAction?: string;
  nextActionDue?: string;
  byId: CrmOwnerId;
  occurredAt: string;
  /** TIPPING-OFF CONTROL. Set on any interaction whose detail touches a
   * compliance matter. Every non-Compliance role sees the row exists and who
   * handled it, never the body — so a restriction can be worked without the
   * reason reaching a customer-facing screen.
   *
   * Named for the restriction, not for one role: it first applied only to
   * Client Services, which quietly let BD Officers read the same body. The
   * boundary is Compliance, and the flag now says so. */
  complianceOnly?: boolean;
};

export const INTERACTIONS: Interaction[] = [
  { id: "int_1", subjectType: "client", subjectId: "inv_2891", type: "call_inbound", summary: "Reported a double M-Pesa deduction", detail: "Customer calm, has the two M-Pesa messages. Confirmed reference QGH4K2P1M9 and raised it with Operations.", outcome: "Enquiry enq_2 opened, routed to Operations", nextAction: "Call back once Operations confirms the duplicate callback", nextActionDue: "2026-09-03", byId: "u_9", occurredAt: "2026-08-08T08:05:00Z" },
  { id: "int_2", subjectType: "client", subjectId: "inv_2891", type: "email", summary: "Sent July statement on request", byId: "u_9", occurredAt: "2026-08-02T10:12:00Z" },
  { id: "int_3", subjectType: "client", subjectId: "inv_2891", type: "system", summary: "Distribution paid — July 2026", detail: "KES 5,384.12 reinvested.", byId: "u_6", occurredAt: "2026-07-31T18:04:00Z" },
  { id: "int_4", subjectType: "client", subjectId: "inv_3350", type: "note", summary: "Compliance matter — restricted access", detail: "Account restricted pending EDD. Do not discuss the reason with the customer; refer any query to Compliance.", byId: "u_2", occurredAt: "2026-08-08T12:00:00Z", complianceOnly: true },
  { id: "int_5", subjectType: "lead", subjectId: "ld_2", type: "call_outbound", summary: "First contact attempt — no answer", outcome: "Voicemail left", nextAction: "Second attempt", nextActionDue: "2026-09-03", byId: "u_1", occurredAt: "2026-09-01T09:30:00Z" },
  { id: "int_6", subjectType: "lead", subjectId: "ld_3", type: "meeting", summary: "Discovery with IFA-referred prospect", detail: "Objectives: monthly income, 3-year horizon, USD exposure to hedge school fees abroad. Comfortable with a 7-day redemption notice.", outcome: "Matched to the USD Eurobond sub-fund", nextAction: "Send the factsheet and open onboarding", nextActionDue: "2026-09-04", byId: "u_1", occurredAt: "2026-08-29T14:00:00Z" },
  { id: "int_7", subjectType: "opportunity", subjectId: "opp_1", type: "meeting", summary: "Treasury committee introduction", detail: "Committee wants a same-week liquidity answer for at least half the placement. Flagged that KES 40M sits above the same-day tier.", outcome: "Bid/No-Bid assessment opened", nextAction: "Return with a tiered liquidity proposal", nextActionDue: "2026-09-08", byId: "u_10", occurredAt: "2026-08-26T10:00:00Z" },
  { id: "int_8", subjectType: "ifa", subjectId: "ifa_1", type: "call_outbound", summary: "Quarterly channel review", detail: "Referred book up 18% on the quarter. Asked about a co-branded factsheet.", outcome: "Marketing to review co-branding", byId: "u_10", occurredAt: "2026-08-20T11:00:00Z" },
  { id: "int_9", subjectType: "client", subjectId: "inv_3122", type: "call_outbound", summary: "Annual servicing review", detail: "Holding unchanged, happy with monthly payout. Confirmed UK address still current.", outcome: "No change; next review scheduled", nextAction: "Annual review", nextActionDue: "2027-05-03", byId: "u_1", occurredAt: "2026-08-15T13:00:00Z" },
];

/** A non-Compliance viewer sees that a restricted interaction happened and who
 * owns it, never its body. Applied at the seam, not in the component, so a new
 * page cannot forget it.
 *
 * The parameter is the POSITIVE permission and defaults to withholding at every
 * call site, so a caller that forgets to pass it redacts rather than leaks. */
export function visibleInteraction(i: Interaction, canSeeComplianceDetail: boolean): Interaction {
  if (canSeeComplianceDetail || !i.complianceOnly) return i;
  return {
    ...i,
    summary: "Compliance matter — restricted",
    detail: undefined,
    outcome: undefined,
    nextAction: undefined,
    nextActionDue: undefined,
  };
}

// ---- Tasks ----

export type TaskStatus = "open" | "done" | "cancelled";
export type TaskSource = "manual" | "sla" | "interaction" | "review_cycle";

export const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  manual: "Created manually",
  sla: "Raised by a service standard",
  interaction: "Follow-up from an interaction",
  review_cycle: "Servicing review cycle",
};

export type CrmTask = {
  id: string;
  title: string;
  detail?: string;
  ownerId: CrmOwnerId;
  dueDate: string;
  status: TaskStatus;
  source: TaskSource;
  subjectType: InteractionSubject | null;
  subjectId: string | null;
  createdAt: string;
  completedAt?: string;
};

export const CRM_TASKS: CrmTask[] = [
  { id: "tsk_1", title: "Call Grace Chepkemoi Koech back on the failed agent cash-out", ownerId: "u_9", dueDate: "2026-11-10", status: "open", source: "interaction", subjectType: "enquiry", subjectId: "enq_2", createdAt: "2026-11-06T08:30:00Z" },
  { id: "tsk_2", title: "Get agent AG-2041's cash-out log for 6 November", ownerId: "u_3", dueDate: "2026-11-10", status: "open", source: "interaction", subjectType: "enquiry", subjectId: "enq_2", createdAt: "2026-11-06T09:00:00Z" },
  { id: "tsk_3", title: "Confirm Peter Kimathi M'Ikiara's new number with Githongo factory", detail: "Payments to GN-142078 are held until the change is approved.", ownerId: "u_9", dueDate: "2026-11-11", status: "open", source: "interaction", subjectType: "enquiry", subjectId: "enq_4", createdAt: "2026-11-05T13:05:00Z" },
  { id: "tsk_4", title: "Acknowledge Esther Wangari Muriuki's PIN lockout", detail: "USSD lockout; inside the one-business-day standard.", ownerId: "u_9", dueDate: "2026-11-10", status: "open", source: "sla", subjectType: "enquiry", subjectId: "enq_7", createdAt: "2026-11-09T06:10:00Z" },
  // Overdue, on purpose: a board where nothing is ever late proves nothing.
  { id: "tsk_5", title: "Chase Kiamokama factory for Daniel Ombati Nyakundi's October kilos", detail: "Buying-centre record and payment file disagree by 74 kg.", ownerId: "u_3", dueDate: "2026-11-06", status: "open", source: "sla", subjectType: "enquiry", subjectId: "enq_6", createdAt: "2026-11-05T16:00:00Z" },
  { id: "tsk_6", title: "Re-send the October bonus notice to Litein farmers who missed it", ownerId: "u_1", dueDate: "2026-11-12", status: "open", source: "manual", subjectType: null, subjectId: null, createdAt: "2026-11-09T07:00:00Z" },
  { id: "tsk_7", title: "Add NPK 23:23:0 to Othaya Farm Inputs' voucher list", ownerId: "u_9", dueDate: "2026-11-04", status: "done", source: "manual", subjectType: "enquiry", subjectId: "enq_3", createdAt: "2026-11-04T09:25:00Z", completedAt: "2026-11-04T11:40:00Z" },
];

// ---- Coverage & commercial segmentation (dated assignments) ----

/** Deliberately the same shape as `classifiers.ts`: a window with a validity
 * range, closed and reopened rather than overwritten. "Who covered this client
 * in June, and why did it move" is the same class of question as "what was
 * their risk tier", and a handover that erases its predecessor is the same
 * bug. Kept in this file rather than added to the compliance classifiers
 * because coverage and commercial segment are BD facts, not AML ones. */
export type DatedAssignment<T extends string> = {
  id: string;
  clientId: string;
  value: T;
  validFrom: string;
  validTo: string | null;
  assignedBy: string;
  reason?: string;
  previousValue?: T;
};

/** Commercial segment — a different axis from the risk band already on the
 * client file. A Low-risk customer can be institutional; a High-risk one can
 * be mass retail. Conflating them is how a book gets serviced by its AML
 * rating. */
export type CommercialSegment = "mass_retail" | "mass_affluent" | "hnwi" | "institutional" | "ifa_introduced";

export const SEGMENT_LABELS: Record<CommercialSegment, string> = {
  mass_retail: "Mass retail",
  mass_affluent: "Mass affluent",
  hnwi: "HNWI",
  institutional: "Institutional",
  ifa_introduced: "IFA-introduced",
};

/** Servicing expectations per segment. The SOP requires ongoing servicing but
 * fixes no cadence; these are indicative and BO-editable in a real build —
 * flagged rather than presented as Investcent policy. */
export const SEGMENT_SERVICE_MODEL: Record<CommercialSegment, { coverage: string; reviewMonths: number | null }> = {
  mass_retail: { coverage: "Self-service, pooled Client Services queue — no named owner", reviewMonths: null },
  mass_affluent: { coverage: "Pooled queue with a named BD Officer for escalations", reviewMonths: 12 },
  hnwi: { coverage: "Named Relationship Manager", reviewMonths: 6 },
  institutional: { coverage: "Named RM plus Head of BD oversight", reviewMonths: 3 },
  ifa_introduced: { coverage: "Serviced through the introducing advisor, with direct escalation", reviewMonths: 12 },
};

let assignSeq = 1;
function dated<T extends string>(clientId: string, value: T, validFrom: string, validTo: string | null, assignedBy: string, reason?: string, previousValue?: T): DatedAssignment<T> {
  return { id: `CRMA-${String(assignSeq++).padStart(4, "0")}`, clientId, value, validFrom, validTo, assignedBy, ...(reason ? { reason } : {}), ...(previousValue ? { previousValue } : {}) };
}

export const COVERAGE_ASSIGNMENTS: DatedAssignment<CrmOwnerId>[] = [
  dated("inv_2891", "u_1", "2026-03-14", null, "System (Onboarding)", "Default BD coverage on activation."),
  dated("inv_3122", "u_1", "2026-05-03", "2026-07-01", "Faith Kamau", "IFA-introduced; BD covers the direct relationship."),
  dated("inv_3122", "u_1", "2026-07-01", null, "Faith Kamau", "Retained after the mid-year book review.", "u_1"),
  dated("inv_2601", "u_9", "2026-02-11", null, "System (Onboarding)", "Mass retail — pooled Client Services queue."),
  dated("inv_3350", "u_9", "2026-08-06", null, "System (Onboarding)", "Mass retail — pooled Client Services queue."),
];

export const SEGMENT_ASSIGNMENTS: DatedAssignment<CommercialSegment>[] = [
  dated("inv_2891", "mass_affluent", "2026-03-14", "2026-06-20", "System (Onboarding)", "Initial segment from declared investment amount."),
  dated("inv_2891", "hnwi", "2026-06-20", null, "Faith Kamau", "Crossed the HNWI threshold after the June top-up.", "mass_affluent"),
  dated("inv_3122", "ifa_introduced", "2026-05-03", null, "Faith Kamau", "Referred by Kevin Mutuku."),
  dated("inv_2601", "mass_retail", "2026-02-11", null, "System (Onboarding)"),
  dated("inv_3350", "mass_retail", "2026-08-06", null, "System (Onboarding)"),
  dated("inv_2765", "mass_retail", "2026-08-05", null, "System (Onboarding)"),
];

function assignmentAsOf<T extends string>(rows: DatedAssignment<T>[], clientId: string, asOf: string): DatedAssignment<T> | undefined {
  return rows.find((a) => a.clientId === clientId && a.validFrom <= asOf && (a.validTo === null || a.validTo > asOf));
}

export function coverageAsOf(clientId: string, asOf = new Date().toISOString().slice(0, 10)) {
  return assignmentAsOf(COVERAGE_ASSIGNMENTS, clientId, asOf);
}

export function segmentAsOf(clientId: string, asOf = new Date().toISOString().slice(0, 10)) {
  return assignmentAsOf(SEGMENT_ASSIGNMENTS, clientId, asOf);
}

function reassign<T extends string>(rows: DatedAssignment<T>[], clientId: string, value: T, assignedBy: string, reason?: string, effectiveFrom = new Date().toISOString().slice(0, 10)): DatedAssignment<T> | null {
  const open = rows.find((a) => a.clientId === clientId && a.validTo === null);
  if (open?.value === value) return null;
  if (open && effectiveFrom < open.validFrom) {
    throw new Error(`Cannot backdate to ${effectiveFrom}: the current window opened ${open.validFrom}`);
  }
  if (open) open.validTo = effectiveFrom;
  const next = dated(clientId, value, effectiveFrom, null, assignedBy, reason, open?.value);
  rows.push(next);
  return next;
}

export function assignCoverage(clientId: string, ownerId: CrmOwnerId, assignedBy: string, reason?: string) {
  if (!SYSTEM_USERS.some((u) => u.id === ownerId)) throw new Error("Unknown owner");
  return reassign(COVERAGE_ASSIGNMENTS, clientId, ownerId, assignedBy, reason);
}

export function assignSegment(clientId: string, segment: CommercialSegment, assignedBy: string, reason?: string) {
  // Validated for the same reason `assignCoverage` validates its owner: the
  // value is a key into SEGMENT_SERVICE_MODEL, so an unrecognised one writes a
  // window whose service model is `undefined` and every consumer downstream
  // renders a blank instead of failing. TypeScript does not help here — the
  // call arrives from a Dropdown carrying a plain string.
  if (!(segment in SEGMENT_LABELS)) throw new Error(`"${segment}" is not a configured commercial segment`);
  return reassign(SEGMENT_ASSIGNMENTS, clientId, segment, assignedBy, reason);
}

export function coverageHistory(clientId: string) {
  return [...COVERAGE_ASSIGNMENTS.filter((a) => a.clientId === clientId)].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}

export function segmentHistory(clientId: string) {
  return [...SEGMENT_ASSIGNMENTS.filter((a) => a.clientId === clientId)].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}

// ---- Campaigns ----

/** `Lead.source` is free text, so "which channel actually converts" has never
 * been answerable. A campaign id on the enquiry and the lead makes it a join
 * rather than a guess. */
export type Campaign = {
  id: string;
  name: string;
  channel: string;
  startedAt: string;
  endedAt: string | null;
  /** What was spent, in KES. Null where the channel has no direct cost —
   * zero would claim it was free, which is a different statement. */
  spendKes: number | null;
  note?: string;
};

export const CAMPAIGNS: Campaign[] = [
  { id: "cmp_search", name: "Search — 'invest in government bonds Kenya'", channel: "Paid search", startedAt: "2026-06-01", endedAt: null, spendKes: 840_000, note: "Highest volume, lowest ticket size." },
  { id: "cmp_radio", name: "Radio — Swahili drive-time", channel: "Radio", startedAt: "2026-07-01", endedAt: "2026-08-31", spendKes: 1_200_000, note: "Drives phone and USSD enquiries rather than app signups." },
  { id: "cmp_ifa", name: "IFA partner programme", channel: "Advisor referral", startedAt: "2026-04-01", endedAt: null, spendKes: null, note: "Cost sits in trailing commission, not campaign spend — do not read a zero here as free." },
  { id: "cmp_branch", name: "Branch counter cards", channel: "Branch", startedAt: "2026-05-15", endedAt: null, spendKes: 180_000 },
];

/** Lead-side attribution. Kept as a lookup rather than a column on `Lead` so
 * the existing register in `admin.ts` is not reshaped underneath the pages
 * already reading it. */
export const LEAD_CAMPAIGNS: Record<string, string> = {
  ld_1: "cmp_search",
  ld_2: "cmp_search",
  ld_3: "cmp_ifa",
  ld_4: "cmp_branch",
};

// ---- Institutional pipeline (Bid / No-Bid) ----

/** The SOP's Bid/No-Bid framework, verbatim on its seven criteria: "strategic
 * fit, capability, profitability, operational complexity, compliance, win
 * probability and reputation". Scored 1–5 each. */
export type BidCriterion =
  | "strategic_fit" | "capability" | "profitability" | "operational_complexity"
  | "compliance" | "win_probability" | "reputation";

export const BID_CRITERIA: { key: BidCriterion; label: string; hint: string; inverted?: boolean }[] = [
  { key: "strategic_fit", label: "Strategic fit", hint: "Does this counterparty and mandate fit where the fund is going?" },
  { key: "capability", label: "Capability", hint: "Can we actually deliver what is being asked, today?" },
  { key: "profitability", label: "Profitability", hint: "Margin after the servicing this segment demands." },
  { key: "operational_complexity", label: "Operational complexity", hint: "Scored inverted — 5 means simple, 1 means it will consume Operations.", inverted: true },
  { key: "compliance", label: "Compliance", hint: "KYB burden, jurisdiction, UBO chain, screening load." },
  { key: "win_probability", label: "Win probability", hint: "Honest read, not the optimistic one." },
  { key: "reputation", label: "Reputation", hint: "What association with this name does to the franchise." },
];

export type OpportunityStage = "qualifying" | "bid_no_bid" | "proposal" | "negotiation" | "won" | "lost" | "no_bid";

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  qualifying: "Qualifying",
  bid_no_bid: "Bid / No-Bid",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  no_bid: "No-bid (declined)",
};

export type Opportunity = {
  id: string;
  counterparty: string;
  type: "institutional" | "corporate" | "sacco" | "pension" | "ifa_channel";
  stage: OpportunityStage;
  currency: "KES" | "USD";
  /** Indicative ticket. Institutional mandates move, so this is what they said,
   * not what has been committed. */
  indicativeAmount: number;
  ownerId: CrmOwnerId;
  openedAt: string;
  expectedDecisionAt?: string;
  closedAt?: string;
  scores: Partial<Record<BidCriterion, number>>;
  decision?: "bid" | "no_bid";
  decisionBy?: string;
  decisionNote?: string;
  sourceEnquiryId?: string;
};

export const OPPORTUNITIES: Opportunity[] = [
  {
    id: "opp_1", counterparty: "Kilimo SACCO", type: "sacco", stage: "bid_no_bid", currency: "KES",
    indicativeAmount: 40_000_000, ownerId: "u_10", openedAt: "2026-08-25", expectedDecisionAt: "2026-09-15",
    scores: { strategic_fit: 4, capability: 4, profitability: 3, operational_complexity: 3, compliance: 3, win_probability: 3, reputation: 4 },
    sourceEnquiryId: "enq_4",
  },
  {
    id: "opp_2", counterparty: "Mwangaza Pension Scheme", type: "pension", stage: "proposal", currency: "KES",
    indicativeAmount: 120_000_000, ownerId: "u_10", openedAt: "2026-07-14", expectedDecisionAt: "2026-09-30",
    scores: { strategic_fit: 5, capability: 3, profitability: 4, operational_complexity: 2, compliance: 4, win_probability: 3, reputation: 5 },
    decision: "bid", decisionBy: "Head of BD", decisionNote: "Bid despite operational complexity — trustee reporting is the gap; Operations to size it before proposal goes out.",
  },
  {
    id: "opp_3", counterparty: "Offshore family office (Gulf)", type: "institutional", stage: "no_bid", currency: "USD",
    indicativeAmount: 2_000_000, ownerId: "u_10", openedAt: "2026-06-02", closedAt: "2026-06-20",
    scores: { strategic_fit: 2, capability: 3, profitability: 4, operational_complexity: 2, compliance: 1, win_probability: 3, reputation: 2 },
    decision: "no_bid", decisionBy: "Head of BD", decisionNote: "Declined on compliance: UBO chain runs through two jurisdictions the tokenization whitelist marks under review, and the fund is not licensed to distribute there.",
  },
  {
    id: "opp_4", counterparty: "Tuungane Chama Network", type: "corporate", stage: "won", currency: "KES",
    indicativeAmount: 8_000_000, ownerId: "u_1", openedAt: "2026-05-10", closedAt: "2026-07-02",
    scores: { strategic_fit: 5, capability: 5, profitability: 3, operational_complexity: 4, compliance: 4, win_probability: 4, reputation: 4 },
    decision: "bid", decisionBy: "Head of BD", decisionNote: "Exactly the mass-market thesis — 400 members onboarding individually rather than one omnibus account.",
  },
  {
    id: "opp_5", counterparty: "Rift Valley Traders Co-op", type: "sacco", stage: "qualifying", currency: "KES",
    indicativeAmount: 15_000_000, ownerId: "u_10", openedAt: "2026-08-30",
    scores: {},
  },
];

/** Mean of the scored criteria, 1–5. Unscored criteria are excluded rather
 * than counted as zero — a half-finished assessment should read as incomplete,
 * not as a bad score. Operational complexity is already stored inverted (5 =
 * simple), so no special-casing is needed here; the label carries the warning. */
export function bidScore(opp: Opportunity): { score: number | null; scored: number; total: number } {
  const values = BID_CRITERIA.map((c) => opp.scores[c.key]).filter((v): v is number => typeof v === "number");
  return {
    score: values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : null,
    scored: values.length,
    total: BID_CRITERIA.length,
  };
}

// ---- Service reviews ----

export type ServiceReview = {
  id: string;
  clientId: string;
  dueDate: string;
  completedAt?: string;
  ownerId: CrmOwnerId;
  note?: string;
};

export const SERVICE_REVIEWS: ServiceReview[] = [
  { id: "svr_1", clientId: "inv_3122", dueDate: "2027-05-03", ownerId: "u_1", note: "Annual — IFA-introduced." },
  { id: "svr_2", clientId: "inv_2891", dueDate: "2026-12-20", ownerId: "u_1", note: "Six-monthly since the HNWI reclassification." },
  { id: "svr_3", clientId: "inv_2601", dueDate: "2026-08-11", ownerId: "u_9", note: "Mass retail — no named review; raised only because the account went quiet." },
];

// ---- BD performance (the SOP's own KPI list) ----

/** "KPIs include response time, KYC turnaround, transaction accuracy,
 * redemption turnaround, complaints, client satisfaction, RFP conversion and
 * onboarding cycle time."
 *
 * Only the ones this platform can actually compute are computed. The rest are
 * returned with `value: null` and a reason — a dashboard that invents a client
 * satisfaction score because the tile looked empty is worse than one that says
 * where the number would have to come from. */
export type BdKpi = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  target?: number;
  /** Lower is better for turnaround metrics; higher for conversion. */
  direction: "lower_better" | "higher_better";
  source: string;
  unavailableReason?: string;
};

export function bdKpis(ackSlaDays: number, now = new Date().toISOString()): BdKpi[] {
  const acknowledged = ENQUIRIES.filter((e) => e.acknowledgedAt);
  const avgAck = acknowledged.length
    ? acknowledged.reduce((s, e) => s + businessDaysBetween(e.receivedAt, e.acknowledgedAt!), 0) / acknowledged.length
    : null;
  const withinSla = acknowledged.filter((e) => businessDaysBetween(e.receivedAt, e.acknowledgedAt!) <= ackSlaDays).length;

  const decided = OPPORTUNITIES.filter((o) => o.stage === "won" || o.stage === "lost" || o.stage === "no_bid");
  const won = OPPORTUNITIES.filter((o) => o.stage === "won").length;

  const openComplaints = COMPLAINTS.filter((c) => c.status !== "resolved" && c.status !== "closed").length;

  const converted = LEADS.filter((l) => l.stage === "converted").length;

  const overdueTasks = CRM_TASKS.filter((t) => t.status === "open" && t.dueDate < now.slice(0, 10)).length;

  return [
    { key: "ack_time", label: "Average acknowledgement time", value: avgAck === null ? null : Number(avgAck.toFixed(2)), unit: "business days", target: ackSlaDays, direction: "lower_better", source: "Enquiry register" },
    { key: "ack_sla", label: "Acknowledged within standard", value: acknowledged.length ? Number(((withinSla / acknowledged.length) * 100).toFixed(0)) : null, unit: "%", target: 100, direction: "higher_better", source: "Enquiry register" },
    { key: "lead_conversion", label: "Lead conversion", value: LEADS.length ? Number(((converted / LEADS.length) * 100).toFixed(0)) : null, unit: "%", direction: "higher_better", source: "Lead register" },
    { key: "rfp_conversion", label: "RFP / institutional conversion", value: decided.length ? Number(((won / decided.length) * 100).toFixed(0)) : null, unit: "%", direction: "higher_better", source: "Opportunity pipeline (decided only)" },
    { key: "open_complaints", label: "Open complaints", value: openComplaints, unit: "open", direction: "lower_better", source: "Complaint register" },
    { key: "overdue_tasks", label: "Overdue follow-ups", value: overdueTasks, unit: "overdue", direction: "lower_better", source: "Task queue" },
    { key: "kyc_tat", label: "KYC turnaround", value: null, unit: "business days", direction: "lower_better", source: "Onboarding turnaround report", unavailableReason: "Computed by the onboarding TAT report from compliance timestamps, not from CRM data — surfaced there rather than duplicated here with a second definition." },
    { key: "redemption_tat", label: "Redemption turnaround", value: null, unit: "business days", direction: "lower_better", source: "Transaction ledger", unavailableReason: "Belongs to Operations' settlement data. A CRM-side approximation would disagree with the operational number." },
    { key: "transaction_accuracy", label: "Transaction accuracy", value: null, unit: "%", direction: "higher_better", source: "Reconciliation breaks", unavailableReason: "Needs an agreed denominator (per transaction, per value, per batch) before it means anything. Open with Operations." },
    { key: "client_satisfaction", label: "Client satisfaction", value: null, unit: "score", direction: "higher_better", source: "Not collected", unavailableReason: "No survey instrument exists. The SOP names the KPI; nothing in the platform produces it, and inventing a proxy would be worse than the gap." },
  ];
}

// ---- Cross-object helpers ----

export function interactionsFor(subjectType: InteractionSubject, subjectId: string) {
  return INTERACTIONS
    .filter((i) => i.subjectType === subjectType && i.subjectId === subjectId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** Every client with no coverage window open. Mass retail is legitimately
 * unowned (pooled queue), so this is reported alongside the segment rather
 * than as a flat error count. */
export function coverageGaps() {
  return CLIENTS.map((c) => {
    const segment = segmentAsOf(c.id)?.value ?? null;
    const owner = coverageAsOf(c.id)?.value ?? null;
    const expectsOwner = segment !== null && segment !== "mass_retail";
    return { clientId: c.id, name: c.name, segment, ownerId: owner, expectsOwner, gap: expectsOwner && !owner };
  });
}

export function leadWithCampaign(lead: Lead) {
  const campaignId = LEAD_CAMPAIGNS[lead.id];
  return { ...lead, campaignId: campaignId ?? null, campaignName: CAMPAIGNS.find((c) => c.id === campaignId)?.name ?? null };
}
