import type { ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "../../../ui";

export function Check({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <Badge tone={ok ? "success" : "danger"}>
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {ok ? yes : no}
    </Badge>
  );
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5">
      <dt className="text-text-soft">{k}</dt>
      <dd className="tabular text-right text-text">{v}</dd>
    </div>
  );
}

/** The plain table these panels share (as on the farmer page). */
export function MiniTable({ head, children, testId, caption }: { head: { label: string; right?: boolean }[]; children: ReactNode; testId?: string; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
      <table className="w-full text-[13px]" data-testid={testId}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface-sunken text-left text-[12px] text-text-soft">
          <tr>
            {head.map((h) => (
              <th key={h.label} scope="col" className={`px-3 py-2 font-medium ${h.right ? "text-right" : ""}`}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
