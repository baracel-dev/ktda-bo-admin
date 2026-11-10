import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Badge, Button, Card, NotePanel, PageHeader, Skeleton, StatCard } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { calendarDate, dateTime, money, units } from "../../lib/tokenConsole/format";
import { MERCHANT_DETAIL_NOT_AVAILABLE, kybOf, merchantsApi } from "../../lib/api.merchants";
import { KYB_LABEL, KYB_TONE, ratePercent } from "../../lib/merchantsAgentsContract";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { DetailItem } from "../../components/tokenconsole/DetailItem";
import { LastRejection } from "../../components/ApprovalNotice";

/* One merchant of this institution, laid out like a farmer's page: who they
   are (from the channel-api, through omnichannel's passthrough), their wallet
   balance on the accounting core and every movement in it, and their tills.
   Read-only: KYB decisions belong to the channel-api. Where this
   environment's omnichannel has no detail read yet, the page shows what the
   merchant list knows and says the wallet is not available. */

const SIZE = 20;
const CURRENCY = "KES";

const NotAvailable = () => (
  <div data-testid="wallet-not-available">
    <NotePanel tone="info" title="Wallet not available on this environment yet">
      Omnichannel here does not read merchants&apos; wallets yet.
    </NotePanel>
  </div>
);

const words = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ") : "—");

