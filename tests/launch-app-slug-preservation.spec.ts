import { test, expect } from "@playwright/test";
import { resolveEffectiveAppSlug } from "../src/server/jobs/scenario-preview-runner";
import type { McpScenario } from "../src/scenarios/scenario-types";

function makeScenario(overrides: Partial<McpScenario>): McpScenario {
  return {
    sourceIssueKey: "HU-1",
    title: "Escenario de prueba",
    steps: ['1. Clic en "Elemento".'],
    preconditions: [],
    expectedResult: "OK",
    type: "functional",
    database: "",
    isConverted: 0,
    automationType: "ui_discovery",
    setupStrategy: "no_login",
    appSlug: "",
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    ...overrides,
  };
}

test("explicit launch appSlug is the source of truth — never replaced by a default", () => {
  const params = { appSlug: "project-a" };
  const scenarios = [makeScenario({ sourceIssueKey: "HU-1" })];

  const resolved = resolveEffectiveAppSlug(params as any, scenarios);

  expect(resolved.appSlug).toBe("project-a");
  expect(resolved.appSlug).not.toBe("default-app");
  expect(resolved.appSlug).not.toBe("arquitectura-automatizacion");
  // The runner passes resolved.appSlug to `discovery:preview ... --app <appSlug>`
  console.log(`resolved appSlug=${resolved.appSlug} -> discovery:preview --app ${resolved.appSlug}`);
});

test("explicit launch appSlug wins even when scenario has a different targetAppSlug", () => {
  const params = { appSlug: "project-a" };
  const scenarios = [makeScenario({ sourceIssueKey: "HU-1", targetAppSlug: "project-b" })];

  const resolved = resolveEffectiveAppSlug(params as any, scenarios);

  // Precedence 1: launch/request appSlug beats scenario targetAppSlug
  expect(resolved.appSlug).toBe("project-a");
});

test("scenario targetAppSlug used when launch appSlug absent", () => {
  const params = { appSlug: undefined, targetAppSlug: undefined };
  const scenarios = [makeScenario({ sourceIssueKey: "HU-1", targetAppSlug: "project-b" })];

  const resolved = resolveEffectiveAppSlug(params as any, scenarios);

  expect(resolved.appSlug).toBe("project-b");
});

test("fallback preserved when no explicit appSlug or scenario target exists", () => {
  const params = { appSlug: undefined, targetAppSlug: undefined };
  const scenarios = [makeScenario({ sourceIssueKey: "HU-1" })];

  // No explicit slug anywhere → existing fallback (throws) is preserved
  expect(() => resolveEffectiveAppSlug(params as any, scenarios)).toThrow();
});