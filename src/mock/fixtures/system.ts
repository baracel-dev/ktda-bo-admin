import type { AdminRole } from "./admin";

/** System-management domain — departments, third-party integrations,
 * scheduled batch jobs and per-app maintenance mode. All BO-managed. */

// ---- Departments ----

export type Department = {
  id: string;
  name: string;
  head: string;
  description: string;
  /** BO Admin roles that belong to this department — users inherit their
   * department through their role. */
  roles: AdminRole[];
};

export const DEPARTMENTS: Department[] = [
  { id: "dep_exec", name: "Executive", head: "Charles Mburu", description: "Oversight of the tea payment service: performance, risk and the approvals that reach the board.", roles: ["ceo"] },
  { id: "dep_bd", name: "Farmer services", head: "Faith Kamau", description: "Registering farmers, messages to farmers, and the call centre and support desk.", roles: ["bd_officer", "client_services", "head_of_bd"] },
  { id: "dep_ops", name: "Payments operations", head: "Grace Mumbi", description: "Payment runs from the factories' files, Pay to M-PESA, reconciliation and unallocated receipts.", roles: ["operations"] },
  { id: "dep_fin", name: "Finance", head: "Daniel Kiptoo", description: "Settlement with M-PESA and SasaPay, float, charges and reporting.", roles: ["head_of_finance"] },
  { id: "dep_net", name: "Agent and merchant network", head: "Susan Achieng", description: "Agents' float and commissions, and agro-dealers that accept input vouchers.", roles: ["investment_manager", "investment_committee"] },
  { id: "dep_comp", name: "Compliance & Risk", head: "Kevin Baraka", description: "KYC decisions, fraud and AML monitoring, investigations and suspicious transaction reports (MLRO).", roles: ["compliance", "mlro", "compliance_analyst"] },
  { id: "dep_it", name: "Technology", head: "IT Admin", description: "Platform administration, access control, integrations and system monitoring.", roles: ["system_admin"] },
];

export function departmentForRole(role: AdminRole): Department | undefined {
  return DEPARTMENTS.find((d) => d.roles.includes(role));
}

// ---- Third-party integrations ----

export type Integration = {
  id: string;
  name: string;
  purpose: string;
  environment: "sandbox" | "production";
  health: "healthy" | "degraded" | "down";
  lastCheckedAt: string;
  note?: string;
};

export const INTEGRATIONS: Integration[] = [
  { id: "int_mpesa", name: "M-PESA (Daraja)", purpose: "Pay to M-PESA (B2C) for farmers, and paybill deposits into wallets.", environment: "production", health: "healthy", lastCheckedAt: "2026-11-09T06:00:00Z" },
  { id: "int_sasapay", name: "SasaPay", purpose: "Farmer, agent and merchant wallets; agent cash-out and till payments.", environment: "production", health: "healthy", lastCheckedAt: "2026-11-09T06:00:00Z" },
  { id: "int_iprs", name: "Identity registry (IPRS)", purpose: "Checks a farmer's ID number and name at registration and KYC.", environment: "production", health: "degraded", lastCheckedAt: "2026-11-09T05:30:00Z", note: "Answers slower than usual since 05:00; checks are queued, not lost." },
  { id: "int_sap", name: "Factory payment files (SAP)", purpose: "Each factory's green leaf and bonus payment file for a payment run.", environment: "production", health: "healthy", lastCheckedAt: "2026-11-09T06:00:00Z" },
  { id: "int_ussd", name: "USSD gateway", purpose: "Farmers' feature-phone menu: balance, statement, cash-out and PIN.", environment: "production", health: "healthy", lastCheckedAt: "2026-11-09T06:00:00Z" },
  { id: "int_sms", name: "SMS gateway", purpose: "Payment notices, consent requests, one-time codes and campaigns.", environment: "production", health: "healthy", lastCheckedAt: "2026-11-09T06:00:00Z" },
  { id: "int_airtel", name: "Airtel Money", purpose: "A second mobile-money rail for farmers on Airtel lines.", environment: "sandbox", health: "down", lastCheckedAt: "2026-11-02T09:00:00Z", note: "Not started. Down here means no integration yet, not an outage." },
];

// ---- Scheduled jobs ----

export type SystemJob = {
  id: string;
  name: string;
  description: string;
  schedule: string;
  enabled: boolean;
  lastRun?: { at: string; status: "success" | "failed"; detail?: string };
};

export const SYSTEM_JOBS: SystemJob[] = [
  { id: "job_files", name: "Factory payment file intake", description: "Collects the factories' payment files and stages them as payment runs for approval.", schedule: "Daily 05:00 EAT", enabled: true, lastRun: { at: "2026-11-09T05:00:00Z", status: "success", detail: "3 files staged: Litein, Momul, Kapkoros." } },
  { id: "job_recon", name: "Daily reconciliation", description: "Matches wallets, M-PESA and SasaPay settlement and the payment runs; raises breaks.", schedule: "Daily 06:30 EAT", enabled: true, lastRun: { at: "2026-11-09T06:30:00Z", status: "success", detail: "1 new break: SasaPay settlement KES 1,240 short." } },
  { id: "job_notices", name: "Payment notices", description: "Sends each farmer an SMS when their line in a payment run is credited.", schedule: "After each payment run", enabled: true, lastRun: { at: "2026-11-06T09:30:00Z", status: "success", detail: "18,011 notices sent." } },
  { id: "job_aml", name: "Fraud and AML monitoring", description: "Split cash-outs, number changes before a payment, repeated agent cash-outs and merchant spikes.", schedule: "Hourly", enabled: true, lastRun: { at: "2026-11-09T07:00:00Z", status: "success" } },
  { id: "job_commission", name: "Agent commissions", description: "Works out each agent's commission for the month and queues it for approval.", schedule: "Last business day, 17:30 EAT", enabled: true, lastRun: { at: "2026-10-30T17:30:00Z", status: "success" } },
  { id: "job_vouchers", name: "Voucher expiry", description: "Expires unused input vouchers past their date and returns the value to the scheme.", schedule: "Daily 00:30 EAT", enabled: true, lastRun: { at: "2026-11-09T00:30:00Z", status: "success", detail: "42 vouchers expired." } },
  { id: "job_kyc_refresh", name: "KYC re-check", description: "Re-checks farmers whose ID check is due again against the identity registry.", schedule: "Weekly, Mon 05:00 EAT", enabled: false, lastRun: { at: "2026-11-02T05:00:00Z", status: "failed", detail: "Timed out against the identity registry; re-enable once it answers normally." } },
];

// ---- Per-app maintenance mode ----

export type MaintenanceTarget = {
  id: string;
  app: string;
  maintenance: boolean;
  note?: string;
};

export const MAINTENANCE_TARGETS: MaintenanceTarget[] = [
  { id: "mt_ussd", app: "Farmer USSD menu", maintenance: false },
  { id: "mt_app", app: "Farmer app", maintenance: false },
  { id: "mt_agent", app: "Agent app", maintenance: false },
  { id: "mt_merchant", app: "Merchant till app", maintenance: true, note: "Upgrade to the voucher list screen; back by 12:00." },
];
