/* Checks a SAP payment file off the main thread (sapPaymentFile.ts): the
 * SHA-256 first (for the control sheet, and so the operator sees the digest
 * omnichannel will match a repeat file on), then the file streamed line by
 * line. Memory stays at one chunk plus the exception report, whatever the
 * file size. Nothing is sent anywhere from here. */
import { LineSplitter, toHex } from "./file-rules";
import { SapFileChecker, type SapCheckResult } from "./sapPaymentFile";

export type SapCheckRequest = { file: File };
export type SapCheckProgress = { stage: "hashing" | "checking"; lines: number; bytes: number; total: number };
export type SapCheckMessage =
  | { type: "progress"; progress: SapCheckProgress }
  | { type: "done"; result: SapCheckResult; sha256: string | null; ms: number; bytes: number }
  | { type: "error"; message: string };

const ctx = self as unknown as { postMessage: (m: SapCheckMessage) => void; onmessage: ((e: MessageEvent<SapCheckRequest>) => void) | null };

ctx.onmessage = async (e) => {
  const { file } = e.data;
  const t0 = performance.now();
  const progress: SapCheckProgress = { stage: "hashing", lines: 0, bytes: 0, total: file.size };
  try {
    ctx.postMessage({ type: "progress", progress: { ...progress } });
    // WebCrypto has no streaming digest; 85 MB hashes in well under a second.
    // Only on secure pages (https, localhost): elsewhere the checksum is "not checked".
    const sha256 = globalThis.crypto?.subtle ? toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))) : null;

    progress.stage = "checking";
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    const splitter = new LineSplitter();
    const checker = new SapFileChecker();
    let next = 25_000;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      progress.bytes += value.length;
      for (const line of splitter.feed(value)) checker.feed(line);
      if (checker.lineCount >= next) {
        next += 25_000;
        progress.lines = checker.lineCount;
        ctx.postMessage({ type: "progress", progress: { ...progress } });
      }
    }
    const tail = splitter.end();
    if (tail !== null) checker.feed(tail);
    const result = checker.result();
    ctx.postMessage({ type: "done", result, sha256, ms: Math.round(performance.now() - t0), bytes: file.size });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
