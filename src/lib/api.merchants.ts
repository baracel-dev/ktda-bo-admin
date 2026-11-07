/* The institution's KTDA merchants (self-onboarded shops), on omnichannel's operator API, which fetches
 * them from the channel-api (their system of record) with the shared KTDA service token. Read-only.
 * Where this environment's omnichannel does not have the endpoint yet, the list answers empty. */
import { omniCall } from "./omniApi";

export type MerchantTill = { till: string; outlet: string; town: string; label: string };

export type Merchant = {
  id: string;
  name: string;
  brsNo: string;
  businessType: string;
  category: string;
  /** PENDING | APPROVED | REJECTED | INFO_REQUESTED (channel-api's kyb value). */
  kyb: string;
  kybSubmittedAt: string | null;
  commissionBps: number;
  walletId: string;
  createdAt: string;
  tills: MerchantTill[];
};

export const merchantsApi = {
  /** Every merchant in this institution, newest first. */
  list: (): Promise<Merchant[]> => omniCall.list<Merchant>("/ktda/merchants"),
};
