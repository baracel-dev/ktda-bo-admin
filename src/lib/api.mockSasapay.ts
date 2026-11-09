/* The demo's mock SasaPay, served by omnichannel itself: where a PAYOUT run
 * pays farmers' M-PESA on an environment with no real provider. Staff can see
 * its balances and the payouts it took, and reset the balances for the next
 * demo. A 404 means the mock is off there, and the page shows nothing. */
import { omniCall } from "./omniApi";
import { maybe, type Maybe } from "./omniMaybe";

export type MockPayout = {
  /** Masked by omnichannel, "2547****0001". */
  receiver?: string | null;
  amount?: number | null;
  currency?: string | null;
  /** The mock's answer: SUCCESS, FAILED, ... */
  result?: string | null;
  at?: string | null;
  reference?: string | null;
};

export type MockSasaPay = {
  enabled: boolean;
  workingBalance?: number | null;
  utilityBalance?: number | null;
  currency?: string | null;
  /** The latest payouts, newest first. */
  payouts?: MockPayout[] | null;
};

export type MockReset = { workingBalance?: number; utilityBalance?: number };

const PATH = "/mock-sasapay";

export const mockSasapay = {
  get: (): Promise<Maybe<MockSasaPay>> => maybe(omniCall.get<MockSasaPay>(PATH)),
  reset: (body: MockReset) => omniCall.post<MockSasaPay>(`${PATH}/reset`, body),
};
