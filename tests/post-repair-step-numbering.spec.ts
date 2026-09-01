import { expect, test } from "@playwright/test";
import { validateScenario } from "../src/scenarios/scenario-validator";
import type { McpScenario } from "../src/scenarios/scenario-types";

/**
 * Focused tests for post-repair step numbering.
 *
 * repairUnbackedClicks can:
 *   - convert "Clic en X" → "Validar que se muestre X" (loses ordinal)
 *   - remove "Volver" steps entirely (leaves gaps)
 *
 * renumberSteps (codex-scenario-generator.ts) must guarantee
 * sequential 1-based numbering before scenarioValidation.
 */

function baseScenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return {
    sourceIssueKey: "TEST-1",
    title: "Test scenario",
    steps: [],
    preconditions: [],
    expectedResult: "Done",
    type: "Functional",
    database: "",
    isConverted: 0,
    automationType: "ui_discovery",
    setupStrategy: "no_login",
    appSlug: "test",
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    ...overrides,
  };
}

function renumberSteps(steps: string[]): string[] {
  return steps.map((step, index) =>
    `${index + 1}. ${String(step).replace(/^\d+[\.)]\s*/, "").trim()}`
  );
}

// ── Conversion: click→assert preserves step number ──────────────────────────

test("click→assert conversion preserves step position", () => {
  const input = [
    '1. Clic en "Iniciar".',
    '2. Validar que se muestre "logo".',
    '3. Clic en "Menu".',
  ];
  // Simulate repair: "Clic en Menu" → "Validar que se muestre Menu"
  const repaired = [
    input[0],
    input[1],
    'Validar que se muestre "Menu"',
  ];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Clic en "Iniciar".',
    '2. Validar que se muestre "logo".',
    '3. Validar que se muestre "Menu"',
  ]);
  const validation = validateScenario(baseScenario({ steps: result }));
  expect(validation.errors).not.toContainEqual(
    expect.stringContaining("not numbered")
  );
});

// ── Removal: step deletion renumbers remaining ──────────────────────────────

test("step removal renumbers remaining steps sequentially", () => {
  const input = [
    '1. Clic en "Alfa".',
    '2. Clic en "Volver".',
    '3. Clic en "Beta".',
  ];
  // Simulate repair: "Volver" removed
  const repaired = [input[0], input[2]];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Clic en "Alfa".',
    '2. Clic en "Beta".',
  ]);
  const validation = validateScenario(baseScenario({ steps: result }));
  expect(validation.errors).not.toContainEqual(
    expect.stringContaining("not numbered")
  );
});

// ── HU-required click: preserves action and number ──────────────────────────

test("HU-required click preserves click action and step number", () => {
  const input = [
    '1. Validar que se muestre "Iniciar".',
    '2. Clic en "Explora nuestros productos".',
    '3. Validar que se muestre "modulo de informacion".',
  ];
  // No repair needed — HU-required click is preserved as-is
  const repaired = [...input];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Validar que se muestre "Iniciar".',
    '2. Clic en "Explora nuestros productos".',
    '3. Validar que se muestre "modulo de informacion".',
  ]);
  const validation = validateScenario(baseScenario({ steps: result }));
  expect(validation.errors).not.toContainEqual(
    expect.stringContaining("not numbered")
  );
});

// ── 3+ steps remain sequential after mixed repair ───────────────────────────

test("3+ steps remain sequential after mixed conversion and removal", () => {
  const input = [
    '1. Clic en "Alfa".',
    '2. Clic en "Volver".',
    '3. Clic en "Beta".',
    '4. Validar que se muestre "gamma".',
    '5. Clic en "Gamma".',
  ];
  // Simulate repair: "Volver" removed, "Clic en Gamma" → assert
  const repaired = [
    input[0],       // 1. Clic en "Alfa"
    input[2],       // was 3. Clic en "Beta"
    input[3],       // was 4. Validar gamma
    'Validar que se muestre "Gamma"',  // was 5. Clic en Gamma → assert
  ];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Clic en "Alfa".',
    '2. Clic en "Beta".',
    '3. Validar que se muestre "gamma".',
    '4. Validar que se muestre "Gamma"',
  ]);
  const validation = validateScenario(baseScenario({ steps: result }));
  expect(validation.errors).not.toContainEqual(
    expect.stringContaining("not numbered")
  );
});

// ── scenarioValidation accepts post-repair numbered steps ───────────────────

test("scenarioValidation accepts result after renumberSteps", () => {
  const steps = [
    '1. Clic en "Alfa".',
    '2. Clic en "Beta".',
    '3. Clic en "Gamma".',
  ];
  const repaired = [
    steps[0],
    'Validar que se muestre "Beta"',
    steps[2],
  ];
  const result = renumberSteps(repaired);
  const validation = validateScenario(baseScenario({ steps: result }));
  expect(validation.errors).not.toContainEqual(
    expect.stringContaining("not numbered")
  );
  expect(validation.errors).not.toContainEqual(
    expect.stringContaining("does not match MCP pattern")
  );
});

// ── First step unnumbered → renumbered → passes ─────────────────────────────

test("first step without ordinal gets numbered and passes validation", () => {
  const repaired = [
    'Validar que se muestre "Iniciar"',
    '2. Validar que se muestre "logo institucional".',
    '3. Validar que se muestre "mensaje de bienvenida".',
  ];
  const result = renumberSteps(repaired);
  expect(result[0]).toMatch(/^1\. /);
  const validation = validateScenario(baseScenario({ steps: result }));
  expect(validation.errors).not.toContainEqual(
    expect.stringContaining("not numbered")
  );
});

// ── All steps unnumbered → all get sequential numbers ───────────────────────

test("all unnumbered steps get sequential numbers", () => {
  const repaired = [
    'Clic en "Alfa".',
    'Validar que se muestre "Beta".',
    'Clic en "Gamma".',
  ];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Clic en "Alfa".',
    '2. Validar que se muestre "Beta".',
    '3. Clic en "Gamma".',
  ]);
});

// ── Duplicate numbers → normalized to sequential ────────────────────────────

test("duplicate step numbers normalized to sequential", () => {
  const repaired = [
    '3. Clic en "Alfa".',
    '3. Clic en "Beta".',
    '3. Clic en "Gamma".',
  ];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Clic en "Alfa".',
    '2. Clic en "Beta".',
    '3. Clic en "Gamma".',
  ]);
});

// ── Mixed notation (dot vs parenthesis) normalized ──────────────────────────

test("mixed dot/parenthesis numbering normalized", () => {
  const repaired = [
    '1) Clic en "Alfa".',
    '2. Clic en "Beta".',
    '3) Clic en "Gamma".',
  ];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Clic en "Alfa".',
    '2. Clic en "Beta".',
    '3. Clic en "Gamma".',
  ]);
});

// ── Step with no text after number → preserved ──────────────────────────────

test("empty step content after stripping number is preserved", () => {
  const repaired = [
    '1. Clic en "Alfa".',
    '2. ',
    '3. Clic en "Gamma".',
  ];
  const result = renumberSteps(repaired);
  expect(result).toEqual([
    '1. Clic en "Alfa".',
    '2. ',
    '3. Clic en "Gamma".',
  ]);
});
