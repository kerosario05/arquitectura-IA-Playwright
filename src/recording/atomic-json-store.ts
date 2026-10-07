import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

/** Replace complete JSON without opening/truncating the current recording file. */
export function writeRecordingJson(file: string, value: unknown): void {
  const content = JSON.stringify(value, null, 2);
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  const transientCodes = new Set(["EBUSY", "EPERM", "EACCES", "UNKNOWN"]);
  const retryDelayMs = [20, 50, 100, 200, 400];
  try {
    fs.writeFileSync(temporaryFile, content, { encoding: "utf8", flag: "wx" });
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(temporaryFile, file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (attempt >= retryDelayMs.length || !transientCodes.has(code)) throw error;
        // Windows scanners/readers can briefly deny replacement of an existing trace.json.
        // Immediate retries often hit the same lock; wait briefly while preserving the old
        // complete file and the same atomic-rename strategy.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs[attempt]);
      }
    }
  } finally {
    // Cleanup must never conceal the original filesystem failure.
    try { fs.unlinkSync(temporaryFile); } catch { /* renamed or unavailable */ }
  }
}
