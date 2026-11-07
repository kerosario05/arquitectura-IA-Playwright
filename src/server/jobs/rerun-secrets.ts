import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Values a person typed in the launch wizard (credentials included) are removed from the job record when the job ends and
 * are never part of the run history or any API response. To let a rerun reuse them without typing everything again, they are
 * stashed here, apart from the history: one file per job, owner-only permissions, never listed by the API, and discarded after
 * a day. Anything older than that is deleted on the next read or start.
 */
export const RERUN_SECRETS_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DIR = path.resolve(process.cwd(), ".artifacts", "tmp", "rerun-secrets");

const safeName = (jobId: string): string => jobId.replace(/[^A-Za-z0-9_-]/g, "_");

export function stashRerunSecrets(jobId: string, entriesByCase: unknown, dir: string = DEFAULT_DIR, now: number = Date.now()): boolean {
  if (!entriesByCase || typeof entriesByCase !== "object" || Array.isArray(entriesByCase)) return false;
  const hasValue = Object.values(entriesByCase as Record<string, unknown>).some((entries) =>
    Array.isArray(entries) && entries.some((entry) => typeof entry?.value === "string" && entry.value !== ""));
  if (!hasValue) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${safeName(jobId)}.json`);
    fs.writeFileSync(target, JSON.stringify({ savedAt: now, entriesByCase }), { encoding: "utf-8", mode: 0o600 });
    try { fs.chmodSync(target, 0o600); } catch { /* Windows ACLs may not expose POSIX modes. */ }
    return true;
  } catch {
    return false;
  }
}

export function loadRerunSecrets(
  jobId: string,
  dir: string = DEFAULT_DIR,
  now: number = Date.now(),
  ttlMs: number = RERUN_SECRETS_TTL_MS,
): Record<string, unknown[]> | undefined {
  const target = path.join(dir, `${safeName(jobId)}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf-8")) as { savedAt?: number; entriesByCase?: Record<string, unknown[]> };
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > ttlMs) {
      fs.rmSync(target, { force: true });
      return undefined;
    }
    return parsed.entriesByCase && typeof parsed.entriesByCase === "object" ? parsed.entriesByCase : undefined;
  } catch {
    return undefined;
  }
}

export function purgeExpiredRerunSecrets(dir: string = DEFAULT_DIR, now: number = Date.now(), ttlMs: number = RERUN_SECRETS_TTL_MS): number {
  let removed = 0;
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const savedAt = (JSON.parse(fs.readFileSync(file, "utf-8")) as { savedAt?: number }).savedAt;
      if (typeof savedAt !== "number" || now - savedAt > ttlMs) { fs.rmSync(file, { force: true }); removed += 1; }
    } catch {
      fs.rmSync(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}
