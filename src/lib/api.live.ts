/* BO Admin pages whose records the tokenization service actually holds, read
 * from it live and mapped into the view models those pages already render —
 * so the page itself is unchanged.
 *
 * Only pages whose every column has a real source are here. The rest stay on
 * the demo (api.demo.ts) rather than show live rows half-filled or invented:
 *   Holdings     is the fund's bond book (ISIN, duration, weight vs limit);
 *                the service's holdings are investors' unit positions.
 *   Products     needs AUM, fee bps, benchmark, CMA approval — not held.
 *   Redemptions  needs settlement tier, due date, funded-by-sale — not held.
 *   Clients/KYC  their detail pages (documents, UBOs, screening, activation)
 *                have no counterpart; Baracel Unyt's Investors and
 *                KYC desk show the real register and decide real reviews. */
import { tokenConsole, tokenConsolePages } from "./api.tokenConsole";
import type { InvestmentOrder, OrderStatus } from "../mock";
import type { Investor, OfferingResponse } from "./tokenConsole/types.gen";

const SUBSCRIPTION_STATUS: Record<string, OrderStatus> = {
  PENDING: "received",
  CONFIRMED: "settled",
  CANCELLED: "cancelled",
};

const shortRef = (prefix: string, id?: string) => `${prefix}-${(id ?? "").replace(/-/g, "").slice(0, 8).toUpperCase() || "—"}`;
/** The price the record actually dealt at — not the offering's par price,
 *  which a redemption need not trade at. */
const priceOf = (amount?: number, quantity?: number) => (amount != null && quantity ? amount / quantity : null);
const currencyOf = (c?: string): InvestmentOrder["currency"] => (c === "USD" ? "USD" : "KES");

/* Orders are read from one call per offering book, so they are kept for a
   minute: coming back to the page is instant rather than another fan-out.
   Concurrent callers share one fetch. Cleared on sign-out. */
const ORDERS_TTL_MS = 60_000;
let ordersCache: { at: number; rows: InvestmentOrder[] } | null = null;
let ordersInFlight: Promise<InvestmentOrder[]> | null = null;

export function clearLiveCache() {
  ordersCache = null;
  ordersInFlight = null;
}

/** Every subscription and redemption across every offering, newest first. */
export function getInvestmentOrders(): Promise<InvestmentOrder[]> {
  if (ordersCache && Date.now() - ordersCache.at < ORDERS_TTL_MS) return Promise.resolve(ordersCache.rows);
  if (!ordersInFlight) {
    const run = fetchInvestmentOrders();
    ordersInFlight = run;
    run.then(
      (rows) => {
        // A sign-out while this was in flight must not repopulate the cache.
        if (ordersInFlight === run) ordersCache = { at: Date.now(), rows };
      },
      () => undefined,
    ).finally(() => {
      if (ordersInFlight === run) ordersInFlight = null;
    });
  }
  return ordersInFlight;
}

async function fetchInvestmentOrders(): Promise<InvestmentOrder[]> {
  // The books need only the offerings; the investor names come after, for just
  // the investors the orders actually name — never the whole register.
  const offerings = await tokenConsole.offerings();
  const books = await Promise.all(
    offerings.map(async (o: OfferingResponse) => {
      const id = o.offeringId ?? "";
      const [subs, reds] = await Promise.all([tokenConsole.subscriptions(id), tokenConsole.redemptions(id)]);
      return { o, subs, reds };
    }),
  );

  // The ids referenced across every book; investorsByIds chunks them to the engine's limit.
  const ids = new Set<string>();
  for (const { subs, reds } of books) {
    for (const s of subs) if (s.investorId) ids.add(s.investorId);
    for (const r of reds) if (r.investorId) ids.add(r.investorId);
  }
  // A failed name lookup only leaves the names out, not the orders themselves.
  const investors = await tokenConsolePages.investorsByIds([...ids]).catch(() => [] as Investor[]);

  const who = new Map<string, Investor>(investors.map((i) => [i.investorId ?? "", i]));
  const client = (investorId?: string) => {
    const i = who.get(investorId ?? "");
    return {
      clientName: i?.displayName ?? i?.externalRef ?? shortRef("INV", investorId),
      clientType: (i?.investorCategory === "INSTITUTIONAL" ? "institutional" : "retail") as InvestmentOrder["clientType"],
    };
  };

  return books
    .flatMap(({ o, subs, reds }) => {
      const id = o.offeringId ?? "";
      const product = o.productId ?? id;
      const subscriptions = subs.map<InvestmentOrder>((s) => ({
        id: s.subscriptionId ?? `${id}-sub-${s.createdAt}`,
        ref: shortRef("SUB", s.subscriptionId),
        ...client(s.investorId),
        product,
        side: "subscription",
        amount: s.amount ?? 0,
        currency: currencyOf(s.currency ?? o.currency),
        // Units are fixed when the order is placed, so the price is known too.
        units: s.quantity ?? null,
        dealingPrice: priceOf(s.amount, s.quantity),
        placedAt: s.createdAt ?? "",
        dealingDate: (s.confirmedAt ?? s.createdAt ?? "").slice(0, 10),
        status: SUBSCRIPTION_STATUS[s.status ?? ""] ?? "received",
        channel: "Tokenization",
      }));
      // A redemption is executed when it is recorded; there is no pending state.
      const redemptions = reds.map<InvestmentOrder>((r) => ({
        id: r.redemptionId ?? `${id}-red-${r.createdAt}`,
        ref: shortRef("RDM", r.redemptionId),
        ...client(r.investorId),
        product,
        side: "redemption",
        amount: r.amount ?? 0,
        currency: currencyOf(r.currency ?? o.currency),
        units: r.quantity ?? null,
        dealingPrice: priceOf(r.amount, r.quantity),
        placedAt: r.createdAt ?? "",
        dealingDate: (r.createdAt ?? "").slice(0, 10),
        status: "settled",
        channel: "Tokenization",
      }));
      return [...subscriptions, ...redemptions];
    })
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}
