import { useEffect, useState } from "react";
import { getClients, getFraudAlerts } from "./api";
import { approvalsApi } from "./api.approvals";
import { useAuth } from "./auth";

/* The counts beside menu entries, each read from the same source as the page
   it sits beside, so the badge and the page always agree:
   - Approvals: requests waiting in omnichannel's approvals queue (it
     decides who may check, so every pending one counts).
   - Onboarding review: sign-ups waiting for review.
   - Fraud alerts: alerts still open.
   A source that fails just shows no badge. */
export function useNavBadges(): Record<string, number> {
  const { role } = useAuth();
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    const count = <T,>(load: () => Promise<T[]>, keep: (x: T) => boolean) =>
      load().then((rows) => rows.filter(keep).length).catch(() => 0);

    Promise.all([
      approvalsApi.summary().then((s) => (s.available ? s.data.pending : 0)).catch(() => 0),
      count(getClients, (c) => c.kycStatus === "pending_review"),
      count(getFraudAlerts, (f) => f.status === "open"),
    ]).then(([approvals, onboarding, fraud]) => {
      if (live) setBadges({ "/approvals": approvals, "/kyc-queue": onboarding, "/fraud-alerts": fraud });
    });
    return () => { live = false; };
  }, [role]);

  return badges;
}
