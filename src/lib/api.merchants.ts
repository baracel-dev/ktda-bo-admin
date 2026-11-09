/* This institution's merchants for the back office.
 *
 * READ (list/summary/one) is a demo-safe bridge to the REAL self-onboarded merchants, which live in the
 * channel-api (the merchant/agent backend), surfaced through omnichannel's operator passthrough
 * `/api/operator/ktda/merchants`. They are mapped here into the merchantsAgentsContract shape the page
 * renders. WRITES (register/decide/BRS/docs/edit) still go to omnichannel's own merchant register — a
 * channel-api merchant has no record there yet, so a decision answers "not available" rather than
 * silently touching the wrong store. Making KYB decisions write through to the channel-api is the
 * follow-up to this read-only bridge.
 *
 * Where this environment's omnichannel does not have the passthrough, a list or summary answers
 * `{ available: false }`. */
import { OmniApiError, omniCall, type Page } from "./omniApi";
import { maybe, missingEndpoint, orUnavailable, type Maybe } from "./omniMaybe";
import type { WalletMovement } from "./journeyContract";
import { controlledPost, controlledPut } from "./api.approvals";
import type { Staged } from "./approvalsContract";
import {
  KYB_COUNT_KEY, MERCHANTS_PATH, PAGE_MAX, merchantPath,
  type BrsStatus, type KybStatus, type Merchant, type MerchantDecision, type MerchantDocumentType, type MerchantsSummary,
  type MerchantType, type RegisterMerchant, type UpdateMerchant,
} from "./merchantsAgentsContract";

export const MERCHANTS_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here does not have merchants.";

export { maybe, missingEndpoint, orUnavailable } from "./omniMaybe";

// --- the real channel-api merchants, mapped to the contract --------------------------------------------

/** The channel-api's merchant, as omnichannel's /ktda/merchants passthrough returns it. */
export type ChannelMerchant = {
  id: string;
  name: string;
  brsNo: string;
  businessType: string;
  category: string;
  /** lowercase: approved | in_review | pending | needs_documents | info_requested | rejected */
  kyb: string;
  kybSubmittedAt: string | null;
  commissionBps: number;
  walletId: string;
  createdAt: string;
  tills: { till: string; outlet: string; town: string; label: string }[];
};

const CHANNEL_MERCHANTS_PATH = "/ktda/merchants";
const channelMerchantPath = (id: string) => `${CHANNEL_MERCHANTS_PATH}/${encodeURIComponent(id)}`;

/** The merchant's wallet on the accounting core: open false and no balances
 *  when the core does not know the wallet. */
export type MerchantWallet = { open: boolean; balances: { currency: string; available: number; updatedAt: string | null }[] };
/** GET /ktda/merchants/{id}: the merchant as the list gives it, with its wallet. */
export type MerchantDetail = ChannelMerchant & { wallet?: MerchantWallet | null };
/** One merchant's page: found (with `walletRead` false where this
 *  omnichannel has no detail read yet, so only the list's fields are known),
 *  or not one of this institution's. */
export type MerchantProfile = { found: true; merchant: MerchantDetail; walletRead: boolean } | { found: false };

export const MERCHANT_DETAIL_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here does not read a merchant's wallet yet.";

const KYB_MAP: Record<string, KybStatus> = {
  approved: "APPROVED", in_review: "IN_REVIEW", pending: "IN_REVIEW",
  needs_documents: "NEEDS_DOCUMENTS", info_requested: "NEEDS_DOCUMENTS", rejected: "REJECTED",
};
export const kybOf = (k: string): KybStatus => KYB_MAP[(k ?? "").toLowerCase()] ?? "IN_REVIEW";

const typeOf = (category: string, businessType: string): MerchantType => {
  const s = `${category} ${businessType}`.toLowerCase();
  return s.includes("agro") ? "AGRO_DEALER" : s.includes("shop") || s.includes("retail") || s.includes("kiosk") ? "SHOP" : "OTHER";
};

const DOC_TYPES: MerchantDocumentType[] = ["CERTIFICATE_OF_REGISTRATION", "KRA_PIN_CERTIFICATE", "DIRECTOR_ID_COPIES", "BANK_LETTER"];

function toMerchant(m: ChannelMerchant): Merchant {
  const kyb = kybOf(m.kyb);
  const approved = kyb === "APPROVED";
  const till = m.tills[0];
  const brsStatus: BrsStatus = approved ? "VERIFIED" : "UNCHECKED";
  return {
    id: m.id,
    reference: m.brsNo,
    name: m.name,
    type: typeOf(m.category, m.businessType),
    town: till?.town ?? null,
    county: null,
    ownerName: null,
    ownerPhone: null,
    tillNo: till?.till ?? null,
    brs: { registrationNo: m.brsNo, status: brsStatus, registeredName: approved ? m.name : null, registeredType: null, registeredOwner: null, checkedAt: approved ? m.kybSubmittedAt : null },
    kyb: { status: kyb, decidedAt: approved ? m.kybSubmittedAt : null, decidedBy: null, note: null },
    settlement: { bank: null, accountMasked: null },
    commissionRate: typeof m.commissionBps === "number" ? m.commissionBps / 10000 : null,
    vouchers: { accepts: false, categories: [] },
    documents: DOC_TYPES.map((type) => ({ type, received: approved, receivedAt: approved ? m.kybSubmittedAt : null, reference: null })),
    sales30d: null,
    transactions30d: null,
    joinedAt: m.createdAt,
    updatedAt: null,
  };
}

