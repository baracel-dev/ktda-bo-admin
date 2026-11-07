import { useEffect, useMemo, useState } from "react";
import { Badge, FilterBar, PageHeader, SearchInput, Skeleton } from "../../ui";
import { useAsyncData } from "../../lib/useAsyncData";
import { calendarDate } from "../../lib/tokenConsole/format";
import { merchantsApi, type Merchant } from "../../lib/api.merchants";
import { SourceError } from "../../components/tokenconsole/ConsoleTable";

/** KYB standing → badge tone. */
const KYB_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  APPROVED: "success",
  PENDING: "warning",
  INFO_REQUESTED: "info",
  REJECTED: "danger",
};
const kybLabel = (k: string): string => (k ? k.charAt(0) + k.slice(1).toLowerCase().replace("_", " ") : "—");

/**
 * The institution's merchants: the agro-dealers and shops farmers pay, as they self-onboarded them on the
 * merchant app. Real data from the channel-api (via omnichannel's operator API). Read-only for now —
 * who they are, their BRS number, KYB standing, tills and wallet.
 */
export default function Merchants() {
  const list = useAsyncData(() => merchantsApi.list());
  const { reload } = list;
  useEffect(() => { void reload(); }, [reload]);
  const [typed, setTyped] = useState("");

  const merchants = list.data ?? null;
  const rows = useMemo(() => {
    const q = typed.trim().toLowerCase();
    if (!merchants) return [];
    if (!q) return merchants;
    return merchants.filter((m) =>
      [m.name, m.brsNo, m.category, m.tills.map((t) => `${t.till} ${t.outlet} ${t.town}`).join(" ")]
        .join(" ").toLowerCase().includes(q));
  }, [merchants, typed]);

  const approved = merchants?.filter((m) => m.kyb === "APPROVED").length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="KTDA"
        title="Merchants"
        subtitle="Agro-dealers and shops where farmers spend, as self-onboarded on the merchant app. Checked against the Business Registration Service before they can take payments."
      />

      {list.error ? (
        <SourceError what="the merchants" error={list.error} onRetry={list.reload} />
      ) : (
        <>
          <FilterBar>
            <SearchInput value={typed} onChange={setTyped} placeholder="Name, BRS, town or till" className="w-72" />
            {merchants && (
              <span className="text-[12.5px] text-text-soft">
                {merchants.length} merchant{merchants.length === 1 ? "" : "s"} · {approved} approved
              </span>
            )}
          </FilterBar>

          {!merchants ? (
            <Skeleton className="h-48" />
          ) : rows.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border p-6 text-center text-sm text-text-soft" data-testid="merchants-empty">
              {typed ? "No merchant matches." : "No merchants yet. They appear here once a shop self-onboards on the merchant app."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <table className="w-full text-[13px]" data-testid="merchants-table">
                <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">Merchant</th>
                    <th className="px-3 py-2 font-medium">BRS no.</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Tills</th>
                    <th className="px-3 py-2 font-medium">KYB</th>
                    <th className="px-3 py-2 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m: Merchant) => (
                    <tr key={m.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium text-text">{m.name}</div>
                        <div className="text-[12px] text-text-soft">{m.businessType}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{m.brsNo}</td>
                      <td className="px-3 py-2">{m.category}</td>
                      <td className="px-3 py-2">
                        {m.tills.length === 0 ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {m.tills.map((t) => (
                              <span key={t.till}>
                                <span className="font-mono text-[12.5px]">{t.till}</span>
                                <span className="text-[12px] text-text-soft"> · {t.outlet}, {t.town}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2"><Badge tone={KYB_TONE[m.kyb] ?? "neutral"}>{kybLabel(m.kyb)}</Badge></td>
                      <td className="px-3 py-2 whitespace-nowrap text-text-soft">{calendarDate(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
