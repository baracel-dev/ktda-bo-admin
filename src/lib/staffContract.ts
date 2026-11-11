/* The KTDA staff directory (omnichannel /api/operator/staff, staff-contract
   v1). Sign-in stays on the tokenization engine; omnichannel keeps who each
   signed-in email is: their roles, the permission keys those resolve to, and
   their status. After every sign-in the page calls POST /me/sign-in with the
   engine's roles and keeps the answer's permissions: the menu, the routes and
   the action buttons check them. Writes need act:users.manage (403
   STAFF_FORBIDDEN otherwise); a disabled member's sign-in is 403
   STAFF_DISABLED, and the page signs them out.

   Where this environment's omnichannel has no directory yet (the staff paths
   answer 404), nothing is enforced: every signed-in user sees every page, as
   before, and the engine still checks its own rules. */

export type StaffRole = "ADMIN" | "COMPLIANCE" | "FINANCE" | "OPERATIONS" | "READ_ONLY" | (string & {});
export type StaffStatus = "INVITED" | "ACTIVE" | "DISABLED";

export type StaffView = {
  id: string;
  email: string;
  fullName: string | null;
  roles: StaffRole[];
  /** Resolved from the roles. */
  permissions: string[];
  status: StaffStatus;
  /** An engine account that signed in before anyone invited it. */
  legacy: boolean;
  invitedBy: string | null;
  invitedAt: string | null;
  lastSignInAt: string | null;
  updatedAt: string | null;
};

export type StaffRoleDef = { role: StaffRole; label: string; defaults: string[] };
export type StaffPermission = { key: string; label: string; group: "page" | "action" };
/** Role → keys, as it stands. */
export type AccessMatrix = Record<string, string[]>;

export const STAFF_PATH = "/staff";
export const STAFF_DISABLED = "STAFF_DISABLED";
export const STAFF_FORBIDDEN = "STAFF_FORBIDDEN";

/** Shown on the sign-in screen when the directory refuses a disabled member. */
export const DISABLED_MESSAGE = "Your back office access has been disabled. Ask an administrator of this back office to enable it.";

/** Thrown by sign-in when the directory refuses the member (403 STAFF_DISABLED). */
export class StaffDisabledError extends Error {
  constructor(message = DISABLED_MESSAGE) {
    super(message);
    this.name = "StaffDisabledError";
  }
}

/* ---- Permission keys the page uses ---- */

export const PAGE = {
  dashboard: "page:dashboard", farmers: "page:farmers", kyc: "page:kyc", merchants: "page:merchants", agents: "page:agents",
  approvals: "page:approvals", payouts: "page:payouts", bulk: "page:bulk", reports: "page:reports", messages: "page:messages",
  users: "page:users", settings: "page:settings", reconciliation: "page:reconciliation",
} as const;

export const ACT = {
  approvalsDecide: "act:approvals.decide", payoutsRelease: "act:payouts.release", kycDecide: "act:kyc.decide", bulkRun: "act:bulk.run",
  merchantsDecide: "act:merchants.decide", agentsManage: "act:agents.manage", usersManage: "act:users.manage", settingsChange: "act:settings.change",
  reconciliationRun: "act:reconciliation.run",
} as const;

/** Which page key a route needs. The longest matching prefix wins; a route
 *  no prefix names needs none (any active member). Pay to M-PESA is the
 *  payment-runs page with ?flow=payout. */
const ROUTE_KEYS: [string, string][] = [
  ["/farmers", PAGE.farmers],
  ["/journey", PAGE.farmers],
  ["/token-console/kyc", PAGE.kyc],
  ["/kyc-queue", PAGE.kyc],
  ["/merchants", PAGE.merchants],
  ["/agents", PAGE.agents],
  ["/approvals", PAGE.approvals],
  ["/bulk", PAGE.bulk],
  ["/reports", PAGE.reports],
  ["/reconciliation", PAGE.reconciliation],
  ["/token-console/reconciliation", PAGE.reconciliation],
  ["/campaigns", PAGE.messages],
  ["/users", PAGE.users],
  ["/token-console/users", PAGE.users],
  ["/institution", PAGE.settings],
  ["/settings", PAGE.settings],
  ["/token-console/configuration", PAGE.settings],
  ["/feature-flags", PAGE.settings],
  ["/system", PAGE.settings],
];

export function pageKeyFor(pathname: string, search = ""): string | null {
  if (pathname === "/") return PAGE.dashboard;
  if (pathname === "/bulk/payments" && new URLSearchParams(search).get("flow") === "payout") return PAGE.payouts;
  let best: [string, string] | null = null;
  for (const r of ROUTE_KEYS) {
    if ((pathname === r[0] || pathname.startsWith(`${r[0]}/`)) && (!best || r[0].length > best[0].length)) best = r;
  }
  return best ? best[1] : null;
}

/** "Compliance, Finance". */
export function rolesText(roles: string[], defs?: StaffRoleDef[] | null): string {
  if (!roles.length) return "No roles";
  return roles.map((r) => defs?.find((d) => d.role === r)?.label ?? r.charAt(0) + r.slice(1).toLowerCase().replace(/_/g, " ")).join(", ");
}
