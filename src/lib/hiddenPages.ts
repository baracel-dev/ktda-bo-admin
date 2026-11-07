/* Pages the KTDA back office keeps in the code but does not offer.

   HIDDEN_PAGES: no menu entry and no place in any role's page list
   (mock/fixtures/admin.ts), but a direct link still opens them.

   REMOVED_PAGES: the platform's own tools, and demo pages that only show
   invented records where a live page does the job. A client institution's staff must
   not change the platform's set-up or see every institution in the engine,
   so these are hidden and the route refuses them too (ProtectedRoute). The
   code stays, so a page can come back by taking it off this list. Refusing
   the route here does not close the engine endpoints behind it; that is
   for the engine. */

export const HIDDEN_PAGES: ReadonlySet<string> = new Set([
  // Farmer Services: the demo farmer register. The live one is Farmers
  // (/farmers, omnichannel's, for this institution). Demo pages (screening,
  // KYC, cases) still link to its records.
  "/clients",
  // Baracel Unyt: kept for KTDA requirements (Policies drive the batch runs).
  "/token-console/policies",
]);

export const REMOVED_PAGES: ReadonlySet<string> = new Set([
  "/token-console/configuration", // schemes, products and packages, engine-wide
  "/token-console/tariffs",       // the platform's tariff rates and domains
  "/token-console/changes",       // approvals for configuration and tariff changes
  "/token-console/users",         // the engine's staff accounts
  "/token-console/overview",      // the engine's books across every institution
  "/token-console/funds",         // every institution in the engine
  "/token-console/investors",     // the engine's investors, every institution's (Farmers is /farmers)
  "/settings",                    // platform settings
  "/feature-flags",               // platform feature flags
  // The demo KYC pages: invented records, from a service KTDA does not have.
  // The KYC desk (/token-console/kyc) and Customer approvals are the live ones.
  "/kyc-queue",                   // onboarding review, and /kyc-queue/:id
  "/kyc-periodic",                // periodic review
  "/kyc-dynamic",                 // dynamic review
  "/screening",                   // screening
]);

const under = (set: ReadonlySet<string>, path: string) =>
  [...set].some((p) => path === p || path.startsWith(`${p}/`));

/** Refused by the route, as well as left out of the menu. */
export const isRemovedPage = (path: string) => under(REMOVED_PAGES, path);

/** Left out of the menu and the role page lists (hidden or removed). */
export const isHiddenPage = (path: string) => HIDDEN_PAGES.has(path) || isRemovedPage(path);
