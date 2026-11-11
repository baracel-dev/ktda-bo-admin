/* Omnichannel's cash-in reconciliation (reconciliationContract.ts). */
import { omniCall, OmniApiError, type Page } from "./omniApi";
import { maybe, type Maybe } from "./omniMaybe";
import { STAFF_FORBIDDEN } from "./staffContract";
import {
  FORBIDDEN_MESSAGE, RECONCILIATION_PATH,
  type ReconciliationLine, type ReconciliationOutcome, type ReconciliationRun,
} from "./reconciliationContract";

const run = (id: string) => `${RECONCILIATION_PATH}/runs/${encodeURIComponent(id)}`;

/** A refusal for want of act:reconciliation.run reads as a permission message. */
async function permitted<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (e instanceof OmniApiError && e.status === 403 && e.code === STAFF_FORBIDDEN) throw new Error(FORBIDDEN_MESSAGE);
    throw e;
  }
}

export const reconciliationApi = {
  /** Newest first; unavailable where this omnichannel has no reconciliation. */
  runs: (): Promise<Maybe<ReconciliationRun[]>> => maybe(omniCall.list<ReconciliationRun>(`${RECONCILIATION_PATH}/runs`)),
  run: (id: string) => omniCall.get<ReconciliationRun>(run(id)),
  lines: (id: string, outcome: ReconciliationOutcome | null, page: number, size: number): Promise<Page<ReconciliationLine>> =>
    omniCall.page<ReconciliationLine>(`${run(id)}/lines${outcome ? `?outcome=${outcome}` : ""}`, page, size),
  /** Upload a statement; `from`/`to` are instants, left out to take the period from the statement. */
  upload: (file: File, period: { from?: string | null; to?: string | null }) => {
    const form = new FormData();
    form.append("file", file);
    if (period.from) form.append("from", period.from);
    if (period.to) form.append("to", period.to);
    return permitted(omniCall.post<ReconciliationRun>(`${RECONCILIATION_PATH}/runs`, form));
  },
  resolve: (id: string, lineId: string, note: string) =>
    permitted(omniCall.post<ReconciliationLine>(`${run(id)}/lines/${encodeURIComponent(lineId)}/resolve`, { note })),
  template: () => omniCall.download(`${RECONCILIATION_PATH}/template.csv`, "cash-in-statement-template.csv", "text/csv"),
  exceptions: (id: string) => omniCall.download(`${run(id)}/exceptions.csv`, `reconciliation-${id}-exceptions.csv`, "text/csv"),
};
