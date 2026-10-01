import * as fs from "node:fs";
import * as path from "node:path";
import { capTitle, type RecordedScenario } from "./trace-to-scenario";

/**
 * Tells the person reviewing a recording whether each scenario title can stand as a test case:
 * whether another scenario or an already promoted case of the same app carries the same name,
 * and whether the title is only the free text typed before recording ("roque 10", "Prueba").
 *
 * It never renames anything. Two recordings of the same walkthrough get the same observed title
 * on purpose -- they ARE the same case -- and only the person can decide whether one of them is a
 * repeat or needs a more specific name.
 */

export type TitleConflict = {
  source: "recording" | "case";
  title: string;
  /** scenarioId for a recorded scenario, case folder name for a promoted case. */
  id: string;
  recordingId?: string;
};

export type ScenarioTitleReview = {
  scenarioId: string;
  conflicts: TitleConflict[];
  /** The title is the typed goal, not something observed, and says nothing about the case. */
  weak: boolean;
  reasons: Array<"duplicate_title" | "typed_goal_title" | "generic_title">;
};

export type TitleCatalogEntry = TitleConflict & { key: string; sourceScenarioId?: string };

const STOPWORDS = new Set(["el", "la", "los", "las", "de", "del", "en", "un", "una", "y", "a", "al", "por", "para", "con"]);
const GENERIC_TITLE = /^(?:prueba|pruebas|test|testing|demo|ejemplo|caso|escenario|grabacion|recorrido|registro|nuevo|asdf|qwerty)?\s*\d*$/i;

/**
 * Comparison key of a title: accents, case, punctuation and connecting words do not make two
 * names different ("Consulta de préstamo" = "Consulta prestamo"), nor does a verb against its
 * noun ("Consultar tarjeta" = "Consulta tarjeta") or a plural.
 */
export function scenarioTitleKey(title: string): string {
  return title
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 ? word.replace(/(?<=[aei])r$/, "").replace(/(?<=[^s])s$/, "") : word))
    .join(" ");
}

/** Every other scenario title of the app's recordings, plus the titles of its promoted cases. */
export function loadTitleCatalog(appSlug: string, appsRoot = path.join("automations", "apps")): TitleCatalogEntry[] {
  const appDir = path.join(appsRoot, appSlug);
  const entries: TitleCatalogEntry[] = [];

  const recordingsDir = path.join(appDir, "recordings");
  for (const recordingId of safeReaddir(recordingsDir)) {
    // Read directly: only titles are needed, and the store logs every load, which for a catalog
    // of every recording on each request would flood the engine log.
    const stored = readJson(path.join(recordingsDir, recordingId, "scenarios.json"));
    const scenarios = (Array.isArray(stored) ? stored : Array.isArray(stored?.scenarios) ? stored.scenarios : []) as RecordedScenario[];
    for (const scenario of scenarios) {
      if (typeof scenario?.title !== "string" || !scenario.title.trim() || typeof scenario.scenarioId !== "string") continue;
      entries.push({ source: "recording", id: scenario.scenarioId, title: scenario.title, recordingId, key: scenarioTitleKey(scenario.title) });
    }
  }

  const caseDirs = [
    ...safeReaddir(path.join(appDir, "sections")).map((section) => path.join(appDir, "sections", section, "cases")),
    path.join(appDir, "cases"),
  ];
  for (const casesDir of caseDirs) {
    for (const caseName of safeReaddir(casesDir)) {
      const meta = readJson(path.join(casesDir, caseName, "case.meta.json"));
      const title = typeof meta?.title === "string" ? meta.title.trim() : "";
      if (!title) continue;
      entries.push({
        source: "case",
        id: caseName,
        title,
        key: scenarioTitleKey(title),
        ...(typeof meta?.sourceScenarioId === "string" ? { sourceScenarioId: meta.sourceScenarioId } : {}),
      });
    }
  }
  return entries;
}

export function reviewScenarioTitles(
  scenarios: readonly RecordedScenario[],
  catalog: readonly TitleCatalogEntry[],
): Record<string, ScenarioTitleReview> {
  const reviews: Record<string, ScenarioTitleReview> = {};
  for (const scenario of scenarios) {
    const key = scenarioTitleKey(scenario.title ?? "");
    const conflicts = key
      ? catalog
        .filter((entry) => entry.key === key)
        // The scenario itself, and the case promoted from it, are not a second case.
        .filter((entry) => entry.id !== scenario.scenarioId && entry.sourceScenarioId !== scenario.scenarioId)
        .map(({ source, title, id, recordingId }) => ({ source, title, id, ...(recordingId ? { recordingId } : {}) }))
      : [];
    const siblings = scenarios
      .filter((other) => other !== scenario && other.scenarioId !== scenario.scenarioId && key && scenarioTitleKey(other.title ?? "") === key)
      .map((other) => ({ source: "recording" as const, title: other.title, id: other.scenarioId, ...(other.sourceRecordingId ? { recordingId: other.sourceRecordingId } : {}) }));
    const allConflicts = dedupeConflicts([...siblings, ...conflicts]);

    const fromTypedGoal = Boolean(scenario.scenarioGoal?.trim()) && scenario.title.trim() === scenario.scenarioGoal?.trim();
    const generic = !key || GENERIC_TITLE.test(key) || key.split(" ").filter((word) => /[a-z]/.test(word)).length < 2;
    const reasons: ScenarioTitleReview["reasons"] = [];
    if (allConflicts.length > 0) reasons.push("duplicate_title");
    if (fromTypedGoal) reasons.push("typed_goal_title");
    if (generic) reasons.push("generic_title");

    reviews[scenario.scenarioId] = {
      scenarioId: scenario.scenarioId,
      conflicts: allConflicts,
      weak: generic,
      reasons,
    };
  }
  return reviews;
}

export const MIN_TITLE_LENGTH = 5;

/** A reviewer renames one scenario; nothing but its title changes. */
export function renameScenarioTitle(
  scenarios: readonly RecordedScenario[],
  scenarioId: string,
  rawTitle: string,
): { ok: true; scenario: RecordedScenario; scenarios: RecordedScenario[] } | { ok: false; code: "TITLE_TOO_SHORT" | "SCENARIO_NOT_FOUND" } {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  if (title.length < MIN_TITLE_LENGTH) return { ok: false, code: "TITLE_TOO_SHORT" };
  const current = scenarios.find((scenario) => scenario.scenarioId === scenarioId);
  if (!current) return { ok: false, code: "SCENARIO_NOT_FOUND" };
  const scenario: RecordedScenario = { ...current, title: capTitle(title), titleEditedByUser: true };
  return { ok: true, scenario, scenarios: scenarios.map((item) => item.scenarioId === scenarioId ? scenario : item) };
}

/** A title a reviewer typed survives regenerating the recording; scenario ids are stable per recording. */
export function keepReviewerTitles(next: RecordedScenario[], previous: readonly RecordedScenario[]): RecordedScenario[] {
  const renamed = new Map(previous.filter((scenario) => scenario.titleEditedByUser).map((scenario) => [scenario.scenarioId, scenario.title]));
  if (renamed.size === 0) return next;
  return next.map((scenario) => renamed.has(scenario.scenarioId)
    ? { ...scenario, title: renamed.get(scenario.scenarioId)!, titleEditedByUser: true }
    : scenario);
}

function dedupeConflicts(conflicts: TitleConflict[]): TitleConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const id = `${conflict.source}:${conflict.id}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
