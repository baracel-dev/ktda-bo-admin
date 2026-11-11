import { expect, test, type Page } from "@playwright/test";
import { ALL_PERMISSIONS, envelope, json, signIn, STAFF, staffView, stubStaffMe } from "./stubs";

/* The staff directory (staff-contract v1): sign-in tells omnichannel who
 * signed in and keeps their permissions; the menu, routes and buttons follow
 * them; a disabled member is signed out; and the live Users & roles page
 * joins the engine's logins with the directory by email. Stubbed. */

type Obj = Record<string, unknown>;
type Sent = { method: string; path: string; body: unknown };

const ROLES = [
  { role: "ADMIN", label: "Administrator", defaults: ALL_PERMISSIONS },
  { role: "COMPLIANCE", label: "Compliance", defaults: ["page:kyc", "page:approvals", "act:kyc.decide"] },
  { role: "FINANCE", label: "Finance", defaults: ["page:bulk", "page:payouts", "act:payouts.release"] },
  { role: "OPERATIONS", label: "Operations", defaults: ["page:farmers", "page:bulk", "act:bulk.run"] },
  { role: "READ_ONLY", label: "Read only", defaults: ["page:dashboard"] },
];
const PERMISSIONS = ALL_PERMISSIONS.map((key) => ({ key, label: key.replace(/^(page|act):/, "").replace(".", " "), group: key.startsWith("page:") ? "page" : "action" }));
const MATRIX: Obj = Object.fromEntries(ROLES.map((r) => [r.role, r.defaults]));

const COMPLIANCE_ME = staffView({ roles: ["COMPLIANCE"], permissions: ["page:kyc", "page:approvals", "page:farmers", "act:kyc.decide"] });

/** The directory and the engine's logins, as the Users & roles page reads them. */
async function stubDirectory(page: Page, opts: { staff?: Obj[]; engine?: Obj[]; me?: Obj; post?: (path: string, body: Obj) => { status: number; body: unknown } | undefined; missing?: boolean } = {}) {
  const sent: Sent[] = [];
  let staff = opts.staff ?? [];
  await page.route(/\/omni\/api\/operator\/staff/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/omni\/api\/operator/, "");
    const body = req.method() === "GET" ? null : (req.postDataJSON() as Obj);
    if (path !== "/staff/me" && path !== "/staff/me/sign-in") sent.push({ method: req.method(), path, body });
    if (opts.missing) return json(route, envelope(404, "Not Found"), 404);
    if (path === "/staff/me" || path === "/staff/me/sign-in") return json(route, opts.me ?? staffView());
    if (req.method() !== "GET") {
      const custom = opts.post?.(path, body!);
      if (custom) return json(route, custom.body, custom.status);
      if (path === "/staff" && req.method() === "POST") {
        const created = staffView({ id: `st-${String(body!.email)}`, email: body!.email, fullName: body!.fullName, roles: body!.roles, status: "INVITED", lastSignInAt: null });
        staff = [created, ...staff];
        return json(route, created, 201);
      }
      if (path.startsWith("/staff/access/")) return json(route, { ...MATRIX, [path.split("/").pop()!]: body!.keys });
      const id = path.split("/")[2]!;
      const cur = staff.find((s) => s.id === id) ?? {};
      const next = { ...cur, ...(path.endsWith("/status") ? { status: body!.status } : body) };
      staff = staff.map((s) => (s.id === id ? next : s));
      return json(route, next);
    }
    if (path === "/staff/roles") return json(route, ROLES);
    if (path === "/staff/permissions") return json(route, PERMISSIONS);
    if (path === "/staff/access") return json(route, MATRIX);
    return json(route, staff);
  });
  await page.route(/\/tok\/admin\/users/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/tok/, "");
    if (req.method() === "GET") return json(route, opts.engine ?? []);
    sent.push({ method: req.method(), path, body: null });
    return json(route, { id: path.split("/")[3], status: "ACTIVE" });
  });
  return sent;
}

const nav = (page: Page) => page.locator("aside").first();
const row = (page: Page, email: string) => page.getByTestId("users-table").locator(`tr[data-email="${email}"]`);

