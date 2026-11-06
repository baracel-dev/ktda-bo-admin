import { useCallback, useEffect, useRef, useState } from "react";
import { checkSapFile, type SapCheckDone, type SapCheckProgress } from "../../../lib/sapPaymentCheck";
import { parseControlSheet, type ControlSheet } from "../../../lib/sapPaymentFile";

export type SapCheckState =
  | { kind: "idle" }
  | { kind: "checking"; file: File; progress: SapCheckProgress | null }
  | { kind: "done"; file: File; done: SapCheckDone }
  | { kind: "error"; file: File; message: string };

/** The in-browser check of one SAP file. A new start (or leaving the page)
 *  stops the one before, so a slow 600k check never lands on a newer file. */
export function useSapCheck() {
  const [state, setState] = useState<SapCheckState>({ kind: "idle" });
  const job = useRef<{ cancel: () => void } | null>(null);

  const stop = useCallback(() => {
    job.current?.cancel();
    job.current = null;
  }, []);

  const start = useCallback((file: File) => {
    stop();
    setState({ kind: "checking", file, progress: null });
    const mine = checkSapFile(file, (progress) => {
      if (job.current === mine) setState({ kind: "checking", file, progress });
    });
    job.current = mine;
    mine.done.then(
      (done) => {
        if (job.current !== mine) return;
        job.current = null;
        setState({ kind: "done", file, done });
      },
      (e: unknown) => {
        if (job.current !== mine) return;
        job.current = null;
        setState({ kind: "error", file, message: e instanceof Error ? e.message : "The file could not be checked." });
      },
    );
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setState({ kind: "idle" });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, start, reset };
}

export type ControlState = { kind: "none" } | { kind: "reading"; name: string } | { kind: "ok"; name: string; sheet: ControlSheet } | { kind: "error"; name: string; message: string };

/** The optional control sheet (<file>.control.json) SAP sends with the file. */
export function useControlSheet() {
  const [state, setState] = useState<ControlState>({ kind: "none" });
  const latest = useRef<File | null>(null);
  const pick = useCallback(async (f: File | null) => {
    latest.current = f;
    if (!f) return setState({ kind: "none" });
    setState({ kind: "reading", name: f.name });
    try {
      const sheet = parseControlSheet(await f.text());
      if (latest.current === f) setState({ kind: "ok", name: f.name, sheet });
    } catch (e) {
      if (latest.current === f) setState({ kind: "error", name: f.name, message: e instanceof Error ? e.message : "The control sheet could not be read." });
    }
  }, []);
  return { state, pick };
}
