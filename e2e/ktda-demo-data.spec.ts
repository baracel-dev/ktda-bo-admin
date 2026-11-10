import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./stubs";
import { isRemovedPage } from "../src/lib/hiddenPages";
import { AUTO_MESSAGES, MESSAGE_CAMPAIGNS, smsParts } from "../src/mock/fixtures/messages";
import { ENQUIRIES, ENQUIRY_CHANNEL_LABELS } from "../src/mock/fixtures/crm";
import { AML_ALERTS, FRAUD_ALERTS, UNALLOCATED_FUNDS } from "../src/mock/fixtures/admin";
import { COMPLAINTS, COMPLIANCE_CASES } from "../src/mock/fixtures/compliance";
import { DASHBOARD_BY_FACTORY, DASHBOARD_RUNS } from "../src/mock/fixtures/dashboard";
import { DEMO_FARMERS } from "../src/mock/fixtures/ktdaPeople";

/* The pages still on demo data show KTDA's world: farmers by grower number
 * and factory, tea payments, agents, merchants with tills, M-PESA and
 * SasaPay, KES only, this month's dates. Nothing of the investment back
 * office they came from. The "Demo data" footer stays on them. */

const INVESTMENT = /Investcent|investor|\bfunds? (?:manager|accounting)\b|\bNAV\b|redemption|subscription|Eurobond|\bbonds?\b|\bIFA\b|portfolio|\bAUM\b|sub-fund|custodian|\bUSD\b/i;

const DEMO_PAGES: [string, string][] = [
  ["/", "Dashboard"],
  ["/campaigns", "Messages"],
  ["/enquiries", "Enquiries"],
  ["/tasks", "Follow-ups"],
  ["/complaints", "Disputes"],
  ["/fraud-alerts", "Fraud alerts"],
  ["/fraud-cases", "Fraud cases"],
  ["/aml-alerts", "Alerts"],
  ["/cases", "Case management"],
  ["/cases/cs_2", "A case"],
  ["/unallocated-funds", "Unallocated funds"],
  ["/audit-log", "Audit log"],
  ["/system", "System"],
];

const heading = (page: Page) => page.locator("main h1").first();

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const [path] of DEMO_PAGES) {
  test(`${path} shows KTDA's demo data, nothing of an investment back office, and the demo footer`, async ({ page }) => {
    await page.goto(path);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByTestId("demo-footer")).toHaveText("Demo data: no real farmers or money");
    // Let the demo reads land before reading the page.
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).not.toContainText(INVESTMENT);
  });
}

test("the general ledger (fund accounting) is out of the menu and refused", async ({ page }) => {
  expect(isRemovedPage("/ledger")).toBe(true);
  await page.goto("/ledger");
  await expect(page.getByTestId("page-removed")).toBeVisible();
});

test("the fixtures are KTDA's: grower numbers, KES only, this month", () => {
  const grower = /^GN-\d{6}$/;
  const subject = /^(GN-\d{6}|AG-\d{4}|M-\d{5})$/;
  for (const f of DEMO_FARMERS) expect(f.growerNo).toMatch(grower);
  for (const a of [...FRAUD_ALERTS, ...AML_ALERTS]) {
    expect(a.clientId, a.id).toMatch(subject);
    expect(a.raisedAt.slice(0, 7), a.id).toBe("2026-11");
  }
  for (const c of COMPLIANCE_CASES) if (c.clientId) expect(c.clientId, c.id).toMatch(subject);
  for (const e of ENQUIRIES) {
    expect(e.clientId, e.id).toMatch(grower);
    expect(e.receivedAt.slice(0, 7), e.id).toBe("2026-11");
  }
  expect(Object.values(ENQUIRY_CHANNEL_LABELS)).toEqual(["USSD", "Agent", "Call centre", "App"]);
  for (const c of COMPLAINTS) expect(c.clientId, c.id).toMatch(grower);
  for (const u of UNALLOCATED_FUNDS) expect(u.currency, u.id).toBe("KES");
  // The factories' figures add up to the paid runs.
  const paid = DASHBOARD_RUNS.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);
  expect(DASHBOARD_BY_FACTORY.reduce((s, f) => s + f.amount, 0)).toBe(paid);
});

test("an SMS's parts follow its length, and every automatic message has a count", () => {
  for (const m of [...MESSAGE_CAMPAIGNS, ...AUTO_MESSAGES]) {
    expect(m.parts, m.id).toBe(smsParts(m.text));
    expect(m.delivered + m.failed, m.id).toBeLessThanOrEqual("recipients" in m ? m.recipients : m.sent);
  }
  expect(smsParts("x".repeat(160))).toBe(1);
  expect(smsParts("x".repeat(161))).toBe(2);
  expect(AUTO_MESSAGES.map((m) => m.name)).toEqual(expect.arrayContaining(["Payment notice", "Consent request", "One-time code"]));
});

test("Messages: campaigns and automatic messages to farmers, with the SMS counts", async ({ page }) => {
  await page.goto("/campaigns");
  await expect(page.getByRole("heading", { name: "Messages", level: 1 })).toBeVisible();
  const campaigns = page.getByTestId("message-campaigns");
  await expect(campaigns).toContainText("October green leaf payment is on the way");
  await expect(campaigns).toContainText("18,240");
  const autos = page.getByTestId("auto-messages");
  for (const name of ["Payment notice", "Consent request", "One-time code"]) await expect(autos).toContainText(name);
  await autos.getByText("Payment notice").first().click();
  await expect(page.getByTestId("message-text")).toContainText("received for 486 kg delivered to Litein");
});

test("Enquiries: farmers' support requests, by USSD, agent, call centre or app; no lead conversion", async ({ page }) => {
  await page.goto("/enquiries");
  await expect(page.locator("main")).toContainText("Cash-out at agent not received");
  await expect(page.locator("main")).toContainText("Fertiliser voucher refused");
  await page.getByText("Payment notice went to my old number").first().click();
  await expect(page.getByRole("dialog")).toContainText("Peter Kimathi M'Ikiara (GN-142078)");
  await expect(page.getByRole("button", { name: "Convert to lead" })).toHaveCount(0);
});

test("Fraud alerts: KTDA's cases, by grower, agent or merchant number", async ({ page }) => {
  await page.goto("/fraud-alerts");
  const main = page.locator("main");
  for (const rule of ["Duplicate grower number", "Number changed before a bonus", "Agent cashing out one farmer repeatedly", "Merchant sales spike"]) {
    await expect(main).toContainText(rule);
  }
  for (const id of ["GN-118407", "AG-2041", "M-10251"]) await expect(main).toContainText(id);
});

test("Dashboard: this month's payment runs, money out of wallets, and what needs a person", async ({ page }) => {
  await page.goto("/");
  const tiles = page.getByTestId("dashboard-tiles");
  await expect(tiles).toContainText("Paid to farmers");
  await expect(tiles).toContainText("24,652 farmers in 2 payment runs this month");
  await expect(page.getByTestId("dashboard-runs")).toContainText("Githongo, Kangaita");
  await expect(page.getByTestId("dashboard-runs")).toContainText("Awaiting approval");
  await expect(page.getByTestId("dashboard-attention")).toContainText("Unallocated receipts");
});
