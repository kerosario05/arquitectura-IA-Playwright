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
import { markEditedScenarios, normalizeScenario } from "./test-design.validation";
import { designCaseInputRequirements, designCaseRuntimeValues, persistDesignCaseInputs, toCaseInput } from "./test-design-publisher";

for (const [project, steps] of [
  ["fenix", ['Ingresar el usuario en "Usuario".', 'Seleccionar la cuenta en "Cuenta de origen".', 'Validar que se muestre "Confirmación"']],
  ["inventory", ['Ingresar la referencia en "Reference".', 'Seleccionar el almacén en "Warehouse".', 'Validar que se muestre "Summary"']],
] as const) {
  test(`${project}: Jira -> Design -> save -> TestRail -> reload retains one steps/input/persistence contract`, async () => {
    const source = {
      scenarioId: `${project}:jira:1`,
      title: "Journey", steps: [...steps], preconditions: [], expectedResult: "Resultado observado",
      inputRequirements: deriveJiraInputRequirements([...steps]), acceptanceCriteriaRefs: ["AC1", "AC2"],
      validation: { valid: true, errors: [], warnings: [] },
    } as unknown as ValidatedScenario;
    const [design] = mapJiraScenariosToTestDesign([source]);
    design.data = design.data.map((datum, index) => ({ ...datum, value: `fixture-${index}` }));
    const normalized = normalizeScenario(JSON.parse(JSON.stringify(design)), 0);
    const [saved] = markEditedScenarios([design], [normalized]);
    assert.deepEqual(designCaseInputRequirements(saved), source.inputRequirements);
    assert.deepEqual(saved.acceptanceCriteriaRefs, source.acceptanceCriteriaRefs);
    assert.deepEqual(saved.data.map(datum => datum.key), source.inputRequirements!.map(input => input.key));
    const published = toCaseInput(saved, "QA-1", { requiredCustomFields: {}, caseOracle: "QA" });
    assert.deepEqual(published.stepsSeparated, scenarioCaseSteps(source.steps).map((step, index, all) => ({
      ...step,
      ...(index === all.length - 1 ? { expected: source.expectedResult } : {}),
    })));
    assert.match(published.preconditions ?? "", /^Datos de prueba requeridos:/, "published preconditions carry the launcher's required-data summary");
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

test("Test Design preserves a project fixture reference for Jira launch without publishing its value to TestRail", async () => {
  const uploadStep = 'Adjuntar el archivo de prueba en "Formulario"';
  const fileRef = "a68b0fb1-201b-4d63-a343-b92adee67662";
  const requirements = deriveJiraInputRequirements([uploadStep]);
  const source = {
    scenarioId: "FORM-1:jira:1", title: "Adjuntar formulario", steps: [uploadStep], preconditions: [],
    expectedResult: "El formulario queda adjunto.", inputRequirements: requirements,
    acceptanceCriteriaRefs: ["AC1"], validation: { valid: true, errors: [], warnings: [] },
  } as unknown as ValidatedScenario;
  const [generated] = mapJiraScenariosToTestDesign([source]);
  generated.data = generated.data.map(datum => ({ ...datum, value: fileRef }));
  const [saved] = markEditedScenarios([generated], [normalizeScenario(JSON.parse(JSON.stringify(generated)), 0)]);

  assert.deepEqual(designCaseInputRequirements(saved), requirements);
  assert.equal(saved.data[0].controlType, "file");
  assert.deepEqual(designCaseRuntimeValues(saved), { [requirements[0].key]: fileRef });
  const published = toCaseInput(saved, "QA-File", { requiredCustomFields: {}, caseOracle: "QA" });
  assert.equal(JSON.stringify(published).includes(fileRef), false);

  const writes: Array<{ projectSlug?: string; caseId?: number; requirements?: Array<{ controlType?: string }>; values?: Record<string, string> }> = [];
  const dependencies = {
    replace: async (projectSlug: string, caseId: number, fields: Array<{ controlType?: string }>) => { writes.push({ projectSlug, caseId, requirements: fields }); },
    persist: async (input: { projectSlug: string; caseId: number; values: readonly { key: string; value: string | number | boolean }[] }) => {
      writes.push({ projectSlug: input.projectSlug, caseId: input.caseId, values: Object.fromEntries(input.values.map(item => [item.key, String(item.value)])) });
      return input.values.length;
    },
  };
  await persistDesignCaseInputs("profile-a", 123, saved, dependencies);
  assert.equal(writes[0].requirements?.[0]?.controlType, "file");
  assert.deepEqual(writes[1].values, { [requirements[0].key]: fileRef });
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
        expectedResult: 'Se muestra "Comprobante".', acceptanceCriteriaRefs: ["AC1", "AC2"] }] };
      return { parsedJson, rawText: JSON.stringify(parsedJson), model: "fixture", providerName: "shared-contract-fixture", durationMs: 1 };
    } };
  const launcher = await generateJiraScenarios([issue], "shared-contract-fixture", provider, { loadProjectKnowledge: true, useCache: true });
  const design = await generateTestDesignScenarios(issue, {
    appSlug: "shared-contract-fixture", provider, existingTitles: ["A title retained from an earlier draft"],
  });
  assert.equal(calls, 1);
  assert.deepEqual(design[0].steps.map(step => step.action), launcher.scenarios[0].steps);
  assert.deepEqual(design[0].inputRequirements, launcher.scenarios[0].inputRequirements);
  assert.deepEqual(design[0].jiraSourceScenario?.validation, launcher.scenarios[0].validation);
  assert.deepEqual(design[0].acceptanceCriteriaRefs, launcher.scenarios[0].acceptanceCriteriaRefs);
  assert.equal(launcher.coverage?.[0].total,2);
  const cached=await generateJiraScenarios([issue], 'shared-contract-fixture', provider, {loadProjectKnowledge:true,useCache:true});
  assert.equal(calls,1);
  assert.deepEqual(cached.coverage,launcher.coverage);
});
