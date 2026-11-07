/* This institution's merchants on omnichannel's operator API (scoped by the
 * proxy). See merchantsAgentsContract.ts. Where this environment's
 * omnichannel does not have them, a list or summary answers
 * `{ available: false }` and a write throws MERCHANTS_NOT_AVAILABLE. */
import { OmniApiError, omniCall, type Page } from "./omniApi";
import type { Maybe } from "./api.farmers";
import {
  MERCHANTS_PATH, MERCHANTS_SUMMARY_PATH, PAGE_MAX, merchantPath,
  type KybStatus, type Merchant, type MerchantDecision, type MerchantDocumentType, type MerchantsSummary, type RegisterMerchant, type UpdateMerchant,
} from "./merchantsAgentsContract";

export const MERCHANTS_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here does not have merchants.";

/** An unknown path or method: this omnichannel predates the module. */
export const missingEndpoint = (e: unknown) => e instanceof OmniApiError && (e.status === 404 || e.status === 405 || e.status === 501);

export async function maybe<T>(call: Promise<T>): Promise<Maybe<T>> {
  try {
    return { available: true, data: await call };
  } catch (e) {
    if (missingEndpoint(e)) return { available: false };
    throw e;
  }
}

/** For a write on a record the page just listed, a 404 is the endpoint missing. */
export async function orUnavailable<T>(call: Promise<T>, message: string): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (missingEndpoint(e)) throw new OmniApiError((e as OmniApiError).status, message);
    throw e;
  }
}

export type MerchantsQuery = { status?: KybStatus | null; q?: string; page?: number; size?: number };

export const merchantsApi = {
  list: ({ status, q, page = 1, size = 20 }: MerchantsQuery = {}): Promise<Maybe<Page<Merchant>>> => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q?.trim()) p.set("q", q.trim());
    const qs = p.toString();
    return maybe(omniCall.page<Merchant>(`${MERCHANTS_PATH}${qs ? `?${qs}` : ""}`, page, Math.min(size, PAGE_MAX)));
  },
  summary: (): Promise<Maybe<MerchantsSummary>> => maybe(omniCall.get<MerchantsSummary>(MERCHANTS_SUMMARY_PATH)),
  /** One merchant, or null when the reference is not this institution's. */
  one: async (reference: string): Promise<Merchant | null> => {
    try {
      return await omniCall.get<Merchant>(merchantPath(reference));
    } catch (e) {
      if (e instanceof OmniApiError && e.status === 404) return null;
      throw e;
    }
  },
  register: (body: RegisterMerchant) => orUnavailable(omniCall.post<Merchant>(MERCHANTS_PATH, body), MERCHANTS_NOT_AVAILABLE),
  update: (reference: string, body: UpdateMerchant) => orUnavailable(omniCall.put<Merchant>(merchantPath(reference), body), MERCHANTS_NOT_AVAILABLE),
  markDocument: (reference: string, type: MerchantDocumentType, documentRef?: string) =>
    orUnavailable(omniCall.post<Merchant>(`${merchantPath(reference)}/documents`, { type, ...(documentRef ? { reference: documentRef } : {}) }), MERCHANTS_NOT_AVAILABLE),
  checkBrs: (reference: string) => orUnavailable(omniCall.post<Merchant>(`${merchantPath(reference)}/brs-check`, {}), MERCHANTS_NOT_AVAILABLE),
  decide: (reference: string, body: MerchantDecision) =>
    orUnavailable(omniCall.post<Merchant>(`${merchantPath(reference)}/decision`, body), MERCHANTS_NOT_AVAILABLE),
};
