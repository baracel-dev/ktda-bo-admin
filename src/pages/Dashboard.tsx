import { useMemo, useState } from "react";
import {
  useContentField,
  AUDIT_CATEGORY_LABELS, LIFECYCLE_LABELS, CASE_STATUS_LABELS, APPROVAL_KIND_LABELS,
  INDICATIVE_USD_KES, type SubFund,
} from "../mock";
import {
  getApprovalQueue, getClients, getSubFunds, getAuditLog, getFundFlows, getAumTrend,
  getCouponCalendar, getOpsSnapshot,
} from "../lib/api";
import {
  PageHeader, StatCard, Card, Badge, Skeleton, formatDateTime, formatDate,
  TimeSeriesChart, ColumnChart, DonutChart, TrendSpark, BulletBar, ChartFrame,
  compactNumber,
} from "../ui";
import { ClipboardCheck, Users, ScrollText, ArrowUpRight, ArrowDownRight, ShieldAlert } from "lucide-react";
import { useAuth, ROLE_LABELS } from "../lib/auth";
import { Link } from "react-router-dom";
import { useAsyncData } from "../lib/useAsyncData";
import { isHiddenPage, isRemovedPage } from "../lib/hiddenPages";

/* The dashboard is role-aware by construction: every panel is gated on the same
 * `canAccess` check the router uses, so a role that cannot open Approvals never
 * sees an approvals figure summarised here either. Summarising data a role
 * cannot reach would be an RBAC leak with extra steps. */

const KES = (n: number) => `KES ${compactNumber(n)}`;

/* Bands read low → high wherever they appear. Sorting them by count instead
   turns a scale into a leaderboard. */
const RISK_ORDER = ["low", "medium", "high"] as const;

const SEVERITY_ORDER = ["low", "medium", "high"] as const;

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-3/5"][i % 5]}`} />
      ))}
    </div>
  );
}

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div style={{ height }}>
      <Skeleton className="w-full h-full rounded-[var(--radius-md)]" />
    </div>
  );
}


/* Panel layout.
 *
 * Which panels a role sees is decided by RBAC, so the count changes per role —
 * and a fixed three-up grid then ends with a hole wherever that count is not a
 * multiple of three. Each panel declares the width it wants; the last row is
 * widened to fill, so the dashboard reads as a block rather than a staircase. */
/* The tile row spreads over however many tiles the role actually gets, rather
   than leaving a quarter of the row empty for a two-tile role. */
const TILE_GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

const SPAN_CLASS: Record<number, string> = {
  1: "",
  2: "md:col-span-2 xl:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
};

type PanelDef = {
  key: string;
  span: number;
  show: boolean;
  /** Reads well at any width — lists, bullet bars, a donut with its legend.
   * Charts with few categories are not: four bars stretched across two columns
   * look like a rendering accident, so they are widened only as a last resort. */
  grow?: boolean;
};

function panelSpans(defs: PanelDef[], cols = 3): Record<string, string> {
  const visible = defs.filter((d) => d.show);
  const out: Record<string, string> = {};
  let row: PanelDef[] = [];
  let used = 0;

  const flush = () => {
    if (!row.length) return;
    const spans = row.map((r) => Math.min(r.span, cols));
    // Every row fills, not just the last: a full-width panel further down (the
    // audit trail) pushes a short row into the middle of the grid, where a hole
    // is just as visible.
    let leftover = cols - spans.reduce((a, b) => a + b, 0);
    // Give the space to a panel that can use it, right-to-left so the reading
    // order survives; if none in this row can, the trailing panel takes it
    // rather than leaving a stub column.
    const order = row.map((_, i) => i).reverse();
    const candidates = order.filter((i) => row[i].grow);
    const takers = candidates.length ? candidates : order;
    for (let n = 0; leftover > 0; n += 1) {
      spans[takers[n % takers.length]] += 1;
      leftover -= 1;
    }
    row.forEach((r, i) => { out[r.key] = SPAN_CLASS[Math.min(spans[i], 3)]; });
    row = [];
    used = 0;
  };

  for (const d of visible) {
    const span = Math.min(d.span, cols);
    if (used + span > cols) flush();
    row.push(d);
    used += span;
    if (used === cols) flush();
  }
  flush();
  return out;
}

