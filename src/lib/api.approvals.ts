/* Omnichannel's approvals queue (maker-checker), and the helpers the
 * controlled writes use to tell "applied" from "sent for approval". See
 * approvalsContract.ts. */
import { omniCall, type Page } from "./omniApi";
import { maybe, orUnavailable, type Maybe } from "./omniMaybe";
import {
  APPROVALS_PATH, approvalPath,
  type Approval, type ApprovalStatus, type ApprovalsSummary, type ApprovalType, type Staged,
} from "./approvalsContract";

export const APPROVALS_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here has no approvals queue.";

export type ApprovalsQuery = { status: ApprovalStatus; type?: ApprovalType | null; page?: number; size?: number };

export const approvalsApi = {
  list: ({ status, type, page = 1, size = 20 }: ApprovalsQuery): Promise<Maybe<Page<Approval>>> => {
    const p = new URLSearchParams({ status });
    if (type) p.set("type", type);
    return maybe(omniCall.page<Approval>(`${APPROVALS_PATH}?${p}`, page, size));
  },
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
