import { getFraudAlerts } from "../lib/api";
import { AlertsBoard } from "../components/AlertsBoard";

/** The fraud desk's queue — the Transaction Monitoring board, pointed at the
 * fraud indicators and the fraud case list. */
export default function FraudAlerts() {
  return (
    <AlertsBoard
      eyebrow="Fraud Reporting"
      title="Fraud alerts"
      tooltip="Duplicate grower numbers, a phone number changed just before a payment or bonus, an agent cashing out the same farmer again and again, a merchant's sales jumping, and sign-ins from a new phone after wrong PINs."
      subtitle="Fraud signs raised on farmers, agents and merchants. Opening a case moves an alert into an investigation."
      fetchAlerts={getFraudAlerts}
      casesPath="/fraud-cases"
    />
  );
}
