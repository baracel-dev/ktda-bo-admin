import { useEffect, useMemo, useState } from "react";
import { tokenConsole, tokenConsolePages } from "../../lib/api";
import type { Page } from "../../lib/tokApi";
import { useSharedList } from "../../lib/tokenConsole/sharedList";
import { useServerList } from "../../lib/useServerList";
import { label as humanize, shortId } from "../../lib/tokenConsole/format";
import type { Investor, InvestorContract } from "../../lib/tokenConsole/types.gen";
import { EntityPicker, type PickerOption } from "./EntityPicker";

/* Searchable pickers for the records the console's forms point at. Each
   reference-data picker reads one shared list (sharedList.ts, keyed like the
   entity registry where the two overlap), so a form with several pickers
   fetches each list once, and a record created elsewhere in the tab shows up
   here too. Investors and contracts run to hundreds of thousands, so those two
   search the engine instead (makeServerPicker). */

type PickerProps = { value: string; onChange: (id: string) => void; placeholder?: string; disabled?: boolean };

function makePicker<T>(
  key: string,
  fetch: () => Promise<T[]>,
  toOption: (row: T) => PickerOption | null,
  noun: string,
) {
  return function Picker({ value, onChange, placeholder, disabled, filter }: PickerProps & { filter?: (row: T) => boolean }) {
    const list = useSharedList(key, fetch);
    const options = useMemo(
      () => (list.data ?? []).filter((r) => !filter || filter(r)).map(toOption).filter((o): o is PickerOption => o !== null),
      [list.data, filter],
    );
    return (
      <EntityPicker
        options={options}
        value={value || null}
        onChange={(v) => onChange(v ?? "")}
        loading={list.isPending}
        disabled={disabled}
        placeholder={placeholder ?? `Select ${noun}…`}
        emptyLabel={list.error ? `Couldn't load ${noun}s: ${list.error}` : `No ${noun}s`}
      />
    );
  };
}

/** How many matches a server-searched picker shows; typing narrows them. */
const SEARCH_SIZE = 20;

/** Labels of records already chosen or looked up, so a form reopened on the
 *  same id does not ask the engine again. Lives for the tab. */
const chosen = new Map<string, PickerOption>();

function makeServerPicker<T, F extends object>(
  key: string,
  search: (q: string, filters: F, page: number, size: number) => Promise<Page<T>>,
  /** The record behind a chosen id, which need not be among the matches on show. */
  byId: (id: string) => Promise<T | null | undefined>,
  toOption: (row: T) => PickerOption | null,
  noun: string,
) {
  return function Picker({ value, onChange, placeholder, disabled, filters }: PickerProps & { filters?: F }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const list = useServerList(
      ({ page, size, q, filters }) => search(q, filters, page, size),
      { q, filters: (filters ?? {}) as F, enabled: open, pageSize: SEARCH_SIZE },
    );
    const options = useMemo(
      () => (list.rows ?? []).map(toOption).filter((o): o is PickerOption => o !== null),
      [list.rows],
    );

    const [resolved, setResolved] = useState<PickerOption | null>(null);
    const cached = value ? chosen.get(`${key}:${value}`) : undefined;
    useEffect(() => {
      if (!value || chosen.has(`${key}:${value}`)) return;
      let live = true;
      // A lookup that fails still shows the id rather than an empty picker.
      const fallback = { id: value, label: shortId(value) };
      byId(value).then(
        (row) => {
          const o = (row && toOption(row)) || fallback;
          if (o !== fallback) chosen.set(`${key}:${value}`, o);
          if (live) setResolved(o);
        },
        () => { if (live) setResolved(fallback); },
      );
      return () => { live = false; };
    }, [value]);
    const selectedOption = cached ?? (resolved?.id === value ? resolved : null);

    const more = list.total > options.length;
    return (
      <EntityPicker
        options={options}
        value={value || null}
        onChange={(v) => {
          const o = options.find((x) => x.id === v);
          if (o) chosen.set(`${key}:${o.id}`, o);
          onChange(v ?? "");
        }}
        onQueryChange={setQ}
        onOpenChange={setOpen}
        selectedOption={selectedOption}
        searching={list.loading}
        disabled={disabled}
        placeholder={placeholder ?? `Select ${noun}…`}
        note={more ? `The first ${options.length} of ${list.total.toLocaleString()} — type to narrow it down` : undefined}
        emptyLabel={list.error ? `Couldn't load ${noun}s: ${list.error}` : list.q ? `No ${noun} matches that` : `No ${noun}s`}
      />
    );
  };
}

