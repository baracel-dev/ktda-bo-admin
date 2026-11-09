import { expect, test, type Page } from "@playwright/test";
import { json, signIn, STAFF } from "./stubs";
import { HIDDEN_PAGES, REMOVED_PAGES } from "../src/lib/hiddenPages";

/* The KTDA shell: placeholder branding, the prototype's navigation (four
 * top-level items, People, Money and Admin), the top bar's search, theme
 * switch and user chip, and the demo-data footer line. */

const nav = (page: Page) => page.locator("aside").first();
const menuHrefs = (page: Page) => page.locator("aside a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));

test("the sign-in page is KTDA's, with nothing of the source back office", async ({ page }) => {
  await page.route(/\/tok\//, (route) => json(route, { error: "signed out" }, 401));
  await page.route(/\/omni\//, (route) => json(route, {}, 404));
  await page.goto("/login");
  await expect(page).toHaveTitle("KTDA Back Office");
  await expect(page.getByRole("img", { name: "KTDA Back Office" })).toBeVisible();
  await expect(page.getByText("KTDA Digital Tea Payment Solution")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Investcent|Investment Bank|Capital Markets Authority/);
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page.getByRole("img", { name: "KTDA Back Office" }).first()).toBeVisible();
  });

  test("the sidebar is KTDA's: no Investcent name or regulator line", async ({ page }) => {
    await expect(nav(page)).toContainText("KTDA Digital Tea Payment Solution.");
    await expect(page.locator("body")).not.toContainText(/Investcent|Capital Markets Authority/);
  });

  test("the menu is four items and three groups: People, Money, Admin", async ({ page }) => {
    const menu = nav(page);
    await expect(menu.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("href", "/");
    await expect(menu.getByRole("link", { name: "Payment runs", exact: true })).toHaveAttribute("href", "/bulk/payments");
    await expect(menu.getByRole("link", { name: "Approvals", exact: true })).toHaveAttribute("href", "/approvals");

    await menu.getByRole("button", { name: "People", exact: true }).click();
    await expect(menu.getByRole("link", { name: "Farmers", exact: true })).toHaveAttribute("href", "/farmers");
    await expect(menu.getByRole("link", { name: "Farmer journey", exact: true })).toHaveAttribute("href", "/journey");
    await expect(menu.getByRole("link", { name: "KYC desk", exact: true })).toHaveAttribute("href", "/token-console/kyc");
    await expect(menu.getByRole("link", { name: "Customer approvals", exact: true })).toHaveAttribute("href", "/token-console/customer-approvals");
    await expect(menu.getByRole("link", { name: "Messages", exact: true })).toHaveAttribute("href", "/campaigns");
    await expect(menu.getByRole("link", { name: "Bulk onboarding", exact: true })).toHaveAttribute("href", "/bulk/onboarding");

    await menu.getByRole("button", { name: "Money", exact: true }).click();
    await expect(menu.getByRole("link", { name: "Transactions", exact: true })).toHaveAttribute("href", "/token-console/transactions");
    await expect(menu.getByRole("link", { name: "Disputes", exact: true })).toHaveAttribute("href", "/complaints");
    await expect(menu.getByRole("link", { name: "Reconciliation", exact: true })).toHaveAttribute("href", "/token-console/reconciliation");
    await expect(menu.getByRole("link", { name: "Fraud alerts", exact: true })).toHaveAttribute("href", "/fraud-alerts");
    await expect(menu.getByRole("link", { name: "Reports", exact: true })).toHaveAttribute("href", "/reports");

    await menu.getByRole("button", { name: "Admin", exact: true }).click();
    for (const [label, href] of [["Institution", "/institution"], ["System health", "/system"], ["Users & roles", "/users"], ["Audit log", "/audit-log"]]) {
      await expect(menu.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
    }

    for (const section of ["Farmer Payments", "Farmer Services", "Baracel Unyt", "Operations", "Finance", "Controls", "Platform", "Reporting"]) {
      await expect(menu.getByRole("button", { name: section, exact: true })).toHaveCount(0);
    }
  });

  test("no hidden page and no replaced demo page has a menu link", async ({ page }) => {
    const hrefs = await menuHrefs(page);
    expect(hrefs.filter((h) => h && (HIDDEN_PAGES.has(h) || REMOVED_PAGES.has(h)))).toEqual([]);
    expect(hrefs).not.toContain("/transactions");
    expect(hrefs).not.toContain("/reconciliation");
    expect(hrefs.filter((h) => h === "/farmers")).toHaveLength(1);
    expect(hrefs).not.toContain("/token-console/investors");
  });

  test("a hidden page still opens by its address", async ({ page }) => {
    await page.goto("/token-console/policies");
    await expect(page.getByText("Access denied")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Accrual & distribution policies", level: 1 })).toBeVisible();
  });

  test("the platform's own tools are refused by their address, and nowhere in the menu", async ({ page }) => {
    const menu = nav(page);
    for (const section of ["People", "Money", "Admin"]) await menu.getByRole("button", { name: section, exact: true }).click();
    for (const label of ["Configuration", "Tariffs", "Change approvals", "Engine users", "Platform settings", "Feature flags", "Engine overview", "Institutions",
      "Onboarding review", "KYC periodic review", "Dynamic review", "Screening", "General ledger"]) {
      await expect(menu.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
    expect(REMOVED_PAGES.size).toBe(14);
    for (const path of REMOVED_PAGES) {
      await page.goto(path);
      await expect(page.getByTestId("page-removed")).toContainText("Not part of this back office");
      await expect(page.locator("main h1")).toHaveCount(1);
    }
    await page.goto("/token-console");
    await expect(page).toHaveURL(/\/$/);
  });

  test("Farmers is this institution's list; the engine-wide one is refused", async ({ page }) => {
    await page.route(/\/omni\/api\/operator\/farmers$|\/omni\/api\/operator\/farmers\?/, (route) => json(route, []));
    await page.route(/\/omni\/api\/operator\/farmers\/summary$/, (route) => json(route, { registered: 0, activated: 0, funded: 0, total: 0 }));
    await page.goto("/farmers");
    await expect(page.getByRole("heading", { name: "Farmers", level: 1 })).toBeVisible();
    await expect(page.getByTestId("farmers-empty")).toContainText("No farmers registered yet");
    await expect(page.getByRole("button", { name: "Register farmer" })).toBeVisible();
    await page.goto("/token-console/investors");
    await expect(page.getByTestId("page-removed")).toBeVisible();
  });

  test("a group's count is the sum of its entries' counts", async ({ page }) => {
    const menu = nav(page);
    // People's only counted entry was the demo onboarding review, now removed.
    await expect(menu.getByRole("button", { name: "People", exact: true })).toHaveText(/^\s*People\s*$/);
    const money = menu.getByRole("button", { name: "Money", exact: true });
    await money.click();

    const fraud = menu.getByRole("link", { name: "Fraud alerts", exact: true });
    await expect(fraud).toHaveAttribute("title", /^Fraud alerts: \d+ waiting$/);
    const f = Number((await fraud.getAttribute("title"))!.match(/(\d+) waiting/)![1]);
    await expect(money).toHaveText(new RegExp(`Money\\s*${f}$`));
  });

  test("search finds a page, and a grower number goes to the farmer", async ({ page }) => {
    const search = page.getByRole("combobox", { name: "Search farmers, runs, pages" });
    await page.locator("main").click();
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();

    await search.fill("reconc");
    await expect(page.getByRole("option", { name: /Reconciliation/ })).toBeVisible();
    await search.press("Enter");
    await expect(page).toHaveURL(/\/token-console\/reconciliation$/);

    await search.fill("GN-104233");
    await expect(page.getByRole("option").first()).toContainText("Farmer GN-104233");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/farmers\?q=GN-104233$/);
  });

  test("the theme switch sets light, dark or the system theme, and remembers it", async ({ page }) => {
    const html = page.locator("html");
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Light theme" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("button", { name: "Follow the system theme" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).not.toHaveClass(/\bdark\b/);
  });

  test("the app opens light even when the system theme is dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(page.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  });

  test("the top bar shows the signed-in user's name and role", async ({ page }) => {
    const chip = page.getByTestId("user-chip");
    await expect(chip).toContainText(STAFF.fullName);
    await expect(chip).toContainText("ADMIN");
  });

  test("the demo-data footer shows on demo pages only", async ({ page }) => {
    await expect(page.getByTestId("demo-footer")).toHaveText("Demo data: no real farmers or money");
    await page.goto("/token-console/policies");
    await expect(page.getByRole("heading", { name: "Accrual & distribution policies", level: 1 })).toBeVisible();
    await expect(page.getByTestId("demo-footer")).toHaveCount(0);
  });
});
