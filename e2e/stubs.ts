import type { Page, Route } from "@playwright/test";

/* Stubbed services for BO Admin's browser tests. `signIn` must run first in
 * every test: its catch-alls make sure no call leaves the browser (the dev
 * proxy would otherwise forward it to UAT). Playwright tries the most
 * recently added route first, so the specific stubs added after it win. */

export const STAFF = { email: "amina@baracel.ae", fullName: "Amina Ops" };
/** What omnichannel records for the signed-in staff member. */
export const ME = `staff:${STAFF.email}`;
export const OTHER = "staff:brian@baracel.ae";

export const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The omnichannel error envelope. */
export const envelope = (status: number, message: string, code?: string, field?: string) => ({
  timestamp: new Date().toISOString(), status, error: "Conflict", message, ...(code ? { code } : {}), ...(field ? { field } : {}),
});

export async function signIn(page: Page) {
  await page.route(/\/tok\//, (route) => json(route, []));
  await page.route(/\/omni\//, (route) => json(route, { message: "Not stubbed" }, 404));
  await page.route(/\/tok\/auth\/me$/, (route) => json(route, { email: STAFF.email, fullName: STAFF.fullName, roles: ["ADMIN"], admin: true }));
}

export async function stubOfferings(page: Page) {
  await page.route(/\/tok\/accounting\/offerings$/, (route) => json(route, [
    { offeringId: "OF-A", assetId: "asset-a", productId: "BOND-A", status: "OPEN", currency: "KES" },
    { offeringId: "OF-B", assetId: "asset-b", productId: "BOND-B", status: "OPEN", currency: "KES" },
  ]));
  await page.route(/\/tok\/accounting\/assets(\?.*)?$/, (route) => json(route, [
    { assetId: "asset-a", name: "IFB1/2023/17" },
    { assetId: "asset-b", name: "FXD1/2024/10" },
  ]));
}

/** The approvals list for one target (?target=&status=REJECTED): `rejected`
 *  for that target, nothing for any other. Returns the queries sent. */
export async function stubLastRejection(page: Page, target: string, rejected: Record<string, unknown> | null) {
  const asked: URLSearchParams[] = [];
  await page.route(/\/omni\/api\/operator\/approvals\?/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    asked.push(q);
    const items = rejected && q.get("target") === target && q.get("status") === "REJECTED" ? [rejected] : [];
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "X-Total-Count": String(items.length), "X-Page": "1", "X-Size": "1", "X-Total-Pages": "1" }, body: JSON.stringify(items) });
  });
  return asked;
}

/** A rejected approval request for a target. */
export const rejectedRequest = (reference: string, target: { kind: string; reference: string; name: string | null }, title: string, note: string) => ({
  id: `id-${reference}`, reference, type: "MERCHANT_UPDATE", title, target, changes: [], reason: null, payload: {}, status: "REJECTED",
  maker: "staff:maker@ktda.test", madeAt: "2026-11-08T09:00:00Z", checker: "staff:checker@ktda.test", decidedAt: "2026-11-08T11:30:00Z",
  decisionNote: note, appliedAt: null, error: null, checkerRoles: ["ADMIN"], resubmitOf: null,
});

/** Every permission key of staff-contract v1. */
export const ALL_PERMISSIONS = [
  "page:dashboard", "page:farmers", "page:kyc", "page:merchants", "page:agents", "page:approvals", "page:payouts", "page:bulk",
  "page:reports", "page:messages", "page:users", "page:settings", "page:reconciliation",
  "act:approvals.decide", "act:payouts.release", "act:kyc.decide", "act:bulk.run", "act:merchants.decide", "act:agents.manage",
  "act:users.manage", "act:settings.change", "act:reconciliation.run",
];

/** A staff directory record (StaffView); an active ADMIN holding every key by default. */
export const staffView = (over: Record<string, unknown> = {}) => ({
  id: "st-amina", email: STAFF.email, fullName: STAFF.fullName, roles: ["ADMIN"], permissions: ALL_PERMISSIONS, status: "ACTIVE",
  legacy: false, invitedBy: null, invitedAt: null, lastSignInAt: "2026-11-10T07:00:00Z", updatedAt: null, ...over,
});

/** The signed-in member's directory record: GET /staff/me and POST /staff/me/sign-in answer `me`. */
export async function stubStaffMe(page: Page, me: Record<string, unknown> | { status: number; body: unknown }) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.route(/\/omni\/api\/operator\/staff\/me(\/sign-in)?$/, (route) => {
    const req = route.request();
    calls.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.method() === "POST" ? req.postDataJSON() : null });
    if ("status" in me && "body" in me && typeof me.status === "number") return json(route, me.body, me.status);
    return json(route, me);
  });
  return calls;
}