export default function Dashboard() {
  const { role, canAccess } = useAuth();
  const subtitle = useContentField("dashboard", "subtitle", "KTDA Digital Tea Payment Solution");

  const showApprovals = canAccess("/approvals");
  const showAudit = canAccess("/audit-log");
  const showFund = canAccess("/nav") || canAccess("/liquidity");
  const showFlows = canAccess("/transactions") || canAccess("/nav");
  const showCompliance = canAccess("/kyc-queue") || canAccess("/aml-alerts") || canAccess("/cases");
  // The demo farmer register is hidden (lib/hiddenPages.ts), so no tile leads to it.
  const showClients = canAccess("/clients") && !isHiddenPage("/clients");

  const [flowRange, setFlowRange] = useState<14 | 30>(30);

  const { data: approvals, loading: approvalsLoading } = useAsyncData(
    () => (showApprovals ? getApprovalQueue() : Promise.resolve([])),
  );
  const { data: clients, loading: clientsLoading } = useAsyncData(() => (showClients ? getClients() : Promise.resolve([])));
  const { data: funds, loading: fundsLoading } = useAsyncData(getSubFunds);
  const { data: flows, loading: flowsLoading } = useAsyncData(() => (showFlows ? getFundFlows(30) : Promise.resolve([])));
  const { data: aum, loading: aumLoading } = useAsyncData(() => (showFund ? getAumTrend(12) : Promise.resolve([])));
  const { data: coupons, loading: couponsLoading } = useAsyncData(() => (showFund ? getCouponCalendar(12) : Promise.resolve([])));
  const { data: snapshot, loading: snapshotLoading } = useAsyncData(() => (role ? getOpsSnapshot(role) : Promise.resolve(null)));
  const { data: audit, loading: auditLoading } = useAsyncData(() => (showAudit ? getAuditLog() : Promise.resolve([])));

  const pending = useMemo(() => (approvals ?? []).filter((a) => a.status === "pending"), [approvals]);

  const windowed = useMemo(() => (flows ?? []).slice(-flowRange), [flows, flowRange]);
  const netFlow = windowed.reduce((s, d) => s + d.subscriptions - d.redemptions, 0);
  const grossIn = windowed.reduce((s, d) => s + d.subscriptions, 0);
  const grossOut = windowed.reduce((s, d) => s + d.redemptions, 0);
  const flowLabels = windowed.map((d) => formatDate(d.date).replace(/ \d{4}$/, ""));

  const statsLoading = clientsLoading || fundsLoading || (showApprovals && approvalsLoading);

  const openAlerts = (snapshot?.alerts ?? []).reduce((sum, a) => sum + a.count, 0);

  /* One list decides both what renders and how wide it is, so a panel can
     never be shown with the wrong span — or shown at all without a role check. */
  const panelDefs: PanelDef[] = [
    { key: "flows", span: 2, show: showFlows, grow: true },
    { key: "aum", span: 2, show: showFund, grow: true },
    { key: "coupons", span: 1, show: showFund, grow: true },
    { key: "files", span: 1, show: showCompliance, grow: true },
    { key: "risk", span: 1, show: showCompliance, grow: true },
    { key: "approvals", span: 1, show: showApprovals },
    { key: "caseload", span: 1, show: canAccess("/cases"), grow: true },
    { key: "newclients", span: 1, show: showClients },
    { key: "exceptions", span: 1, show: canAccess("/reconciliation") || canAccess("/unallocated-funds"), grow: true },
    { key: "audit", span: 3, show: showAudit, grow: true },
  ];
  const shown = Object.fromEntries(panelDefs.map((d) => [d.key, d.show])) as Record<string, boolean>;
  const span = panelSpans(panelDefs);

  const tiles = [
    showFlows && (
      <StatCard
        key="flow"
        label={`Net flow · ${flowRange}d`}
        value={`${netFlow >= 0 ? "+" : "−"}${KES(Math.abs(netFlow))}`}
        icon={netFlow >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
        hint={`${KES(grossIn)} in · ${KES(grossOut)} out`}
        tooltip="Subscriptions less redemptions over the window, expressed in KES across both sub-funds."
        chart={windowed.length > 1 ? <TrendSpark points={windowed.map((d) => d.subscriptions - d.redemptions)} tone={netFlow >= 0 ? "success" : "danger"} /> : undefined}
        to={canAccess("/transactions") ? "/transactions" : undefined}
      />
    ),
    showApprovals && (
      <StatCard
        key="approvals"
        label="Pending approvals"
        value={pending.length}
        icon={<ClipboardCheck size={18} />}
        hint={snapshot && snapshot.oldestApprovalDays > 0 ? `oldest waiting ${snapshot.oldestApprovalDays}d` : "awaiting maker-checker sign-off"}
        trend={snapshot && snapshot.oldestApprovalDays >= 3 ? { value: "ageing queue", positive: false } : undefined}
        tooltip="Maker-checker: actions here need approval from someone other than the person who proposed them."
        to="/approvals"
      />
    ),
    canAccess("/aml-alerts") && (
      <StatCard
        key="alerts"
        label="Open AML alerts"
        value={openAlerts}
        icon={<ShieldAlert size={18} />}
        hint="raised and not yet decided"
        to="/aml-alerts"
      />
    ),
    showClients && (
      <StatCard
        key="clients"
        label="Client files"
        value={(clients ?? []).length}
        icon={<Users size={18} />}
        hint="on the register"
        to="/clients"
      />
    ),
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        eyebrow={role ? ROLE_LABELS[role] : ""}
        title="Dashboard"
        subtitle={subtitle}
        actions={
          funds?.length ? (
            <Badge tone="neutral">NAV as of {formatDate(funds[0].navAsOf)}</Badge>
          ) : undefined
        }
      />

      {/* ---- headline figures ----
           Composed from what this role can actually reach, then trimmed to
           four. A tile is a summary of a page: showing one for a page the role
           cannot open leaks the same number the router is meant to withhold. */}
      <div className={`grid gap-4 mb-6 ${TILE_GRID[Math.min(Math.max(tiles.length, 1), 4)]}`}>
        {statsLoading
          ? [0, 1, 2, 3].map((i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-4 w-24 mb-4" />
                <Skeleton className="h-8 w-20 mb-3" />
                <Skeleton className="h-3 w-28" />
              </Card>
            ))
          : tiles.slice(0, 4)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {/* ---- flow: the fund's pulse ---- */}
        {shown.flows && (
          <ChartFrame
            className={span.flows}
            title="Subscriptions vs redemptions"
            subtitle="KES-equivalent, both sub-funds. Weekends and the post-payday peak are the shape to expect."
            legend={[
              { label: "Subscriptions", colorIndex: 0, value: KES(grossIn) },
              { label: "Redemptions", colorIndex: 4, value: KES(grossOut) },
            ]}
            action={
              <div className="flex items-center rounded-full bg-surface-sunken p-0.5">
                {([14, 30] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setFlowRange(d)}
                    aria-pressed={flowRange === d}
                    className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full transition-colors ${
                      flowRange === d ? "bg-surface text-text shadow-[var(--shadow-sm)]" : "text-text-faint hover:text-text"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            }
            table={{
              columns: ["Date", "Subscriptions", "Redemptions", "Net", "Tickets"],
              rows: windowed.map((d) => [
                formatDate(d.date),
                KES(d.subscriptions),
                KES(d.redemptions),
                `${d.subscriptions - d.redemptions >= 0 ? "+" : "−"}${KES(Math.abs(d.subscriptions - d.redemptions))}`,
                d.tickets,
              ]),
            }}
          >
            {flowsLoading ? (
              <ChartSkeleton height={220} />
            ) : (
              <ColumnChart
                height={220}
                labels={flowLabels}
                formatValue={(v) => compactNumber(v)}
                series={[
                  { label: "Subscriptions", values: windowed.map((d) => d.subscriptions), colorIndex: 0 },
                  { label: "Redemptions", values: windowed.map((d) => d.redemptions), colorIndex: 4 },
                ]}
              />
            )}
          </ChartFrame>
        )}

        {/* ---- AUM: two currencies, two axes, so two charts ---- */}
        {shown.aum && (
          <ChartFrame
            className={span.aum}
            title="AUM by sub-fund"
            subtitle="Twelve months. Shown as small multiples rather than one chart — two currencies never share an axis."
            table={{
              columns: ["Month", "KES fund", "USD fund"],
              rows: (aum ?? []).map((p) => [p.month, `KES ${compactNumber(p.kes)}`, `USD ${compactNumber(p.usd)}`]),
            }}
          >
            {aumLoading ? (
              <ChartSkeleton height={190} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {(funds ?? []).map((f, i) => (
                  <SubFundAum key={f.code} fund={f} points={(aum ?? []).map((p) => (f.currency === "KES" ? p.kes : p.usd))} labels={(aum ?? []).map((p) => p.month)} colorIndex={i === 0 ? 0 : 2} />
                ))}
              </div>
            )}
          </ChartFrame>
        )}

        {/* ---- the ladder's whole point: a coupon every month ---- */}
        {shown.coupons && (
          <ChartFrame
            className={span.coupons}
            title="Coupon inflow"
            subtitle="Next 12 months, KES-equivalent, derived from the ladder's own coupon dates."
            table={{
              columns: ["Month", "KES-equiv", "Bonds paying"],
              rows: (coupons ?? []).map((m) => [m.month, KES(m.kes + m.usd * INDICATIVE_USD_KES), m.bonds.join(", ") || "—"]),
            }}
          >
            {couponsLoading ? (
              <ChartSkeleton height={190} />
            ) : (
              <ColumnChart
                height={190}
                labels={(coupons ?? []).map((m) => m.month)}
                series={[{ label: "Coupon receipts", values: (coupons ?? []).map((m) => m.kes + m.usd * INDICATIVE_USD_KES), colorIndex: 1 }]}
              />
            )}
            <p className="text-[11px] text-text-faint mt-3 leading-snug">
              A staggered six-rung ladder should leave no empty month — a gap here is a sourcing question for the
              Investment Committee, not a display bug.
            </p>
          </ChartFrame>
        )}

        {/* ---- compliance: where the files actually are ---- */}
        {shown.files && (
          <ChartFrame
            className={span.files}
            title="Client files by stage"
            subtitle="The onboarding funnel as it stands right now."
            table={{
              columns: ["Stage", "Files"],
              rows: (snapshot?.lifecycle ?? []).map((r) => [LIFECYCLE_LABELS[r.status], r.count]),
            }}
          >
            {snapshotLoading ? (
              <ChartSkeleton height={180} />
            ) : (
              <DonutChart
                size={148}
                centerLabel="client files"
                centerValue={(snapshot?.lifecycle ?? []).reduce((s, r) => s + r.count, 0)}
                formatValue={(v) => String(v)}
                segments={(snapshot?.lifecycle ?? []).map((r) => ({ label: LIFECYCLE_LABELS[r.status], value: r.count }))}
              />
            )}
          </ChartFrame>
        )}

        {/* ---- risk & alerts: status colours, never series colours ---- */}
        {shown.risk && (
          <ChartFrame
            className={span.risk}
            title="Risk & open alerts"
            subtitle="Customer risk bands, and monitoring alerts still awaiting a decision."
          >
            {snapshotLoading ? (
              <PanelSkeleton rows={5} />
            ) : (
              <div className="flex flex-col gap-4">
                <BulletBar
                  formatValue={(v) => String(v)}
                  rows={[...(snapshot?.riskMix ?? [])]
                    .sort((a, b) => RISK_ORDER.indexOf(a.rating) - RISK_ORDER.indexOf(b.rating))
                    .map((r) => ({
                    label: `${r.rating[0].toUpperCase()}${r.rating.slice(1)} risk`,
                    value: r.count,
                      tone: r.rating === "high" ? "danger" : r.rating === "medium" ? "warning" : "success",
                    }))}
                />
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-text-soft">
                      <ShieldAlert size={13} className="text-text-faint" /> Open AML alerts
                    </span>
                    <Link to="/aml-alerts" className="text-xs text-primary-600 font-medium">Review</Link>
                  </div>
                  {(snapshot?.alerts ?? []).length ? (
                    <BulletBar
                      formatValue={(v) => String(v)}
                      rows={[...(snapshot?.alerts ?? [])]
                        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
                        .map((a) => ({
                        label: `${a.severity[0].toUpperCase()}${a.severity.slice(1)} severity`,
                        value: a.count,
                          tone: a.severity === "high" ? "danger" : a.severity === "medium" ? "warning" : "info",
                        }))}
                    />
                  ) : (
                    <p className="text-sm text-text-faint">No alerts open.</p>
                  )}
                </div>
              </div>
            )}
          </ChartFrame>
        )}

        {/* ---- approval ageing: the number that actually needs watching ---- */}
        {shown.approvals && (
          <ChartFrame
            className={span.approvals}
            title="Approvals waiting"
            subtitle="Age matters more than count — an old item is a stalled control, not a backlog."
          >
            {approvalsLoading || snapshotLoading ? (
              <ChartSkeleton height={160} />
            ) : (
              <>
                <ColumnChart
                  height={150}
                  labels={(snapshot?.approvalAgeing ?? []).map((b) => b.bucket)}
                  formatValue={(v) => String(Math.round(v))}
                  yTicks={3}
                  series={[{
                    label: "Waiting",
                    values: (snapshot?.approvalAgeing ?? []).map((b) => b.count),
                    colorIndex: 5,
                  }]}
                />
                <ul className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
                  {pending.slice(0, 3).map((a) => (
                    <li key={a.id} className="min-w-0">
                      <div className="text-xs text-text truncate">{a.title}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-text-faint mt-0.5">
                        <span className="text-warning font-medium">{APPROVAL_KIND_LABELS[a.kind]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDate(a.proposedAt)}</span>
                      </div>
                    </li>
                  ))}
                  {pending.length === 0 && <li className="text-sm text-text-faint">Nothing pending — nice and clean.</li>}
                </ul>
                <Link to="/approvals" className="mt-3 inline-block text-xs text-primary-600 font-medium">Open the queue</Link>
              </>
            )}
          </ChartFrame>
        )}

        {/* ---- case load ---- */}
        {shown.caseload && (
          <ChartFrame
            className={span.caseload}
            title="Case load"
            subtitle="Financial-crime cases by state, including anything escalated to the MLRO."
            table={{
              columns: ["Status", "Cases"],
              rows: (snapshot?.cases ?? []).map((c) => [CASE_STATUS_LABELS[c.status], c.count]),
            }}
          >
            {snapshotLoading ? (
              <PanelSkeleton rows={4} />
            ) : (
              <BulletBar
                formatValue={(v) => String(v)}
                rows={(snapshot?.cases ?? []).map((c, i) => ({
                  label: CASE_STATUS_LABELS[c.status],
                  value: c.count,
                  colorIndex: i,
                }))}
              />
            )}
          </ChartFrame>
        )}

        {/* ---- growth ---- */}
        {shown.newclients && (
          <ChartFrame
            className={span.newclients}
            title="New client files"
            subtitle="Opened per month, from the client register."
            table={{
              columns: ["Month", "Files opened"],
              rows: (snapshot?.newClientsByMonth ?? []).map((m) => [m.month, m.count]),
            }}
          >
            {snapshotLoading ? (
              <ChartSkeleton height={160} />
            ) : (
              <ColumnChart
                height={160}
                yTicks={3}
                labels={(snapshot?.newClientsByMonth ?? []).map((m) => m.month)}
                formatValue={(v) => String(Math.round(v))}
                series={[{ label: "New files", values: (snapshot?.newClientsByMonth ?? []).map((m) => m.count), colorIndex: 3 }]}
              />
            )}
          </ChartFrame>
        )}

        {/* ---- money that has not landed anywhere yet ---- */}
        {shown.exceptions && (
          <ChartFrame className={span.exceptions} title="Needs a human" subtitle="Items no automated step can close.">
            {snapshotLoading ? (
              <PanelSkeleton rows={3} />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                <ExceptionRow
                  to="/reconciliation"
                  label="Open reconciliation breaks"
                  value={snapshot?.openBreaks ?? 0}
                  tone={(snapshot?.openBreaks ?? 0) > 0 ? "warning" : "success"}
                />
                <ExceptionRow
                  to="/unallocated-funds"
                  label="Unallocated receipts"
                  value={snapshot?.unallocatedCount ?? 0}
                  hint={snapshot ? `${KES(snapshot.unallocatedValueKes)} held` : undefined}
                  tone={(snapshot?.unallocatedCount ?? 0) > 0 ? "warning" : "success"}
                />
                {!isRemovedPage("/screening") && (
                  <ExceptionRow
                    to="/screening"
                    label="Unresolved screening matches"
                    value={snapshot?.unresolvedScreeningMatches ?? 0}
                    tone={(snapshot?.unresolvedScreeningMatches ?? 0) > 0 ? "danger" : "success"}
                  />
                )}
              </ul>
            )}
          </ChartFrame>
        )}

        {/* ---- audit trail ---- */}
        {shown.audit && (
          <Card className={`p-5 ${span.audit}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
                <ScrollText size={15} className="text-text-faint" />
                Recent platform activity
              </h2>
              <Link to="/audit-log" className="text-xs text-primary-600 font-medium">Full audit log</Link>
            </div>
            {auditLoading ? (
              <PanelSkeleton />
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {(audit ?? []).slice(0, 6).map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <Badge tone={e.category === "security" ? "warning" : e.category === "config" ? "accent" : "info"} className="shrink-0">
                      {AUDIT_CATEGORY_LABELS[e.category]}
                    </Badge>
                    <span className="text-sm text-text truncate min-w-0">
                      <span className="font-medium">{e.action}</span> — {e.target}
                    </span>
                    <span className="text-xs text-text-faint ml-auto shrink-0 hidden sm:block">{formatDateTime(e.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/** One sub-fund's AUM curve. Its own chart, its own axis, its own currency —
 * the alternative is a dual-axis chart, which is never the answer. */
function SubFundAum({
  fund, points, labels, colorIndex,
}: {
  fund: SubFund;
  points: number[];
  labels: string[];
  colorIndex: number;
}) {
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const change = first > 0 ? (last - first) / first : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-text-soft truncate">{fund.currency} fund</span>
        <span className={`text-[11px] font-semibold ${change >= 0 ? "text-success" : "text-danger"}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(1)}% 12m
        </span>
      </div>
      <div className="font-display text-lg font-semibold tabular text-text mb-1">
        {fund.currency} {compactNumber(last)}
      </div>
      <TimeSeriesChart
        height={150}
        labels={labels}
        formatValue={(v) => compactNumber(v)}
        series={[{ label: `${fund.currency} AUM`, values: points, colorIndex }]}
      />
    </div>
  );
}

function ExceptionRow({
  label, value, hint, tone, to,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: "success" | "warning" | "danger";
  to: string;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Link to={to} className="text-sm text-text hover:text-primary-600 transition-colors">{label}</Link>
        {hint && <div className="text-[11px] text-text-faint">{hint}</div>}
      </div>
      <Badge tone={value === 0 ? "success" : tone} className="ml-auto shrink-0">
        {value === 0 ? "clear" : value}
      </Badge>
    </li>
  );
}
