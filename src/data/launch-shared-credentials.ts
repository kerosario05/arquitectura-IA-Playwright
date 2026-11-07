import fs from "node:fs";
import { detectCredentialRole } from "./data-key-resolver";

/**
 * One launch usually logs in with one account, but the wizard only asks for the credentials in some cases' forms.
 * A case that resolved its credentials publishes them next to the job's runtime-context file; a later case of the SAME
 * job whose login steps have no value reuses them. Only username/password are shared, and only while every case that
 * published a role agreed on its value: a disagreement means "different accounts per case", so nothing is shared.
 * The file lives and dies with the runtime-context file (same job, mode 0600).
 */
const SHARED_ROLES = { username: "auth.username", password: "auth.password" } as const;
type Shared = Partial<Record<keyof typeof SHARED_ROLES, string | null>>;
type Entry = { key: string; value: string; source?: string; sensitive?: boolean };

export const sharedCredentialsPath = (contextPath: string): string => `${contextPath}.shared-credentials.json`;

function read(path: string): Shared {
  try { return JSON.parse(fs.readFileSync(path, "utf-8")) as Shared; } catch { return {}; }
}

export function publishLaunchCredentials(contextPath: string | undefined, entries: readonly Entry[] | undefined): void {
  if (!contextPath || !entries?.length) return;
  const file = sharedCredentialsPath(contextPath);
  const shared = read(file);
  let changed = false;
  for (const [role, key] of Object.entries(SHARED_ROLES) as [keyof typeof SHARED_ROLES, string][]) {
    const found = entries.find((e) => e.key.toLowerCase() === key && typeof e.value === "string" && e.value.trim() !== "");
    if (!found) continue;
    const next = shared[role] === undefined || shared[role] === found.value ? found.value : null;
    if (shared[role] !== next) { shared[role] = next; changed = true; }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(shared), { encoding: "utf-8", mode: 0o600 });
}

/** Adds the shared credential for each login field of `steps` that has no value of its own. */
export function fillMissingLaunchCredentials<T extends Entry>(
  contextPath: string | undefined,
  entries: readonly T[] | undefined,
  steps: ReadonlyArray<{ label?: string; actionType?: string }>,
): T[] | undefined {
  if (!contextPath) return entries as T[] | undefined;
  const shared = read(sharedCredentialsPath(contextPath));
  const added: T[] = [];
  for (const step of steps) {
    if (step.actionType && step.actionType !== "action_fill") continue;
    const role = detectCredentialRole(step.label ?? "");
    if (role !== "username" && role !== "password") continue;
    const key = SHARED_ROLES[role];
    const value = shared[role];
    const has = [...(entries ?? []), ...added].some((e) => e.key.toLowerCase() === key && String(e.value ?? "").trim() !== "");
    if (has || !value) continue;
    added.push({ key, value, source: "user_provided_qa_credentials", sensitive: true } as T);
  }
  return added.length ? [...(entries ?? []), ...added] : entries as T[] | undefined;
}

export function deleteSharedCredentials(contextPath: string): void {
  try { fs.unlinkSync(sharedCredentialsPath(contextPath)); } catch { /* absent */ }
}
