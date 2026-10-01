import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

/** Replace complete JSON without opening/truncating the current recording file. */
export function writeRecordingJson(file: string, value: unknown): void {
  const content = JSON.stringify(value, null, 2);
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  const transientCodes = new Set(["EBUSY", "EPERM", "EACCES", "UNKNOWN"]);
  try {
    fs.writeFileSync(temporaryFile, content, { encoding: "utf8", flag: "wx" });
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(temporaryFile, file);
        return;
      } catch (error) {
        if (attempt >= 2 || !transientCodes.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
  } finally {
    // Cleanup must never conceal the original filesystem failure.
    try { fs.unlinkSync(temporaryFile); } catch { /* renamed or unavailable */ }
  }
}
