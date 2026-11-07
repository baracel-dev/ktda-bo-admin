import { expect, test, type Page } from "@playwright/test";
import { FAIL, IDS, stubUnyt, type Mode } from "./unyt-fixtures";
import { isHiddenPage } from "../src/lib/hiddenPages";

/* Every Baracel Unyt page (/token-console/*) the KTDA back office shows (the
 * investment-only ones are hidden, see src/lib/hiddenPages.ts) against stubbed
 * services, three ways:
 *   empty  every list answers [] — the page shows its empty state, not a crash;
 *   data   representative rows in the services' own shapes — the page shows them;
 *   fail   every read answers 500 — the page shows its error, not a blank or sample data.
 * In every case: no "Demo data" badge (Unyt must be live), no uncaught error, and no
 * write leaves the page just because it was opened. */

type PageCase = {
  path: string;
  heading: string;
  /** Text only the empty state shows. */
  empty: string | RegExp;
  /** Text only the data case shows, taken from the fixtures. */
  data: (string | RegExp)[];
  /** Which service's failure the page reports (omni pages may also read the ledger). */
  fails: "tok" | "omni";
  /** The Customer desk reads only on a search. */
  search?: string;
};

const ALL_PAGES: PageCase[] = [
  { path: "overview", heading: "Overview", empty: "Nothing posted yet", data: ["Subscription by Wanjiru Kamau", "Balanced"], fails: "tok" },
  { path: "investors", heading: "Farmers", empty: "No farmers on the register yet", data: [IDS.investorName, "Otieno Ochieng"], fails: "tok" },
  { path: "accounts", heading: "Accounts", empty: "No accounts open", data: [IDS.fundContract, IDS.loanContract], fails: "tok" },
  { path: "journals", heading: "Journals", empty: "Nothing posted yet", data: ["Subscription by Wanjiru Kamau"], fails: "tok" },
  { path: "trial-balance", heading: "Trial balance", empty: "No balances", data: ["Investor principal", "-250,000.00"], fails: "tok" },
  { path: "reconciliation", heading: "Reconciliation", empty: "Nothing to reconcile", data: ["Agrees"], fails: "tok" },
  { path: "runs", heading: "Batch runs", empty: "No runs yet", data: ["RUN-ACC-1", "95.89"], fails: "tok" },
  { path: "compliance", heading: "Review queue", empty: "Queue is clear", data: ["Name partially matches a sanctions list"], fails: "tok" },
  { path: "changes", heading: "Change approvals", empty: "Nothing is waiting.", data: ["Price BRF-KES-INC at 101.25", "Management fee 2%"], fails: "tok" },
  { path: "tariffs", heading: "Tariffs", empty: "No values", data: ["Retail default", "1.5%"], fails: "tok" },
  { path: "funds", heading: "Institutions", empty: "No ladders built", data: ["CMA/CIS/2026/01", "KES 19,750,000.00"], fails: "tok" },
  { path: "configuration", heading: "Configuration", empty: /No schemes yet/, data: ["Bond fund scheme"], fails: "tok" },
  { path: "loans", heading: "Loans", empty: "No loan accounts yet", data: [IDS.loanContract], fails: "tok" },
  { path: "kyc", heading: "KYC desk", empty: "No farmer is waiting on a KYC decision.", data: ["Otieno Ochieng", "GRW-0078", "Differs from the registry"], fails: "omni" },
  { path: "customers", heading: "Customer desk", empty: "No customer found.", data: ["Alice Wanjiru"], fails: "omni", search: "alice@example.com" },
  { path: "customer-approvals", heading: "Customer approvals", empty: "Nothing is waiting for a second person", data: ["False alarm", "Alice Wanjiru"], fails: "omni" },
  { path: "transactions", heading: "Transactions", empty: "No customer has paid yet", data: ["QWE123RTY", "+KES 5,000.00"], fails: "omni" },
  { path: "surveillance", heading: "Surveillance", empty: "No open alerts", data: ["4 payments in totalling 39,600 KES", "47 holdings"], fails: "omni" },
  { path: "reports", heading: "Reports", empty: "No report has been produced yet", data: ["transactions-2026-10-01-to-2026-10-28"], fails: "omni" },
  { path: "users", heading: "Tokenization users", empty: "No accounts", data: ["peter@baracel.ae", "10.0.0.7"], fails: "tok" },
];

