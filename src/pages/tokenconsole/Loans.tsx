import { useEffect, useMemo, useState } from "react";
import { HandCoins, Plus } from "lucide-react";
import { Button, Field, FilterBar, GlassStat, Input, Modal, NotePanel, PageHeader, SearchInput, Select, SelectFilter, StatRail, useToast } from "../../ui";
import { tokenConsole, tokenConsolePages } from "../../lib/api";
import { TokApiError } from "../../lib/tokApi";
import { useAsyncData } from "../../lib/useAsyncData";
import { useServerList } from "../../lib/useServerList";
import { counted, label, money, percent } from "../../lib/tokenConsole/format";
import { useAction } from "../../lib/tokenConsole/useAction";
import type { InvestorContract } from "../../lib/tokenConsole/types.gen";
import { Code, ConsoleTable, StatusBadge } from "../../components/tokenconsole/ConsoleTable";
import { InvestorPicker } from "../../components/tokenconsole/Pickers";

/** A blank or non-positive entry is not an amount; the backend should never see one. */
const positive = (s: string) => s.trim() !== "" && Number.isFinite(Number(s)) && Number(s) > 0;
const positiveInt = (s: string) => positive(s) && Number.isInteger(Number(s));

/* The engine serves /accounting/loans/* from the release that added loan
   servicing (2026-10-29). An older engine answers Spring's own 404 for the
   whole family; say that, rather than "Not found" next to a real loan. A
   business 404 (an unknown account) carries {error} and is shown as is. */
const LOANS_MISSING = "Loan servicing isn't available on this tokenization backend — it predates the loan endpoints.";
function explainMissing<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof TokApiError && e.isMissingEndpoint) throw new Error(LOANS_MISSING);
      throw e;
    }
  };
}
const loanApi = {
  get: explainMissing(tokenConsole.loan),
  disburse: explainMissing(tokenConsole.disburseLoan),
  accrue: explainMissing(tokenConsole.accrueLoan),
  repay: explainMissing(tokenConsole.repayLoan),
  close: explainMissing(tokenConsole.closeLoan),
};

const STATUS_OPTIONS = ["PENDING", "ACTIVE", "SETTLED", "FROZEN", "CLOSED"].map((value) => ({ value, label: label(value) }));
const ACTIVE_ONLY = ["ACTIVE"];

