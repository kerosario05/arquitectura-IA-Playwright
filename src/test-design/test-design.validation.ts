import { randomUUID } from "node:crypto";
import { normalizeAuthoredJiraStep } from "../jira/jira-authored-step-format";
import { deriveJiraInputRequirements } from "../jira/jira-input-requirements";
import type {
  TestDesignPriority,
  TestDesignScenario,
  TestDesignScenarioType,
  TestDesignStep,
  TestDesignDatum,
} from "./test-design.types";

/**
 * Normalization of scenarios coming from the panel (or the AI), and the checks
 * that gate publishing. The panel validates too, but its payload is never trusted:
 * whatever is stored or published goes through here.
 */

/** TestRail rejects case titles longer than 250 characters. */
export const MAX_TITLE_LENGTH = 250;
export const MAX_TEXT_LENGTH = 10_000;
export const MAX_STEPS_PER_SCENARIO = 100;
export const MAX_SCENARIOS_PER_STORY = 200;

const PRIORITIES: TestDesignPriority[] = ["low", "medium", "high", "critical"];
const TYPES: TestDesignScenarioType[] = ["functional", "negative", "edge", "regression", "other"];

export class TestDesignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDesignValidationError";
  }
}

function text(value: unknown, field: string, max = MAX_TEXT_LENGTH): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new TestDesignValidationError(`${field} debe ser texto`);
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new TestDesignValidationError(`${field} supera el máximo de ${max} caracteres`);
  }
  return trimmed;
}

const CONDITIONS = ["valid", "invalid", "expired"] as const;
const MAX_DATA_PER_SCENARIO = 50;

function normalizeData(raw: unknown, path: string): TestDesignDatum[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new TestDesignValidationError(`${path} debe ser una lista`);
  if (raw.length > MAX_DATA_PER_SCENARIO) {
    throw new TestDesignValidationError(`${path} supera el máximo de ${MAX_DATA_PER_SCENARIO} datos`);
  }
  const seen = new Set<string>();
  const out: TestDesignDatum[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") throw new TestDesignValidationError(`${path}[${i}] debe ser un objeto`);
    const d = item as Record<string, unknown>;
    const key = text(d.key, `${path}[${i}].key`, 120);
    if (!key || seen.has(key.toLowerCase())) return;
    seen.add(key.toLowerCase());
    const condition = CONDITIONS.find((c) => c === d.condition);
    out.push({
      key,
      ...(typeof d.label === "string" && d.label.trim() ? { label: text(d.label, `${path}[${i}].label`, 300) } : {}),
      // Not trimmed: a datum may legitimately start or end with spaces.
      value: typeof d.value === "string" ? d.value.slice(0, 500) : "",
      sensitive: d.sensitive === true,
      description: text(d.description, `${path}[${i}].description`, 300),
      ...(condition ? { condition } : {}),
    });
  });
  return out;
}

function normalizeStep(raw: unknown, path: string): TestDesignStep {
  if (typeof raw === "string") return { action: normalizeAuthoredJiraStep(text(raw, `${path}.action`)), expected: "" };
  if (!raw || typeof raw !== "object") throw new TestDesignValidationError(`${path} debe ser un objeto`);
  const step = raw as Record<string, unknown>;
  return {
    action: normalizeAuthoredJiraStep(text(step.action, `${path}.action`)),
    expected: text(step.expected, `${path}.expected`),
  };
}

function normalizeCaseId(value: unknown, path: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const id = typeof value === "string" ? Number(value.replace(/^C/i, "")) : value;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new TestDesignValidationError(`${path}.testRailCaseId no es un id de caso válido`);
  }
  return id;
}

/**
 * Coerces one scenario into the stored shape. Missing optional fields get
 * defaults; wrong types are rejected rather than guessed. Empty steps (no action
 * and no expected result) are dropped: they are rows the user added and left blank.
 */
