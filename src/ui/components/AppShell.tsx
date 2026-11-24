import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, ChevronDown, PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react";
import clsx from "clsx";
import { PageTransition } from "./PageTransition";
import { Modal } from "./Modal";
import { Button } from "./Primitives";
import { BrandLockup, BrandLogo, BrandMark } from "./Brand";

export type NavItem = {
  label: string;
  to: string;
  icon: ReactNode;
  section?: string;
  /** A count waiting on the user (open reviews, alerts). Zero or absent shows nothing. */
  badge?: number;
};

const UNGROUPED = "";

/** The count pill beside a menu entry. Hidden from the accessible name so a
 *  link stays "Approvals", not "Approvals 2"; the title carries the count. */
function CountPill({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="ml-auto shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-warning-bg text-warning text-[11px] font-semibold tabular grid place-items-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}

const sumBadges = (items: NavItem[]) => items.reduce((t, i) => t + (i.badge ?? 0), 0);
/** Width of the collapsed rail (Ant Design's collapsed Sider is 80px). */
const RAIL_W = 80;

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota) — collapse state is not critical */
  }
}

export function AppShell({
  appName,
  appTag,
  nav,
  user,
  footerNote,
  children,
  onLogout,
  collapsibleNav = false,
  navStorageKey,
  sectionIcons,
  headerStart,
  headerEnd,
}: {
  appName: string;
  appTag: string;
  nav: NavItem[];
  user?: { name: string; role: string; avatarInitials: string };
  footerNote?: ReactNode;
  children: ReactNode;
  onLogout?: () => void;
  /** Opt in to Ant-Design-style collapsible parent menus + a collapse-to-the-left rail. */
  collapsibleNav?: boolean;
  /** localStorage namespace for the collapse state. Defaults to the app name. */
  navStorageKey?: string;
  /** Icon per section name, shown on the parent menu row. Falls back to the first child's icon. */
  sectionIcons?: Record<string, ReactNode>;
  /** Top bar, left (a search box). */
  headerStart?: ReactNode;
  /** Top bar, right, before the user chip (a theme switch). */
  headerEnd?: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const location = useLocation();

  const storeKey = navStorageKey ?? appName;
  const railKey = `brf.nav.rail:${storeKey}`;
  // Singular on purpose — one section is open at a time, so the stored value is
  // a section name, not a list. A different key from the old `…sections` array
  // so a stored list from the previous behaviour is simply ignored.
  const sectionKey = `brf.nav.section:${storeKey}`;

  const [railed, setRailed] = useState(() => (collapsibleNav ? readStored<unknown>(railKey, false) === true : false));
  /* Parent menus are an accordion: closed by default, and opening one closes
     the other. With eleven sections in BO Admin, all-open turned the sidebar
     into a scrolling wall of links where the section you wanted was rarely on
     screen. `null` means every section is collapsed. */
  const [openSection, setOpenSection] = useState<string | null>(() => {
    if (!collapsibleNav) return null;
    const stored = readStored<unknown>(sectionKey, null);
    return typeof stored === "string" ? stored : null;
  });
  // Which rail icon currently shows its flyout submenu (Ant's collapsed-mode popup).
  const [flyout, setFlyout] = useState<{ key: string; top: number } | null>(null);
  const flyoutTimer = useRef<number | null>(null);

  const groups = useMemo(() => {
    const order: string[] = [];
    const bySection = new Map<string, NavItem[]>();
    for (const item of nav) {
      const key = item.section ?? UNGROUPED;
      if (!bySection.has(key)) {
        bySection.set(key, []);
        order.push(key);
      }
      bySection.get(key)!.push(item);
    }
    return order.map((section) => ({ section, items: bySection.get(section)! }));
  }, [nav]);

  const isActive = useCallback(
    (to: string) => location.pathname === to || (to !== "/" && location.pathname.startsWith(to)),
    [location.pathname],
  );

  // The section holding the current route, so it can be auto-revealed and highlighted.
  const activeSection = useMemo(
    () => groups.find((g) => g.section !== UNGROUPED && g.items.some((i) => isActive(i.to)))?.section ?? null,
    [groups, isActive],
  );

  useEffect(() => {
    if (collapsibleNav) writeStored(railKey, railed);
  }, [collapsibleNav, railKey, railed]);

  useEffect(() => {
    if (collapsibleNav) writeStored(sectionKey, openSection);
  }, [collapsibleNav, sectionKey, openSection]);

  // Navigating into a collapsed parent menu opens it — and, being an accordion,
  // closes whichever section was open — so the current page is never hidden.
  useEffect(() => {
    if (!collapsibleNav || !activeSection) return;
    setOpenSection(activeSection);
  }, [collapsibleNav, activeSection]);

  const clearFlyoutTimer = () => {
    if (flyoutTimer.current !== null) {
      window.clearTimeout(flyoutTimer.current);
      flyoutTimer.current = null;
    }
  };
  useEffect(() => clearFlyoutTimer, []);

  const openFlyout = (key: string, el: HTMLElement | null) => {
    if (!el) return;
    clearFlyoutTimer();
    setFlyout({ key, top: el.getBoundingClientRect().top });
  };
  // A small grace period so the pointer can travel from the icon to the popup.
  const closeFlyoutSoon = () => {
    clearFlyoutTimer();
    flyoutTimer.current = window.setTimeout(() => setFlyout(null), 140);
  };
  const closeFlyoutNow = () => {
    clearFlyoutTimer();
    setFlyout(null);
  };

  // The popup is meaningless once the rail expands or the route changes.
  useEffect(() => {
    closeFlyoutNow();
  }, [railed, location.pathname]);

  // Keep the current page visible in a long nav (e.g. after a reload, or when the
  // rail expands) without ever scrolling the page itself.
  const navScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = navScrollRef.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]');
    // Opening another parent collapses the current page's section; chasing its
    // hidden link would yank the sidebar away from the menu just clicked.
    if (!box || !el || el.closest("[data-collapsed]")) return;
    const item = el.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (item.top < view.top || item.bottom > view.bottom) {
      box.scrollTop += item.top - view.top - (view.height - item.height) / 2;
    }
  }, [location.pathname, railed, openSection]);

  const toggleSection = (section: string) =>
    setOpenSection((prev) => (prev === section ? null : section));

  const sectionIconFor = (section: string, items: NavItem[]) => sectionIcons?.[section] ?? items[0]?.icon;

  const itemLink = (item: NavItem, opts: { nested?: boolean; inFlyout?: boolean } = {}) => {
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        title={item.badge ? `${item.label}: ${item.badge} waiting` : undefined}
        onClick={() => {
          setDrawerOpen(false);
          closeFlyoutNow();
        }}
        className={clsx(
          "relative flex items-center gap-2.5 h-9 rounded-md text-[13.5px] font-medium cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50",
          opts.inFlyout ? "px-2.5" : opts.nested ? "pl-[34px] pr-3" : "px-3",
          active ? "bg-primary-50 text-primary-700" : "text-text-soft hover:bg-surface-sunken hover:text-text",
        )}
      >
        <span className={clsx("shrink-0", active ? "text-primary-600" : "text-text-faint")}>{item.icon}</span>
        <span className="truncate">{item.label}</span>
        {!!item.badge && <CountPill n={item.badge} />}
      </Link>
    );
  };

  /** A rail icon plus the popup it opens on hover/focus — Ant's collapsed-menu behaviour. */
  const railEntry = (key: string, trigger: ReactNode, popup: ReactNode, popupHeight: number) => {
    const open = flyout?.key === key;
    // Anchor to the icon, but pull the popup up so it can't run off the bottom.
    const top = open ? Math.max(8, Math.min(flyout.top, window.innerHeight - popupHeight - 8)) : 0;
    return (
      <div
        key={key}
        className="relative"
        onMouseEnter={(e) => openFlyout(key, e.currentTarget)}
        onMouseLeave={closeFlyoutSoon}
        onFocus={(e) => openFlyout(key, e.currentTarget)}
        onBlur={closeFlyoutSoon}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeFlyoutNow();
        }}
      >
        {trigger}
        {open && (
          <div
            className="fixed z-50 pl-2 animate-fade-in"
            style={{ left: RAIL_W, top }}
            onMouseEnter={clearFlyoutTimer}
            onMouseLeave={closeFlyoutSoon}
          >
            <div className="min-w-[196px] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg p-1.5">
              {popup}
            </div>
          </div>
        )}
      </div>
    );
  };

  const railNav = () => (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
      {groups.map(({ section, items }) =>
        section === UNGROUPED
          ? items.map((item) => {
              const active = isActive(item.to);
              return railEntry(
                item.to,
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  onClick={closeFlyoutNow}
                  className={clsx(
                    "relative flex items-center justify-center h-10 w-full rounded-md cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50",
                    active ? "bg-primary-50 text-primary-600" : "text-text-faint hover:bg-surface-sunken hover:text-text",
                  )}
                >
                  {item.icon}
                  <span className="sr-only">{item.label}</span>
                  {!!item.badge && <span aria-hidden="true" className="absolute top-1.5 right-2.5 h-2 w-2 rounded-full bg-warning" />}
                </Link>,
                <div className="px-2 py-1 text-[13px] font-medium text-text whitespace-nowrap">{item.label}</div>,
                40,
              );
            })
          : railEntry(
              section,
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={flyout?.key === section}
                aria-label={section}
                onClick={(e) => openFlyout(section, e.currentTarget.parentElement)}
                className={clsx(
                  "relative flex items-center justify-center h-10 w-full rounded-md cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50",
                  section === activeSection
                    ? "bg-primary-50 text-primary-600"
                    : "text-text-faint hover:bg-surface-sunken hover:text-text",
                )}
              >
                {sectionIconFor(section, items)}
                {sumBadges(items) > 0 && <span aria-hidden="true" className="absolute top-1.5 right-2.5 h-2 w-2 rounded-full bg-warning" />}
              </button>,
              <>
                <div className="px-2.5 pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint whitespace-nowrap">
                  {section}
                </div>
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => itemLink(item, { inFlyout: true }))}
                </div>
              </>,
              48 + items.length * 40,
            ),
      )}
    </nav>
  );

  const inlineNav = (collapsible: boolean) => (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
      {groups.map(({ section, items }) => {
        if (section === UNGROUPED) {
          return (
            <div key={section} className="flex flex-col gap-0.5">
              {items.map((item) => itemLink(item))}
            </div>
          );
        }
        if (!collapsible) {
          return (
            <div key={section} className="mt-4 first:mt-0">
              <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint">{section}</div>
              <div className="flex flex-col gap-0.5">{items.map((item) => itemLink(item))}</div>
            </div>
          );
        }

        const open = openSection === section;
        const panelId = `nav-section-${section.replace(/\W+/g, "-").toLowerCase()}`;
        const childActive = section === activeSection;
        return (
          <div key={section}>
            <button
              type="button"
              onClick={() => toggleSection(section)}
              aria-expanded={open}
              aria-controls={panelId}
              className={clsx(
                "w-full flex items-center gap-2.5 h-9 px-3 rounded-md text-[13.5px] font-medium cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50",
                childActive && !open ? "text-primary-700 bg-primary-50/60" : "text-text-soft hover:bg-surface-sunken hover:text-text",
              )}
            >
              <span className={clsx("shrink-0", childActive ? "text-primary-600" : "text-text-faint")}>
                {sectionIconFor(section, items)}
              </span>
              <span className="flex-1 text-left truncate">{section}</span>
              {sumBadges(items) > 0 && <CountPill n={sumBadges(items)} />}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={clsx("shrink-0 text-text-faint transition-transform duration-200 motion-reduce:transition-none", open ? "" : "-rotate-90")}
              />
            </button>
            <div
              id={panelId}
              data-collapsed={open ? undefined : ""}
              className={clsx(
                "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
                open ? "grid-rows-[1fr]" : "grid-rows-[0fr] invisible",
              )}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-0.5 pt-0.5">{items.map((item) => itemLink(item, { nested: true }))}</div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );

  const showRail = collapsibleNav && railed;

  const userBlock = (rail: boolean) =>
    user && (
      <div className={clsx("shrink-0 border-t border-border p-3 flex items-center", rail ? "flex-col gap-2" : "gap-2.5")}>
        <div
          className="h-9 w-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold shrink-0"
          title={rail ? `${user.name} · ${user.role}` : undefined}
        >
          {user.avatarInitials}
        </div>
        {!rail && (
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-text truncate">{user.name}</div>
            <div className="text-[11px] text-text-faint truncate">{user.role}</div>
          </div>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            aria-label="Sign out"
            title="Sign out"
            className="text-text-faint hover:text-danger p-1.5 rounded-md hover:bg-surface-sunken shrink-0 cursor-pointer transition-colors"
          >
            <LogOut size={15} />
          </button>
        )}
      </div>
    );

  return (
    <div className="min-h-screen flex bg-app">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-md focus:bg-primary-600 focus:text-[var(--text-on-primary)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      {/* desktop sidebar */}
      <aside
        className={clsx(
          // sticky makes the aside its own stacking context; z-40 lifts that context
          // above the main column so the rail's flyout submenus aren't painted under it.
          "hidden lg:flex lg:flex-col shrink-0 border-r border-border bg-surface sticky top-0 z-40 h-screen transition-[width] duration-200 ease-out motion-reduce:transition-none",
          showRail ? "w-20" : "w-64",
        )}
      >
        {/* The collapse control sits in the sidebar's own header, top-right —
            where Linear, Notion and VS Code put it — rather than pinned to the
            bottom edge as a full-width bar, which read as a footer action
            rather than a view control. At rail width there is no "right" to
            sit in, so the brand mark gives way to the toggle: the rail's icons
            already identify the app, and a 36px mark beside a 36px button in
            80px leaves neither room to breathe. */}
        <div className={clsx("h-16 flex items-center border-b border-border shrink-0", showRail ? "justify-center px-2" : "gap-2.5 pl-5 pr-2.5")}>
          {!showRail && (
            <>
              <div className="min-w-0 flex-1" title={`${appName} ${appTag}`}>
                <BrandLockup size={30} />
              </div>
            </>
          )}
          {collapsibleNav ? (
            <button
              type="button"
              onClick={() => setRailed((v) => !v)}
              aria-expanded={!railed}
              aria-label={railed ? "Expand sidebar" : "Collapse sidebar"}
              title={railed ? "Expand sidebar" : "Collapse sidebar"}
              className="h-9 w-9 shrink-0 grid place-items-center rounded-md text-text-faint hover:bg-surface-sunken hover:text-text cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50"
            >
              {railed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          ) : (
            showRail && (
              <BrandMark size={28} />
            )
          )}
        </div>
        <div ref={navScrollRef} className="flex-1 min-h-0 overflow-y-auto py-4">
          {showRail ? railNav() : inlineNav(collapsibleNav)}
        </div>
        {footerNote && !showRail && <div className="shrink-0 mx-3 mb-3 mt-2 text-[10.5px] text-text-faint leading-snug">{footerNote}</div>}
        {userBlock(showRail)}
      </aside>

      {/* mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40 cursor-pointer" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-surface border-r border-border flex flex-col animate-fade-in">
            <div className="h-16 flex items-center justify-between px-5 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <BrandLockup size={30} />
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="text-text-faint hover:text-text cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto py-4">{inlineNav(collapsibleNav)}</div>
            {userBlock(false)}
          </div>
        </div>
      )}

      {/* main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 shrink-0 border-b border-border bg-surface flex items-center gap-3 px-4 lg:px-6 sticky top-0 z-30">
          <button type="button" className="lg:hidden text-text-soft cursor-pointer" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <BrandLogo size={22} className="lg:hidden" />
          {headerStart && <div className="min-w-0 flex-1 max-w-md">{headerStart}</div>}
          <div className="ml-auto flex items-center gap-3">
            {headerEnd}
            {user && (
              <div className="hidden lg:flex items-center gap-2.5" data-testid="user-chip">
                <div className="h-8 w-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[11px] font-semibold">
                  {user.avatarInitials}
                </div>
                <div className="leading-tight">
                  <div className="text-[13px] font-medium text-text">{user.name}</div>
                  <div className="text-[11px] text-text-faint">{user.role}</div>
                </div>
              </div>
            )}
          </div>
        </header>
        <main id="main-content" className="flex-1 relative p-4 sm:p-6 lg:p-8">
          <div className="relative max-w-[1400px] w-full mx-auto">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>

      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Sign out?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmLogout(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setConfirmLogout(false); onLogout?.(); }}>Sign out</Button>
          </>
        }
      >
        <p className="text-sm text-text-soft">You'll need to sign in again to access {appName}.</p>
      </Modal>
    </div>
  );
}