export default function TokenConsoleLoans() {
  const toast = useToast();
  const products = useAsyncData(tokenConsole.products);
  const openAccount = useAction(tokenConsole.openAccount);

  const loanProducts = useMemo(() => (products.data ?? []).filter((p) => p.assetClass === "LOAN"), [products.data]);
  const loanProductIds = useMemo(
    () => loanProducts.map((p) => p.productId).filter((id): id is string => !!id).sort(),
    [loanProducts],
  );
  // No loan product means no loan account; asking without a productId would list every contract.
  const hasLoanProducts = loanProductIds.length > 0;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const contracts = useServerList(
    ({ page, size, q, filters }) => tokenConsolePages.contracts({ q, productId: filters.productId, status: filters.status }, page, size),
    { q, filters: { productId: loanProductIds, status: status === "all" ? [] : [status] }, enabled: hasLoanProducts },
  );
  const tilesKey = loanProductIds.join(",");
  const tiles = useAsyncData(() => (hasLoanProducts ? tokenConsolePages.contractsSummary(loanProductIds) : Promise.resolve(null)));
  // The loan products arrive after the first (empty) read.
  const reloadTiles = tiles.reload;
  useEffect(() => { if (tilesKey) void reloadTiles(); }, [tilesKey, reloadTiles]);

  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [investorId, setInvestorId] = useState("");
  const [productId, setProductId] = useState("");
  const [contractId, setContractId] = useState("");

  const closeOpenForm = () => {
    setOpening(false);
    setInvestorId("");
    setProductId("");
    setContractId("");
    openAccount.reset();
  };

  const refresh = () => {
    contracts.reload();
    void tiles.reload();
  };

  const submitOpen = async () => {
    const r = await openAccount.run({ investorId, productId, contractId: contractId.trim() || undefined });
    if (!r) return;
    toast.push(`Opened loan account ${r.contractId ?? ""}.`);
    closeOpenForm();
    refresh();
    setSelected(r.contractId ?? null);
  };

  // The account list is contracts filtered by the loan products, so it needs both.
  const source = {
    data: products.data ? contracts.rows : null,
    loading: products.loading || contracts.loading,
    error: products.error ?? contracts.error,
    reload: () => { void products.reload(); contracts.reload(); },
  };
  const t = tiles.data;
  const tile = (n: number | undefined) => (tiles.error || !products.data ? "—" : !hasLoanProducts ? 0 : t ? n ?? 0 : "…");

  return (
    <div>
      <PageHeader
        eyebrow="Baracel Unyt"
        title="Loans"
        subtitle="The lending lifecycle — disburse, accrue interest on the outstanding balance, repay (interest first, then principal), close."
        actions={<Button size="sm" onClick={() => setOpening(true)}><Plus size={14} /> Open loan account</Button>}
      />

      <StatRail className="mb-6">
        <GlassStat label="Loan products" value={products.data ? loanProducts.length : "—"} icon={<HandCoins size={16} />} tone="primary" />
        <GlassStat label="Loan accounts" value={tile(t?.total)} hint={tiles.error ? `Totals unavailable: ${tiles.error}` : undefined} />
        <GlassStat label="Active" value={tile(t?.byStatus?.ACTIVE)} tone="success" emphasis={false} />
        <GlassStat label="Closed" value={tile(t?.byStatus?.CLOSED)} />
      </StatRail>

      <ConsoleTable<InvestorContract>
        title="Loan accounts"
        description={source.data && hasLoanProducts ? `${counted(contracts.total, "account")}${contracts.filtered ? " match" : ", newest opened first"}` : undefined}
        what="loan accounts"
        source={source}
        paging={contracts.paging}
        rowId={(r) => r.contractId}
        onRowClick={(r) => setSelected(r.contractId ?? null)}
        toolbar={hasLoanProducts && (
          <FilterBar className="mb-3">
            <SearchInput value={q} onChange={setQ} placeholder="Account id or borrower…" className="w-full sm:w-72" />
            <SelectFilter value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="All statuses" />
          </FilterBar>
        )}
        emptyLabel={contracts.filtered ? "No loan account matches that" : "No loan accounts yet — open one to begin"}
        columns={[
          { key: "account", header: "Account", render: (r) => <Code>{r.contractId}</Code> },
          { key: "borrower", header: "Borrower", render: (r) => r.investorRef ?? "—" },
          { key: "product", header: "Product", render: (r) => <Code>{r.productId}</Code>, hideOnMobile: true },
          { key: "ccy", header: "Ccy", render: (r) => r.currency ?? "—" },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.contractStatus} /> },
        ]}
      />

      <Modal
        open={opening}
        onClose={closeOpenForm}
        title="Open a loan account"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeOpenForm}>Cancel</Button>
            <Button size="sm" disabled={!investorId || !productId || openAccount.pending} onClick={() => void submitOpen()}>
              {openAccount.pending ? "Opening…" : "Open account"}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-text-soft">Originate a loan for a borrower against a loan product.</p>
        <div className="grid gap-4">
          <Field label="Borrower (investor)" required group hint="Only active investors can borrow. Search by name, reference or id.">
            <InvestorPicker value={investorId} onChange={setInvestorId} filters={{ status: ACTIVE_ONLY }} placeholder="Search for a borrower…" />
          </Field>
          <Field
            label="Loan product"
            required
            hint={products.data && loanProducts.length === 0 ? "No loan products yet. Create one on Products with asset class Loan." : undefined}
          >
            <Select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={loanProducts.length === 0}>
              <option value="">Select…</option>
              {loanProducts.map((p) => <option key={p.productId} value={p.productId}>{p.productId} — {p.name}</option>)}
            </Select>
          </Field>
          <Field label="Account ID" hint="Leave blank to generate one.">
            <Input value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="Auto" />
          </Field>
        </div>
        {products.error && (
          <NotePanel tone="warning" className="mt-4">The loan products could not be loaded: {products.error}</NotePanel>
        )}
        {openAccount.error && <NotePanel tone="danger" className="mt-4">{openAccount.error}</NotePanel>}
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Loan ${selected ?? ""}`} size="lg">
        {/* Keyed so typed amounts and errors never carry over to another loan. */}
        {selected && <LoanPanel key={selected} contractId={selected} onChanged={refresh} />}
      </Modal>
    </div>
  );
}

function LoanPanel({ contractId, onChanged }: { contractId: string; onChanged: () => void }) {
  const toast = useToast();
  const loan = useAsyncData(() => loanApi.get(contractId));
  const disburse = useAction(loanApi.disburse);
  const accrue = useAction(loanApi.accrue);
  const repay = useAction(loanApi.repay);
  const close = useAction(loanApi.close);

  const [disburseAmt, setDisburseAmt] = useState("");
  const [accrueDays, setAccrueDays] = useState("30");
  const [repayAmt, setRepayAmt] = useState("");

  const v = loan.data;
  const ccy = v?.currency;
  const busy = disburse.pending || accrue.pending || repay.pending || close.pending;
  const err = disburse.error ?? accrue.error ?? repay.error ?? close.error;
  // No actions until the position has loaded, and none on a closed loan.
  const locked = busy || !v || v.status === "CLOSED";
  // Nothing owed, and nothing held for approval that would change that.
  const settled = v?.totalOutstanding === 0 && !v.pendingApproval;
  const invalid = (s: string, ok: (s: string) => boolean, msg: string) => (s.trim() !== "" && !ok(s) ? msg : undefined);

  // Every action moves the position; re-read it rather than trusting a partial response.
  const after = async (done: unknown, message: string, reset?: () => void) => {
    if (done === undefined) return;
    toast.push(message);
    reset?.();
    await loan.reload();
    onChanged();
  };

  if (loan.error === LOANS_MISSING) {
    return <NotePanel tone="warning" title="Not available yet">{LOANS_MISSING}</NotePanel>;
  }

  return (
    <>
      {loan.error && <NotePanel tone="danger" className="mb-4">{loan.error}</NotePanel>}
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        <Figure label="Principal due" value={money(v?.outstandingPrincipal, ccy)} />
        <Figure label="Interest due" value={money(v?.outstandingInterest, ccy)} />
        <Figure label="Total outstanding" value={money(v?.totalOutstanding, ccy)} strong />
        <Figure label="Status" value={v?.status ? label(v.status) : "—"} />
      </div>
      {/* An engine older than the rate fields sends none: say nothing rather than "no rate". */}
      {v && v.annualRate !== undefined && (
        <p className="mb-5 text-[12.5px] text-text-soft">
          {v.annualRate != null
            ? <>Rate {percent(v.annualRate)} a year{v.dayCount ? `, ${label(v.dayCount)}` : ""} — from tariff domain <Code>{v.rateSource ?? "—"}</Code>.</>
            : "No loan rate is in force for this loan, so interest can't be accrued. Set a TT-LOAN-RATE value on its product's, package's or institution's tariff domain."}
        </p>
      )}
      {v?.pendingApproval && (
        <NotePanel tone="warning" className="mb-4" title="Held for approval">
          A posting on this loan is at or above the approval threshold and is waiting on Journals. The figures above change once it is approved, and the loan can't be closed until then.
        </NotePanel>
      )}

      {/* Each button sits at the bottom of its column, so a hint or error
          under one field doesn't stagger them. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col">
          <Field label="Disburse amount" error={invalid(disburseAmt, positive, "Enter an amount above 0.")}>
            <Input type="number" inputMode="decimal" value={disburseAmt} onChange={(e) => setDisburseAmt(e.target.value)} placeholder="200000" />
          </Field>
          <div className="mt-auto pt-2">
            <Button size="sm" disabled={locked || !positive(disburseAmt)}
              onClick={async () => after(await disburse.run(contractId, Number(disburseAmt)), "Disbursed.", () => setDisburseAmt(""))}>
              Disburse
            </Button>
          </div>
        </div>
        <div className="flex flex-col">
          <Field label="Accrue interest (days)" error={invalid(accrueDays, positiveInt, "Enter whole days above 0.")}>
            <Input type="number" inputMode="numeric" value={accrueDays} onChange={(e) => setAccrueDays(e.target.value)} />
          </Field>
          <div className="mt-auto pt-2">
            <Button size="sm" disabled={locked || !positiveInt(accrueDays)}
              onClick={async () => after(await accrue.run(contractId, Number(accrueDays)), "Interest accrued.")}>
              Accrue
            </Button>
          </div>
        </div>
        <div className="flex flex-col">
          <Field label="Repay amount" hint="Interest first, then principal." error={invalid(repayAmt, positive, "Enter an amount above 0.")}>
            <Input type="number" inputMode="decimal" value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} placeholder="10000" />
          </Field>
          <div className="mt-auto pt-2">
            <Button size="sm" disabled={locked || !positive(repayAmt)}
              onClick={async () => {
                const r = await repay.run(contractId, Number(repayAmt));
                await after(r, r ? `Repaid — interest ${money(r.interestPaid, ccy)}, principal ${money(r.principalPaid, ccy)}.` : "", () => setRepayAmt(""));
              }}>
              Repay
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button variant="outline" size="sm" disabled={locked || !settled}
          onClick={async () => after(await close.run(contractId), "Loan closed.")}>
          Close loan
        </Button>
        {v && v.status !== "CLOSED" && !settled && (
          <span className="text-[12.5px] text-text-soft">A loan can be closed once nothing is outstanding or held for approval.</span>
        )}
      </div>
      {err && <NotePanel tone="danger" className="mt-3">{err}</NotePanel>}
    </>
  );
}

function Figure({ label: text, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">{text}</div>
      <div className={strong ? "mt-1 tabular text-base font-semibold text-text" : "mt-1 tabular text-sm text-text"}>{value}</div>
    </div>
  );
}