export function normalizeScenario(
  raw: unknown,
  index: number,
  defaults: { origin?: TestDesignScenario["origin"] } = {},
): TestDesignScenario {
  const path = `scenarios[${index}]`;
  if (!raw || typeof raw !== "object") throw new TestDesignValidationError(`${path} debe ser un objeto`);
  const s = raw as Record<string, unknown>;

  if (s.steps !== undefined && !Array.isArray(s.steps)) {
    throw new TestDesignValidationError(`${path}.steps debe ser una lista`);
  }
  const rawSteps = (s.steps as unknown[] | undefined) ?? [];
  if (rawSteps.length > MAX_STEPS_PER_SCENARIO) {
    throw new TestDesignValidationError(`${path} supera el máximo de ${MAX_STEPS_PER_SCENARIO} pasos`);
  }
  const steps = rawSteps
    .map((step, i) => normalizeStep(step, `${path}.steps[${i}]`))
    .filter((step) => step.action || step.expected);

  const priority = PRIORITIES.includes(s.priority as TestDesignPriority)
    ? (s.priority as TestDesignPriority)
    : "medium";
  const type = TYPES.includes(s.type as TestDesignScenarioType)
    ? (s.type as TestDesignScenarioType)
    : "functional";
  const origin = s.origin === "manual" || s.origin === "ai" ? s.origin : defaults.origin ?? "manual";
  const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : randomUUID();
  const inputRequirements = Array.isArray(s.inputRequirements)
    ? deriveJiraInputRequirements(steps.map(step => step.action), s.inputRequirements) : undefined;
  const data = normalizeData(s.data, `${path}.data`);
  const boundData = new Set<TestDesignDatum>();
  const runtimeData = inputRequirements?.map(requirement => {
    const exact = data.find(datum => datum.key === requirement.key);
    const matching = data.filter(datum => (datum.label ?? datum.key).toLowerCase() === requirement.label.toLowerCase());
    const unique = inputRequirements.filter(other => other.label === requirement.label).length === 1;
    const datum = exact ?? (unique && matching.length === 1 ? matching[0] : undefined);
    if (datum) boundData.add(datum);
    return { ...datum, key: requirement.key, label: requirement.label, value: datum?.value ?? "",
      sensitive: requirement.sensitive || datum?.sensitive === true, description: datum?.description ?? "",
      ...(requirement.dataCondition ? { condition: requirement.dataCondition } : {}) };
  });

  return {
    id,
    title: text(s.title, `${path}.title`, MAX_TITLE_LENGTH),
    preconditions: text(s.preconditions, `${path}.preconditions`),
    steps,
    data: runtimeData ? [...runtimeData, ...data.filter(datum => !boundData.has(datum))] : data,
    ...(inputRequirements ? { inputRequirements } : {}),
    ...(Array.isArray(s.acceptanceCriteriaRefs) ? { acceptanceCriteriaRefs: s.acceptanceCriteriaRefs.filter((ref): ref is string => typeof ref === "string") } : {}),
    ...(Array.isArray(s.generationWarnings) ? { generationWarnings: s.generationWarnings.filter((warning): warning is string => typeof warning === "string") } : {}),
    expectedResult: text(s.expectedResult, `${path}.expectedResult`),
    priority,
    type,
    selectedForTestRail: s.selectedForTestRail === undefined ? true : s.selectedForTestRail === true,
    selectedForJira: s.selectedForJira === undefined ? true : s.selectedForJira === true,
    testRailCaseId: normalizeCaseId(s.testRailCaseId, path),
    testRailDirty: s.testRailDirty === true,
    origin,
    edited: s.edited === true,
  };
}

export function normalizeScenarios(
  raw: unknown,
  defaults: { origin?: TestDesignScenario["origin"] } = {},
): TestDesignScenario[] {
  if (!Array.isArray(raw)) throw new TestDesignValidationError("scenarios debe ser una lista");
  if (raw.length > MAX_SCENARIOS_PER_STORY) {
    throw new TestDesignValidationError(
      `una historia no puede tener más de ${MAX_SCENARIOS_PER_STORY} escenarios`,
    );
  }
  const scenarios = raw.map((item, index) => normalizeScenario(item, index, defaults));
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) {
      throw new TestDesignValidationError(`id de escenario repetido: ${scenario.id}`);
    }
    seen.add(scenario.id);
  }
  return scenarios;
}

export function testRailContentSignature(s: TestDesignScenario): string {
  return JSON.stringify([s.title, s.preconditions, s.steps, s.data, s.expectedResult, s.priority, s.type]);
}

/**
 * Sets `edited` on scenarios whose content differs from the stored version, so
 * regeneration can tell AI output nobody touched from work a person did. The
 * flag is never cleared, and selection changes alone do not count as an edit.
 */
export function markEditedScenarios(
  previous: TestDesignScenario[],
  next: TestDesignScenario[],
): TestDesignScenario[] {
  const before = new Map(previous.map((s) => [s.id, s]));
  return next.map((scenario) => {
    const stored = before.get(scenario.id);
    // A new row (added or duplicated in the panel) must not inherit a case it was copied from.
    if (!stored) return { ...scenario, testRailCaseId: null, testRailDirty: false };
    const contentChanged = testRailContentSignature(stored) !== testRailContentSignature(scenario);
    const edited = scenario.edited || stored.edited || contentChanged;
    // The TestRail link is server-owned: the panel cannot attach or detach a case.
    return {
      ...scenario,
      edited,
      testRailCaseId: stored.testRailCaseId,
      testRailDirty: stored.testRailDirty === true || (stored.testRailCaseId !== null && contentChanged),
    };
  });
}

export type PublishIssue = {
  scenarioId: string;
  title: string;
  problem: string;
};

/**
 * What blocks publishing the scenarios selected for `destination`. Unselected
 * scenarios are never checked: an incomplete draft row the user is not sending
 * must not hold up the rest.
 */
export function findPublishIssues(
  scenarios: TestDesignScenario[],
  destination: "testrail" | "jira",
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  for (const scenario of scenarios) {
    const selected = destination === "testrail" ? scenario.selectedForTestRail : scenario.selectedForJira;
    if (!selected) continue;
    const add = (problem: string) => issues.push({ scenarioId: scenario.id, title: scenario.title, problem });
    if (!scenario.title) add("sin título");
    if (scenario.steps.length === 0) add("sin pasos");
    scenario.steps.forEach((step, index) => {
      if (!step.action) add(`el paso ${index + 1} no tiene acción`);
    });
    if (!scenario.expectedResult && scenario.steps.every((step) => !step.expected)) {
      add("sin resultado esperado");
    }
  }
  return issues;
}
