import { useState } from "react";
import { Button, DataTable, Field, FilterBar, Input, Modal, NotePanel, PageHeader, SearchInput, SelectFilter, useToast } from "../../ui";
import { tokenConsole, tokenConsolePages } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useServerList } from "../../lib/useServerList";
import { calendarDate, counted, dateTime, money } from "../../lib/tokenConsole/format";
import { useAction } from "../../lib/tokenConsole/useAction";
import type { InvestorContract } from "../../lib/tokenConsole/types.gen";
import { Code, ConsoleTable, StatusBadge } from "../../components/tokenconsole/ConsoleTable";
import { DetailItem } from "../../components/tokenconsole/DetailItem";
import { ActionModal, isPositive } from "../../components/tokenconsole/ActionModal";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "FROZEN", label: "Frozen" },
  { value: "CLOSED", label: "Closed" },
];

/** Contracts are searched, filtered and paged by the engine, newest opened first. */
export default function TokenConsoleAccounts() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const contracts = useServerList(
    ({ page, size, q, filters }) => tokenConsolePages.contracts({ q, status: filters.status }, page, size),
    { q, filters: { status: status === "all" ? [] : [status] } },
  );
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Baracel Unyt"
        title="Accounts"
        subtitle="Investor contracts: one per investor per product, and the anchor every posting hangs off. Select one for its ledger accounts and cash."
      />
      <ConsoleTable<InvestorContract>
        what="accounts"
        source={contracts.source}
        paging={contracts.paging}
        rowId={(r) => r.contractId}
        title="Contracts"
        description={contracts.rows
          ? `${counted(contracts.total, "account")}${contracts.filtered ? " match" : ", newest opened first"}`
          : undefined}
        toolbar={
          <FilterBar className="mb-3">
            <SearchInput value={q} onChange={setQ} placeholder="Contract id or investor…" className="w-full sm:w-72" />
            <SelectFilter value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="All statuses" />
          </FilterBar>
        }
        emptyLabel={contracts.filtered ? "No account matches that" : "No accounts open"}
        onRowClick={(r) => setOpen(r.contractId ?? null)}
        columns={[
          { key: "contract", header: "Contract", render: (r) => <Code>{r.contractId}</Code> },
          { key: "investor", header: "Investor", render: (r) => r.investorRef ?? "—" },
          { key: "product", header: "Product", render: (r) => <Code>{r.productId}</Code> },
          { key: "ccy", header: "Ccy", render: (r) => r.currency ?? "—", hideOnMobile: true },
          { key: "opened", header: "Opened", render: (r) => <span className="tabular text-xs text-text-soft">{calendarDate(r.openedAt)}</span>, hideOnMobile: true },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.contractStatus} /> },
        ]}
      />
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Account ${open ?? ""}`} size="lg">
        {/* Keyed so an amount typed for one account never carries to the next. */}
        {open && <AccountPanel key={open} contractId={open} onChanged={contracts.reload} />}
      </Modal>
    </div>
  );
}

type Confirm = "freeze" | "unfreeze" | "close";
const CONFIRM: Record<Confirm, { title: string; body: string; label: string; danger: boolean }> = {
  freeze: {
    title: "Freeze this account?",
    body: "It drops out of accrual, distribution and fee runs, and nothing can be withdrawn until it is unfrozen.",
    label: "Freeze", danger: true,
  },
  unfreeze: { title: "Unfreeze this account?", body: "It returns to active and rejoins the batch runs.", label: "Unfreeze", danger: false },
  close: {
    title: "Close this account for good?",
    body: "Closing is terminal: the account cannot be reopened. Withdraw any cash first.",
    label: "Close account", danger: true,
  },
};

function AccountPanel({ contractId, onChanged }: { contractId: string; onChanged: () => void }) {
  const toast = useToast();
  const account = useAsyncData(() => tokenConsole.account(contractId));
  const cash = useAsyncData(() => tokenConsole.withdrawable(contractId));
  const act = useAction(async (kind: Confirm) =>
    kind === "freeze" ? tokenConsole.freezeAccount(contractId)
    : kind === "unfreeze" ? tokenConsole.unfreezeAccount(contractId)
    : tokenConsole.closeAccount(contractId));
  const withdraw = useAction(tokenConsole.withdraw);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [amount, setAmount] = useState("");

  const a = account.data;
  const w = cash.data;
  const ccy = a?.currency;
  const status = (a?.status ?? "").toUpperCase();
  const closed = status === "CLOSED";
  const frozen = status === "FROZEN";
  const glRows = (a?.glAccounts ?? []).map((g, i) => ({ ...g, id: g.glAccountId ?? `gl-${i}` }));
  const amountProblem = amount.trim() === "" ? undefined
    : !isPositive(amount) ? "Enter an amount above 0."
    : w?.total != null && Number(amount) > w.total ? `No more than ${money(w.total, ccy)} is withdrawable.` : undefined;

  const refresh = () => {
    void account.reload();
    void cash.reload();
    onChanged();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const done = await act.run(confirm);
    if (!done) return;
    toast.push(confirm === "freeze" ? "Account frozen." : confirm === "unfreeze" ? "Account unfrozen." : "Account closed.");
    setConfirm(null);
    refresh();
  };

  const runWithdraw = async () => {
    // Blank withdraws everything withdrawable: the service needs the amount, so it is sent as that figure.
    const all = w?.total ?? 0;
    if (amount.trim() === "" && !(all > 0)) {
      toast.push("There is nothing withdrawable on this account.");
      return;
    }
    const done = await withdraw.run(contractId, { amount: amount.trim() === "" ? all : Number(amount) });
    if (!done) return;
    toast.push(`Withdrew ${money(done.total, ccy)}.`);
    setWithdrawing(false);
    setAmount("");
    refresh();
  };

  return (
    <>
      {(account.error || cash.error) && <NotePanel tone="danger" className="mb-4">{account.error ?? cash.error}</NotePanel>}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 mb-5">
        <DetailItem term="Investor">{a?.investorRef ?? "—"}</DetailItem>
        <DetailItem term="Product"><Code>{a?.productId}</Code></DetailItem>
        <DetailItem term="Status"><StatusBadge status={a?.status} /></DetailItem>
        <DetailItem term="Opened">{dateTime(a?.openedAt)}</DetailItem>
        <DetailItem term="Settlement cash">{money(w?.settlementCash, ccy)}</DetailItem>
        <DetailItem term="Accrued interest">{money(w?.accruedInterest, ccy)}</DetailItem>
      </dl>

      <h3 className="mb-2 text-[13px] font-semibold text-text">Ledger accounts</h3>
      <DataTable
        rows={glRows}
        emptyLabel={account.loading ? "Loading…" : "This account opened no ledger accounts"}
        columns={[
          { key: "code", header: "Account", render: (g) => <Code>{g.accountCode}</Code> },
          { key: "id", header: "Ledger id", render: (g) => <Code>{g.glAccountId}</Code>, hideOnMobile: true },
          { key: "bal", header: "Posted balance", className: "tabular text-right", render: (g) => money(g.balance, ccy) },
        ]}
      />

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button size="sm" disabled={!a || closed || frozen || !w?.total} onClick={() => { withdraw.reset(); setWithdrawing(true); }}>
          Withdraw cash
        </Button>
        {frozen
          ? <Button size="sm" variant="outline" disabled={!a} onClick={() => { act.reset(); setConfirm("unfreeze"); }}>Unfreeze</Button>
          : <Button size="sm" variant="outline" disabled={!a || closed} onClick={() => { act.reset(); setConfirm("freeze"); }}>Freeze</Button>}
        <Button size="sm" variant="ghost" disabled={!a || closed} onClick={() => { act.reset(); setConfirm("close"); }}>Close account</Button>
        {closed && <span className="text-[12.5px] text-text-soft">This account is closed.</span>}
        {frozen && <span className="text-[12.5px] text-text-soft">Frozen accounts can't withdraw.</span>}
      </div>

      {confirm && (
        <ActionModal
          size="sm"
          title={CONFIRM[confirm].title}
          description={CONFIRM[confirm].body}
          submitLabel={CONFIRM[confirm].label}
          tone={CONFIRM[confirm].danger ? "danger" : "primary"}
          pending={act.pending}
          error={act.error}
          onSubmit={() => void runConfirm()}
          onClose={() => setConfirm(null)}
        />
      )}
      {withdrawing && (
        <ActionModal
          title="Withdraw cash"
          description={<>Pays out settlement cash first, then accrued interest. {money(w?.total, ccy)} is withdrawable now.</>}
          submitLabel="Withdraw"
          problem={amountProblem}
          pending={withdraw.pending}
          error={withdraw.error}
          onSubmit={() => void runWithdraw()}
          onClose={() => setWithdrawing(false)}
        >
          <Field label="Amount" hint="Leave blank to withdraw everything withdrawable." error={amountProblem}>
            <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={w?.total != null ? String(w.total) : ""} />
          </Field>
        </ActionModal>
      )}
    </>
  );
}
