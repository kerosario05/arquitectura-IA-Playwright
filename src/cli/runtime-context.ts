import fs from "node:fs/promises";
import type { DataContextEntry } from "../data/data-context";

export type RuntimeContext = Record<string, DataContextEntry[]>;

/** Load only the case-scoped runtime data needed by promoted execution. */
export async function loadRuntimeContextFromPath(
  contextPath: string | undefined,
): Promise<RuntimeContext | undefined> {
  if (!contextPath) return undefined;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(contextPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("runtime_context_invalid");
    }
    for (const entries of Object.values(parsed as Record<string, unknown>)) {
      if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== "object" || typeof (entry as DataContextEntry).key !== "string")) {
        throw new Error("runtime_context_invalid");
      }
    }
    return parsed as RuntimeContext;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    if (error instanceof Error && error.message === "runtime_context_invalid") throw error;
    throw new Error("runtime_context_unreadable");
  }
}

export function resolveRuntimeEntriesForCase(
  context: RuntimeContext | undefined,
  caseId: number,
): DataContextEntry[] | undefined {
  if (!context) return undefined;
  const entries = context[String(caseId)];
  return Array.isArray(entries) && entries.length > 0 ? entries : undefined;
}
