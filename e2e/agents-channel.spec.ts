import { expect, test, type Page } from "@playwright/test";
import { envelope, json, signIn } from "./stubs";

/* Agents on KTDA come from the channel-api, the register the agent app signs
 * in to, through omnichannel's /ktda/agents passthrough (the 10 Nov bug: an
 * agent registered here could not sign in to the app, because the page wrote
 * to omnichannel's own register). With the passthrough there, every read and
 * write goes to /ktda/agents and none to /agents; the register form follows
 * the channel's agent number rule and says where the starter PIN went; the
 * drawer has no "record activity" form for an app agent. A channel that does
 * not answer is an error with a retry, not a fallback to the other register.
 * Stubbed. */

type Obj = Record<string, unknown>;
const agent = (agentNo: string, over: Obj = {}): Obj => ({
  agentNo, fullName: "Test App Agent", phone: "+254700000501", town: "Litein", status: "ACTIVE",
  float: { balance: 40000, limit: 50000, low: false }, today: { transactions: 3 }, onboardedThisMonth: 2, commissionThisMonth: 125.5,
  suspension: null, createdAt: "2026-11-10T08:00:00Z", updatedAt: null, source: "channel", ...over,
});
const SUMMARY = { active: 1, lowFloat: 0, suspended: 0, onboardedThisMonth: 2, commissionThisMonth: 125.5 };
const headers = (n: number) => ({ "X-Total-Count": String(n), "X-Page": "1", "X-Size": "20", "X-Total-Pages": "1" });
type Sent = { method: string; path: string; body: unknown };

async function stubChannel(page: Page, opts: { summaryStatus?: number; post?: (path: string, body: Obj) => { status: number; body: unknown } | undefined } = {}) {
  const sent: Sent[] = [];
  // omnichannel's own register: any call there is a bug on KTDA.
  await page.route(/\/omni\/api\/operator\/agents/, (route) => {
    sent.push({ method: route.request().method(), path: new URL(route.request().url()).pathname, body: null });
    return json(route, envelope(500, "Wrong register"), 500);
  });
  await page.route(/\/omni\/api\/operator\/ktda\/agents/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/omni\/api\/operator/, "");
    const body = req.method() === "POST" ? (req.postDataJSON() as Obj | null) : null;
    sent.push({ method: req.method(), path, body });
    if (req.method() === "POST") {
      const a = opts.post?.(path, body ?? {}) ?? { status: 200, body: agent("A-7731") };
      return json(route, a.body, a.status);
    }
    if (path === "/ktda/agents/summary") {
      return opts.summaryStatus ? json(route, envelope(opts.summaryStatus, "The KTDA channel could not be reached; try again shortly", "KTDA_CHANNEL_UNAVAILABLE"), opts.summaryStatus) : json(route, SUMMARY);
    }
    if (path === "/ktda/agents") {
      const l = [agent("A-7731")];
      return route.fulfill({ status: 200, contentType: "application/json", headers: headers(l.length), body: JSON.stringify(l) });
    }
    return json(route, agent(decodeURIComponent(path.split("/").pop()!), { mustChangePin: true }));
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the list and counts are the channel's agents, and nothing touches omnichannel's own register", async ({ page }) => {
  const sent = await stubChannel(page);
  await page.goto("/agents");
  const rows = page.getByTestId("agents-table").locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Test App Agent");
  await expect(rows.nth(0)).toContainText("A-7731");
  await expect(page.getByTestId("agent-tiles")).toContainText("Active agents1");
  expect(sent.some((s) => s.path.startsWith("/omni/api/operator/agents"))).toBe(false);
});

