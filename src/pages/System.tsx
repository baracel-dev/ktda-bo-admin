import { useState } from "react";
import {
  getIntegrations, setIntegrationEnvironment, getSystemJobs, setSystemJobEnabled, runSystemJob,
  getMaintenanceTargets, setMaintenanceMode,
} from "../lib/api";
import type { Integration, SystemJob, MaintenanceTarget } from "../mock";
import { PageHeader, Card, Badge, Button, Toggle, Dropdown, Skeleton, useToast, formatDateTime } from "../ui";
import { Plug, CalendarClock, Construction, Play } from "lucide-react";
import { useAuth, ADMIN_USERS } from "../lib/auth";
import { useAsyncData } from "../lib/useAsyncData";

const HEALTH_TONE: Record<Integration["health"], "success" | "warning" | "danger"> = {
  healthy: "success",
  degraded: "warning",
  down: "danger",
};

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Plug; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 p-5 pb-4 border-b border-border">
      <span className="h-9 w-9 rounded-lg bg-primary-50 text-primary-600 ring-1 ring-primary-500/20 flex items-center justify-center shrink-0">
        <Icon size={17} />
      </span>
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        <p className="text-xs text-text-soft mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export default function System() {
  const { role } = useAuth();
  const toast = useToast();
  const me = role ? ADMIN_USERS[role].name : "";

  const integrations = useAsyncData(getIntegrations);
  const jobs = useAsyncData(getSystemJobs);
  const maintenance = useAsyncData(getMaintenanceTargets);
  const [busy, setBusy] = useState<string | null>(null);

  const wrap = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(null);
    }
  };

  const switchEnvironment = (i: Integration, environment: Integration["environment"]) =>
    wrap(i.id, async () => {
      const updated = await setIntegrationEnvironment(i.id, environment, me);
      integrations.setData((prev) => (prev ? prev.map((x) => (x.id === updated.id ? { ...updated } : x)) : prev));
      toast.push(`${updated.name} switched to ${environment}`, environment === "production" ? "success" : "info");
    });

  const toggleJob = (j: SystemJob, enabled: boolean) =>
    wrap(j.id, async () => {
      const updated = await setSystemJobEnabled(j.id, enabled, me);
      jobs.setData((prev) => (prev ? prev.map((x) => (x.id === updated.id ? { ...updated } : x)) : prev));
      toast.push(`${updated.name} ${enabled ? "enabled" : "disabled"}`, enabled ? "success" : "info");
    });

  const runJob = (j: SystemJob) =>
    wrap(`run_${j.id}`, async () => {
      const updated = await runSystemJob(j.id, me);
      jobs.setData((prev) => (prev ? prev.map((x) => (x.id === updated.id ? { ...updated } : x)) : prev));
      toast.push(`${updated.name} completed`, "success");
    });

  const toggleMaintenance = (t: MaintenanceTarget, on: boolean) =>
    wrap(t.id, async () => {
      const updated = await setMaintenanceMode(t.id, on, me);
      maintenance.setData((prev) => (prev ? prev.map((x) => (x.id === updated.id ? { ...updated } : x)) : prev));
      toast.push(`${updated.app}: maintenance ${on ? "on" : "off"}`, on ? "warning" : "success");
    });

  return (
    <div>
      <PageHeader
        title="System"
        tooltip="The platform's connections, the scheduled jobs behind payment runs, reconciliation and messages, and maintenance mode for each channel. Every action is audit-logged."
        subtitle="Connections, scheduled jobs and maintenance for USSD, the app, agents and the back office."
      />

      <div className="flex flex-col gap-6">
        <Card className="overflow-hidden">
          <SectionHeader icon={Plug} title="Integrations" description="Services the platform depends on: M-PESA, SasaPay, the identity registry, SMS and the factories' payment files." />
          {integrations.loading ? (
            <div className="p-5 flex flex-col gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(integrations.data ?? []).map((i) => (
                <li key={i.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text">{i.name}</span>
                      <Badge tone={HEALTH_TONE[i.health]}>{i.health}</Badge>
                    </div>
                    <p className="text-xs text-text-soft mt-0.5 max-w-xl">{i.purpose}</p>
                    <p className="text-[11px] text-text-faint mt-1">
                      Checked {formatDateTime(i.lastCheckedAt)}{i.note ? ` · ${i.note}` : ""}
                    </p>
                  </div>
                  <div className={busy === i.id ? "opacity-50 pointer-events-none shrink-0" : "shrink-0"}>
                    <Dropdown
                      size="sm"
                      value={i.environment}
                      onChange={(v) => switchEnvironment(i, v as Integration["environment"])}
                      options={[
                        { value: "sandbox", label: "Sandbox" },
                        { value: "production", label: "Production" },
                      ]}
                      ariaLabel={`${i.name} environment`}
                      className="w-40"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <SectionHeader icon={CalendarClock} title="Scheduled jobs" description="The end-of-day jobs behind payment runs, reconciliation, payment notices and monitoring." />
          {jobs.loading ? (
            <div className="p-5 flex flex-col gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(jobs.data ?? []).map((j) => (
                <li key={j.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text">{j.name}</span>
                      <Badge tone="neutral">{j.schedule}</Badge>
                      {j.lastRun && (
                        <Badge tone={j.lastRun.status === "success" ? "success" : "danger"}>
                          last run {j.lastRun.status}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-text-soft mt-0.5 max-w-xl">{j.description}</p>
                    {j.lastRun && (
                      <p className="text-[11px] text-text-faint mt-1">
                        {formatDateTime(j.lastRun.at)}{j.lastRun.detail ? ` · ${j.lastRun.detail}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Button size="sm" variant="outline" disabled={!j.enabled || busy === `run_${j.id}`} onClick={() => runJob(j)}>
                      <Play size={13} />
                      {busy === `run_${j.id}` ? "Running…" : "Run now"}
                    </Button>
                    <div className={busy === j.id ? "opacity-50 pointer-events-none" : ""}>
                      <Toggle checked={j.enabled} onChange={(v) => toggleJob(j, v)} label={j.name} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <SectionHeader icon={Construction} title="Maintenance mode" description="Take a surface offline with a maintenance notice — e.g. during cutovers. The back office itself can't be taken down from here." />
          {maintenance.loading ? (
            <div className="p-5 flex flex-col gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(maintenance.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text">{t.app}</span>
                      {t.maintenance && <Badge tone="warning">in maintenance</Badge>}
                    </div>
                    {t.note && <p className="text-xs text-text-soft mt-0.5">{t.note}</p>}
                  </div>
                  <div className={busy === t.id ? "opacity-50 pointer-events-none" : ""}>
                    <Toggle checked={t.maintenance} onChange={(v) => toggleMaintenance(t, v)} label={`${t.app} maintenance`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
