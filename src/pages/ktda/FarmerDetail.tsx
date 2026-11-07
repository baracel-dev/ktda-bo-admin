import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Badge, Button, Card, NotePanel, PageHeader, Skeleton, StatCard } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { calendarDate, dateTime, money, units } from "../../lib/tokenConsole/format";
import { farmersApi } from "../../lib/api.farmers";
import { farmerWallet } from "../../lib/farmerWallet";
import { OmniApiError } from "../../lib/omniApi";
import { customerDeskLink } from "../../lib/tokenConsole/customerSearch";
import { NOT_AVAILABLE, STATE_LABEL, STATE_MEANS, STATE_TONE, type Farmer } from "../../lib/journeyContract";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";
import { DetailItem } from "../../components/tokenconsole/DetailItem";
import { FarmerKyc } from "./FarmerKyc";

/* One farmer of this institution: their record and stage, their wallet
   balance and every movement in it, all from omnichannel (which reads the
   wallet from the engine's ledger and answers only for this institution's
   farmers). Read-only. Where this environment's omnichannel has no wallet
   read yet, the wallet part says so and the record still shows. */

const SIZE = 20;

type Profile = { found: true; farmer: Farmer } | { found: false };

async function loadProfile(growerNo: string): Promise<Profile> {
  try {
    return { found: true, farmer: await farmersApi.one(growerNo) };
  } catch (e) {
    if (e instanceof OmniApiError && e.status === 404) return { found: false };
    throw e;
  }
}

const NotAvailable = () => (
  <div data-testid="wallet-not-available">
    <NotePanel tone="info" title="Wallet not available on this environment yet">
      Omnichannel here does not read farmers' wallets yet. It needs the omnichannel release with the farmer wallet read.
    </NotePanel>
  </div>
);

