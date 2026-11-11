import {
  LayoutDashboard, Layers, ClipboardCheck, UsersRound, Users, FileCheck2, UserPlus, Megaphone, BadgeCheck, LifeBuoy,
  UserCheck, Inbox, ListChecks, CalendarCheck2, Activity, Radar, Wallet, ArrowLeftRight, MessageSquareWarning,
  GitCompareArrows, TriangleAlert, FileBarChart2, BookOpenCheck, Scale, CalendarClock, HandCoins, Landmark,
  FileSpreadsheet, FileSearch, ShieldAlert, FolderSearch, ShieldCheck, Siren, Settings, SlidersHorizontal, ServerCog,
  UserCog, ScrollText, Percent, KeyRound, ToggleLeft, Building2, Route as RouteIcon, Store, Briefcase,
} from "lucide-react";
import type { ReactNode } from "react";
import type { NavItem } from "../ui";
import { isHiddenPage } from "./hiddenPages";

type NavDef = Omit<NavItem, "icon" | "badge"> & { icon: typeof LayoutDashboard };

/* KTDA's navigation: four top-level items and three groups (People, Money,
   Admin), after the prototype back office (docs/ktda). Each group lists the
   prototype's pages first, then the pages this back office already has that
   fit there. Prototype pages not built yet (Partner payments, Input
   vouchers, Custody & liquidity, Integrations) join the menu
   when their page lands. */
const KTDA_NAV: NavDef[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Payment runs", to: "/bulk/payments", icon: Layers },
  { label: "Approvals", to: "/approvals", icon: ClipboardCheck },

  { label: "Farmer journey", to: "/journey", section: "People", icon: RouteIcon },
  { label: "Farmers", to: "/farmers", section: "People", icon: Users },
  { label: "Merchants", to: "/merchants", section: "People", icon: Store },
  { label: "Agents", to: "/agents", section: "People", icon: Briefcase },
  { label: "Onboarding review", to: "/kyc-queue", section: "People", icon: FileCheck2 },
  { label: "Messages", to: "/campaigns", section: "People", icon: Megaphone },
  { label: "Bulk onboarding", to: "/bulk/onboarding", section: "People", icon: UserPlus },
  { label: "KYC desk", to: "/token-console/kyc", section: "People", icon: BadgeCheck },
  { label: "Customer desk", to: "/token-console/customers", section: "People", icon: LifeBuoy },
  { label: "Customer approvals", to: "/token-console/customer-approvals", section: "People", icon: UserCheck },
  { label: "Enquiries", to: "/enquiries", section: "People", icon: Inbox },
  { label: "Follow-ups", to: "/tasks", section: "People", icon: ListChecks },
  { label: "KYC periodic review", to: "/kyc-periodic", section: "People", icon: CalendarCheck2 },
  { label: "Dynamic review", to: "/kyc-dynamic", section: "People", icon: Activity },
  { label: "Screening", to: "/screening", section: "People", icon: Radar },

  { label: "Transactions", to: "/token-console/transactions", section: "Money", icon: ArrowLeftRight },
  { label: "Disputes", to: "/complaints", section: "Money", icon: MessageSquareWarning },
  { label: "Reconciliation", to: "/reconciliation", section: "Money", icon: GitCompareArrows },
  { label: "Ledger reconciliation", to: "/token-console/reconciliation", section: "Money", icon: Scale },
  { label: "Fraud alerts", to: "/fraud-alerts", section: "Money", icon: TriangleAlert },
  { label: "Reports", to: "/reports", section: "Money", icon: FileBarChart2 },
  { label: "Fraud cases", to: "/fraud-cases", section: "Money", icon: FileSearch },
  { label: "AML alerts", to: "/aml-alerts", section: "Money", icon: ShieldAlert },
  { label: "Case management", to: "/cases", section: "Money", icon: FolderSearch },
  { label: "Review queue", to: "/token-console/compliance", section: "Money", icon: ShieldCheck },
  { label: "Surveillance", to: "/token-console/surveillance", section: "Money", icon: Siren },
  { label: "Accounts", to: "/token-console/accounts", section: "Money", icon: Wallet },
  { label: "Journals", to: "/token-console/journals", section: "Money", icon: BookOpenCheck },
  { label: "Trial balance", to: "/token-console/trial-balance", section: "Money", icon: Scale },
  { label: "Batch runs", to: "/token-console/runs", section: "Money", icon: CalendarClock },
  { label: "Loans", to: "/token-console/loans", section: "Money", icon: HandCoins },
  { label: "Institutions", to: "/token-console/funds", section: "Money", icon: Landmark },
  { label: "Unallocated funds", to: "/unallocated-funds", section: "Money", icon: Wallet },
  { label: "General ledger", to: "/ledger", section: "Money", icon: BookOpenCheck },
  { label: "Engine reports", to: "/token-console/reports", section: "Money", icon: FileSpreadsheet },

  { label: "Institution", to: "/institution", section: "Admin", icon: Building2 },
  { label: "Configuration", to: "/token-console/configuration", section: "Admin", icon: SlidersHorizontal },
  { label: "System health", to: "/system", section: "Admin", icon: ServerCog },
  { label: "Users & roles", to: "/users", section: "Admin", icon: UserCog },
  { label: "Audit log", to: "/audit-log", section: "Admin", icon: ScrollText },
  { label: "Tariffs", to: "/token-console/tariffs", section: "Admin", icon: Percent },
  { label: "Change approvals", to: "/token-console/changes", section: "Admin", icon: ClipboardCheck },
  { label: "Engine users", to: "/token-console/users", section: "Admin", icon: KeyRound },
  { label: "Platform settings", to: "/settings", section: "Admin", icon: Settings },
  { label: "Feature flags", to: "/feature-flags", section: "Admin", icon: ToggleLeft },
  { label: "Engine overview", to: "/token-console/overview", section: "Admin", icon: LayoutDashboard },
];

/* Routes that stay registered but have no menu entry: the hidden and removed
   pages (hiddenPages.ts; the removed ones the route refuses too), and the demo Transactions and Reconciliation pages, which
   the live ones above replace in the menu. */
export const NAV_DEFS: NavDef[] = KTDA_NAV.filter((n) => !isHiddenPage(n.to));

/** The menu for these paths, with a count beside the entries `badges` names. */
export function navForRole(allowedPaths: string[], badges: Record<string, number> = {}): NavItem[] {
  return NAV_DEFS.filter((n) => allowedPaths.includes(n.to)).map((n) => ({
    ...n,
    icon: <n.icon size={16} />,
    badge: badges[n.to],
  }));
}

/** Parent-menu icons, one per `section` used above. */
export const SECTION_ICONS: Record<string, ReactNode> = {
  People: <UsersRound size={16} />,
  Money: <Wallet size={16} />,
  Admin: <Settings size={16} />,
};
