import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./ui";
import { AuthProvider } from "./lib/auth";
import { ProtectedRoute } from "./lib/ProtectedRoute";
import Login from "./pages/Login";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Clients = lazy(() => import("./pages/Clients"));
const KycQueue = lazy(() => import("./pages/KycQueue"));
const KycPeriodic = lazy(() => import("./pages/KycPeriodic"));
const KycDynamic = lazy(() => import("./pages/KycDynamic"));
const KycOnboardingDetail = lazy(() => import("./pages/KycOnboardingDetail"));
const KycPeriodicDetail = lazy(() => import("./pages/KycPeriodicDetail"));
const KycDynamicDetail = lazy(() => import("./pages/KycDynamicDetail"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const Cases = lazy(() => import("./pages/Cases"));
const CaseDetail = lazy(() => import("./pages/CaseDetail"));
const Screening = lazy(() => import("./pages/Screening"));
const Complaints = lazy(() => import("./pages/Complaints"));
const AmlAlerts = lazy(() => import("./pages/AmlAlerts"));
const FraudAlerts = lazy(() => import("./pages/FraudAlerts"));
const FraudCases = lazy(() => import("./pages/FraudCases"));
const Approvals = lazy(() => import("./pages/Approvals"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Reconciliation = lazy(() => import("./pages/Reconciliation"));
const UnallocatedFunds = lazy(() => import("./pages/UnallocatedFunds"));
const UsersAdmin = lazy(() => import("./pages/UsersAdmin"));
const Reports = lazy(() => import("./pages/Reports"));
const PlatformSettings = lazy(() => import("./pages/PlatformSettings"));
const FeatureFlags = lazy(() => import("./pages/FeatureFlags"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const System = lazy(() => import("./pages/System"));
const Ledger = lazy(() => import("./pages/Ledger"));
const Enquiries = lazy(() => import("./pages/Enquiries"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const TokenConsoleOverview = lazy(() => import("./pages/tokenconsole/Overview"));
const TokenConsoleInvestors = lazy(() => import("./pages/tokenconsole/Investors"));
const TokenConsoleAccounts = lazy(() => import("./pages/tokenconsole/Accounts"));
const TokenConsoleJournals = lazy(() => import("./pages/tokenconsole/Journals"));
const TokenConsoleTrialBalance = lazy(() => import("./pages/tokenconsole/TrialBalance"));
const TokenConsoleReconciliation = lazy(() => import("./pages/tokenconsole/Reconciliation"));
const TokenConsoleRuns = lazy(() => import("./pages/tokenconsole/Runs"));
const BulkLoad = lazy(() => import("./pages/ktda/BulkLoad"));
const PaymentRuns = lazy(() => import("./pages/ktda/BulkLoad").then((m) => ({ default: m.PaymentRuns })));
const Institution = lazy(() => import("./pages/ktda/Institution"));
const Journey = lazy(() => import("./pages/ktda/Journey"));
const FarmersByStage = lazy(() => import("./pages/ktda/FarmersByStage"));
const FarmerDetail = lazy(() => import("./pages/ktda/FarmerDetail"));
const Merchants = lazy(() => import("./pages/ktda/Merchants"));
const Agents = lazy(() => import("./pages/ktda/Agents"));
const TokenConsolePolicies = lazy(() => import("./pages/tokenconsole/Policies"));
const TokenConsoleCompliance = lazy(() => import("./pages/tokenconsole/Compliance"));
const TokenConsoleChanges = lazy(() => import("./pages/tokenconsole/Changes"));
const TokenConsoleFunds = lazy(() => import("./pages/tokenconsole/Funds"));
const TokenConsoleTariffs = lazy(() => import("./pages/tokenconsole/Tariffs"));
const TokenConsoleConfiguration = lazy(() => import("./pages/tokenconsole/Configuration"));
const TokenConsoleLoans = lazy(() => import("./pages/tokenconsole/Loans"));
const TokenConsoleKyc = lazy(() => import("./pages/tokenconsole/Kyc"));
const TokenConsoleCustomers = lazy(() => import("./pages/tokenconsole/Customers"));
const TokenConsoleCustomerApprovals = lazy(() => import("./pages/tokenconsole/CustomerApprovals"));
const TokenConsoleTransactions = lazy(() => import("./pages/tokenconsole/Transactions"));
const TokenConsoleReports = lazy(() => import("./pages/tokenconsole/Reports"));
const TokenConsoleSurveillance = lazy(() => import("./pages/tokenconsole/Surveillance"));
const TokenConsoleUsers = lazy(() => import("./pages/tokenconsole/Users"));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
      <Route path="/kyc-queue" element={<ProtectedRoute><KycQueue /></ProtectedRoute>} />
      <Route path="/kyc-queue/:id" element={<ProtectedRoute><KycOnboardingDetail /></ProtectedRoute>} />
      <Route path="/kyc-periodic" element={<ProtectedRoute><KycPeriodic /></ProtectedRoute>} />
      <Route path="/kyc-periodic/:id" element={<ProtectedRoute><KycPeriodicDetail /></ProtectedRoute>} />
      <Route path="/kyc-dynamic" element={<ProtectedRoute><KycDynamic /></ProtectedRoute>} />
      <Route path="/kyc-dynamic/:id" element={<ProtectedRoute><KycDynamicDetail /></ProtectedRoute>} />
      <Route path="/clients/:id" element={<ProtectedRoute><ClientDetail /></ProtectedRoute>} />
      <Route path="/cases" element={<ProtectedRoute><Cases /></ProtectedRoute>} />
      <Route path="/cases/:id" element={<ProtectedRoute><CaseDetail /></ProtectedRoute>} />
      <Route path="/screening" element={<ProtectedRoute><Screening /></ProtectedRoute>} />
      <Route path="/complaints" element={<ProtectedRoute><Complaints /></ProtectedRoute>} />
      <Route path="/aml-alerts" element={<ProtectedRoute><AmlAlerts /></ProtectedRoute>} />
      <Route path="/fraud-alerts" element={<ProtectedRoute><FraudAlerts /></ProtectedRoute>} />
      <Route path="/fraud-cases" element={<ProtectedRoute><FraudCases /></ProtectedRoute>} />
      <Route path="/approvals" element={<ProtectedRoute><Approvals /></ProtectedRoute>} />
      <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
      <Route path="/reconciliation" element={<ProtectedRoute><Reconciliation /></ProtectedRoute>} />
      <Route path="/unallocated-funds" element={<ProtectedRoute><UnallocatedFunds /></ProtectedRoute>} />
      <Route path="/ledger" element={<ProtectedRoute><Ledger /></ProtectedRoute>} />
      <Route path="/enquiries" element={<ProtectedRoute><Enquiries /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
      <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
      {/* Baracel Unyt, the merged tokenization console. The bare prefix is not a page: its
          overview lives one level down so a grant on it cannot cover the
          console's other pages (see canAccess in lib/auth.tsx). */}
      <Route path="/token-console" element={<Navigate to="/" replace />} />
      <Route path="/token-console/overview" element={<ProtectedRoute><TokenConsoleOverview /></ProtectedRoute>} />
      <Route path="/token-console/investors" element={<ProtectedRoute><TokenConsoleInvestors /></ProtectedRoute>} />
      <Route path="/token-console/accounts" element={<ProtectedRoute><TokenConsoleAccounts /></ProtectedRoute>} />
      <Route path="/token-console/journals" element={<ProtectedRoute><TokenConsoleJournals /></ProtectedRoute>} />
      <Route path="/token-console/trial-balance" element={<ProtectedRoute><TokenConsoleTrialBalance /></ProtectedRoute>} />
      <Route path="/token-console/reconciliation" element={<ProtectedRoute><TokenConsoleReconciliation /></ProtectedRoute>} />
      <Route path="/bulk/onboarding" element={<ProtectedRoute><BulkLoad key="onboarding" flow="ONBOARDING" /></ProtectedRoute>} />
      <Route path="/bulk/payments" element={<ProtectedRoute><PaymentRuns /></ProtectedRoute>} />
      <Route path="/institution" element={<ProtectedRoute><Institution /></ProtectedRoute>} />
      <Route path="/journey" element={<ProtectedRoute><Journey /></ProtectedRoute>} />
      <Route path="/journey/register" element={<ProtectedRoute><BulkLoad key="registration" flow="REGISTRATION" /></ProtectedRoute>} />
      <Route path="/journey/activate" element={<ProtectedRoute><BulkLoad key="activation" flow="ACTIVATION" /></ProtectedRoute>} />
      <Route path="/farmers" element={<ProtectedRoute><FarmersByStage /></ProtectedRoute>} />
      <Route path="/farmers/:growerNo" element={<ProtectedRoute><FarmerDetail /></ProtectedRoute>} />
      <Route path="/merchants" element={<ProtectedRoute><Merchants /></ProtectedRoute>} />
      <Route path="/agents" element={<ProtectedRoute><Agents /></ProtectedRoute>} />
      <Route path="/token-console/runs" element={<ProtectedRoute><TokenConsoleRuns /></ProtectedRoute>} />
      <Route path="/token-console/policies" element={<ProtectedRoute><TokenConsolePolicies /></ProtectedRoute>} />
      <Route path="/token-console/compliance" element={<ProtectedRoute><TokenConsoleCompliance /></ProtectedRoute>} />
      <Route path="/token-console/changes" element={<ProtectedRoute><TokenConsoleChanges /></ProtectedRoute>} />
      <Route path="/token-console/funds" element={<ProtectedRoute><TokenConsoleFunds /></ProtectedRoute>} />
      <Route path="/token-console/tariffs" element={<ProtectedRoute><TokenConsoleTariffs /></ProtectedRoute>} />
      <Route path="/token-console/configuration" element={<ProtectedRoute><TokenConsoleConfiguration /></ProtectedRoute>} />
      <Route path="/token-console/loans" element={<ProtectedRoute><TokenConsoleLoans /></ProtectedRoute>} />
      <Route path="/token-console/kyc" element={<ProtectedRoute><TokenConsoleKyc /></ProtectedRoute>} />
      <Route path="/token-console/customers" element={<ProtectedRoute><TokenConsoleCustomers /></ProtectedRoute>} />
      <Route path="/token-console/customer-approvals" element={<ProtectedRoute><TokenConsoleCustomerApprovals /></ProtectedRoute>} />
      <Route path="/token-console/transactions" element={<ProtectedRoute><TokenConsoleTransactions /></ProtectedRoute>} />
      <Route path="/token-console/surveillance" element={<ProtectedRoute><TokenConsoleSurveillance /></ProtectedRoute>} />
      <Route path="/token-console/reports" element={<ProtectedRoute><TokenConsoleReports /></ProtectedRoute>} />
      {/* Identity checks merged into the KYC desk; old links still land. */}
      <Route path="/token-console/identity" element={<Navigate to="/token-console/kyc" replace />} />
      <Route path="/token-console/users" element={<ProtectedRoute><TokenConsoleUsers /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><UsersAdmin /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><PlatformSettings /></ProtectedRoute>} />
      <Route path="/feature-flags" element={<ProtectedRoute><FeatureFlags /></ProtectedRoute>} />
      <Route path="/audit-log" element={<ProtectedRoute><AuditLog /></ProtectedRoute>} />
      <Route path="/system" element={<ProtectedRoute><System /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary appName="KTDA Back Office">
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
}
