import assert from "node:assert/strict";
import test from "node:test";
import { parseJiraWorkflowStep, jiraWorkflowErrors, jiraWorkflowApplications, parseJiraDocumentSet } from "./jira-workflow";
import { deriveJiraInputRequirements } from "./jira-input-requirements";
import { discoverJiraScenario, type JiraBrowserPort } from "./jira-semantic-executor";
import { compileJiraSpec } from "./jira-spec-compiler";
import { normalizeScenario } from "../test-design/test-design.validation";
import { designCaseInputRequirements, designCaseRuntimeValues, fillPlaceholders } from "../test-design/test-design-publisher";
import { resolveJiraConfiguredInputValues, jiraScenarioRuntimeValues } from "./jira-runtime-values";
import { auditGeneratedJiraSyntax } from "./jira-scenario-generator";
import { redactJiraScenarioInputs } from "./jira-rerun-manifest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJiraApplications, saveJiraApplications } from "./jira-workflow-config";

const steps = ['Abrir la aplicación configurada del proyecto', 'Presionar "Crear"',
  'Capturar el valor de "Número de solicitud" como "solicitudId"', 'Cambiar a la aplicación "Aprobaciones"',
  'Ingresar usuario en "Usuario"', 'Ingresar el valor capturado "solicitudId" en "Número de solicitud"',
  'Presionar "Consultar"', 'Presionar "Aprobar" en la fila del valor capturado "solicitudId" en "Solicitudes"',
  'Cambiar a la aplicación "principal"', 'Adjuntar los documentos requeridos en "Documentación"', 'Validar que se muestre "Finalizada"'];
const ref = "a68b0fb1-201b-4d63-a343-b92adee67662";
test("workflow grammar validates capture ordering and configured applications", () => {
  assert.deepEqual(jiraWorkflowErrors(steps), []);
  assert.match(jiraWorkflowErrors([steps[5]])[0], /CAPTURE_NOT_DECLARED/);
  assert.match(jiraWorkflowErrors([steps[2], steps[2]])[0], /CAPTURE_DUPLICATE/);
  assert.equal(parseJiraWorkflowStep('Adjuntar documento'), undefined);
  assert.equal(jiraWorkflowApplications({ jiraApplications: { Aprobaciones: { baseUrl: "http://fixture.test/#/approval" } } }).Aprobaciones.baseUrl, "http://fixture.test/#/approval");
  assert.throws(() => jiraWorkflowApplications({ jiraApplications: { unsafe: { baseUrl: "file:///private" } } }), /URL_INVALID/);
  assert.throws(() => jiraWorkflowApplications({ jiraApplications: { unsafe: { baseUrl: "https://user:secret@example.test" } } }), /URL_INVALID/);
  assert.deepEqual(parseJiraDocumentSet(JSON.stringify({ Formulario: ref })), { Formulario: ref });
  assert.throws(() => parseJiraDocumentSet('{"Formulario":"C:/local.pdf"}'), /SET_INVALID/);
});

test("Jira discovery -> plan -> promoted spec retains dynamic bindings, never a captured literal", async () => {
  const executed: string[] = [];
  const port: JiraBrowserPort = { async navigate() {}, async executeWorkflow(op) { executed.push(op.kind); },
    async act() { return { strategy: "label", value: "fixture" }; }, async assert(target) { return { observedText: target }; } };
  const requirements = deriveJiraInputRequirements(steps);
  assert.deepEqual(requirements.map(field => [field.label, field.controlType, field.application]), [["Usuario", "text", "Aprobaciones"], ["Documentación", "file-set", "principal"]]);
  const scenario = { scenarioId: "FLOW-1:jira:1", sourceIssueKey: "FLOW-1", title: "Aprobar solicitud", steps,
    expectedResult: 'Se muestra "Finalizada"', inputRequirements: requirements };
  const discovered = await discoverJiraScenario(scenario, port, Object.fromEntries(requirements.map(field => [field.key, field.controlType === "file-set" ? JSON.stringify({ Formulario: ref }) : "fixture-user"])));
  assert.deepEqual(executed, ["capture", "application", "fillCaptured", "clickCapturedRow", "application", "documents"]);
  const compiled = compileJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario, appSlug: "fixture", sectionSlug: "jira", automationId: "flow", specPath: "fixture/case.spec.ts" });
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /createJiraWorkflowSession/);
  assert.match(compiled.source, /"kind":"capture"/);
  assert.match(compiled.source, /page = workflow.page/);
  assert.equal(discovered.runtimeEntries.some(entry => entry.key === "solicitudId"), false);
  assert.deepEqual(redactJiraScenarioInputs(scenario).steps, steps);
  assert.deepEqual(await auditGeneratedJiraSyntax([scenario], []), []);
});

test("Test Design save and TestRail input handoff preserve document maps and application ownership", () => {
  const requirements = deriveJiraInputRequirements(steps);
  const data = requirements.map(field => ({ key: field.key, label: field.label, controlType: field.controlType, value: field.controlType === "file-set" ? JSON.stringify({ Formulario: ref }) : "fixture-user" }));
  const scenario = normalizeScenario({ title: "Adjuntos", steps: steps.map(action => ({ action })), data, inputRequirements: requirements }, 0);
  assert.deepEqual(designCaseInputRequirements(scenario), requirements);
  assert.deepEqual(designCaseRuntimeValues(scenario), Object.fromEntries(data.map(field => [field.key, field.value])));
  assert.equal(fillPlaceholders(`{{${requirements[1].key}}}`, scenario.data), `{{${requirements[1].key}}}`);
  const manual = normalizeScenario({ steps: [{ action: steps[9] }], data: [] }, 0);
  assert.equal(manual.data[0].controlType, "file-set");
});

test("secondary applications cannot inherit primary credentials or document fixtures", () => {
  const requirements = deriveJiraInputRequirements(steps);
  const resolved = resolveJiraConfiguredInputValues({ overrides: undefined, scenarioId: "flow", requirements, profileUsername: "primary-only", environment: {}, testData: {} });
  assert.equal(resolved[requirements[0].key], undefined);
  assert.deepEqual(jiraScenarioRuntimeValues({}, { [requirements[0].key]: "primary-only" }, requirements), {});
  const explicit = resolveJiraConfiguredInputValues({ scenarioId: "flow", requirements, overrides: { flow: { [requirements[0].key]: "approval-user" } }, environment: {} });
  assert.equal(explicit[requirements[0].key], "approval-user");
});

test("application aliases save atomically with the rest of the project profile preserved", async () => {
  const slug = `workflow-config-${randomUUID()}`;
  const directory = path.resolve("automations/apps", slug);
  const appsRoot = path.resolve("automations/apps");
  assert.equal(path.dirname(directory), appsRoot);
  await fs.mkdir(directory);
  const configPath = path.join(directory, "app.config.json");
  try {
    await fs.writeFile(configPath, JSON.stringify({ baseUrl: "https://primary.fixture/#/home", loginMode: "password", testData: { retained: true } }), "utf8");
    const saved = await saveJiraApplications(slug, { Aprobaciones: { baseUrl: "https://approval.fixture/#/tasks" } });
    assert.equal(saved.Aprobaciones.baseUrl, "https://approval.fixture/#/tasks");
    assert.deepEqual(await readJiraApplications(slug), saved);
    const profile = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(profile.baseUrl, "https://primary.fixture/#/home");
    assert.equal(profile.loginMode, "password");
    assert.deepEqual(profile.testData, { retained: true });
  } finally {
    await fs.unlink(configPath).catch(() => {});
    await fs.rmdir(directory).catch(() => {});
  }
});