export default function MerchantDetail() {
  const key = useParams().id ?? "";
  const profile = useAsyncData(() => merchantsApi.detail(key));
  const merchant = profile.data?.found ? profile.data.merchant : null;
  const walletRead = profile.data?.found ? profile.data.walletRead : false;
  const id = merchant?.id ?? null;

  const wallet = merchant?.wallet ?? null;
  const balance = wallet?.open ? wallet.balances.find((b) => b.currency === CURRENCY) ?? wallet.balances[0] ?? null : null;
  const currency = balance?.currency ?? CURRENCY;
  const [page, setPage] = useState(1);
  const moves = useAsyncData(async () => (id && walletRead && balance ? merchantsApi.movements(id, currency, page, SIZE) : null));
  const { reload: reloadMoves } = moves;
  useEffect(() => { if (id && walletRead && balance) void reloadMoves(); }, [id, walletRead, balance, currency, page, reloadMoves]);

  const crumb = (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-[12.5px] text-text-soft">
      <Link to="/merchants" className="hover:text-text">Merchants</Link>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="text-text">{merchant?.name ?? key}</span>
    </nav>
  );

  if (profile.error) return <div>{crumb}<SourceError what="the merchant" error={profile.error} onRetry={profile.reload} /></div>;
  if (!profile.data) return <div>{crumb}<Skeleton className="h-48" /></div>;
  if (!merchant) {
    return (
      <div>
        {crumb}
        <div data-testid="merchant-not-found">
          <NotePanel tone="info" title="No such merchant">No merchant {key} is registered with this institution.</NotePanel>
        </div>
      </div>
    );
  }

  const kyb = kybOf(merchant.kyb);
  const m = moves.data;

  return (
    <div data-testid="merchant-profile">
      {crumb}
      <PageHeader
        eyebrow={`Merchant · ${merchant.brsNo}`}
        title={merchant.name}
        subtitle={[words(merchant.businessType), words(merchant.category), merchant.createdAt && `since ${calendarDate(merchant.createdAt)}`].filter((x) => x && x !== "—").join(" · ") || undefined}
        actions={<Badge tone={KYB_TONE[kyb] ?? "neutral"}>{`KYB: ${KYB_LABEL[kyb] ?? kyb}`}</Badge>}
      />
      <LastRejection key={merchant.brsNo} target={merchant.brsNo} className="mb-4" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="merchant-tiles">
        <div data-testid="wallet-balance">
          <StatCard
            label="Wallet balance KES"
            value={!walletRead ? "Not available" : balance ? money(balance.available, balance.currency) : "No wallet"}
            hint={!walletRead ? "Not on this environment yet" : balance?.updatedAt ? `As of ${dateTime(balance.updatedAt)}` : balance ? "Available now" : "The accounting core does not know this wallet"}
          />
        </div>
        <StatCard label="Tills" value={units(merchant.tills.length)} />
        <StatCard label="Commission" value={typeof merchant.commissionBps === "number" ? ratePercent(merchant.commissionBps / 10000) : "—"} hint="Of each sale" />
        <StatCard label="KYB" value={KYB_LABEL[kyb] ?? kyb} hint={merchant.kybSubmittedAt ? `Submitted ${calendarDate(merchant.kybSubmittedAt)}` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <section aria-label="Tills" className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-text">Tills</h2>
            {merchant.tills.length === 0 ? (
              <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="tills-empty">No tills yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
                <table className="w-full text-[13px]" data-testid="tills">
                  <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                    <tr>
                      <th className="px-3 py-2 font-medium">Till</th>
                      <th className="px-3 py-2 font-medium">Outlet</th>
                      <th className="px-3 py-2 font-medium">Town</th>
                      <th className="px-3 py-2 font-medium">Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merchant.tills.map((t) => (
                      <tr key={t.till} className="border-t border-border/60">
                        <td className="px-3 py-2 font-mono text-[12.5px]">{t.till}</td>
                        <td className="px-3 py-2">{t.outlet || "—"}</td>
                        <td className="px-3 py-2">{t.town || "—"}</td>
                        <td className="px-3 py-2 text-text-soft">{t.label || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="Transaction history" className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold text-text">Transaction history</h2>
            {!walletRead ? <NotAvailable /> : !balance ? (
              <div data-testid="wallet-none">
                <NotePanel tone="info" title="No wallet yet">The accounting core does not know this merchant&apos;s wallet, so there is no history to show.</NotePanel>
              </div>
            ) : moves.error === MERCHANT_DETAIL_NOT_AVAILABLE ? <NotAvailable /> : moves.error ? (
              <SourceError what="the transaction history" error={moves.error} onRetry={moves.reload} />
            ) : !m ? <Skeleton className="h-32" /> : m.items.length === 0 ? (
              <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="movements-empty">
                No movements yet.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
                  <table className="w-full text-[13px]" data-testid="movements">
                    <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                      <tr>
                        <th className="px-3 py-2 font-medium">When</th>
                        <th className="px-3 py-2 font-medium">What</th>
                        <th className="px-3 py-2 font-medium">Reference</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.items.map((x) => (
                        <tr key={`${x.reference}-${x.type}`} className="border-t border-border/60">
                          <td className="whitespace-nowrap px-3 py-2 tabular text-text-soft">{dateTime(x.occurredAt)}</td>
                          <td className="px-3 py-2">{x.description ?? (x.type === "CREDIT" ? "Money in" : "Money out")}</td>
                          <td className="px-3 py-2 font-mono text-[12px] text-text-soft">{x.reference}</td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right tabular ${x.type === "CREDIT" ? "text-success" : "text-text"}`}>
                            {x.type === "CREDIT" ? "+" : "−"}{money(x.amount, x.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {m.pages > 1 && (
                  <div className="mt-3 flex items-center justify-between text-[12.5px] text-text-soft">
                    <span>{units(m.total)} movements · page {page} of {m.pages}</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                      <Button size="sm" variant="outline" disabled={page >= m.pages} onClick={() => setPage(page + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <Card className="h-fit p-4">
          <h2 className="mb-3 text-sm font-semibold text-text">Details</h2>
          <dl className="grid gap-3" data-testid="merchant-details">
            <DetailItem term="BRS number"><span className="font-mono">{merchant.brsNo}</span></DetailItem>
            <DetailItem term="Business type">{words(merchant.businessType)}</DetailItem>
            <DetailItem term="Category">{words(merchant.category)}</DetailItem>
            <DetailItem term="Wallet id"><span className="font-mono text-[12px] break-all">{merchant.walletId || "—"}</span></DetailItem>
            <DetailItem term="KYB submitted">{merchant.kybSubmittedAt ? calendarDate(merchant.kybSubmittedAt) : "—"}</DetailItem>
            <DetailItem term="Joined">{merchant.createdAt ? calendarDate(merchant.createdAt) : "—"}</DetailItem>
          </dl>
        </Card>
      </div>
    </div>
  );
}
