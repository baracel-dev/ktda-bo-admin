import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Banknote, HandCoins, Wallet, TriangleAlert, ScrollText } from "lucide-react";
import { useContentField, AUDIT_CATEGORY_LABELS, CASE_STATUS_LABELS } from "../mock";
import { getDashboardMoney } from "../mock/fixtures/dashboard";
import { getAuditLog, getComplaints, getComplianceCases, getEnquiries, getFraudAlerts, getUnallocatedFunds } from "../lib/api";
import {
  PageHeader, StatCard, Card, Badge, Skeleton, formatDateTime, formatDate, ColumnChart, DonutChart, BulletBar, ChartFrame, compactNumber,
} from "../ui";
import { useAuth, ROLE_LABELS } from "../lib/auth";
import { useAsyncData } from "../lib/useAsyncData";

/* The KTDA dashboard: this month's payments to farmers, what farmers did
   with the money, farmers by stage, and what needs a person. Demo data (the
   footer says so) until omnichannel's summaries back it. */

const KES = (n: number) => `KES ${compactNumber(n)}`;
const count = (n: number) => n.toLocaleString("en-KE");

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={`h-4 ${["w-3/4", "w-2/3", "w-4/5", "w-1/2"][i % 4]}`} />)}
    </div>
  );
}

export default function Dashboard() {
  const { role } = useAuth();
  const subtitle = useContentField("dashboard", "subtitle", "KTDA Digital Tea Payment Solution");

  const { data: money, loading: moneyLoading } = useAsyncData(getDashboardMoney);
  const { data: fraud } = useAsyncData(getFraudAlerts);
  const { data: unallocated } = useAsyncData(getUnallocatedFunds);
  const { data: disputes } = useAsyncData(getComplaints);
  const { data: enquiries } = useAsyncData(getEnquiries);
  const { data: cases, loading: casesLoading } = useAsyncData(() => (role ? getComplianceCases(role) : Promise.resolve([])));
  const { data: audit, loading: auditLoading } = useAsyncData(getAuditLog);

  const paid = useMemo(() => (money?.runs ?? []).filter((r) => r.status === "paid"), [money]);
  const paidTotal = paid.reduce((s, r) => s + r.amount, 0);
  const paidFarmers = paid.reduce((s, r) => s + r.farmers, 0);
  const days = money?.days ?? [];
  const cashOut = days.reduce((s, d) => s + d.cashOut, 0);
  const mpesa = days.reduce((s, d) => s + d.mpesa, 0);
  const merchant = days.reduce((s, d) => s + d.merchant, 0);
  const inWallets = Math.max(0, paidTotal - cashOut - mpesa - merchant);

  const openFraud = (fraud ?? []).filter((a) => a.status === "open").length;
  const unmatched = (unallocated ?? []).filter((u) => u.status === "unmatched");
  const openDisputes = (disputes ?? []).filter((c) => c.status !== "resolved" && c.status !== "closed").length;
  const lateEnquiries = (enquiries ?? []).filter((e) => e.sla.state === "breached").length;
  const caseRows = Object.entries(
    (cases ?? []).reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {}),
  );

  const farmers = money?.farmers;

  return (
    <div>
      <PageHeader eyebrow={role ? ROLE_LABELS[role] : ""} title="Dashboard" subtitle={subtitle} actions={<Badge tone="neutral">November 2026</Badge>} />

      <div className="grid gap-4 mb-6 grid-cols-2 lg:grid-cols-4" data-testid="dashboard-tiles">
        {moneyLoading || !farmers ? (
          [0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-5"><Skeleton className="h-4 w-24 mb-4" /><Skeleton className="h-8 w-20 mb-3" /><Skeleton className="h-3 w-28" /></Card>
          ))
        ) : (
          <>
            <StatCard label="Paid to farmers" value={KES(paidTotal)} icon={<Banknote size={18} />} hint={`${count(paidFarmers)} farmers in ${paid.length} payment runs this month`} to="/bulk/payments" />
            <StatCard label="Cashed out at agents" value={KES(cashOut)} icon={<HandCoins size={18} />} hint="this month" to="/agents" />
            <StatCard label="Farmers with a wallet" value={count(farmers.activated)} icon={<Wallet size={18} />} hint={`of ${count(farmers.registered)} registered`} to="/farmers" />
            <StatCard label="Open fraud alerts" value={openFraud} icon={<TriangleAlert size={18} />} hint="raised and not yet looked at" to="/fraud-alerts" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <ChartFrame
          className="md:col-span-2 xl:col-span-2"
          title="Money out of farmers' wallets"
          subtitle="This month, a day at a time: cash-outs at agents, Pay to M-PESA and payments at merchants' tills."
          legend={[
            { label: "Agent cash-out", colorIndex: 0, value: KES(cashOut) },
            { label: "Pay to M-PESA", colorIndex: 2, value: KES(mpesa) },
            { label: "Merchant tills", colorIndex: 4, value: KES(merchant) },
          ]}
          table={{
            columns: ["Date", "Agent cash-out", "Pay to M-PESA", "Merchant tills"],
            rows: days.map((d) => [formatDate(d.date), KES(d.cashOut), KES(d.mpesa), KES(d.merchant)]),
          }}
        >
          {moneyLoading ? <Skeleton className="h-[220px] w-full" /> : (
            <ColumnChart
              height={220}
              stacked
              labels={days.map((d) => formatDate(d.date).replace(/ \d{4}$/, ""))}
              series={[
                { label: "Agent cash-out", values: days.map((d) => d.cashOut), colorIndex: 0 },
                { label: "Pay to M-PESA", values: days.map((d) => d.mpesa), colorIndex: 2 },
                { label: "Merchant tills", values: days.map((d) => d.merchant), colorIndex: 4 },
              ]}
            />
          )}
        </ChartFrame>

        <ChartFrame
          title="Where this month's payments went"
          subtitle="Of what was paid to farmers this month."
          table={{ columns: ["Use", "KES"], rows: [["Agent cash-out", KES(cashOut)], ["Pay to M-PESA", KES(mpesa)], ["Merchant tills", KES(merchant)], ["Still in wallets", KES(inWallets)]] }}
        >
          {moneyLoading ? <Skeleton className="h-[170px] w-full" /> : (
            <DonutChart
              size={148}
              centerLabel="paid"
              centerValue={KES(paidTotal)}
              segments={[
                { label: "Agent cash-out", value: cashOut, colorIndex: 0 },
                { label: "Pay to M-PESA", value: mpesa, colorIndex: 2 },
                { label: "Merchant tills", value: merchant, colorIndex: 4 },
                { label: "Still in wallets", value: inWallets, colorIndex: 6 },
              ]}
            />
          )}
        </ChartFrame>

        <Card className="p-5 md:col-span-2 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text">Payment runs this month</h2>
            <Link to="/bulk/payments" className="text-xs text-primary-600 font-medium">All payment runs</Link>
          </div>
          {moneyLoading ? <PanelSkeleton rows={3} /> : (
            <ul className="flex flex-col divide-y divide-border" data-testid="dashboard-runs">
              {(money?.runs ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text font-medium">{r.title}: {r.factories.join(", ")}</div>
                    <div className="text-[11px] text-text-faint tabular">{r.id} · {formatDateTime(r.at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm tabular text-text">{KES(r.amount)}</div>
                    <div className="text-[11px] text-text-faint">{count(r.farmers)} farmers</div>
                  </div>
                  <Badge tone={r.status === "paid" ? "success" : "warning"}>{r.status === "paid" ? "Paid" : "Awaiting approval"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ChartFrame title="Farmers" subtitle="Registered, with a wallet, KYC verified, and paid this month.">
          {moneyLoading || !farmers ? <PanelSkeleton /> : (
            <BulletBar
              formatValue={count}
              rows={[
                { label: "Registered", value: farmers.registered, colorIndex: 0 },
                { label: "With a wallet", value: farmers.activated, colorIndex: 1 },
                { label: "KYC verified", value: farmers.kycVerified, colorIndex: 2 },
                { label: "Paid this month", value: paidFarmers, colorIndex: 3 },
              ]}
            />
          )}
        </ChartFrame>

        <ChartFrame title="Paid by factory" subtitle="This month's paid runs." table={{ columns: ["Factory", "KES"], rows: (money?.byFactory ?? []).map((f) => [f.factory, KES(f.amount)]) }}>
          {moneyLoading ? <PanelSkeleton rows={6} /> : (
            <BulletBar formatValue={KES} rows={(money?.byFactory ?? []).map((f) => ({ label: f.factory, value: f.amount, colorIndex: 0 }))} />
          )}
        </ChartFrame>

        <ChartFrame title="Needs a person" subtitle="Items no automatic step can close.">
          <ul className="flex flex-col divide-y divide-border" data-testid="dashboard-attention">
            <AttentionRow to="/unallocated-funds" label="Unallocated receipts" value={unmatched.length} hint={unmatched.length ? `${KES(unmatched.reduce((s, u) => s + u.amount, 0))} held` : undefined} />
            <AttentionRow to="/fraud-alerts" label="Open fraud alerts" value={openFraud} tone="danger" />
            <AttentionRow to="/complaints" label="Open disputes" value={openDisputes} />
            <AttentionRow to="/enquiries" label="Enquiries past the standard" value={lateEnquiries} tone="danger" />
          </ul>
        </ChartFrame>

        <ChartFrame title="Case load" subtitle="Investigations by state." table={{ columns: ["Status", "Cases"], rows: caseRows.map(([s, n]) => [CASE_STATUS_LABELS[s as keyof typeof CASE_STATUS_LABELS], n]) }}>
          {casesLoading ? <PanelSkeleton /> : (
            <BulletBar formatValue={String} rows={caseRows.map(([s, n], i) => ({ label: CASE_STATUS_LABELS[s as keyof typeof CASE_STATUS_LABELS], value: n, colorIndex: i }))} />
          )}
        </ChartFrame>

        <Card className="p-5 md:col-span-2 xl:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-text"><ScrollText size={15} className="text-text-faint" />Recent activity</h2>
            <Link to="/audit-log" className="text-xs text-primary-600 font-medium">Full audit log</Link>
          </div>
          {auditLoading ? <PanelSkeleton /> : (
            <div className="flex flex-col divide-y divide-border">
              {(audit ?? []).slice(0, 6).map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Badge tone={e.category === "security" ? "warning" : e.category === "config" ? "accent" : "info"} className="shrink-0">{AUDIT_CATEGORY_LABELS[e.category]}</Badge>
                  <span className="text-sm text-text truncate min-w-0"><span className="font-medium">{e.action}</span>: {e.target}</span>
                  <span className="text-xs text-text-faint ml-auto shrink-0 hidden sm:block">{formatDateTime(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function AttentionRow({ label, value, hint, tone = "warning", to }: { label: string; value: number; hint?: string; tone?: "warning" | "danger"; to: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Link to={to} className="text-sm text-text hover:text-primary-600 transition-colors">{label}</Link>
        {hint && <div className="text-[11px] text-text-faint">{hint}</div>}
      </div>
      <Badge tone={value === 0 ? "success" : tone} className="ml-auto shrink-0">{value === 0 ? "clear" : value}</Badge>
    </li>
  );
}
