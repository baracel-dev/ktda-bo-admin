/* This institution's field agents. On KTDA they are the channel-api's agents,
 * the ones the agent app signs in as, through omnichannel's passthrough
 * /ktda/agents (same shapes as below, plus `source: "channel"`). Where this
 * omnichannel has no passthrough (404/405/501 on it), the page falls back to
 * omnichannel's own register /agents, as before. Which one is decided once per
 * page load and every call follows it, so a write never lands in the other
 * store. See merchantsAgentsContract.ts.
 *
 * Where neither is available, a list or summary answers `{ available: false }`
 * and a write throws AGENTS_NOT_AVAILABLE. When the channel-api does not
 * answer, omnichannel says 503 and the page shows the error with a retry. */
import { OmniApiError, omniCall, type Page } from "./omniApi";
import { maybe, missingEndpoint, orUnavailable, type Maybe } from "./omniMaybe";
import { controlledPost, withReason } from "./api.approvals";
import type { Staged } from "./approvalsContract";
import {
  AGENTS_PATH, CHANNEL_AGENTS_PATH, PAGE_MAX,
  type Agent, type AgentActivity, type AgentStatus, type AgentsSummary, type RecordActivity, type RegisterAgent, type TopUp,
} from "./merchantsAgentsContract";

export const AGENTS_NOT_AVAILABLE = "Not available on this environment yet: omnichannel here does not have agents.";
export const RECORDED_IN_APP = "Cash in, cash out and onboarding are recorded by the agent in the agent app.";

/** Where the agents come from: the channel-api (the agent app's register) or omnichannel's own. */
export type AgentSource = "channel" | "register";

let resolved: Promise<AgentSource> | null = null;

/** Decided once per page load by asking for the channel's counts: missing
 *  there means this omnichannel has no passthrough. Any other failure is not
 *  remembered, so a retry asks again. */
function source(): Promise<AgentSource> {
  if (!resolved) {
    resolved = omniCall.get<AgentsSummary>(`${CHANNEL_AGENTS_PATH}/summary`).then(
      () => "channel" as const,
      (e: unknown) => {
        if (missingEndpoint(e)) return "register" as const;
        resolved = null;
        throw e;
      },
    );
  }
  return resolved;
}

const base = async () => ((await source()) === "channel" ? CHANNEL_AGENTS_PATH : AGENTS_PATH);
const pathOf = async (agentNo: string) => `${await base()}/${encodeURIComponent(agentNo)}`;

export type AgentsQuery = { status?: AgentStatus | null; q?: string; page?: number; size?: number };

export const agentsApi = {
  source,
  list: ({ status, q, page = 1, size = 20 }: AgentsQuery = {}): Promise<Maybe<Page<Agent>>> => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q?.trim()) p.set("q", q.trim());
    const qs = p.toString();
    return maybe((async () => omniCall.page<Agent>(`${await base()}${qs ? `?${qs}` : ""}`, page, Math.min(size, PAGE_MAX)))());
  },
  summary: (): Promise<Maybe<AgentsSummary>> => maybe((async () => omniCall.get<AgentsSummary>(`${await base()}/summary`))()),
  /** One agent, or null when the number is not this institution's. */
  one: async (agentNo: string): Promise<Agent | null> => {
    try {
      return await omniCall.get<Agent>(await pathOf(agentNo));
    } catch (e) {
      if (e instanceof OmniApiError && e.status === 404) return null;
      throw e;
    }
  },
  /** Omnichannel's own register only: a channel agent's activity is in the
   *  agent app, so on the channel this is an empty page (the page says why). */
  activities: async (agentNo: string, page: number, size = 20): Promise<Page<AgentActivity>> => {
    if ((await source()) === "channel") return { items: [], page: 1, pages: 1, total: 0 };
    return orUnavailable(omniCall.page<AgentActivity>(`${await pathOf(agentNo)}/activities`, page, Math.min(size, PAGE_MAX)), AGENTS_NOT_AVAILABLE);
  },
  register: async (body: RegisterAgent) => orUnavailable(omniCall.post<Agent>(await base(), body), AGENTS_NOT_AVAILABLE),
  /* The three below are sent for approval (202). Suspend's reason is both why
     the agent is suspended and the request's reason. */
  suspend: async (agentNo: string, reason: string): Promise<Staged<Agent>> =>
    orUnavailable(controlledPost<Agent>(`${await pathOf(agentNo)}/suspend`, { reason }), AGENTS_NOT_AVAILABLE),
  reinstate: async (agentNo: string, reason?: string): Promise<Staged<Agent>> =>
    orUnavailable(controlledPost<Agent>(`${await pathOf(agentNo)}/reinstate`, withReason(reason)), AGENTS_NOT_AVAILABLE),
  topUp: async (agentNo: string, body: TopUp & { reason?: string }): Promise<Staged<Agent>> =>
    orUnavailable(controlledPost<Agent>(`${await pathOf(agentNo)}/float/top-up`, body), AGENTS_NOT_AVAILABLE),
  /** Omnichannel's own register only (a channel agent records in the agent
   *  app). Answers the activity recorded (the agent's float is read again after). */
  record: async (agentNo: string, body: RecordActivity) => {
    if ((await source()) === "channel") throw new OmniApiError(501, RECORDED_IN_APP);
    return orUnavailable(omniCall.post<AgentActivity>(`${await pathOf(agentNo)}/activities`, body), AGENTS_NOT_AVAILABLE);
  },
};