/** Every real merchant, newest first as the channel-api orders it, mapped to the contract. */
async function realMerchants(): Promise<Merchant[]> {
  return (await omniCall.list<ChannelMerchant>(CHANNEL_MERCHANTS_PATH)).map(toMerchant);
}

export type MerchantsQuery = { status?: KybStatus | null; q?: string; page?: number; size?: number };

export const merchantsApi = {
  list: ({ status, q, page = 1, size = 20 }: MerchantsQuery = {}): Promise<Maybe<Page<Merchant>>> =>
    maybe((async () => {
      let all = await realMerchants();
      if (status) all = all.filter((m) => m.kyb.status === status);
      const needle = q?.trim().toLowerCase();
      if (needle) {
        all = all.filter((m) =>
          [m.name, m.reference, m.town, m.tillNo, m.type].filter(Boolean).join(" ").toLowerCase().includes(needle));
      }
      const sz = Math.min(size, PAGE_MAX);
      const total = all.length;
      const pages = Math.max(1, Math.ceil(total / sz));
      const items = all.slice((page - 1) * sz, (page - 1) * sz + sz);
      return { items, page, pages, total };
    })()),

  summary: (): Promise<Maybe<MerchantsSummary>> =>
    maybe((async () => {
      const all = await realMerchants();
      const byStatus = { inReview: 0, needsDocuments: 0, approved: 0, rejected: 0 };
      for (const m of all) byStatus[KYB_COUNT_KEY[m.kyb.status]] += 1;
      const approved = all.filter((m) => m.kyb.status === "APPROVED");
      return {
        approved: byStatus.approved,
        agroDealers: approved.filter((m) => m.type === "AGRO_DEALER").length,
        waitingForKyb: byStatus.inReview + byStatus.needsDocuments,
        acceptVouchers: approved.filter((m) => m.vouchers.accepts).length,
        sales30d: null,
        byStatus,
      };
    })()),

  /** One merchant's page by its channel-api id (or, from an older link, its
   *  BRS number). The detail read answers 404 both for a merchant that is not
   *  this institution's and on an omnichannel without the read, so a 404 is
   *  settled from the list: listed means the read is missing (the page shows
   *  the list's fields), not listed means no such merchant. */
  detail: async (key: string): Promise<MerchantProfile> => {
    const read = async (id: string): Promise<MerchantProfile | null> => {
      try {
        return { found: true, merchant: await omniCall.get<MerchantDetail>(channelMerchantPath(id)), walletRead: true };
      } catch (e) {
        if (missingEndpoint(e)) return null;
        throw e;
      }
    };
    const direct = await read(key);
    if (direct) return direct;
    const all = await maybe(omniCall.list<ChannelMerchant>(CHANNEL_MERCHANTS_PATH));
    const listed = all.available ? all.data.find((m) => m.id === key) ?? all.data.find((m) => m.brsNo === key) : undefined;
    if (!listed) return { found: false };
    if (listed.id !== key) {
      const byId = await read(listed.id);
      if (byId) return byId;
    }
    return { found: true, merchant: listed, walletRead: false };
  },
  /** One page of the merchant's wallet movements in `currency`, newest first. */
  movements: (id: string, currency: string, page: number, size = 20): Promise<Page<WalletMovement>> =>
    omniCall.page<WalletMovement>(`${channelMerchantPath(id)}/movements?currency=${encodeURIComponent(currency)}`, page, size).catch((e: unknown) => {
      if (missingEndpoint(e)) throw new OmniApiError((e as OmniApiError).status, MERCHANT_DETAIL_NOT_AVAILABLE);
      throw e;
    }),

  /** One merchant by reference (its BRS number), or null when it is not one of this institution's. */
  one: async (reference: string): Promise<Merchant | null> =>
    (await realMerchants()).find((m) => m.reference === reference) ?? null,

  // Writes still target omnichannel's own merchant register (follow-up: write through to the channel-api).
  register: (body: RegisterMerchant) => orUnavailable(omniCall.post<Merchant>(MERCHANTS_PATH, body), MERCHANTS_NOT_AVAILABLE),
  /** A change to the settlement bank or account, the commission or the till is sent for approval. */
  update: (reference: string, body: UpdateMerchant & { reason?: string }): Promise<Staged<Merchant>> =>
    orUnavailable(controlledPut<Merchant>(merchantPath(reference), body), MERCHANTS_NOT_AVAILABLE),
  markDocument: (reference: string, type: MerchantDocumentType, documentRef?: string) =>
    orUnavailable(omniCall.post<Merchant>(`${merchantPath(reference)}/documents`, { type, ...(documentRef ? { reference: documentRef } : {}) }), MERCHANTS_NOT_AVAILABLE),
  checkBrs: (reference: string) => orUnavailable(omniCall.post<Merchant>(`${merchantPath(reference)}/brs-check`, {}), MERCHANTS_NOT_AVAILABLE),
  /** Approving, or revoking an approval, is sent for approval; needs documents and a first rejection apply at once. */
  decide: (reference: string, body: MerchantDecision & { reason?: string }): Promise<Staged<Merchant>> =>
    orUnavailable(controlledPost<Merchant>(`${merchantPath(reference)}/decision`, body), MERCHANTS_NOT_AVAILABLE),
};
