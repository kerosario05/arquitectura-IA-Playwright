import fs from "node:fs";
import path from "node:path";

/**
 * Stock of cédulas prepared ahead of time (scripts/prepare-ready-cedulas.ts): each one has a current
 * master date and was approved by the credit engine. The generator hands these out first. A handed-out
 * cédula is held for a while so two people do not receive the same one at once; after the hold it
 * returns to the pool (the Oracle "already a customer" check still removes any that became customers).
 */
export type ReadyState = { approved: string[]; approvedAt?: Record<string, string>; startedAt?: string };
type Taken = Record<string, string>;

const root = () => path.join(process.cwd(), ".artifacts");
export const READY_STATE_FILE = () => path.join(root(), "data-cedulas-ready.json");
export const READY_TAKEN_FILE = () => path.join(root(), "data-cedulas-taken.json");
/** Cédulas that became customers: out of the stock for good. Kept apart from the state file so a running prepare
 * script (which rewrites that file) can never bring them back. */
export const READY_USED_FILE = () => path.join(root(), "data-cedulas-used.json");

export function readUsedReadyCedulas(file = READY_USED_FILE()): Set<string> {
  return new Set(Object.keys(readJson<Record<string, string>>(file, {})));
}

export function markReadyCedulasUsed(ids: string[], options: { now?: Date; usedFile?: string } = {}): void {
  if (ids.length === 0) return;
  const file = options.usedFile ?? READY_USED_FILE();
  const used = readJson<Record<string, string>>(file, {});
  for (const id of ids) used[id.replace(/\D/g, "")] = (options.now ?? new Date()).toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(used));
}

/** How many prepared cédulas are still in the stock (approved and not used). */
export function readyStockCount(stateFile = READY_STATE_FILE(), usedFile = READY_USED_FILE()): number {
  const used = readUsedReadyCedulas(usedFile);
  return (readJson<ReadyState>(stateFile, { approved: [] }).approved ?? []).filter((id) => !used.has(id.replace(/\D/g, ""))).length;
}

export function dataCedulasReadyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DATA_CEDULAS_USE_READY?.trim().toLowerCase() !== "false";
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** A prepared cédula stays valid this long: the Portal trusts the stored data while the master date is recent. */
export function dataCedulasReadyMaxAgeDays(env: NodeJS.ProcessEnv = process.env): number {
  return numberEnv(env.DATA_CEDULAS_READY_MAX_AGE_DAYS, 25);
}

export function dataCedulasReadyHoldMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return numberEnv(env.DATA_CEDULAS_READY_HOLD_MINUTES, 120);
}

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

/** Ids that can be handed out now, in random order. */
export function listReadyCedulas(options: {
  excluded?: string[];
  now?: Date;
  maxAgeDays?: number;
  holdMinutes?: number;
  stateFile?: string;
  takenFile?: string;
  usedFile?: string;
  random?: () => number;
}): string[] {
  const now = (options.now ?? new Date()).getTime();
  const state = readJson<ReadyState>(options.stateFile ?? READY_STATE_FILE(), { approved: [] });
  const taken = readJson<Taken>(options.takenFile ?? READY_TAKEN_FILE(), {});
  const maxAgeMs = (options.maxAgeDays ?? dataCedulasReadyMaxAgeDays()) * 86_400_000;
  const holdMs = (options.holdMinutes ?? dataCedulasReadyHoldMinutes()) * 60_000;
  const excluded = new Set([...(options.excluded ?? []).map((id) => id.replace(/\D/g, "")), ...readUsedReadyCedulas(options.usedFile)]);
  const fallbackApprovedAt = state.startedAt ? Date.parse(state.startedAt) : now;
  const usable = (state.approved ?? []).filter((id) => {
    const key = id.replace(/\D/g, "");
    if (!key || excluded.has(key)) return false;
    const approvedAt = Date.parse(state.approvedAt?.[id] ?? "") || fallbackApprovedAt;
    if (now - approvedAt > maxAgeMs) return false;
    const heldAt = Date.parse(taken[key] ?? "");
    return !(Number.isFinite(heldAt) && now - heldAt < holdMs);
  });
  const random = options.random ?? Math.random;
  for (let i = usable.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [usable[i], usable[j]] = [usable[j], usable[i]];
  }
  return usable;
}

/** Records the hand-out; drops holds that already expired so the file stays small. */
export function holdReadyCedulas(ids: string[], options: { now?: Date; holdMinutes?: number; takenFile?: string } = {}): void {
  const file = options.takenFile ?? READY_TAKEN_FILE();
  const now = options.now ?? new Date();
  const holdMs = (options.holdMinutes ?? dataCedulasReadyHoldMinutes()) * 60_000;
  const taken = readJson<Taken>(file, {});
  for (const [key, at] of Object.entries(taken)) if (now.getTime() - Date.parse(at) >= holdMs) delete taken[key];
  for (const id of ids) taken[id.replace(/\D/g, "")] = now.toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(taken));
}
