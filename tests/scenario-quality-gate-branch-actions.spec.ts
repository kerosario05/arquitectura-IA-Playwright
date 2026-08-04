import { expect, test } from "@playwright/test";
import { applyScenarioQualityGate } from "../src/scenarios/codex-scenario-generator";
import type { JiraIssueSource, McpRouteProfile } from "../src/scenarios/scenario-types";

function makeIssue(overrides: Partial<JiraIssueSource> = {}): JiraIssueSource {
  return {
    key: overrides.key ?? "HU-1",
    summary: overrides.summary ?? "HU de opciones",
    description: overrides.description ?? "",
    acceptanceCriteria: overrides.acceptanceCriteria ?? null,
    labels: overrides.labels ?? [],
    components: overrides.components ?? [],
    status: overrides.status ?? "To Do",
    issueType: overrides.issueType ?? "Story",
  };
}

test("quality gate preserves decisive option click detected from option flows", () => {
  const issue = makeIssue({
    key: "HU-ALFA-BETA",
    description: 'Si el usuario selecciona "Opción Beta", el sistema debe mostrar "Destino Beta".',
  });
  const routeProfile: McpRouteProfile = {
    name: "test-profile",
    entry: [],
    aliases: {},
    intermediates: {},
    domainTerms: {},
    visibleControls: ["Opción Beta", "Destino Beta"],
    representativeFixture: {},
    notes: [],
  };
  const scenarios = [
    {
      sourceIssueKey: issue.key,
      title: "Flujo beta",
      steps: ['1. Clic en "Iniciar".', '2. Clic en "Opción Beta".', '3. Validar que se muestre "Destino Beta".'],
      expectedResult: "OK",
    },
  ];

  const result = applyScenarioQualityGate(scenarios, [issue], routeProfile);
  expect(result.rejected).toHaveLength(0);
  expect(result.scenarios).toHaveLength(1);
  expect(result.scenarios[0].steps.join(" ")).toContain('Clic en "Opción Beta"');
});

test("quality gate still removes unrelated visible-control navigation not required by HU option flows", () => {
  const issue = makeIssue({
    key: "HU-SIMPLE",
    description: 'Si el usuario selecciona "Opción Alfa", el sistema debe mostrar "Destino Alfa".',
  });
  const routeProfile: McpRouteProfile = {
    name: "test-profile",
    entry: [],
    aliases: {},
    intermediates: {},
    domainTerms: {},
    visibleControls: ["Banner informativo", "Destino Alfa"],
    representativeFixture: {},
    notes: [],
  };
  const scenarios = [
    {
      sourceIssueKey: issue.key,
      title: "Flujo con ruido",
      steps: ['1. Clic en "Banner informativo".', '2. Clic en "Opción Alfa".', '3. Validar que se muestre "Destino Alfa".'],
      expectedResult: "OK",
    },
  ];

  const result = applyScenarioQualityGate(scenarios, [issue], routeProfile);
  expect(result.rejected).toHaveLength(0);
  expect(result.scenarios).toHaveLength(1);
  expect(result.scenarios[0].steps.join(" ")).not.toContain('Clic en "Banner informativo"');
  expect(result.scenarios[0].steps.join(" ")).toContain('Clic en "Opción Alfa"');
});
