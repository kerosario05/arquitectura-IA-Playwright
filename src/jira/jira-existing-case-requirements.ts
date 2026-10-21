import path from "node:path";
import { loadAutomationIndex } from "../automations/automation-index";
import { loadPromotedDataManifestSync } from "../data/promoted-data";
import type { JiraScenarioInput } from "./jira-semantic-executor";

// Same normalization as the runtime (discovery-batch-runner normalizeRuntimeKey).
const canonicalKey = (key: string) => key.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Per-requirement effective values for the preflight: explicit (request) values win over
 * DB-confirmed ones; keys match by runtime normalization. Returns values keyed by the
 * requirement key. Confirmed rows are scoped by project + TestRail case id. Never logs values.
 */
export async function resolveExistingJiraCaseValues(
  appSlug: string,
  scenarios: JiraScenarioInput[],
  explicitByCase: Record<string, Record<string, string>>,
  deps: {
    resolveProject?: (slug: string) => Promise<{ id: string } | null | undefined>;
    loadValues?: (projectId: string, caseId: number) => Promise<Array<{ key: string; value: unknown }>>;
  } = {},
): Promise<Record<string, Record<string, string>>> {
  let projectId: string | undefined;
  try {
    const resolveProject = deps.resolveProject ?? (async (slug: string) => (await import("../db/project-repository")).getProjectBySlug(slug));
    projectId = (await resolveProject(appSlug))?.id;
  } catch { /* DB unavailable: explicit/profile values only, like the runner */ }
  const out: Record<string, Record<string, string>> = {};
  for (const scenario of scenarios) {
    const caseId = Number(scenario.scenarioId);
    const explicit = explicitByCase[scenario.scenarioId] ?? {};
    const byKey = new Map<string, string>();
    if (projectId && Number.isSafeInteger(caseId) && caseId > 0) {
      try {
        const loadValues = deps.loadValues ?? (async (id: string, cid: number) => (await import("../db/project-case-runtime-value-service")).getConfirmedRuntimeValues(id, cid));
        for (const row of await loadValues(projectId, caseId)) {
          const value = String(row.value ?? "").trim() ? String(row.value) : "";
          if (value && !byKey.has(canonicalKey(row.key))) byKey.set(canonicalKey(row.key), value);
        }
      } catch { /* optional store */ }
    }
    for (const [key, value] of Object.entries(explicit)) if (String(value ?? "").trim()) byKey.set(canonicalKey(key), value);
    const values: Record<string, string> = { ...explicit };
    for (const req of scenario.inputRequirements ?? []) {
      if (String(values[req.key] ?? "").trim()) continue;
      const match = byKey.get(canonicalKey(req.key));
      if (match) values[req.key] = match;
    }
    out[scenario.scenarioId] = values;
  }
  return out;
}

/**
 * Build validation scenarios for existing TestRail cases linked to a Jira-generated automation.
 * Requirements come from the promoted-data manifest (key/label/required metadata only); the
 * manifest's masked value is never read. Cases without Jira lineage are skipped.
 */
export async function buildExistingJiraCaseScenarios(appSlug: string, caseIds: number[]): Promise<JiraScenarioInput[]> {
  if (!appSlug || caseIds.length === 0) return [];
  const index = await loadAutomationIndex(path.join("automations", "apps", appSlug, "index.json")).catch(() => undefined);
  const scenarios: JiraScenarioInput[] = [];
  for (const caseId of caseIds) {
    const entry = index?.automations.find((candidate) => candidate.caseId === caseId && candidate.tags?.includes("jira_generated"));
    if (!entry) continue;
    const manifest = loadPromotedDataManifestSync(path.join(path.dirname(path.resolve(entry.specPath.replace(/[\\/]+/g, path.sep))), "promoted-data.json"));
    const inputRequirements = (manifest?.entries ?? [])
      // A persisted real `value` is what the spec runtime falls back to; `maskedValue` is not a value.
      .filter((item) => item.required === true && item.key?.trim() && !item.value?.trim())
      .map((item) => ({ key: item.key, label: item.fieldName?.trim() || item.key, stepIndex: item.stepIndex, required: true }));
    scenarios.push({
      scenarioId: String(caseId),
      title: entry.title,
      sourceIssueKey: entry.externalId ?? "",
      steps: [],
      expectedResult: "",
      appSlug,
      inputRequirements: inputRequirements as JiraScenarioInput["inputRequirements"],
    });
  }
  return scenarios;
}
