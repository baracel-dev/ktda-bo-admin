/* "Not on this environment yet" handling shared by the newer operator API
 * clients (merchants, agents, approvals). */
import { OmniApiError } from "./omniApi";

export type Maybe<T> = { available: true; data: T } | { available: false };

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
