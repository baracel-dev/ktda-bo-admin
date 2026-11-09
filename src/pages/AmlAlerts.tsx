import { getAmlAlerts } from "../lib/api";
import { AlertsBoard } from "../components/AlertsBoard";

export default function AmlAlerts() {
  return (
    <AlertsBoard
      eyebrow="Transaction Monitoring"
      title="Alerts"
      tooltip="AML is anti-money laundering. Splitting a large sum into many small cash-outs to stay under the review line is the pattern this queue flags most."
      subtitle="Money-laundering signs across tea payments, wallet transfers, agent cash-outs and Pay to M-PESA. Opening a case moves an alert into an investigation."
      fetchAlerts={getAmlAlerts}
      casesPath="/cases"
    />
  );
}
