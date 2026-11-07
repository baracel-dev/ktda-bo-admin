/* This institution's field agents on omnichannel's operator API (scoped by
 * the proxy). See merchantsAgentsContract.ts. Where this environment's
 * omnichannel does not have them, a list or summary answers
 * `{ available: false }` and a write throws AGENTS_NOT_AVAILABLE. */
import { OmniApiError, omniCall, type Page } from "./omniApi";
import { maybe, orUnavailable, type Maybe } from "./omniMaybe";
import { controlledPost, withReason } from "./api.approvals";
import type { Staged } from "./approvalsContract";
import {
  AGENTS_PATH, AGENTS_SUMMARY_PATH, PAGE_MAX, agentPath,
  type Agent, type AgentActivity, type AgentStatus, type AgentsSummary, type RecordActivity, type RegisterAgent, type TopUp,
} from "./merchantsAgentsContract";

export const AGENTS_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here does not have agents.";

export type AgentsQuery = { status?: AgentStatus | null; q?: string; page?: number; size?: number };

export const agentsApi = {
  list: ({ status, q, page = 1, size = 20 }: AgentsQuery = {}): Promise<Maybe<Page<Agent>>> => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q?.trim()) p.set("q", q.trim());
    const qs = p.toString();
    return maybe(omniCall.page<Agent>(`${AGENTS_PATH}${qs ? `?${qs}` : ""}`, page, Math.min(size, PAGE_MAX)));
  },
  summary: (): Promise<Maybe<AgentsSummary>> => maybe(omniCall.get<AgentsSummary>(AGENTS_SUMMARY_PATH)),
  /** One agent, or null when the number is not this institution's. */
  one: async (agentNo: string): Promise<Agent | null> => {
    try {
      return await omniCall.get<Agent>(agentPath(agentNo));
    } catch (e) {
      if (e instanceof OmniApiError && e.status === 404) return null;
      throw e;
    }
  },
  activities: (agentNo: string, page: number, size = 20): Promise<Page<AgentActivity>> =>
    orUnavailable(omniCall.page<AgentActivity>(`${agentPath(agentNo)}/activities`, page, Math.min(size, PAGE_MAX)), AGENTS_NOT_AVAILABLE),
  register: (body: RegisterAgent) => orUnavailable(omniCall.post<Agent>(AGENTS_PATH, body), AGENTS_NOT_AVAILABLE),
  /* The three below are sent for approval (202). Suspend's reason is both why
     the agent is suspended and the request's reason. */
  suspend: (agentNo: string, reason: string): Promise<Staged<Agent>> =>
    orUnavailable(controlledPost<Agent>(`${agentPath(agentNo)}/suspend`, { reason }), AGENTS_NOT_AVAILABLE),
  reinstate: (agentNo: string, reason?: string): Promise<Staged<Agent>> =>
    orUnavailable(controlledPost<Agent>(`${agentPath(agentNo)}/reinstate`, withReason(reason)), AGENTS_NOT_AVAILABLE),
  topUp: (agentNo: string, body: TopUp & { reason?: string }): Promise<Staged<Agent>> =>
    orUnavailable(controlledPost<Agent>(`${agentPath(agentNo)}/float/top-up`, body), AGENTS_NOT_AVAILABLE),
  /** Answers the activity recorded (the agent's float is read again after). */
  record: (agentNo: string, body: RecordActivity) =>
    orUnavailable(omniCall.post<AgentActivity>(`${agentPath(agentNo)}/activities`, body), AGENTS_NOT_AVAILABLE),
};
