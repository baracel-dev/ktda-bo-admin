/* The institution's farmers and where each is in the journey, and the
 * single-farmer register, on omnichannel's operator API (scoped to this back
 * office's institution by the proxy). See journeyContract.ts. Where this
 * environment's omnichannel does not have them, a read answers
 * `{ available: false }` and the register throws NOT_AVAILABLE. */
import { OmniApiError, omniCall, type Page } from "./omniApi";
import { controlledPost } from "./api.approvals";
import type { Staged } from "./approvalsContract";
import {
  FARMERS_MAX_SIZE, FARMERS_PATH, FARMERS_SUMMARY_PATH, NOT_AVAILABLE, farmerByCustomerPath, farmerPath, notBuiltYet,
  KYC_SWEEP_PATH, KYC_SWEEP_RUNNING,
  type AssistedOnboarding, type Farmer, type FarmerDocument, type FarmerPhotoType, type FarmerState, type FarmersSummary, type KycDecisionBody,
  type KycStatus, type KycSweep, type OnboardingChannel, type RegisterFarmer,
} from "./journeyContract";

export type FarmersQuery = { state?: FarmerState | null; kyc?: KycStatus | null; channel?: OnboardingChannel | null; q?: string; page?: number; size?: number };
export type Maybe<T> = { available: true; data: T } | { available: false };
/** A register call's answer: `created` false when the farmer was already
 *  registered with the same phone (200 rather than 201). */
export type Registered = { created: boolean; farmer: Farmer };

const notBuilt = (e: unknown) => e instanceof OmniApiError && notBuiltYet(e.status, e.message);

/** A write this omnichannel does not have yet throws NOT_AVAILABLE. */
async function notBuiltAsUnavailable<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (notBuilt(e)) throw new OmniApiError((e as OmniApiError).status, NOT_AVAILABLE);
    throw e;
  }
}

async function maybe<T>(call: Promise<T>): Promise<Maybe<T>> {
  try {
    return { available: true, data: await call };
  } catch (e) {
    if (notBuilt(e)) return { available: false };
    throw e;
  }
}

export const farmersApi = {
  /** One page, newest registered first as omnichannel orders it. */
  list: ({ state, kyc, channel, q, page = 1, size = 20 }: FarmersQuery = {}): Promise<Maybe<Page<Farmer>>> => {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (kyc) params.set("kyc", kyc);
    if (channel) params.set("channel", channel);
    if (q?.trim()) params.set("q", q.trim());
    const query = params.toString();
    return maybe(omniCall.page<Farmer>(`${FARMERS_PATH}${query ? `?${query}` : ""}`, page, Math.min(size, FARMERS_MAX_SIZE)));
  },
  /** How many of the institution's farmers are at each stage. */
  summary: (): Promise<Maybe<FarmersSummary>> => maybe(omniCall.get<FarmersSummary>(FARMERS_SUMMARY_PATH)),
  /** One farmer; a 404 here is "no such grower", not a missing endpoint. */
  one: (growerNo: string): Promise<Farmer> => omniCall.get<Farmer>(farmerPath(growerNo)),
  /** The farmer behind an omnichannel profile, or null when it is not one of
   *  this institution's farmers (or this omnichannel cannot say). */
  byCustomer: async (customerId: string): Promise<Farmer | null> => {
    try {
      return await omniCall.get<Farmer>(farmerByCustomerPath(customerId));
    } catch (e) {
      if (e instanceof OmniApiError && e.status === 404) return null;
      throw e;
    }
  },
  /** Start (or restart) KYC for an activated farmer still at NONE; one already
   *  pending or decided comes back unchanged. */
  startKyc: (growerNo: string): Promise<Farmer> => notBuiltAsUnavailable(omniCall.post<Farmer>(`${farmerPath(growerNo)}/kyc/start`, {})),
  /** Compliance's decision, recorded on the farmer with the note and set on the ledger's standing. */
  decideKyc: (growerNo: string, body: KycDecisionBody & { reason?: string }): Promise<Staged<Farmer>> =>
    notBuiltAsUnavailable(controlledPost<Farmer>(`${farmerPath(growerNo)}/kyc/decision`, body)),
  /** The latest KYC sweep, or null when none has ever run (or this
   *  omnichannel has none: a GET cannot tell the two apart). */
  latestSweep: async (): Promise<KycSweep | null> => {
    try {
      const s = await omniCall.get<KycSweep | unknown>(KYC_SWEEP_PATH);
      // Anything that is not a sweep (a proxy's fallback page, say) is none.
      return s && typeof s === "object" && !Array.isArray(s) && typeof (s as KycSweep).status === "string" ? (s as KycSweep) : null;
    } catch (e) {
      if (e instanceof OmniApiError && e.status === 404) return null;
      throw e;
    }
  },
  /** Start the sweep. `running` when one was already under way: the sweep
   *  answered is then that one, read back. A 404 here is NOT_AVAILABLE. */
  startSweep: async (): Promise<{ sweep: KycSweep | null; alreadyRunning: boolean }> => {
    try {
      return { sweep: await omniCall.post<KycSweep>(KYC_SWEEP_PATH, {}), alreadyRunning: false };
    } catch (e) {
      if (e instanceof OmniApiError && e.status === 409 && e.code === KYC_SWEEP_RUNNING) {
        return { sweep: await farmersApi.latestSweep(), alreadyRunning: true };
      }
      if (notBuilt(e)) throw new OmniApiError((e as OmniApiError).status, NOT_AVAILABLE);
      throw e;
    }
  },
  /** Complete one registered farmer's onboarding in person; answers the farmer as they are now. */
  assistedOnboarding: (growerNo: string, body: AssistedOnboarding): Promise<Farmer> =>
    notBuiltAsUnavailable(omniCall.post<Farmer>(`${farmerPath(growerNo)}/assisted-onboarding`, body)),
  /** The farmer's photos and their review state. */
  documents: (growerNo: string): Promise<Maybe<FarmerDocument[]>> => maybe(omniCall.list<FarmerDocument>(`${farmerPath(growerNo)}/documents`)),
  uploadDocument: (growerNo: string, type: FarmerPhotoType, file: File): Promise<FarmerDocument> => {
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);
    return notBuiltAsUnavailable(omniCall.post<FarmerDocument>(`${farmerPath(growerNo)}/documents`, form));
  },
  register: async (body: RegisterFarmer): Promise<Registered> => {
    try {
      const { status, data } = await omniCall.postWithStatus<Farmer>(FARMERS_PATH, body);
      return { created: status === 201, farmer: data };
    } catch (e) {
      if (notBuilt(e)) throw new OmniApiError((e as OmniApiError).status, NOT_AVAILABLE);
      throw e;
    }
  },
};
