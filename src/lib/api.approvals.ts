/* Omnichannel's approvals queue (maker-checker), and the helpers the
 * controlled writes use to tell "applied" from "sent for approval". See
 * approvalsContract.ts. */
import { omniCall, type Page } from "./omniApi";
import { maybe, orUnavailable, type Maybe } from "./omniMaybe";
import {
  APPROVALS_PATH, approvalPath,
  type Approval, type ApprovalDetails, type ApprovalStatus, type ApprovalsSummary, type ApprovalType, type Staged,
} from "./approvalsContract";

export const APPROVALS_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here has no approvals queue.";

export type ApprovalsQuery = {
  status: ApprovalStatus; type?: ApprovalType | null;
  /** One target's requests: an agent number, a merchant reference, a grower number, or "farmers" for bulk KYC decisions. */
  target?: string | null;
  /** Only the signed-in staff member's own requests. */
  mine?: boolean;
  page?: number; size?: number;
};

export const approvalsApi = {
  list: ({ status, type, target, mine, page = 1, size = 20 }: ApprovalsQuery): Promise<Maybe<Page<Approval>>> => {
    const p = new URLSearchParams({ status });
    if (type) p.set("type", type);
    if (target) p.set("target", target);
    if (mine) p.set("mine", "true");
    return maybe(omniCall.page<Approval>(`${APPROVALS_PATH}?${p}`, page, size));
  },
  /** The target as it stands now; null when it has gone or the type has none. Unavailable before v2. */
  details: async (idOrRef: string): Promise<Maybe<ApprovalDetails | null>> => {
    const r = await maybe(omniCall.get<{ details: ApprovalDetails | null }>(`${approvalPath(idOrRef)}/details`));
    return r.available ? { available: true, data: r.data?.details ?? null } : r;
  },
  /** The latest rejected request for one target, or null. */
  lastRejected: async (target: string): Promise<Approval | null> => {
    const r = await approvalsApi.list({ status: "REJECTED", target, size: 1 });
    return r.available ? r.data.items[0] ?? null : null;
  },
  /** Ask again after a REJECTED, FAILED or CANCELLED request: the new PENDING request. */
  resubmit: (idOrRef: string, reason?: string) =>
    orUnavailable(omniCall.post<Approval>(`${approvalPath(idOrRef)}/resubmit`, withReason(reason)), APPROVALS_NOT_AVAILABLE),
  summary: (): Promise<Maybe<ApprovalsSummary>> => maybe(omniCall.get<ApprovalsSummary>(`${APPROVALS_PATH}/summary`)),
  /** By id or reference; null when it is not this institution's. */
  one: async (idOrRef: string): Promise<Approval | null> => {
    const r = await maybe(omniCall.get<Approval>(approvalPath(idOrRef)));
    return r.available ? r.data : null;
  },
  approve: (idOrRef: string, note?: string) =>
    orUnavailable(omniCall.post<Approval>(`${approvalPath(idOrRef)}/approve`, note ? { note } : {}), APPROVALS_NOT_AVAILABLE),
  reject: (idOrRef: string, note: string) =>
    orUnavailable(omniCall.post<Approval>(`${approvalPath(idOrRef)}/reject`, { note }), APPROVALS_NOT_AVAILABLE),
  cancel: (idOrRef: string) => orUnavailable(omniCall.post<Approval>(`${approvalPath(idOrRef)}/cancel`, {}), APPROVALS_NOT_AVAILABLE),
};

/** A 202 answer is { approval }; anything else is the record, applied. */
function stagedFrom<T>(status: number, data: unknown): Staged<T> {
  if (status === 202 && data && typeof data === "object" && "approval" in data) return { approval: (data as { approval: Approval }).approval };
  return { applied: data as T };
}

/** POST a controlled write. */
export async function controlledPost<T>(path: string, body: unknown): Promise<Staged<T>> {
  const { status, data } = await omniCall.postWithStatus<unknown>(path, body);
  return stagedFrom<T>(status, data);
}

/** PUT a controlled write. */
export async function controlledPut<T>(path: string, body: unknown): Promise<Staged<T>> {
  const { status, data } = await omniCall.putWithStatus<unknown>(path, body);
  return stagedFrom<T>(status, data);
}

/** `{ reason }` when one was typed, to spread into a controlled write's body. */
export const withReason = (reason: string | null | undefined) => (reason?.trim() ? { reason: reason.trim() } : {});
