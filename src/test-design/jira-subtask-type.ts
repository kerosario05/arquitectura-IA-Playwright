import type { JiraIssueTypeRef } from "../clients/jira.client";

/**
 * Which sub-task issue type holds a story's test cases.
 *
 * The name differs per Jira project ("Sub-task", "Subtask", "Subtarea", or a
 * dedicated "Plan de pruebas"), so it is read from the project's create metadata
 * instead of hard-coded. Order: the configured name, then "Plan de pruebas",
 * then the generic sub-task. Never an unrelated sub-task type such as "Defecto".
 */

export class SubtaskTypeNotFoundError extends Error {
  constructor(
    public readonly projectKey: string,
    public readonly available: string[],
    configured?: string,
  ) {
    super(
      configured
        ? `El proyecto ${projectKey} no tiene el tipo de sub-tarea "${configured}" (JIRA_TEST_SUBTASK_ISSUE_TYPE). Disponibles: ${available.join(", ") || "ninguno"}`
        : `El proyecto ${projectKey} no tiene un tipo de sub-tarea para casos de prueba. Disponibles: ${available.join(", ") || "ninguno"}. Configura JIRA_TEST_SUBTASK_ISSUE_TYPE.`,
    );
    this.name = "SubtaskTypeNotFoundError";
  }
}

export function normalizeTypeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

const PREFERRED = "plan de pruebas";
const GENERIC = new Set(["sub-task", "subtask", "sub task", "subtarea", "sub-tarea"]);

export function chooseSubtaskType(
  projectKey: string,
  types: JiraIssueTypeRef[],
  configuredName?: string | null,
): JiraIssueTypeRef {
  const byName = (wanted: string) => types.find((t) => normalizeTypeName(t.name) === wanted);
  const configured = configuredName?.trim();
  if (configured) {
    const match = byName(normalizeTypeName(configured));
    if (match) return match;
    throw new SubtaskTypeNotFoundError(projectKey, types.map((t) => t.name), configured);
  }
  const chosen = byName(PREFERRED) ?? types.find((t) => GENERIC.has(normalizeTypeName(t.name)));
  if (!chosen) throw new SubtaskTypeNotFoundError(projectKey, types.map((t) => t.name));
  return chosen;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; type: JiraIssueTypeRef }>();

export async function resolveSubtaskType(
  projectKey: string,
  loadTypes: (projectKey: string) => Promise<JiraIssueTypeRef[]>,
  configuredName: string | null | undefined = process.env.JIRA_TEST_SUBTASK_ISSUE_TYPE,
): Promise<JiraIssueTypeRef> {
  const key = `${projectKey.toUpperCase()}|${configuredName ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.type;
  const type = chooseSubtaskType(projectKey, await loadTypes(projectKey), configuredName);
  cache.set(key, { at: Date.now(), type });
  return type;
}

export function clearSubtaskTypeCache(): void {
  cache.clear();
}