/** The cases for pages this back office still offers (removed pages keep their
 *  case, for when they come back). */
const PAGES = ALL_PAGES.filter((c) => !isHiddenPage(`/token-console/${c.path}`));

/** Every route App.tsx serves under /token-console (bar the redirects and the
 *  hidden and removed pages) has a case above. */
test("every shown Unyt route is covered", async () => {
  const fs = await import("node:fs");
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const routes = [...app.matchAll(/path="\/token-console\/([\w-]+)" element=\{<ProtectedRoute>/g)]
    .map((m) => m[1])
    .filter((r) => !isHiddenPage(`/token-console/${r}`));
  expect(routes.length).toBeGreaterThanOrEqual(13);
  expect(PAGES.map((p) => p.path).sort()).toEqual([...routes].sort());
});

/** Collects what must not happen while a page is open. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("response", (r) => {
    if (/\/(tok|omni)\//.test(r.url()) && r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  return problems;
}

async function open(page: Page, c: PageCase, mode: Mode) {
  const stub = await stubUnyt(page, mode);
  const problems = watch(page);
  await page.goto(`/token-console/${c.path}`);
  await expect(page.getByRole("heading", { name: c.heading, exact: true, level: 1 })).toBeVisible();
  if (c.search) {
    await page.getByLabel("Phone, email, investor id or profile id").fill(c.search);
    await page.getByRole("button", { name: "Find" }).click();
  }
  return { ...stub, problems };
}

const main = (page: Page) => page.locator("main");

for (const c of PAGES) {
  test.describe(`/token-console/${c.path}`, () => {
    test("empty: shows its empty state", async ({ page }) => {
      const { problems, writes } = await open(page, c, "empty");
      await expect(main(page).getByText(c.empty).first()).toBeVisible();
      for (const d of c.data) await expect(main(page).getByText(d)).toHaveCount(0);
      await expect(page.getByText("Demo data")).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      expect(problems).toEqual([]);
      expect(writes).toEqual([]);
    });

    test("data: shows the services' rows", async ({ page }) => {
      const { problems, writes } = await open(page, c, "data");
      for (const d of c.data) await expect(main(page).getByText(d).first()).toBeVisible();
      await expect(page.getByText("Demo data")).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      expect(problems).toEqual([]);
      expect(writes).toEqual([]);
    });

    test("fail: a 500 shows the page's error, not blank or sample data", async ({ page }) => {
      const { problems, writes } = await open(page, c, "fail");
      await expect(main(page).getByText(FAIL[c.fails]).first()).toBeVisible();
      for (const d of c.data) await expect(main(page).getByText(d)).toHaveCount(0);
      await expect(main(page).getByText(c.empty)).toHaveCount(0);
      // A list that could not be read is unknown, not empty.
      await expect(main(page)).not.toContainText(/nothing is waiting\.|nothing has been posted yet/i);
      await expect(page.getByText("Demo data")).toHaveCount(0);
      // The 500s themselves are expected; nothing else may go wrong.
      expect(problems.filter((p) => !/^500 GET |^console: Failed to load resource: .* 500/.test(p))).toEqual([]);
      expect(writes).toEqual([]);
    });
  });
}

test("the Demo data check can fail: a page still on src/mock shows the badge", async ({ page }) => {
  await stubUnyt(page, "empty");
  await page.goto("/clients");
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
});

test("overview: a trial balance that cannot be read is not reported as an empty book", async ({ page }) => {
  test.skip(isHiddenPage("/token-console/overview"), "removed from the KTDA back office");
  await open(page, ALL_PAGES[0], "fail");
  await expect(main(page).getByText("Could not load the trial balance")).toBeVisible();
  await expect(main(page)).not.toContainText("nothing has been posted yet");
  await expect(main(page).getByText("the trial balance could not be read")).toBeVisible();
});
