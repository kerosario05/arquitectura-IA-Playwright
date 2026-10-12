import { randomUUID } from "node:crypto";
import {
  isSensitiveName,
  keyFromLabel,
  labelFromKey,
  MAX_DATA_FIELDS,
  MAX_DATA_VALUE_LENGTH,
  reconcileDataFields,
  scenarioTexts,
} from "./test-data";
import type {
  TestDesignDataField,
  TestDesignPriority,
  TestDesignScenario,
  TestDesignScenarioType,
  TestDesignStep,
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

function normalizeStep(raw: unknown, path: string): TestDesignStep {
  if (typeof raw === "string") return { action: text(raw, `${path}.action`), expected: "" };
  if (!raw || typeof raw !== "object") throw new TestDesignValidationError(`${path} debe ser un objeto`);
  const step = raw as Record<string, unknown>;
  return {
    action: text(step.action, `${path}.action`),
    expected: text(step.expected, `${path}.expected`),
  };
}

function normalizeDataField(raw: unknown, path: string): TestDesignDataField | null {
  if (!raw || typeof raw !== "object") throw new TestDesignValidationError(`${path} debe ser un objeto`);
  const f = raw as Record<string, unknown>;
  const label = text(f.label, `${path}.label`, 120);
  const key = keyFromLabel(text(f.key, `${path}.key`, 60) || label);
  if (!key) return null;
  return {
    key,
    label: label || labelFromKey(key),
    description: text(f.description, `${path}.description`, 500),
    value: text(f.value, `${path}.value`, MAX_DATA_VALUE_LENGTH),
    sensitive: typeof f.sensitive === "boolean" ? f.sensitive : isSensitiveName(`${key} ${label}`),
  };
}

function normalizeData(raw: unknown, path: string): TestDesignDataField[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new TestDesignValidationError(`${path}.data debe ser una lista`);
  if (raw.length > MAX_DATA_FIELDS) {
    throw new TestDesignValidationError(`${path} supera el máximo de ${MAX_DATA_FIELDS} datos de prueba`);
  }
  const fields: TestDesignDataField[] = [];
  raw.forEach((item, i) => {
    const field = normalizeDataField(item, `${path}.data[${i}]`);
    if (field && !fields.some((existing) => existing.key === field.key)) fields.push(field);
  });
  return fields;
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

  const preconditions = text(s.preconditions, `${path}.preconditions`);
  const expectedResult = text(s.expectedResult, `${path}.expectedResult`);
  const data = reconcileDataFields(normalizeData(s.data, path), scenarioTexts({ preconditions, steps, expectedResult }));

  return {
    id,
    title: text(s.title, `${path}.title`, MAX_TITLE_LENGTH),
    preconditions,
    steps,
    expectedResult,
    data,
    priority,
    type,
    selectedForTestRail: s.selectedForTestRail === undefined ? true : s.selectedForTestRail === true,
    selectedForJira: s.selectedForJira === undefined ? true : s.selectedForJira === true,
    testRailCaseId: normalizeCaseId(s.testRailCaseId, path),
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

function contentSignature(s: TestDesignScenario): string {
  return JSON.stringify([s.title, s.preconditions, s.steps, s.expectedResult, s.priority, s.type, s.data]);
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
    if (!stored) return { ...scenario, testRailCaseId: null };
    const edited = scenario.edited || stored.edited || contentSignature(stored) !== contentSignature(scenario);
    // The TestRail link is server-owned: the panel cannot attach or detach a case.
    return { ...scenario, edited, testRailCaseId: stored.testRailCaseId };
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