export default function FarmerDetail() {
  const growerNo = useParams().growerNo ?? "";
  const profile = useAsyncData(() => loadProfile(growerNo));
  const farmer = profile.data?.found ? profile.data.farmer : null;

  const wallet = useAsyncData(async () => (farmer ? farmerWallet.wallet(farmer.growerNo) : null));
  const { reload: reloadWallet } = wallet;
  const found = farmer?.growerNo ?? null;
  useEffect(() => { if (found) void reloadWallet(); }, [found, reloadWallet]);

  const w = wallet.data;
  const balance = w?.walletOpen ? w.balances[0] ?? null : null;
  const currency = balance?.currency ?? null;
  const [page, setPage] = useState(1);
  const moves = useAsyncData(async () => (found && currency ? farmerWallet.movements(found, currency, page, SIZE) : null));
  const { reload: reloadMoves } = moves;
  useEffect(() => { if (found && currency) void reloadMoves(); }, [found, currency, page, reloadMoves]);

  const crumb = (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-[12.5px] text-text-soft">
      <Link to="/farmers" className="hover:text-text">Farmers</Link>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="font-mono text-text">{growerNo}</span>
    </nav>
  );

  if (profile.error) return <div>{crumb}<SourceError what="the farmer" error={profile.error} onRetry={profile.reload} /></div>;
  if (!profile.data) return <div>{crumb}<Skeleton className="h-48" /></div>;
  if (!farmer) {
    return (
      <div>
        {crumb}
        <div data-testid="farmer-not-found">
          <NotePanel tone="info" title="No such farmer">No farmer with grower number {growerNo} is registered with this institution.</NotePanel>
        </div>
      </div>
    );
  }

  const m = moves.data;
  const lastCredit = page === 1 ? m?.items.find((x) => x.type === "CREDIT") ?? null : null;

  return (
    <div data-testid="farmer-profile">
      {crumb}
      <PageHeader
        eyebrow={`Farmer · ${farmer.growerNo}`}
        title={farmer.fullName ?? farmer.growerNo}
        subtitle={[farmer.factory, farmer.registeredAt && `registered ${calendarDate(farmer.registeredAt)}`].filter(Boolean).join(" · ") || undefined}
        actions={<Badge tone={STATE_TONE[farmer.status] ?? "neutral"}>{STATE_LABEL[farmer.status] ?? farmer.status}</Badge>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
        <FarmerKyc farmer={farmer} onChanged={(f) => profile.setData({ found: true, farmer: f })} />
        <section aria-label="Wallet" className="min-w-0">
          {wallet.error === NOT_AVAILABLE ? (
            <NotAvailable />
          ) : wallet.error ? (
            <SourceError what="the wallet" error={wallet.error} onRetry={wallet.reload} />
          ) : !w ? (
            <Skeleton className="h-28" />
          ) : !balance ? (
            <div data-testid="wallet-none">
              <NotePanel tone="info" title="No wallet yet">
                {farmer.status === "REGISTERED"
                  ? "The wallet opens when the farmer finishes onboarding in the app or on the web."
                  : "Omnichannel reports no open wallet for this farmer."}
              </NotePanel>
            </div>
          ) : (
            <>
              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                <div data-testid="wallet-available">
                  <StatCard label="Wallet balance" value={money(balance.available, balance.currency)} hint={balance.updatedAt ? `Available · as of ${dateTime(balance.updatedAt)}` : "Available to spend now"} />
                </div>
                <StatCard
                  label="Last credit"
                  value={lastCredit ? money(lastCredit.amount, lastCredit.currency) : farmer.lastFundedAt ? calendarDate(farmer.lastFundedAt) : "None yet"}
                  hint={lastCredit ? calendarDate(lastCredit.occurredAt) : farmer.lastFundedAt ? "Last funded" : "No payment has reached this wallet"}
                />
                <StatCard label="Movements" value={m ? units(m.total) : "…"} hint="In and out of the wallet" />
              </div>

              <h2 className="mb-2 text-sm font-semibold text-text">Wallet activity</h2>
              {moves.error === NOT_AVAILABLE ? <NotAvailable /> : moves.error ? (
                <SourceError what="the wallet activity" error={moves.error} onRetry={moves.reload} />
              ) : !m ? <Skeleton className="h-32" /> : m.items.length === 0 ? (
                <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="wallet-activity-empty">
                  No money has moved in this wallet yet.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
                    <table className="w-full text-[13px]" data-testid="wallet-activity">
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
                            <td className="px-3 py-2">
                              {x.description ?? (x.type === "CREDIT" ? "Money in" : "Money out")}
                            </td>
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
            </>
          )}
        </section>
        </div>

        <Card className="h-fit p-4">
          <h2 className="mb-3 text-sm font-semibold text-text">Details</h2>
          <dl className="grid gap-3" data-testid="farmer-details">
            <DetailItem term="Grower number"><span className="font-mono">{farmer.growerNo}</span></DetailItem>
            <DetailItem term="Phone"><span className="tabular">{farmer.phone ?? "—"}</span></DetailItem>
            <DetailItem term="Factory">{farmer.factory ?? "—"}</DetailItem>
            <DetailItem term="Stage">{STATE_LABEL[farmer.status] ?? farmer.status}<span className="block text-[12px] text-text-soft">{STATE_MEANS[farmer.status]}</span>{farmer.status === "CLASH" && farmer.clashReason && <span className="mt-1 block text-[12px] text-warning" data-testid="clash-reason">{farmer.clashReason}</span>}</DetailItem>
            <DetailItem term="Registered">{farmer.registeredAt ? calendarDate(farmer.registeredAt) : "—"}</DetailItem>
            <DetailItem term="Activated">{farmer.activatedAt ? calendarDate(farmer.activatedAt) : "—"}</DetailItem>
            <DetailItem term="Last funded">{farmer.lastFundedAt ? calendarDate(farmer.lastFundedAt) : "—"}</DetailItem>
          </dl>
          {farmer.customerId && (
            <Link to={customerDeskLink(farmer.customerId)} className="mt-4 inline-block text-sm font-medium text-primary-600 hover:text-primary-700" data-testid="customer-desk-link">
              Open in the Customer desk →
            </Link>
          )}
        </Card>
      </div>
    </div>
  );
}
