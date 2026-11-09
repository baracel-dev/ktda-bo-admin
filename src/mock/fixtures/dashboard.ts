/* The Dashboard's money figures for this month (November 2026): the payment
   runs, what farmers did with the money, farmers by stage and payments by
   factory. Demo data until the dashboard reads omnichannel's summaries. KES. */

export type DashboardRun = {
  id: string;
  title: string;
  factories: string[];
  farmers: number;
  amount: number;
  status: "paid" | "awaiting_approval";
  at: string;
};

export const DASHBOARD_RUNS: DashboardRun[] = [
  { id: "PR-2026-11-09", title: "October green leaf payment", factories: ["Githongo", "Kangaita"], farmers: 9_118, amount: 64_210_000, status: "awaiting_approval", at: "2026-11-09T07:40:00Z" },
  { id: "PR-2026-11-06", title: "October green leaf payment", factories: ["Litein", "Momul", "Kapkoros"], farmers: 18_240, amount: 136_420_000, status: "paid", at: "2026-11-06T09:05:00Z" },
  { id: "PR-2026-11-02", title: "October mini bonus", factories: ["Chinga", "Gitugi", "Ndima"], farmers: 6_412, amount: 28_846_000, status: "paid", at: "2026-11-02T08:30:00Z" },
];

/** Money out of farmers' wallets, a day at a time. */
export type DashboardDay = { date: string; cashOut: number; mpesa: number; merchant: number };

const M = 1_000_000;
export const DASHBOARD_DAYS: DashboardDay[] = [
  { date: "2026-11-01", cashOut: 1.2 * M, mpesa: 0.8 * M, merchant: 0.6 * M },
  { date: "2026-11-02", cashOut: 3.9 * M, mpesa: 2.1 * M, merchant: 1.4 * M },
  { date: "2026-11-03", cashOut: 5.6 * M, mpesa: 2.8 * M, merchant: 2.2 * M },
  { date: "2026-11-04", cashOut: 4.1 * M, mpesa: 2.0 * M, merchant: 1.9 * M },
  { date: "2026-11-05", cashOut: 3.2 * M, mpesa: 1.6 * M, merchant: 1.7 * M },
  { date: "2026-11-06", cashOut: 9.8 * M, mpesa: 5.4 * M, merchant: 2.9 * M },
  { date: "2026-11-07", cashOut: 12.6 * M, mpesa: 6.9 * M, merchant: 4.8 * M },
  { date: "2026-11-08", cashOut: 7.4 * M, mpesa: 3.8 * M, merchant: 3.1 * M },
  { date: "2026-11-09", cashOut: 2.1 * M, mpesa: 1.0 * M, merchant: 0.9 * M },
];

export const DASHBOARD_FARMERS = { registered: 52_310, activated: 41_870, kycVerified: 38_904 };

/** What each factory's farmers were paid this month (the paid runs). */
export const DASHBOARD_BY_FACTORY: { factory: string; amount: number }[] = [
  { factory: "Litein", amount: 52_100_000 },
  { factory: "Momul", amount: 44_620_000 },
  { factory: "Kapkoros", amount: 39_700_000 },
  { factory: "Chinga", amount: 11_200_000 },
  { factory: "Gitugi", amount: 9_800_000 },
  { factory: "Ndima", amount: 7_846_000 },
];

const later = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

export const getDashboardMoney = () => later({ runs: DASHBOARD_RUNS, days: DASHBOARD_DAYS, farmers: DASHBOARD_FARMERS, byFactory: DASHBOARD_BY_FACTORY });
