/* Runs the SAP file check in a worker (sapPaymentCheck.worker.ts) and hands
 * back its result; `cancel` stops it (a different file was picked, or the
 * page was left). */
import type { SapCheckMessage, SapCheckProgress, SapCheckRequest } from "./sapPaymentCheck.worker";
import type { SapCheckResult } from "./sapPaymentFile";

export type { SapCheckProgress };
export type SapCheckDone = { result: SapCheckResult; sha256: string | null; ms: number; bytes: number };

export function checkSapFile(file: File, onProgress: (p: SapCheckProgress) => void): { done: Promise<SapCheckDone>; cancel: () => void } {
  const worker = new Worker(new URL("./sapPaymentCheck.worker.ts", import.meta.url), { type: "module" });
  let settle: ((err: Error | null, v?: SapCheckDone) => void) | null = null;
  const done = new Promise<SapCheckDone>((resolve, reject) => {
    settle = (err, v) => {
      settle = null;
      worker.terminate();
      if (err) reject(err);
      else resolve(v!);
    };
  });
  worker.onmessage = (e: MessageEvent<SapCheckMessage>) => {
    const m = e.data;
    if (m.type === "progress") onProgress(m.progress);
    else if (m.type === "done") settle?.(null, { result: m.result, sha256: m.sha256, ms: m.ms, bytes: m.bytes });
    else settle?.(new Error(m.message));
  };
  worker.onerror = (e) => {
    e.preventDefault();
    settle?.(new Error("The file check stopped unexpectedly. Pick the file again."));
  };
  worker.postMessage({ file } satisfies SapCheckRequest);
  return {
    done,
    cancel: () => settle?.(new Error("cancelled")),
  };
}