export const ContractPicker = makeServerPicker<InvestorContract, Record<string, never>>(
  "contract",
  (q, _filters, page, size) => tokenConsolePages.contracts({ q }, page, size),
  // `q` matches a contract id exactly or by prefix; take the exact one.
  async (id) => (await tokenConsolePages.contracts({ q: id }, 1, SEARCH_SIZE)).items.find((c) => c.contractId === id),
  (c) => (c.contractId ? { id: c.contractId, label: c.investorRef ?? c.contractId, meta: `${c.productId ?? "—"} · ${c.contractStatus ?? "—"}` } : null),
  "contract",
);

/** Investors that cannot transact are listed but greyed, with the reason —
 *  an operator who can't find someone otherwise assumes the list is broken.
 *  `filters.status` narrows the search on the engine instead (Loans: only
 *  active investors can borrow). */
export const InvestorPicker = makeServerPicker<Investor, { status?: string[] }>(
  "investor",
  (q, filters, page, size) => tokenConsolePages.investors({ q, status: filters.status }, page, size),
  async (id) => (await tokenConsolePages.investorsByIds([id]))[0],
  (i) => i.investorId
    ? {
        id: i.investorId,
        label: i.displayName ?? i.externalRef ?? i.investorId,
        meta: i.externalRef ?? shortId(i.investorId),
        disabledReason: i.lifecycleStatus && i.lifecycleStatus !== "ACTIVE" ? humanize(i.lifecycleStatus) : undefined,
      }
    : null,
  "investor",
);

export const ProductPicker = makePicker(
  "tok:product", tokenConsole.products,
  (p) => (p.productId ? { id: p.productId, label: p.name ?? p.productId, meta: `${p.productId} · ${p.currency ?? ""}` } : null),
  "product",
);

export const OfferingPicker = makePicker(
  "tok:offering", tokenConsole.offerings,
  (o) => (o.offeringId ? { id: o.offeringId, label: `${o.productId ?? "—"} · ${o.offeringId}`, meta: `${humanize(o.status)} · ${o.currency ?? ""}` } : null),
  "offering",
);

export const AssetPicker = makePicker(
  "tok:asset", () => tokenConsole.assets(),
  (a) => a.assetId
    ? {
        id: a.assetId,
        label: a.name ?? a.assetId,
        meta: `${humanize(a.status)} · ${a.currency ?? ""}`,
        // Only an approved asset can back an offering.
        disabledReason: a.status === "DRAFT" ? "Not approved yet" : a.status === "RETIRED" ? "Retired" : undefined,
      }
    : null,
  "asset",
);

export const SubFundPicker = makePicker(
  "tok:subFund", tokenConsole.subFunds,
  (f) => (f.subFundId ? { id: f.subFundId, label: f.name ?? f.subFundId, meta: f.baseCurrency ?? undefined } : null),
  "sub-fund",
);

export const TokenClassPicker = makePicker(
  "tok:tokenClass", tokenConsole.tokenClasses,
  (t) => (t.tokenClassId
    ? { id: t.tokenClassId, label: t.name ?? t.symbol ?? shortId(t.tokenClassId), meta: `${t.symbol ?? ""} ${t.currency ?? ""} · ${humanize(t.status)}` }
    : null),
  "token class",
);

export const TariffTypePicker = makePicker(
  "tok:tariffType", tokenConsole.tariffTypes,
  (t) => (t.tariffTypeId ? { id: t.tariffTypeId, label: t.name ?? t.tariffTypeId, meta: t.tariffTypeId } : null),
  "tariff type",
);

export const TariffDomainPicker = makePicker(
  "tok:tariffDomain", tokenConsole.tariffDomains,
  (d) => (d.tariffDomainId ? { id: d.tariffDomainId, label: d.name ?? d.tariffDomainId, meta: d.tariffDomainId } : null),
  "tariff domain",
);

export const TariffValuePicker = makePicker(
  "tok:tariffValue", tokenConsole.tariffValues,
  (v) => (v.tariffValueId
    ? { id: v.tariffValueId, label: `${v.tariffTypeId ?? "—"} · ${v.currency ?? ""} · ${v.rate ?? "—"}`, meta: `${v.tariffDomainId ?? ""} from ${v.effectiveFrom ?? "—"}` }
    : null),
  "tariff",
);
