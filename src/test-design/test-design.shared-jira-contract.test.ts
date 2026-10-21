import assert from "node:assert/strict";
import test from "node:test";
import { deriveJiraInputRequirements } from "../jira/jira-input-requirements";
import { persistJiraCaseInputs } from "../jira/jira-case-input-persistence";
import { scenarioCaseSteps } from "../scenarios/scenario-case-transport";
import { normalizeTestRailCase } from "../testrail/testrail-normalizer";
import type { ValidatedScenario } from "../scenarios/scenario-types";
import { mapJiraScenariosToTestDesign } from "./test-design-generator";
import { generateTestDesignScenarios } from "./test-design-generator";
import { generateJiraScenarios } from "../jira/jira-scenario-generator";
import type { AiProvider } from "../ai/ai-provider.types";
import { normalizeScenario } from "./test-design.validation";
import { designCaseInputRequirements, designCaseRuntimeValues, persistDesignCaseInputs, toCaseInput } from "./test-design-publisher";

for (const [project, steps] of [
  ["fenix", ['Ingresar el usuario en "Usuario".', 'Seleccionar la cuenta en "Cuenta de origen".', 'Validar que se muestre "Confirmación"']],
  ["inventory", ['Ingresar la referencia en "Reference".', 'Seleccionar el almacén en "Warehouse".', 'Validar que se muestre "Summary"']],
] as const) {
  test(`${project}: Jira -> Design -> save -> TestRail -> reload retains one steps/input/persistence contract`, async () => {
    const source = {
      title: "Journey", steps: [...steps], preconditions: [], expectedResult: "Resultado observado",
      inputRequirements: deriveJiraInputRequirements([...steps]), acceptanceCriteriaRefs: ["AC1", "AC2"],
      validation: { valid: true, errors: [], warnings: [] },
    } as unknown as ValidatedScenario;
    const [design] = mapJiraScenariosToTestDesign([source]);
    design.data = design.data.map((datum, index) => ({ ...datum, value: `fixture-${index}` }));
    const saved = normalizeScenario(JSON.parse(JSON.stringify(design)), 0);
    assert.deepEqual(designCaseInputRequirements(saved), source.inputRequirements);
    assert.deepEqual(saved.acceptanceCriteriaRefs, source.acceptanceCriteriaRefs);
    assert.deepEqual(saved.data.map(datum => datum.key), source.inputRequirements!.map(input => input.key));
    const published = toCaseInput(saved, "QA-1", { requiredCustomFields: {}, caseOracle: "QA" });
    assert.deepEqual(published.stepsSeparated, scenarioCaseSteps(source.steps));
    assert.equal(published.preconditions, undefined);
    assert.equal(JSON.stringify(published).includes("fixture-"), false);
    const reloaded = normalizeTestRailCase({ id: 123, title: published.title, custom_steps_separated: published.stepsSeparated });
    assert.deepEqual(reloaded.steps.map(step => step.action), source.steps);
    assert.deepEqual(deriveJiraInputRequirements(reloaded.steps.map(step => step.action), saved.inputRequirements), source.inputRequirements);
    const writes: unknown[] = [];
    const dependencies = {
      replace: async (projectSlug: string, caseId: number, requirements: unknown[]) => { writes.push({ projectSlug, caseId, requirements }); },
      persist: async (input: unknown) => { writes.push(input); return 2; },
    };
    await persistDesignCaseInputs(project, 123, saved, dependencies);
    const designWrites = writes.splice(0);
    await persistJiraCaseInputs({ projectSlug: project, scenarioId: saved.id,
      publishedCases: [{ scenarioId: saved.id, caseId: 123 }], requirements: source.inputRequirements!,
      values: designCaseRuntimeValues(saved) }, dependencies);
    assert.deepEqual(writes, designWrites);
  });
}

test("legacy label keys bind uniquely to the same canonical runtime fields", () => {
  const scenario = normalizeScenario({ title: "Legacy", steps: ['Ingresar el usuario en "Usuario".'],
    data: [{ key: "Usuario", value: "fixture-user" }] }, 0);
  const requirements = deriveJiraInputRequirements(scenario.steps.map(step => step.action));
  assert.deepEqual(designCaseRuntimeValues(scenario), { [requirements[0].key]: "fixture-user" });
});

test("Launcher and Design share the same valid generation cache with identical source/provider/knowledge", async () => {
  const issue = { key: "SYNC-7", summary: "Pagar con tarjeta", description: "Como cliente quiero pagar mis pedidos con tarjeta.",
    acceptanceCriteria: "1. Solo tarjetas vigentes.\n2. Se muestra el comprobante.", labels: [], components: [], status: "To Do", issueType: "Story" };
  let calls = 0;
  const provider: AiProvider = { providerType: "fake", providerName: "shared-contract-fixture", model: "fixture",
    async completeJson() {
      calls++;
      const parsedJson = { scenarios: [{ sourceIssueKey: issue.key, title: "Pago", preconditions: [],
        steps: ['Abrir la aplicación configurada del proyecto', 'Ingresar una tarjeta válida en "Número de tarjeta"', 'Validar que se muestre "Comprobante"'],
        expectedResult: 'Se muestra "Comprobante".', acceptanceCriteriaRefs: ["AC1"] }] };
      return { parsedJson, rawText: JSON.stringify(parsedJson), model: "fixture", providerName: "shared-contract-fixture", durationMs: 1 };
    } };
  const launcher = await generateJiraScenarios([issue], "shared-contract-fixture", provider, { loadProjectKnowledge: true, useCache: true });
  const design = await generateTestDesignScenarios(issue, { appSlug: "shared-contract-fixture", provider });
  assert.equal(calls, 1);
  assert.deepEqual(design[0].steps.map(step => step.action), launcher.scenarios[0].steps);
  assert.deepEqual(design[0].inputRequirements, launcher.scenarios[0].inputRequirements);
});