test("register an app agent: the channel's number rule, the body, and where the starter PIN went", async ({ page }) => {
  const sent = await stubChannel(page, {
    post: (path) => path === "/ktda/agents"
      ? { status: 201, body: agent("A-7731", { fullName: "Grace Chebet", float: { balance: 0, limit: 50000, low: true }, status: "LOW_FLOAT", mustChangePin: true, pinSentTo: "+2547****678" }) }
      : undefined,
  });
  await page.goto("/agents");
  await page.getByRole("button", { name: "Register agent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("The starter PIN goes by SMS to this phone");
  await page.getByLabel("Full name", { exact: true }).fill("Grace Chebet");
  await page.getByLabel("Phone", { exact: true }).fill("0712345678");
  await page.getByLabel("Town", { exact: true }).fill("Litein");
  await page.getByLabel("Float limit (KES)").fill("50000");
  await page.getByLabel("Agent no. (optional)").fill("X-12");
  await expect(page.getByTestId("form-problem")).toContainText("A- and 3 to 6 digits");
  await expect(dialog.getByRole("button", { name: "Register", exact: true })).toBeDisabled();
  await page.getByLabel("Agent no. (optional)").fill("A-7731");
  await dialog.getByRole("button", { name: "Register", exact: true }).click();

  await expect(page).toHaveURL(/focus=A-7731/);
  await expect(page.getByText("Grace Chebet is registered as A-7731. The starter PIN went by SMS to +2547****678")).toBeVisible();
  const post = sent.find((s) => s.method === "POST")!;
  expect(post.path).toBe("/ktda/agents");
  expect(post.body).toEqual({ agentNo: "A-7731", fullName: "Grace Chebet", phone: "0712345678", town: "Litein", floatLimit: 50000 });
});

test("a phone that already belongs to an app agent shows omnichannel's message", async ({ page }) => {
  await stubChannel(page, { post: () => ({ status: 409, body: envelope(409, "That phone already belongs to agent A-1001", "AGENT_PHONE_TAKEN") }) });
  await page.goto("/agents");
  await page.getByRole("button", { name: "Register agent" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("X");
  await page.getByLabel("Phone", { exact: true }).fill("0712345678");
  await page.getByLabel("Town", { exact: true }).fill("T");
  await page.getByLabel("Float limit (KES)").fill("1000");
  await page.getByRole("dialog").getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText("That phone already belongs to agent A-1001")).toBeVisible();
});

test("an app agent's drawer: top-up and suspend go to the channel, and activity is in the app", async ({ page }) => {
  const sent = await stubChannel(page);
  await page.goto("/agents?focus=A-7731");
  const drawer = page.getByTestId("agent-drawer");
  await expect(drawer).toContainText("Starter PIN not changed yet");
  await expect(page.getByTestId("record-activity")).toHaveCount(0);
  await expect(page.getByTestId("recorded-in-app")).toBeVisible();
  await expect(page.getByTestId("activities-in-app")).toBeVisible();

  const topUp = page.getByTestId("top-up");
  await topUp.getByLabel("Top-up amount").fill("1500");
  await topUp.getByLabel("Top-up reference").fill("EQ-77");
  await topUp.getByRole("button", { name: "Top up" }).click();
  await expect(page.getByText("Float topped up by KES 1,500.00.")).toBeVisible();
  await drawer.getByRole("button", { name: "Suspend agent" }).click();
  await page.getByRole("dialog").last().getByLabel("Reason").fill("Float not banked.");
  await page.getByRole("dialog").last().getByRole("button", { name: "Suspend", exact: true }).click();

  await expect.poll(() => sent.filter((s) => s.method === "POST").map((s) => s.path)).toEqual([
    "/ktda/agents/A-7731/float/top-up", "/ktda/agents/A-7731/suspend",
  ]);
  expect(sent.some((s) => s.path.endsWith("/activities"))).toBe(false);
  expect(sent.some((s) => s.path.startsWith("/omni/api/operator/agents"))).toBe(false);
});

test("a channel that does not answer is an error with a retry, not the other register", async ({ page }) => {
  const sent = await stubChannel(page, { summaryStatus: 503 });
  await page.goto("/agents");
  await expect(page.getByText("Could not load the agents")).toBeVisible();
  await expect(page.getByText("The KTDA channel could not be reached; try again shortly").first()).toBeVisible();
  expect(sent.some((s) => s.path.startsWith("/omni/api/operator/agents"))).toBe(false);
});