test.describe("signing in", () => {
  test("after the engine lets someone in, the page tells the directory with the engine's roles", async ({ page }) => {
    let signedIn = false;
    await page.route(/\/tok\//, (route) => json(route, []));
    await page.route(/\/omni\//, (route) => json(route, { message: "Not stubbed" }, 404));
    await page.route(/\/tok\/auth\/me$/, (route) => (signedIn
      ? json(route, { email: STAFF.email, fullName: STAFF.fullName, roles: ["ADMIN"], admin: true })
      : json(route, { error: "Unauthorized" }, 401)));
    await page.route(/\/tok\/auth\/login$/, (route) => { signedIn = true; return json(route, { admin: true, email: STAFF.email }); });
    const calls = await stubStaffMe(page, staffView());
    await page.goto("/login");
    await page.getByLabel("Email").fill(STAFF.email);
    await page.getByLabel("Password").fill("secret");
    // Wait for the sign-in call itself: the login page has a heading too, so a
    // visible heading does not mean the call has been made yet.
    const signInCall = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname.endsWith("/staff/me/sign-in"));
    await page.getByRole("button", { name: "Sign in" }).click();
    expect((await signInCall).postDataJSON()).toEqual({ fullName: STAFF.fullName, engineRoles: ["ADMIN"] });
    await expect(page).not.toHaveURL(/\/login$/);
    await expect.poll(() => calls.filter((c) => c.path.endsWith("/me/sign-in")).map((c) => c.method)).toEqual(["POST"]);
  });

  test("a disabled member (403 STAFF_DISABLED) is signed out with a clear message", async ({ page }) => {
    let signedIn = false;
    let loggedOut = false;
    await page.route(/\/tok\//, (route) => json(route, []));
    await page.route(/\/omni\//, (route) => json(route, { message: "Not stubbed" }, 404));
    await page.route(/\/tok\/auth\/me$/, (route) => (signedIn ? json(route, { email: STAFF.email, fullName: STAFF.fullName, roles: ["COMPLIANCE"] }) : json(route, { error: "Unauthorized" }, 401)));
    await page.route(/\/tok\/auth\/login$/, (route) => { signedIn = true; return json(route, { admin: false, email: STAFF.email }); });
    await page.route(/\/tok\/auth\/logout$/, (route) => { loggedOut = true; signedIn = false; return json(route, {}); });
    await stubStaffMe(page, { status: 403, body: envelope(403, "This staff member is disabled", "STAFF_DISABLED") });
    await page.goto("/login");
    await page.getByLabel("Email").fill(STAFF.email);
    await page.getByLabel("Password").fill("secret");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("Your back office access has been disabled.");
    await expect(page).toHaveURL(/\/login$/);
    expect(loggedOut).toBe(true);
  });

  test("a session already open whose member was disabled since is signed out on the next load", async ({ page }) => {
    await signIn(page);
    await page.route(/\/tok\/auth\/logout$/, (route) => json(route, {}));
    await stubStaffMe(page, { status: 403, body: envelope(403, "This staff member is disabled", "STAFF_DISABLED") });
    await page.goto("/farmers");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("signed-out-reason")).toContainText("Your back office access has been disabled.");
  });

  test("without a directory on this omnichannel, nothing is enforced", async ({ page }) => {
    await signIn(page);
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
    for (const label of ["Agents", "Merchants", "Payment runs", "Approvals", "Dashboard"]) {
      await expect(nav(page).getByRole("link", { name: new RegExp(`^${label.replace("&", "\\&")}`) }).first()).toBeVisible();
    }
  });
});

test.describe("enforcing the permissions", () => {
  test("the menu shows only the pages the member's roles open, and a refused route says why", async ({ page }) => {
    await signIn(page);
    await stubStaffMe(page, COMPLIANCE_ME);
    await page.goto("/farmers");
    await expect(page.getByRole("heading", { name: "Farmers", level: 1 })).toBeVisible();
    for (const label of ["Farmers", "KYC desk", "Approvals"]) await expect(nav(page).getByRole("link", { name: new RegExp(`^${label}`) }).first()).toBeVisible();
    for (const label of ["Agents", "Merchants", "Users & roles", "Payment runs", "Dashboard", "Reports"]) {
      await expect(nav(page).getByRole("link", { name: new RegExp(`^${label.replace("&", "\\&")}$`) })).toHaveCount(0);
    }
    await expect(page.getByText("Compliance", { exact: true }).first()).toBeVisible();
    await page.goto("/agents");
    await expect(page.getByTestId("access-denied")).toContainText("Your roles (Compliance) do not include it.");
  });

  test("Pay to M-PESA needs page:payouts even with page:bulk", async ({ page }) => {
    await signIn(page);
    await stubStaffMe(page, staffView({ roles: ["OPERATIONS"], permissions: ["page:bulk", "act:bulk.run"] }));
    await page.goto("/bulk/payments?flow=payout");
    await expect(page.getByTestId("access-denied")).toBeVisible();
  });

  test("a checker without act:approvals.decide sees the request but no Approve or Reject", async ({ page }) => {
    await signIn(page);
    await stubStaffMe(page, staffView({ roles: ["READ_ONLY"], permissions: ["page:approvals"] }));
    const approval = {
      id: "id-1", reference: "AP-10001", type: "AGENT_FLOAT_TOP_UP", title: "Top up float of agent A-0001", target: { kind: "AGENT", reference: "A-0001", name: null },
      changes: [], reason: null, payload: {}, status: "PENDING", maker: "staff:maker@ktda.test", madeAt: "2026-11-10T07:00:00Z", checker: null, decidedAt: null,
      decisionNote: null, appliedAt: null, error: null, checkerRoles: [], resubmitOf: null,
    };
    await page.route(/\/omni\/api\/operator\/approvals\/AP-10001$/, (route) => json(route, approval));
    await page.goto("/approvals?open=AP-10001");
    await expect(page.getByTestId("approval-drawer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("approval-drawer").getByTestId("no-permission")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();
  });
});

test.describe("Users & roles", () => {
  const STAFF_ROWS = [
    staffView(),
    staffView({ id: "st-inv", email: "invited@ktda.test", fullName: "Invited Officer", roles: ["FINANCE"], status: "INVITED", lastSignInAt: null }),
    staffView({ id: "st-wait", email: "waiting@ktda.test", fullName: "Waiting Officer", roles: ["OPERATIONS"], status: "INVITED", lastSignInAt: null }),
    staffView({ id: "st-act", email: "active@ktda.test", fullName: "Active Officer", roles: ["COMPLIANCE"], status: "ACTIVE" }),
    staffView({ id: "st-leg", email: "dev@ktda.test", fullName: "Dev Account", roles: ["READ_ONLY"], status: "ACTIVE", legacy: true }),
    staffView({ id: "st-off", email: "off@ktda.test", fullName: "Off Officer", roles: ["FINANCE"], status: "ACTIVE" }),
  ];
  const ENGINE = [
    { id: "u-me", email: STAFF.email, fullName: STAFF.fullName, status: "ACTIVE", roles: ["ADMIN"] },
    { id: "u-wait", email: "Waiting@ktda.test", fullName: "Waiting Officer", status: "PENDING", roles: ["ACCOUNTANT"] },
    { id: "u-new", email: "newcomer@ktda.test", fullName: "New Comer", status: "PENDING", roles: ["COMPLIANCE"] },
    { id: "u-act", email: "active@ktda.test", fullName: "Active Officer", status: "ACTIVE", roles: ["COMPLIANCE"] },
    { id: "u-leg", email: "dev@ktda.test", fullName: "Dev Account", status: "ACTIVE", roles: ["DEVELOPER"] },
    { id: "u-off", email: "off@ktda.test", fullName: "Off Officer", status: "DISABLED", roles: ["ACCOUNTANT"] },
  ];

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("one row per email, joining the engine's logins and the directory, with the contract's states and actions", async ({ page }) => {
    await stubDirectory(page, { staff: STAFF_ROWS, engine: ENGINE });
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users & roles", level: 1 })).toBeVisible();
    await expect(page.getByTestId("demo-footer")).toHaveCount(0);
    const cases: [string, string, string[]][] = [
      ["invited@ktda.test", "Invited, waiting for sign-up", ["Edit roles", "Revoke"]],
      ["waiting@ktda.test", "Signed up, awaiting approval", ["Approve", "Reject"]],
      ["newcomer@ktda.test", "Signed up, no invite", ["Approve with roles", "Reject"]],
      ["active@ktda.test", "Active", ["Edit roles", "Disable"]],
      ["dev@ktda.test", "Active (engine account)", ["Edit roles", "Disable"]],
      ["off@ktda.test", "Disabled", ["Enable"]],
    ];
    for (const [email, status, buttons] of cases) {
      const r = row(page, email);
      await expect(r.locator("td").nth(2), email).toHaveText(status);
      await expect(r.getByTestId("row-actions").getByRole("button"), email).toHaveText(buttons);
    }
    await expect(page.getByTestId("users-table").locator("tbody tr")).toHaveCount(7);
    await expect(row(page, "active@ktda.test")).toContainText("Compliance");
    // Never a way to disable yourself.
    await expect(row(page, STAFF.email)).toContainText("you");
    await expect(row(page, STAFF.email).getByRole("button", { name: "Disable" })).toHaveCount(0);
  });

  test("invite: the email lower-cased, a name and roles; an email already there shows omnichannel's message", async ({ page }) => {
    let taken = false;
    const sent = await stubDirectory(page, {
      staff: STAFF_ROWS, engine: ENGINE,
      post: (path) => (taken && path === "/staff" ? { status: 409, body: envelope(409, "officer@ktda.test already has a record", "STAFF_EXISTS") } : undefined),
    });
    await page.goto("/users");
    await page.getByRole("button", { name: "Invite a user" }).click();
    await page.getByRole("dialog").getByLabel("Email").fill(" Officer@KTDA.test ");
    await page.getByLabel("Full name").fill("Finance Officer");
    await page.getByRole("checkbox", { name: "Finance" }).check();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByText("officer@ktda.test invited.")).toBeVisible();
    expect(sent.find((s) => s.method === "POST" && s.path === "/staff")!.body).toEqual({ email: "officer@ktda.test", fullName: "Finance Officer", roles: ["FINANCE"] });
    await expect(row(page, "officer@ktda.test")).toContainText("Invited, waiting for sign-up");

    taken = true;
    await page.getByRole("button", { name: "Invite a user" }).click();
    await page.getByRole("dialog").getByLabel("Email").fill("officer@ktda.test");
    await page.getByLabel("Full name").fill("Finance Officer");
    await page.getByRole("checkbox", { name: "Finance" }).check();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("officer@ktda.test already has a record");
  });

  test("approve a sign-up with no invite: the record with roles first, then the engine's approve", async ({ page }) => {
    const sent = await stubDirectory(page, { staff: STAFF_ROWS, engine: ENGINE });
    await page.goto("/users");
    await row(page, "newcomer@ktda.test").getByRole("button", { name: "Approve with roles" }).click();
    await expect(page.getByLabel("Full name")).toHaveValue("New Comer");
    await page.getByRole("checkbox", { name: "Compliance" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("newcomer@ktda.test: approved with Compliance.")).toBeVisible();
    expect(sent.map((s) => `${s.method} ${s.path}`).filter((s) => !s.startsWith("GET"))).toEqual(["POST /staff", "POST /admin/users/u-new/approve"]);
    expect(sent.find((s) => s.method === "POST" && s.path === "/staff")!.body).toEqual({ email: "newcomer@ktda.test", fullName: "New Comer", roles: ["COMPLIANCE"] });
  });

  test("an invited sign-up: Approve is the engine's only; Reject is the engine's and the directory's", async ({ page }) => {
    const sent = await stubDirectory(page, { staff: STAFF_ROWS, engine: ENGINE });
    await page.goto("/users");
    await row(page, "waiting@ktda.test").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("waiting@ktda.test: approved; they become active at their first sign-in.")).toBeVisible();
    expect(sent.filter((s) => s.method !== "GET").map((s) => s.path)).toEqual(["/admin/users/u-wait/approve"]);
    sent.length = 0;
    await row(page, "waiting@ktda.test").getByRole("button", { name: "Reject" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("waiting@ktda.test: rejected.")).toBeVisible();
    expect(sent.filter((s) => s.method !== "GET").map((s) => `${s.path} ${JSON.stringify(s.body)}`)).toEqual(["/admin/users/u-wait/reject null", '/staff/st-wait/status {"status":"DISABLED"}']);
  });

  test("disable goes to the engine and the directory; enable undoes only what is disabled", async ({ page }) => {
    const sent = await stubDirectory(page, { staff: STAFF_ROWS, engine: ENGINE });
    await page.goto("/users");
    await row(page, "active@ktda.test").getByRole("button", { name: "Disable" }).click();
    await expect(page.getByRole("dialog")).toContainText("cannot sign in again until enabled");
    await page.getByRole("dialog").getByRole("button", { name: "Disable" }).click();
    await expect(page.getByText("active@ktda.test: disabled.")).toBeVisible();
    expect(sent.filter((s) => s.method !== "GET").map((s) => `${s.path} ${JSON.stringify(s.body)}`)).toEqual(["/admin/users/u-act/disable null", '/staff/st-act/status {"status":"DISABLED"}']);
    sent.length = 0;
    // Disabled on the engine only: enabling it there is all there is to do.
    await row(page, "off@ktda.test").getByRole("button", { name: "Enable" }).click();
    await expect(page.getByText("off@ktda.test: enabled.")).toBeVisible();
    expect(sent.filter((s) => s.method !== "GET").map((s) => s.path)).toEqual(["/admin/users/u-off/enable"]);
  });

  test("revoke an invite, and edit a member's roles", async ({ page }) => {
    const sent = await stubDirectory(page, { staff: STAFF_ROWS, engine: ENGINE });
    await page.goto("/users");
    await row(page, "invited@ktda.test").getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("invited@ktda.test: invite revoked.")).toBeVisible();
    expect(sent.filter((s) => s.method !== "GET").map((s) => `${s.path} ${JSON.stringify(s.body)}`)).toEqual(['/staff/st-inv/status {"status":"DISABLED"}']);
    sent.length = 0;
    await row(page, "dev@ktda.test").getByRole("button", { name: "Edit roles" }).click();
    await page.getByRole("checkbox", { name: "Read only" }).uncheck();
    await page.getByRole("checkbox", { name: "Operations" }).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("dev@ktda.test: roles saved.")).toBeVisible();
    expect(sent.find((s) => s.method === "PUT")).toEqual({ method: "PUT", path: "/staff/st-leg", body: { fullName: "Dev Account", roles: ["OPERATIONS"] } });
  });

  test("Access: the role-to-key matrix; administrators keep every key; a role is saved on its own", async ({ page }) => {
    const sent = await stubDirectory(page, { staff: STAFF_ROWS, engine: ENGINE });
    await page.goto("/users");
    await page.getByRole("tab", { name: "Access" }).click();
    const matrix = page.getByTestId("access-matrix");
    await expect(matrix.getByRole("checkbox", { name: "Administrator: users manage" })).toBeChecked();
    await expect(matrix.getByRole("checkbox", { name: "Administrator: users manage" })).toBeDisabled();
    const reports = matrix.getByRole("checkbox", { name: "Compliance: reports" });
    await expect(reports).not.toBeChecked();
    await reports.check();
    await page.getByRole("button", { name: "Save Compliance" }).click();
    await expect(page.getByText("Compliance: access saved.")).toBeVisible();
    expect(sent.find((s) => s.method === "PUT")).toEqual({ method: "PUT", path: "/staff/access/COMPLIANCE", body: { keys: ["page:kyc", "page:approvals", "act:kyc.decide", "page:reports"] } });
    await expect(page.getByRole("button", { name: "Save Compliance" })).toHaveCount(0);
  });

  test("a member with page:users but not act:users.manage reads but changes nothing", async ({ page }) => {
    await stubDirectory(page, { staff: STAFF_ROWS, engine: ENGINE, me: staffView({ roles: ["COMPLIANCE"], permissions: ["page:users"] }) });
    await page.goto("/users");
    await expect(page.getByTestId("read-only")).toBeVisible();
    await expect(row(page, "active@ktda.test")).toContainText("Active");
    await expect(page.getByRole("button", { name: "Invite a user" })).toHaveCount(0);
    await expect(page.getByTestId("row-actions")).toHaveCount(0);
    await page.getByRole("tab", { name: "Access" }).click();
    await expect(page.getByTestId("access-matrix").getByRole("checkbox", { name: "Compliance: reports" })).toBeDisabled();
  });

  test("the engine's logins unreadable (no engine ADMIN): the directory shows alone and says why", async ({ page }) => {
    await stubDirectory(page, { staff: STAFF_ROWS });
    await page.route(/\/tok\/admin\/users$/, (route) => json(route, { error: "Forbidden" }, 403));
    await page.goto("/users");
    await expect(page.getByTestId("engine-unavailable")).toBeVisible();
    await expect(row(page, "invited@ktda.test")).toContainText("Invited, waiting for sign-up");
  });

  test("an omnichannel without the directory says so", async ({ page }) => {
    await stubDirectory(page, { missing: true });
    await page.goto("/users");
    await expect(page.getByTestId("not-available")).toContainText("no staff directory");
  });
});
