import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { EventEmitter } from "node:events";
import { scanCurrentPage } from "../explorer/page-scanner";
import {compileJiraSpec} from './jira-spec-compiler';
import {JiraRequiredDataError, jiraTargetFailure, jiraTargetDiagnosticField, jiraAuthorsVerification, createJiraPlaywrightPort, jiraSelectionDisplayConfirms, selectJiraObservedOption, resolveJiraNativeOption, resolveJiraStepTarget, resolveJiraStepTargetAfterClick, snapshotJiraRows, markJiraAddedRow, relocateJiraAddedRow,jiraRefersToAddedRow} from './jira-semantic-executor';
import { __setJiraDomTargetResolverForTesting } from './jira-dom-target-ai';
import {deriveJiraInputRequirements} from './jira-input-requirements';
import {normalizeJiraAssertionSyntax} from './jira-assertion-syntax';
import type { ExecutionPlanStep } from "../types/execution-plan.types";

test("target failure keeps public code and carries only a label-free diagnostic", () => {
  const error = jiraTargetFailure({ status: "ambiguous", target: "Secret Label", confidence: 0, matchReason: "jira_exact_visible_action_text_ambiguous",
    candidateText: "Secret Label", candidates: [],
    clickableCandidates: [{ text: "Secret Label", normalizedText: "secret label", type: "button", role: "button", tagName: "button" },
      { text: "Other Text", normalizedText: "x", type: "link", role: "a b <script>", tagName: "a" }] });
  assert.equal(error.message, "JIRA_TARGET_AMBIGUOUS");
  assert.equal(error.message.match(/^([A-Z][A-Z_]+)(?::[a-z_]+)?/)?.[1], "JIRA_TARGET_AMBIGUOUS");
  assert.deepEqual(error.diagnostic, { status: "ambiguous", matchReason: "jira_exact_visible_action_text_ambiguous", candidateCount: 2,
    candidates: [{ role: "button", tag: "button", hasIdentity: false }, { role: undefined, tag: "a", hasIdentity: false }] });
  assert.doesNotMatch(JSON.stringify(error.diagnostic), /Secret|Other|secret/);
});

test("target failure uses explicit candidateCount, one candidate list, and a safe matchReason prefix", () => {
  const item = { text: "Secret Label", normalizedText: "secret label", type: "button", role: "button", tagName: "button" };
  const capped = [item, item, item, item, item];
  const error = jiraTargetFailure({ status: "ambiguous", target: "Secret Label", confidence: 0,
    matchReason: "multiple_similar_candidates (7 with score 0.9 for Secret Label)", candidateText: "Secret Label",
    candidates: capped, clickableCandidates: capped, closestCandidates: capped,
    ambiguityDiagnostics: { candidateCount: 7 } } as never);
  assert.equal(error.diagnostic.candidateCount, 7);
  assert.equal(error.diagnostic.matchReason, "multiple_similar_candidates");
  assert.equal(error.diagnostic.candidates.length, 5);
  assert.doesNotMatch(JSON.stringify(error.diagnostic), /Secret|secret|score|\d+ with/);
  // No explicit count: overlapping views are not summed.
  const fallback = jiraTargetFailure({ status: "ambiguous", target: "x", confidence: 0, matchReason: "m", candidateText: "x",
    candidates: capped, clickableCandidates: capped.slice(0, 3) } as never);
  assert.equal(fallback.diagnostic.candidateCount, 3);
});

test("failed-result contract keeps code and sanitized diagnostic only for target failures", () => {
  const error = jiraTargetFailure({ status: "not_found", target: "Secret Label", confidence: 0, matchReason: "no_match", candidateText: "Secret Label",
    candidates: [{ text: "Secret Label", normalizedText: "secret label", type: "button", role: "button", tagName: "button", ariaLabel: "Secret Aria" }] } as never);
  const code = error.message.match(/^([A-Z][A-Z_]+)(?::[a-z_]+)?/)?.[1];
  const serialized = JSON.parse(JSON.stringify({ status: "failed", failedReason: code, ...jiraTargetDiagnosticField(error) }));
  assert.deepEqual(serialized, { status: "failed", failedReason: "JIRA_TARGET_NOT_FOUND", targetDiagnostic: {
    status: "not_found", matchReason: "no_match", candidateCount: 1, candidates: [{ role: "button", tag: "button", hasIdentity: true }] } });
  assert.doesNotMatch(JSON.stringify(serialized), /Secret|secret/);
  assert.deepEqual(jiraTargetDiagnosticField(new Error("JIRA_OTHER")), {});
});

test("native option resolution ignores prompt options and keeps the observed option value", () => {
  const options = [
    { value: "", label: "Selecciona una frecuencia" },
    { value: "MTH", label: "Mensual" },
    { value: "MTH2", label: "Mensual anticipado" },
  ];
  assert.equal(resolveJiraNativeOption(options, "frecuencia"), undefined);
  assert.deepEqual(resolveJiraNativeOption(options, "Mensual"), { value: "MTH", label: "Mensual" });
  assert.deepEqual(resolveJiraNativeOption(options, "Dato de prueba", true), { value: "MTH", label: "Mensual" });
  assert.equal(resolveJiraNativeOption([options[0]], "Mensual"), undefined);
});

test("selection readback rejects prompts and ignores the field aria-label", () => {
  assert.equal(jiraSelectionDisplayConfirms("Seleccione tipo de ingreso", "Ingreso"), false);
  assert.equal(jiraSelectionDisplayConfirms("-- Seleccionar --", "Seleccionar"), false);
  assert.equal(jiraSelectionDisplayConfirms("", "Ingreso"), false);
  assert.equal(jiraSelectionDisplayConfirms("Ingreso fijo", "Ingreso"), true);
});

test("custom select that keeps its placeholder after a click is not reported selected", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const html = (commit: boolean) => `<table><tbody><tr><td><button id="f" aria-label="Tipo de ingreso" onclick="document.getElementById('l').hidden=false">Seleccione tipo</button>
      <ul id="l" role="listbox" hidden><li role="option" tabindex="0" onclick="${commit ? "document.getElementById('f').textContent='Ingreso fijo'" : ""}">Ingreso fijo</li></ul></td></tr></tbody></table>`;
    await page.setContent(html(false));
    await assert.rejects(selectJiraObservedOption(page, page.locator("#f"), "Ingreso"), /JIRA_SELECTION_STATE_UNCONFIRMED/);
    await page.setContent(html(true));
    await selectJiraObservedOption(page, page.locator("#f"), "Ingreso");
    assert.equal(await page.locator("#f").innerText(), "Ingreso fijo");
  } finally {
    await browser.close();
  }
});

test('missing data reports field metadata only and all missing fields before navigation',async()=>{
 const steps=['Ingresar usuario en "Usuario"','Ingresar contraseña en "Contraseña"','Validar que se muestre "Ready"'];
 const fields=deriveJiraInputRequirements(steps);
 const input={scenarioId:'HU-2:jira:1',sourceIssueKey:'HU-2',title:'Login',steps,expectedResult:'Ready',inputRequirements:fields};
 const calls:string[]=[];
 await assert.rejects(discoverJiraScenario(input,port(calls),{}),error=>{
  assert.ok(error instanceof JiraRequiredDataError);
  assert.deepEqual(error.missingInputs,fields.map(field=>({key:field.key,label:field.label,stepIndex:field.stepIndex})));
  return true;
 });
 assert.deepEqual(calls,[]);
 const suppliedValue='synthetic-private-value';
 await assert.rejects(discoverJiraScenario(input,port(calls),{[fields[0].key]:suppliedValue}),error=>{
  assert.ok(error instanceof JiraRequiredDataError);
  assert.deepEqual(error.missingInputs,[{key:fields[1].key,label:'Contraseña',stepIndex:2}]);
  assert.ok(!JSON.stringify(error).includes(suppliedValue));
  return true;
 });
});
import { isScenarioEligibleForEngine, resolveExecutionEngine } from "./execution-origin";
import { observeAuthStageSettled, discoverJiraScenario, jiraScenarioHasAuthoredCredentialEntry, normalizeJiraFrameworkPreconditions, normalizeJiraScenarioForExecution, type JiraBrowserPort, type JiraClassicLoginObservation, type JiraImplicitLogin, type JiraScenarioInput } from "./jira-semantic-executor";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import { compileDeterministicSpec } from "../automations/spec-compiler/deterministic-spec-compiler";

const scenario: JiraScenarioInput = { scenarioId: "JIRA-1", sourceIssueKey: "AA-88", title: "Observe gate", steps: ["Presionar \"Solicitar\"", "Validar pantalla de autenticación para iniciar sesión"], expectedResult: "" , authIntent: "gate_observation" };
function port(calls: string[]): JiraBrowserPort { return { baseUrl: "https://app.example.test/", async navigate() { calls.push("navigate"); }, async navigateTo(url) { calls.push(`navigateTo:${url}`); }, async authenticate() { calls.push("authenticate"); return { success: true }; }, async assertPrecondition(target) { calls.push(`precondition:${target}`); return { observedText: target }; }, async act(step, target) { calls.push(`${step.action}:${target}`); return { strategy: "css", value: "#request" }; }, async assert(target, auth) { calls.push(`assert:${auth}`); return auth ? { stage: "identification_input" } : {}; } }; }
test("only explicit validated Jira provenance selects the new engine", () => {
  assert.equal(resolveExecutionEngine({ scenarios: [{ sourceIssueKey: "AA-88" }] }), "legacy");
  const req = { executionEngine: "jira_semantic", scenarioOrigin: { kind: "jira_generated", jiraKey: "AA-88" }, scenarios: [{ scenarioId: "JIRA-1", sourceIssueKey: "AA-88" }] };
  assert.equal(resolveExecutionEngine(req), "jira_semantic");
  assert.throws(() => resolveExecutionEngine({ ...req, scenarios: [{ sourceIssueKey: "AA-82" }] }), /PROVENANCE/);
  assert.throws(() => resolveExecutionEngine({ ...req, recordingId: "recording" }), /RECORDING/);
  assert.equal(resolveExecutionEngine({ recordingId: "recording" }), "legacy");
  assert.throws(() => resolveExecutionEngine({ ...req, scenarios: [...req.scenarios, ...req.scenarios] }), /ID_INVALID/);
  assert.equal(isScenarioEligibleForEngine("legacy", { mcpExecutable: false }), false);
  assert.equal(isScenarioEligibleForEngine("jira_semantic", { mcpExecutable: false }), true);
  assert.equal(isScenarioEligibleForEngine("jira_semantic", { mcpExecutable: false, validation: { valid: false } }), true);
  assert.equal(isScenarioEligibleForEngine("jira_semantic", { mcpExecutable: false, validation: { valid: false, errors: ["JIRA_FILTER_TEST_DATA_UNSPECIFIED"] } }), true);
  assert.equal(isScenarioEligibleForEngine("jira_semantic", { validation: { valid: false, errors: ["JIRA_ASSERTION_CAPABILITY_UNSUPPORTED"] } }), true);
  assert.equal(isScenarioEligibleForEngine("jira_semantic", { validation: { valid: true } }), true);
});
test("gate observation preserves the requested clicks without ordinal selection or authentication", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario(scenario, port(calls));
  assert.deepEqual(calls, ["navigate", "click:Solicitar", "assert:true"]);
  assert.equal(discovered.sourceScenario.auth?.required, false);
  const contract = buildSpecExecutionContract(discovered.plan, discovered.sourceScenario, { appSlug: "synthetic-one", sectionSlug: "jira" });
  const compiled = compileDeterministicSpec(contract, { targetSpecPath: path.resolve(".artifacts/jira-fixture/case.spec.ts") });
  assert.deepEqual(compiled.unsupportedCapabilities, []);
  assert.match(compiled.source, /detectAuthGate/);
  assert.match(compiled.source, /identification_input/);
  assert.doesNotMatch(compiled.source, /ensureAuthenticated|primer elemento|first visible/);
});
test("initial evidence is captured after project navigation and before the first scenario action", async () => {
  const calls: string[] = [];
  await discoverJiraScenario(scenario, port(calls), {}, () => {}, () => false, async () => { calls.push("capture-initial"); });
  assert.deepEqual(calls, ["navigate", "capture-initial", "click:Solicitar", "assert:true"]);
});
test("gate observation does not append a redundant prose expected result as an unobservable oracle", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario,
    authIntent: undefined,
    steps: ['Presionar "Solicitar"', 'Validar que se muestre "pantalla de autenticación del kiosco"'],
    expectedResult: "Solicitar inicia el límite de autenticación del kiosco.",
  }, port(calls));
  assert.deepEqual(calls, ["navigate", "click:Solicitar", "assert:true"]);
  assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "click", "assertVisible"]);
});
test("expected-result paraphrases already covered by an explicit assertion do not become duplicate oracles", async () => {
  const cases = [
    ['Validar que se muestre "Persona encontrada"', "La persona se encuentra en el sistema."],
    ['Validar que se muestre "Coincidencia en listas no restrictivas"', "La consulta indica coincidencia no restrictiva."],
  ] as const;
  for (const [step, expectedResult] of cases) {
    const calls: string[] = [];
    const targets: string[] = [];
    let discovered: Awaited<ReturnType<typeof discoverJiraScenario>>;
    try {
      discovered = await discoverJiraScenario({ ...scenario, authIntent: undefined, steps: [step], expectedResult }, {
        ...port(calls), async assert(target) { targets.push(target); return { observedText: target }; },
      });
    } catch (error) { throw new Error(`${step} / ${expectedResult}: ${(error as Error).message}`); }
    assert.equal(targets.length, 1, `${step} already verifies its expected result: ${targets.join(" | ")}`);
    assert.equal(discovered.plan.steps.filter(item => item.action === "assertVisible").length, 1);
  }
  const partialCalls: string[] = [];
  const partialTargets: string[] = [];
  await discoverJiraScenario({ ...scenario, authIntent: undefined,
    steps: ['Validar que se muestre "Persona encontrada"'],
    expectedResult: "La persona encontrada está autorizada como representante." }, {
    ...port(partialCalls), async assert(target) { partialTargets.push(target); return { observedText: target }; },
  });
  assert.equal(partialTargets.length, 2, "an additional expected-result condition must not be silently suppressed");
  for (const [step, expectedResult] of [
    ['Validar que no se muestre "Resultado"', "No se muestra Resultado."],
    ['Validar que no se muestre "Solicitud recibida"', "No se muestra Solicitud recibida."],
  ] as const) {
    const calls: string[] = [];
    await discoverJiraScenario({ ...scenario, authIntent: undefined,
      steps: ['Validar que se muestre "Error"', step], expectedResult }, {
      ...port(calls), async assertAbsent(target) { calls.push(`absent:${target}`); return { absent: true }; },
    });
    assert.equal(calls.filter(call => call.startsWith("absent:")).length, 1,
      `${expectedResult} is already verified by its explicit negative step`);
  }
  const calls: string[] = [];
  const targets: string[] = [];
  await discoverJiraScenario({ ...scenario, authIntent: undefined, steps: ['Validar que se muestre "Solicitudes de prospectos PJ"'],
    expectedResult: "Se muestran los indicadores de carga y el listado." }, {
    ...port(calls), async assert(target) { targets.push(target); return { observedText: target }; },
  });
  assert.equal(targets.length, 2, "a distinct loading outcome must remain a required oracle");
});
test("expected-result narrative is covered by explicit notification action and list-state assertions", async () => {
  const targets: string[] = [];
  const input = { ...scenario, authIntent: undefined,
    steps: ['Presionar "Notificaciones"', 'Validar que se muestre "Solicitudes de prospectos PJ"',
      'Validar que se muestre "Devuelta"'],
    expectedResult: "La campana abre el listado filtrado por Devuelta." };
  const discovered = await discoverJiraScenario(input, {
    ...port([]), async assert(target) { targets.push(target); return { observedText: target }; },
  });
  assert.deepEqual(targets, ["Solicitudes de prospectos PJ", "Devuelta"]);
  assert.equal(discovered.plan.steps.filter(step => step.action === "assertVisible").length, 2);

  const incompleteTargets: string[] = [];
  await discoverJiraScenario({ ...input, steps: input.steps.slice(0, 2) }, {
    ...port([]), async assert(target) { incompleteTargets.push(target); return { observedText: target }; },
  });
  assert.ok(incompleteTargets.some(target => /filtrado por Devuelta/i.test(target)),
    "the summary remains required when its filtered status has no authored oracle");
});

test("field-state summary requirements become backed, executable field oracles", async () => {
  const enabled: string[] = [];
  const input = { ...scenario, authIntent: undefined, expectedResult: "Se habilitan país de origen, registro y representante.",
    steps: ['Seleccionar "NIT" en "Tipo de Identificación"', 'Validar que se muestre "País de Origen"',
      'Validar que se muestre "Registro en País de Origen"', 'Validar que se muestre "Representante en el País"'] };
  const discovered = await discoverJiraScenario(input, { ...port([]),
    async assert(target) { return { observedText: target }; },
    async assertFieldEnabled(label) { enabled.push(label); return { kind: "field_enabled", fieldLabel: label }; },
  });
  assert.deepEqual(enabled, ["País de Origen", "Registro en País de Origen", "Representante en el País"]);
  const fieldOracles = discovered.sourceScenario.observableOracles?.filter(item => item.type === "field_state") ?? [];
  assert.equal(fieldOracles.length, 3);
  assert.ok(fieldOracles.every(item => item.backed && item.details?.kind === "field_enabled"));
  const compiled = compileJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario, appSlug: "fixture", sectionSlug: "jira",
    automationId: "field-state", specPath: path.resolve(".artifacts/tmp/field-state/case.spec.ts") });
  assert.deepEqual(compiled.unsupported, []);
  assert.equal((compiled.source.match(/assertJiraSpecFieldEnabled\(/g) ?? []).length, 3);
});
test("native fill keeps runtime binding and excludes literals from plan and source", async () => {
  const discovered = await discoverJiraScenario({ ...scenario, steps: ['Ingresar "synthetic-secret" en "Clave"'] }, port([]));
  assert.equal(discovered.plan.steps[1].action, "fill");
  assert.equal(discovered.runtimeEntries[0].value, "synthetic-secret");
  assert.doesNotMatch(JSON.stringify(discovered.plan), /synthetic-secret/);
});
test("unresolved and cancelled actions fail closed", async () => {
  await assert.rejects(discoverJiraScenario(scenario, { ...port([]), async act() { throw new Error("JIRA_TARGET_AMBIGUOUS"); } }), /AMBIGUOUS/);
  await assert.rejects(discoverJiraScenario(scenario, port([]), {}, () => {}, () => true), /CANCELLED/);
});

test("negative requirements are blocked rather than weakened to positive visibility", async () => {
  await assert.rejects(discoverJiraScenario({ ...scenario, steps: ['Validar que no aparezca la pantalla de autenticación'] }, port([])), /CAPABILITY_UNSUPPORTED/);
});

test('a rejection summary requires both explicit subject-matched polarities across profiles',async()=>{
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const input={scenarioId:'HU-1:jira:1',sourceIssueKey:'HU-1',title:'Rejected',appSlug,steps:['Validar que se muestre "problema de código de acceso"','Validar que no se muestre "operación exitosa"'],expectedResult:'Se informa el problema del código de acceso y no se presenta la operación como exitosa.'};
  const targets:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(){return {strategy:'css',value:'#field'};},async assert(target){targets.push(target);return {observedText:target};},async assertAbsent(target){targets.push(`absent:${target}`);return {absent:true};}};
  const discovered=await discoverJiraScenario(input,browser);
  assert.deepEqual(targets,['problema de código de acceso','absent:operación exitosa']);
  assert.equal(discovered.sourceScenario.observableOracles?.length,2);
  const compiled=compileJiraSpec({plan:discovered.plan,sourceScenario:discovered.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-summary/case.spec.ts')});
  assert.deepEqual(compiled.unsupported,[]);
  for(const steps of [input.steps.slice(0,1),input.steps.slice(1),[input.steps[0],'Validar que se muestre "operación exitosa"'],[input.steps[0],'Validar que no se muestre "operación exitosa con comprobante"']]) {
   await assert.rejects(discoverJiraScenario({...input,steps},browser),/JIRA_ASSERTION_CAPABILITY_UNSUPPORTED|JIRA_ABSENCE_REQUIRES_OBSERVED_CONTEXT/);
  }
 }
});

const rowStep = 'Validar que la fila coincidente del beneficiario agregado permanezca visible en "Destinatarios guardados"';
const rowPort = (rows: Array<[string, string[]]>, outcome?: string): JiraBrowserPort => ({
  async navigate() {}, async act() { return { strategy: "css", value: "#field" }; }, async assert(target) { return { observedText: target }; },
  async assertRowMatch(container, values) {
    rows.push([container, values]);
    if (outcome) throw new Error(outcome);
    return { kind: "table_row_match", container, matchedRows: 1, boundValueCount: values.length };
  },
});

const searchFill = 'Ingresar "Buscar beneficiarios"';
const realRowStep = 'Validar que la fila coincidente permanezca visible en la lista Destinatarios guardados';
const SEARCH_KEY = "beneficiary_search_name";
// Mirrors the real scenario: the search fill declares its input requirement at its own step index.
const searchScenario = (steps: string[], stepIndex = 1): JiraScenarioInput => ({ ...scenario, steps, inputRequirements: [
  { key: SEARCH_KEY, label: "Buscar beneficiarios", stepIndex, operation: "fill", required: true, editable: true, sensitive: false, controlType: "text", source: "jira_step" }] });

test("row assertion binds to the entered value and the named container", async () => {
  const rows: Array<[string, string[]]> = [];
  const discovered = await discoverJiraScenario(searchScenario([searchFill, rowStep]), rowPort(rows), { [SEARCH_KEY]: "Ana Perez" });
  assert.deepEqual(rows, [["Destinatarios guardados", ["Ana Perez"]]]);
  const oracle = discovered.sourceScenario.observableOracles?.find(item => item.target === "Destinatarios guardados");
  assert.equal(oracle?.backed, true);
  assert.equal((oracle?.details as { kind?: string }).kind, "table_row_match");
  assert.deepEqual((oracle?.details as { boundValueKeys?: string[] }).boundValueKeys, [SEARCH_KEY]);
  const compile = (sourceScenario: typeof discovered.sourceScenario) => compileJiraSpec({ plan: discovered.plan, sourceScenario, appSlug: "fixture-shop", sectionSlug: "jira", automationId: "fixture", specPath: path.resolve(".artifacts/tmp/jira-row/case.spec.ts") });
  // The compiled spec carries value keys only, never the entered value, and never downgrades to visible text.
  const compiled = compile(discovered.sourceScenario);
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /assertJiraSpecRowMatch\(page, "Destinatarios guardados", rowValues\d+/);
  assert.match(compiled.source, /resolveJiraSpecValue\("beneficiary_search_name"/);
  assert.doesNotMatch(compiled.source, /Ana Perez/);
  assert.doesNotMatch(compiled.source, /assertJiraSpecVisibleText\(page, "Destinatarios guardados"/);
  // Missing, unknown, credential-like or non-backed bindings fail closed instead of weakening the assertion.
  const mutate = (patch: (details: Record<string, unknown>) => void, backed = true) => compile({ ...discovered.sourceScenario, observableOracles: discovered.sourceScenario.observableOracles?.map(item => {
    if (item.target !== "Destinatarios guardados") return item;
    const details = { ...(item.details as Record<string, unknown>) }; patch(details);
    return { ...item, backed, details };
  }) });
  for (const bad of [
    mutate(details => { delete details.boundValueKeys; }),
    mutate(details => { details.boundValueKeys = []; }),
    mutate(details => { details.boundValueKeys = ["not_a_fill_key"]; }),
    mutate(details => { details.boundValueKeys = ["auth.password"]; }),
    mutate(details => { details.matchedRows = 2; }),
    mutate(() => {}, false),
  ]) {
    assert.ok(bad.unsupported.some(item => item.endsWith("table_row_match_spec_unsupported")));
    assert.doesNotMatch(bad.source, /assertJiraSpecRowMatch\(page,|assertJiraSpecVisibleText\(page, "Destinatarios guardados"/);
  }
});

test("expectedResult equivalent to an explicit row-match assertion adds no synthetic step; unrelated claims stay blocked", async () => {
  const rows: Array<[string, string[]]> = [];
  const values = { [SEARCH_KEY]: "Ana Perez" };
  const equivalent = "La fila coincidente del beneficiario agregado permanece visible en \"Destinatarios guardados\"";
  const discovered = await discoverJiraScenario({ ...searchScenario([searchFill, rowStep]), expectedResult: equivalent }, rowPort(rows), values);
  assert.deepEqual(rows, [["Destinatarios guardados", ["Ana Perez"]]]);
  assert.equal(discovered.plan.steps.filter(step => step.description?.startsWith("Validar")).length, 1);
  // Unquoted restatement of the same row outcome is also covered.
  const unquoted = await discoverJiraScenario({ ...searchScenario([searchFill, rowStep]), expectedResult: "Se muestra la fila coincidente del beneficiario agregado" }, rowPort([]), values);
  assert.equal(unquoted.plan.steps.filter(step => step.description?.startsWith("Validar")).length, 1);
  // Non-equivalent claims remain synthesized and fail closed (no row wording / different container / negative).
  for (const expectedResult of ["Se muestra una nueva fila agregada con el total actualizado", "La fila coincidente permanece visible en \"Otra tabla\"", "No se muestra la fila coincidente"]) {
    await assert.rejects(discoverJiraScenario({ ...searchScenario([searchFill, rowStep]), expectedResult }, rowPort([]), values), /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED|JIRA_ASSERTION_TARGET_UNOBSERVABLE|JIRA_ROW_DATA_BINDING_MISSING/, expectedResult);
  }
});

test("structural_row_count row assertion binds the entered beneficiary field by label overlap", async () => {
  const rows: Array<[string, string[]]> = [];
  const discovered = await discoverJiraScenario({ ...scenario, steps: ['Ingresar "Nombre del beneficiario"', rowStep] }, rowPort(rows), { jira_step_1: "Ana Perez" });
  assert.deepEqual(rows, [["Destinatarios guardados", ["Ana Perez"]]]);
  const oracle = discovered.sourceScenario.observableOracles?.find(item => item.target === "Destinatarios guardados");
  assert.deepEqual((oracle?.details as { boundValueKeys?: string[] }).boundValueKeys, ["jira_step_1"]);
});

test("structural_row_count falls back to the immediate search fill when labels share no token", async () => {
  const structuralStep = 'Validar que la fila coincidente del beneficiario agregado permanezca visible en "Destinatarios guardados"';
  const rows: Array<[string, string[]]> = [];
  // "Buscar beneficiarios" (plural) shares no >=5 token with the assertion wording ("beneficiario").
  const discovered = await discoverJiraScenario(searchScenario([searchFill, structuralStep]), rowPort(rows), { [SEARCH_KEY]: "Ana Perez" });
  assert.deepEqual(rows, [["Destinatarios guardados", ["Ana Perez"]]]);
  const oracle = discovered.sourceScenario.observableOracles?.find(item => item.target === "Destinatarios guardados");
  assert.deepEqual((oracle?.details as { boundValueKeys?: string[] }).boundValueKeys, [SEARCH_KEY]);
  // An intervening fill breaks the fallback.
  const broken: Array<[string, string[]]> = [];
  await assert.rejects(discoverJiraScenario(searchScenario([searchFill, 'Ingresar "Monto"', structuralStep]), rowPort(broken), { [SEARCH_KEY]: "Ana Perez", jira_step_2: "500" }), /JIRA_ROW_DATA_BINDING_MISSING/);
  // A sensitive fill immediately before never binds, even with a search fill earlier.
  await assert.rejects(discoverJiraScenario(searchScenario([searchFill, 'Ingresar "Contraseña"', structuralStep]), rowPort(broken), { [SEARCH_KEY]: "Ana Perez", jira_step_2: "synthetic-secret" }), /JIRA_ROW_DATA_BINDING_MISSING/);
  // A non-search immediate fill without label overlap does not bind.
  await assert.rejects(discoverJiraScenario({ ...scenario, steps: ['Ingresar "Monto"', structuralStep] }, rowPort(broken), { jira_step_1: "500" }), /JIRA_ROW_DATA_BINDING_MISSING/);
  assert.deepEqual(broken, []);
});

test("two-label bound row assertion binds both preceding fills and fails closed otherwise", async () => {
  const fills = ['Ingresar un nombre nuevo en "Nombre del beneficiario"', 'Ingresar un alias nuevo en "Alias"'];
  const quoted = 'Validar que la fila con el nombre ingresado en "Nombre del beneficiario" y el alias ingresado en "Alias" aparezca en "Destinatarios guardados"';
  const unquoted = 'Validar que la fila coincidente con el nombre y el alias del segundo beneficiario aparezcan en "Destinatarios guardados"';
  const valueByLabel: Record<string, string> = { "Nombre del beneficiario": "Ana Perez", Alias: "Atlas" };
  // Mirrors production: requirements are derived from the steps and values are keyed by the derived keys.
  const build = (steps: string[]) => {
    const inputRequirements = deriveJiraInputRequirements(steps);
    const values = Object.fromEntries(inputRequirements.map(field => [field.key, valueByLabel[field.label]]));
    return { input: { ...scenario, steps, inputRequirements }, values, keys: inputRequirements.map(field => field.key) };
  };
  for (const step of [quoted, unquoted]) {
    const rows: Array<[string, string[]]> = [];
    const { input, values, keys } = build([...fills, normalizeJiraAssertionSyntax(step)]);
    assert.equal(keys.length, 2, step);
    const discovered = await discoverJiraScenario(input, rowPort(rows), values);
    assert.deepEqual(rows, [["Destinatarios guardados", ["Ana Perez", "Atlas"]]], step);
    const oracle = discovered.sourceScenario.observableOracles?.find(item => item.target === "Destinatarios guardados");
    assert.deepEqual((oracle?.details as { boundValueKeys?: string[] }).boundValueKeys, keys, step);
  }
  // Missing binding for either label, or a missing container, never passes.
  const rows: Array<[string, string[]]> = [];
  for (const fill of fills) {
    const { input, values } = build([fill, normalizeJiraAssertionSyntax(quoted)]);
    await assert.rejects(discoverJiraScenario(input, rowPort(rows), values), /JIRA_ROW_DATA_BINDING_MISSING/);
  }
  const noContainer = build([...fills, normalizeJiraAssertionSyntax(quoted.replace(' en "Destinatarios guardados"', ""))]);
  await assert.rejects(discoverJiraScenario(noContainer.input, rowPort(rows), noContainer.values), /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED|JIRA_ASSERTION_TARGET_UNOBSERVABLE|JIRA_ROW_DATA_BINDING_MISSING/);
  assert.deepEqual(rows, []);
});

test("matching-row contract stays fail-closed for negative, count and unscoped phrasings", async () => {
  const fills = ['Ingresar un nombre nuevo en "Nombre del beneficiario"', 'Ingresar un alias nuevo en "Alias"'];
  const inputRequirements = deriveJiraInputRequirements(fills);
  const values = Object.fromEntries(inputRequirements.map(field => [field.key, field.label === "Alias" ? "Atlas" : "Ana Perez"]));
  const rows: Array<[string, string[]]> = [];
  const negativeStep = 'Validar que no aparezca la fila con el nombre ingresado en "Nombre del beneficiario" y el alias ingresado en "Alias" en "Destinatarios guardados"';
  await assert.rejects(
    discoverJiraScenario({ ...scenario, steps: [...fills, normalizeJiraAssertionSyntax(negativeStep)], inputRequirements }, rowPort(rows), values),
    /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED/);
  assert.deepEqual(rows, []);
  // No-container phrase: canonical subject is the field label itself, so it must throw without any row call.
  await assert.rejects(
    discoverJiraScenario({ ...scenario, steps: [...fills, normalizeJiraAssertionSyntax('Validar que la fila con el nombre ingresado en "Nombre del beneficiario" aparezca')], inputRequirements }, rowPort(rows), values),
    /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED/);
  assert.deepEqual(rows, []);
  await discoverJiraScenario({ ...scenario, steps: [...fills, normalizeJiraAssertionSyntax('Validar que se muestre "Destinatarios guardados"')], inputRequirements }, rowPort(rows), values).catch(() => undefined);
  assert.deepEqual(rows, []);
});

test("spec runtime row match requires named container and exactly one row with all values", async () => {
  const { assertJiraSpecRowMatch } = await import("./jira-spec-runtime");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const table = (name: string, rows: string[][]) => `<table aria-label="${name}"><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const check = async (html: string, values: string[]) => {
      await page.setContent(html);
      return assertJiraSpecRowMatch(page, "Destinatarios guardados", values, 600).then(() => "ok", (error: Error) => error.message);
    };
    assert.equal(await check(table("Destinatarios guardados", [["Ana Perez", "123"], ["Luis", "456"]]), ["Ana Perez", "123"]), "ok");
    assert.equal(await check(table("Destinatarios guardados", [["Luis", "456"]]), ["Ana Perez"]), "JIRA_ROW_NOT_OBSERVED");
    // Substring-only matches are rejected at cell level.
    assert.equal(await check(table("Destinatarios guardados", [["Anabel Perez", "123"]]), ["Ana"]), "JIRA_ROW_NOT_OBSERVED");
    assert.equal(await check(table("Destinatarios guardados", [["Ana Perez", "1234"]]), ["Ana Perez", "123"]), "JIRA_ROW_NOT_OBSERVED");
    assert.equal(await check(table("Destinatarios guardados", [["Anabel", "1"], ["Ana", "2"]]), ["Ana"]), "ok");
    assert.equal(await check(table("Destinatarios guardados", [["Ana Perez", "1"], ["Ana Perez", "2"]]), ["Ana Perez"]), "JIRA_ROW_AMBIGUOUS");
    assert.equal(await check(table("Otra tabla", [["Ana Perez"]]), ["Ana Perez"]), "JIRA_ROW_CONTAINER_UNOBSERVABLE");
    assert.equal(await check(table("Destinatarios guardados", [["Ana Perez"]]) + table("Destinatarios guardados", [["Ana Perez"]]), ["Ana Perez"]), "JIRA_ROW_CONTAINER_AMBIGUOUS");
    assert.equal(await check(table("Destinatarios guardados", [["Ana Perez"]]), []), "JIRA_ROW_DATA_BINDING_MISSING");
    assert.equal(await check(table("Destinatarios guardados", [["Ana Perez"]]), ["  "]), "JIRA_ROW_DATA_BINDING_MISSING");
  } finally { await browser.close(); }
});

test("credential/auth fields never bind a row assertion nor reach the oracle", async () => {
  for (const label of ["Contraseña", "Usuario", "Número de identificación de empresa", "Código OTP", "Token de seguridad", "PIN", "Código de acceso", "Secret"]) {
    const rows: Array<[string, string[]]> = [];
    // Label shares the meaningful word "beneficiario" with the assertion, so only the credential guard can reject it.
    await assert.rejects(discoverJiraScenario({ ...scenario, steps: [`Ingresar "${label} del beneficiario"`, rowStep] }, rowPort(rows), { jira_step_1: "synthetic-secret" }), /JIRA_ROW_DATA_BINDING_MISSING/, label);
    assert.deepEqual(rows, []);
  }
  const rows: Array<[string, string[]]> = [];
  const discovered = await discoverJiraScenario(searchScenario(['Ingresar "Contraseña del beneficiario"', searchFill, rowStep], 2), rowPort(rows), { jira_step_1: "synthetic-secret", [SEARCH_KEY]: "Ana Perez" });
  assert.deepEqual(rows, [["Destinatarios guardados", ["Ana Perez"]]]);
  const oracle = JSON.stringify(discovered.sourceScenario.observableOracles?.find(item => item.target === "Destinatarios guardados"));
  assert.doesNotMatch(oracle, /synthetic-secret|jira_step_1/);
  assert.match(oracle, /beneficiary_search_name/);
});

test("row assertion fails closed without a bound entered value", async () => {
  const rows: Array<[string, string[]]> = [];
  await assert.rejects(discoverJiraScenario({ ...scenario, steps: [rowStep] }, rowPort(rows)), /JIRA_ROW_DATA_BINDING_MISSING/);
  await assert.rejects(discoverJiraScenario({ ...scenario, steps: ['Ingresar "Monto"', rowStep] }, rowPort(rows), { jira_step_1: "500" }), /JIRA_ROW_DATA_BINDING_MISSING/);
  // Search fill not immediately preceding: an intervening step breaks the binding.
  await assert.rejects(discoverJiraScenario(searchScenario([searchFill, 'Ingresar "Monto"', rowStep]), rowPort(rows), { [SEARCH_KEY]: "Ana Perez", jira_step_2: "500" }), /JIRA_ROW_DATA_BINDING_MISSING/);
  // Unnamed container: no quoted container in the assertion.
  await assert.rejects(discoverJiraScenario(searchScenario([searchFill, 'Validar que la fila coincidente del beneficiario agregado permanezca visible']), rowPort(rows), { [SEARCH_KEY]: "Ana Perez" }), /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED/);
  // Row phrase combined with a non-row canonical oracle type (count wording) stays unsupported.
  await assert.rejects(discoverJiraScenario(searchScenario([searchFill, 'Validar que se muestre una nueva fila agregada en "Destinatarios guardados"']), rowPort(rows), { [SEARCH_KEY]: "Ana Perez" }), /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED|JIRA_ASSERTION_TARGET_UNOBSERVABLE/);
  assert.deepEqual(rows, []);
});

test("row assertion fails closed on missing, ambiguous or mismatched row/container evidence", async () => {
  const withKey = searchScenario([searchFill, rowStep]);
  for (const code of ["JIRA_ROW_NOT_OBSERVED", "JIRA_ROW_AMBIGUOUS", "JIRA_ROW_CONTAINER_UNOBSERVABLE", "JIRA_ROW_CONTAINER_AMBIGUOUS"]) {
    await assert.rejects(discoverJiraScenario(withKey, rowPort([], code), { [SEARCH_KEY]: "Ana Perez" }), new RegExp(code));
  }
  const withoutCapability = rowPort([]);
  delete withoutCapability.assertRowMatch;
  await assert.rejects(discoverJiraScenario(withKey, withoutCapability, { [SEARCH_KEY]: "Ana Perez" }), /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED/);
});

const tableDownloadStep = "Validar que se descargue el archivo datos.csv con los movimientos correspondientes a los filtros aplicados.";
const downloadPort = (events: string[], table: () => Promise<string[][] | undefined> | undefined, release?: Promise<void>): JiraBrowserPort => ({
  async navigate() {}, async act() { return { strategy: "css", value: "#field" }; }, async assert(target) { return { observedText: target }; },
  ...(table ? { async observeVisibleTable() { events.push("observe"); return table(); } } : {}),
  async assertDownload(expected) {
    events.push(`assertDownload:${JSON.stringify(expected.tableRows)}`);
    await release;
    events.push("download-resolved");
    return { kind: "download_content", filename: "datos.csv", bytes: 10 };
  },
});

test("table-bound download observes visible rows, passes them to assertDownload and passes only after it resolves", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rows = [["10 oct 2026", "Transferencia", "TRX-1", "-RD$1.00", "Completada"]];
  let settled = false;
  const pending = discoverJiraScenario({ ...scenario, steps: [tableDownloadStep] }, downloadPort(events, async () => rows, gate)).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false, "must not pass before the real download assertion resolves");
  release();
  const discovered = await pending;
  assert.deepEqual(events, ["observe", `assertDownload:${JSON.stringify(rows)}`, "download-resolved"]);
  const oracle = discovered.sourceScenario.observableOracles?.find(item => (item.details as { kind?: string })?.kind === "download_content");
  assert.equal(oracle?.backed, true);
});

test("table-bound download fails closed before assertDownload when the table is unobserved, empty or unsupported", async () => {
  for (const [table, code] of [[async () => undefined, /JIRA_DOWNLOAD_TABLE_UNOBSERVABLE/], [undefined, /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED/]] as const) {
    const events: string[] = [];
    await assert.rejects(discoverJiraScenario({ ...scenario, steps: [tableDownloadStep] }, downloadPort(events, table as never)), code);
    assert.ok(!events.some(event => event.startsWith("assertDownload")), "assertDownload must not run");
  }
  // An empty observation reaches assertDownload, whose contract (jiraDownloadSatisfies) rejects tableBound + no rows.
  const { jiraDownloadSatisfies, parseJiraDownloadExpectation } = await import("./jira-download-assertion");
  const expected = { ...parseJiraDownloadExpectation(tableDownloadStep)!, tableRows: [] as string[][] };
  assert.equal(jiraDownloadSatisfies("datos.csv", "a,b\n1,2\n", expected), false);
});

test("row-count wording and unnamed containers stay blocked", async () => {
  const rows: Array<[string, string[]]> = [];
  for (const blocked of ['Validar que se muestre una nueva fila agregada en "Destinatarios guardados"',
    'Validar que la fila coincidente del beneficiario agregado permanezca visible',
    'Validar que la fila coincidente permanezca visible en la lista porque el usuario lo pidió antes']) {
    await assert.rejects(discoverJiraScenario({ ...scenario, steps: ['Ingresar "Nombre del beneficiario"', blocked] }, rowPort(rows), { jira_step_1: "Ana Perez" }), /JIRA_ASSERTION_CAPABILITY_UNSUPPORTED|JIRA_ASSERTION_TARGET_UNOBSERVABLE/);
  }
  assert.deepEqual(rows, []);
});

test("row assertion without added-row wording still binds to the named list", async () => {
  const rows: Array<[string, string[]]> = [];
  await discoverJiraScenario(searchScenario([searchFill, realRowStep]), rowPort(rows), { [SEARCH_KEY]: "Ana Perez" });
  assert.deepEqual(rows, [["Destinatarios guardados", ["Ana Perez"]]]);
});

test("named route paths and quoted visible preconditions are executed and retained", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario,
    preconditions: ['Está visible "Portal de solicitudes"'],
    steps: ["Navegar a la página /requests", 'Presionar "Nueva solicitud"'],
  }, port(calls));
  assert.deepEqual(calls, ["navigate", "precondition:Portal de solicitudes", "navigateTo:https://app.example.test/requests", "click:Nueva solicitud"]);
  assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "assertVisible", "navigate", "click"]);
  assert.equal(discovered.plan.steps[2].target && (discovered.plan.steps[2].target as { value: string }).value, "https://app.example.test/requests");
  assert.equal(discovered.sourceScenario.observableOracles?.[0].backed, true);
});

test("only the complete Jira framework setup boilerplate is removed for its matching app", async () => {
  const generated = ["1. BASE_URL configurado.\n2. App available.\n3. APP_LOGIN_MODE=password.\n4. AuthGate/AuthFlow enabled.\n5. Test client meets dataRequirements.\n6. App Slug: kiosko."];
  const normalized = normalizeJiraFrameworkPreconditions({ ...scenario, appSlug: "kiosko", preconditions: generated }, "kiosko");
  assert.deepEqual(normalized, { preconditions: [], removed: true });
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario, appSlug: "kiosko", preconditions: generated }, port(calls));
  assert.deepEqual(calls, ["navigate", "click:Solicitar", "assert:true"]);
  assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "click", "assertVisible"]);
});

test("framework boilerplate is retained when partial, augmented, or scoped to another app", async () => {
  const complete = ["1. BASE_URL configurado.\n2. App available.\n3. APP_LOGIN_MODE=password.\n4. AuthGate/AuthFlow enabled.\n5. Test client meets dataRequirements.\n6. App Slug: kiosko."];
  assert.equal(normalizeJiraFrameworkPreconditions({ ...scenario, preconditions: complete }, "fenix").removed, false);
  assert.equal(normalizeJiraFrameworkPreconditions({ ...scenario, preconditions: [...complete, 'Está visible "Solicitar"'] }, "kiosko").removed, false);
  assert.equal(normalizeJiraFrameworkPreconditions({ ...scenario, preconditions: ["BASE_URL configurado."] }, "kiosko").removed, false);
  await assert.rejects(discoverJiraScenario({ ...scenario, appSlug: "kiosko", preconditions: ["BASE_URL configurado."] }, port([])), /JIRA_PRECONDITION_NOT_OBSERVABLE/);
});

test("drops an invented ordinal selection only when a direct destination is explicitly asserted", async () => {
  const input: JiraScenarioInput = { ...scenario, appSlug: "kiosko", steps: [
    'Clic en "Explora nuestros productos".',
    "Seleccionar el primer elemento visible del listado.",
    'Validar que se muestre "Información de productos".',
  ], expectedResult: "Explora nuestros productos dirige directamente a Información de productos." };
  const normalized = normalizeJiraScenarioForExecution(input, "kiosko");
  assert.equal(normalized.removedRedundantOrdinalSelectionCount, 1);
  assert.deepEqual(normalized.scenario.steps, [input.steps[0], input.steps[2]]);
  const calls: string[] = [];
  const discovered = await discoverJiraScenario(normalized.scenario, port(calls));
  assert.deepEqual(calls, ["navigate", "click:Explora nuestros productos", "assert:false"]);
  assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "click", "assertVisible"]);
  const underSpecified = normalizeJiraScenarioForExecution({ ...input, expectedResult: "Información de productos debe mostrar los productos disponibles." }, "kiosko");
  assert.equal(underSpecified.removedRedundantOrdinalSelectionCount, 0);
  const unassertedDestination = normalizeJiraScenarioForExecution({ ...input, steps: input.steps.slice(0, 2) }, "kiosko");
  assert.equal(unassertedDestination.removedRedundantOrdinalSelectionCount, 0);
});

test("setup routes reject cross-origin targets and unverifiable preconditions", async () => {
  await assert.rejects(discoverJiraScenario({ ...scenario, steps: ["Navegar a la página https://outside.example/requests"] }, port([])), /JIRA_ROUTE_OUTSIDE_APP_ORIGIN/);
  await assert.rejects(discoverJiraScenario({ ...scenario, preconditions: ["El usuario tiene acceso"] }, port([])), /JIRA_PRECONDITION_NOT_OBSERVABLE/);
  await assert.rejects(discoverJiraScenario({ ...scenario, steps: ["Navegar a solicitudes"] }, port([])), /SETUP_OR_ACTION_POLICY_UNSUPPORTED/);
});

test("full authentication is explicit, runs configured flow and compiles an AuthFlow call", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", steps: ['Presionar "Solicitar"'] }, port(calls));
  assert.deepEqual(calls, ["navigate", "authenticate", "click:Solicitar"]);
  assert.equal(discovered.sourceScenario.auth?.required, true);
  assert.equal(discovered.sourceScenario.auth?.insertionAfterStepIndex, 1);
  const contract = buildSpecExecutionContract(discovered.plan, discovered.sourceScenario, { appSlug: "portal-comercial", sectionSlug: "jira" });
  const compiled = compileDeterministicSpec(contract, { targetSpecPath: path.resolve(".artifacts/jira-fixture/case.spec.ts") });
  assert.deepEqual(compiled.unsupportedCapabilities, []);
  assert.match(compiled.source, /authFlow\.ensureAuthenticated\(/);
  assert.ok(compiled.source.indexOf("page.goto") < compiled.source.indexOf("authFlow.ensureAuthenticated("));
});

test("credential entry detection is generic across authored username and password field labels", () => {
  assert.equal(jiraScenarioHasAuthoredCredentialEntry([
    'Ingresar usuario en "Usuario"',
    'Ingresar contraseña en "Contraseña"',
  ]), true);
  assert.equal(jiraScenarioHasAuthoredCredentialEntry(['Ingresar el monto en "Monto"']), false);
});

test("full authentication with authored credentials executes those steps without preemptive AuthFlow", async () => {
  const steps = ["Abrir la aplicación configurada del proyecto", 'Ingresar usuario en "Usuario"',
    'Ingresar contraseña en "Contraseña"', 'Presionar "Iniciar sesión"'];
  const inputRequirements = deriveJiraInputRequirements(steps);
  const runtimeValues = Object.fromEntries(inputRequirements.map(requirement => [
    requirement.key, requirement.label === "Usuario" ? "synthetic-user" : "synthetic-pass",
  ]));
  const calls: string[] = [];
  const browser = { ...port(calls), authenticate: undefined };
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", expectedResult: "",
    steps, inputRequirements }, browser, runtimeValues);

  assert.deepEqual(calls, ["navigate", "fill:Usuario", "fill:Contraseña", "click:Iniciar sesión"]);
  assert.equal(discovered.sourceScenario.auth?.required, false);
  assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "navigate", "fill", "fill", "click"]);
  assert.ok(!JSON.stringify(discovered.plan).includes("synthetic-pass"));
});

test("authored credentials defer AuthFlow until the submitted form exposes a pending gate", async () => {
  const steps = ['Ingresar usuario en "Usuario"', 'Ingresar contraseña en "Contraseña"', 'Presionar "Iniciar sesión"'];
  const inputRequirements = deriveJiraInputRequirements(steps);
  const runtimeValues = Object.fromEntries(inputRequirements.map(requirement => [
    requirement.key, requirement.label === "Usuario" ? "synthetic-user" : "synthetic-pass",
  ]));
  const calls: string[] = [];
  const browser = { ...port(calls), async observeAuthStage() { calls.push("observe-stage"); return "otp"; },
    async authenticate(stage?: string) { calls.push(`authenticate:${stage}`); return { success: true }; } };
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", expectedResult: "",
    steps, inputRequirements }, browser, runtimeValues);

  assert.deepEqual(calls, ["navigate", "fill:Usuario", "fill:Contraseña", "click:Iniciar sesión", "observe-stage", "authenticate:otp"]);
  assert.equal(discovered.sourceScenario.auth?.required, true);
  assert.equal(discovered.sourceScenario.auth?.insertionAfterStepIndex, discovered.plan.steps.at(-1)?.index);
});

const classicForm = { username: "Usuario", password: "Contraseña", submit: "Ingresar" };
const creds = { username: "synthetic-user", password: "synthetic-pass" };
function classicPort(calls: string[], form: typeof classicForm | null = classicForm): JiraBrowserPort {
  return { ...port(calls), async observeClassicLogin() { calls.push("observe-login"); return form ?? undefined; } };
}
test("full authentication with a classic login form logs in with profile credentials before the first action, never via AuthFlow", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", steps: ['Presionar "Solicitar"'] },
    classicPort(calls), {}, () => {}, () => false, async () => { calls.push("capture-initial"); }, creds);
  assert.deepEqual(calls, ["navigate", "capture-initial", "observe-login", "fill:Usuario", "fill:Contraseña", "click:Ingresar", "click:Solicitar"]);
  assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "fill", "fill", "click", "click"]);
  assert.equal(discovered.sourceScenario.auth?.required, false);
  assert.ok(!JSON.stringify(discovered.plan).includes(creds.password));
});
test("implicit classic login honors an authored profile selection visible on the login form before credentials", async () => {
  const calls: string[] = [];
  const onForm = new Set(["Personal", "Empresarial"]); // profile choices only exist on the login form
  const p = { ...classicPort(calls), async isLoginSelectorOption(target: string) { return onForm.has(target); } };
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: undefined,
    steps: ["Abrir la aplicación configurada del proyecto", 'Presionar "Empresarial"', 'Presionar "Auditoría"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls, ["navigate", "observe-login", "click:Empresarial", "fill:Usuario", "fill:Contraseña", "click:Ingresar", "click:Auditoría"]);
  assert.deepEqual(discovered.plan.steps.map(step => step.index), [1, 2, 3, 4, 5, 6]);
});
test("implicit classic login does not pre-execute an ordinary visible login action that is not a selector option", async () => {
  const calls: string[] = [];
  // Visible on the form, but no peer-group selection state: the port reports it is not a selector option.
  const p = { ...classicPort(calls), async isTargetVisible() { return true; }, async isLoginSelectorOption() { return false; } };
  await discoverJiraScenario({ ...scenario, authIntent: undefined,
    steps: ['Presionar "Solicitar código por SMS"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls.slice(0, 5), ["navigate", "observe-login", "fill:Usuario", "fill:Contraseña", "click:Ingresar"]);
});
test("implicit classic login without a selection step keeps the ordinary credential-first order", async () => {
  const calls: string[] = [];
  const p = { ...classicPort(calls), async isLoginSelectorOption() { return false; } };
  await discoverJiraScenario({ ...scenario, authIntent: undefined, steps: ['Presionar "Auditoría"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls, ["navigate", "observe-login", "fill:Usuario", "fill:Contraseña", "click:Ingresar", "click:Auditoría"]);
});
test("authored 'open app' step after implicit classic login is not replayed as a second navigate", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication",
    steps: ["Abrir la aplicación configurada del proyecto", 'Presionar "Solicitar"'] }, classicPort(calls), {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "fill", "fill", "click", "click"]);
  assert.deepEqual(discovered.plan.steps.map(step => step.index), [1, 2, 3, 4, 5]);
  // Without a login the authored open step is kept.
  const plain = await discoverJiraScenario({ ...scenario, steps: ["Abrir la aplicación configurada del proyecto", 'Presionar "Solicitar"'] }, port([]));
  assert.equal(plain.plan.steps.filter(step => step.action === "navigate").length, 2);
});
test("classic login with an extra identified credential field fills it from its role value; missing data or an unidentified control stops explicitly", async () => {
  const withRnc = { ...classicForm, extra: [{ label: "RNC", role: "company_identifier" }] };
  const run = (form: JiraClassicLoginObservation, login: JiraImplicitLogin, calls: string[]) => discoverJiraScenario(
    { ...scenario, authIntent: "full_authentication", steps: ['Presionar "Solicitar"'] },
    { ...port(calls), async observeClassicLogin() { return form; } }, {}, () => {}, () => false, undefined, login);
  const calls: string[] = [];
  const discovered = await run(withRnc, { ...creds, fields: { company_identifier: "synthetic-rnc" } }, calls);
  assert.deepEqual(calls, ["navigate", "fill:RNC", "fill:Usuario", "fill:Contraseña", "click:Ingresar", "click:Solicitar"]);
  assert.ok(discovered.runtimeEntries.some(entry => entry.key === "auth.company_identifier"));
  assert.ok(!JSON.stringify(discovered.plan).includes("synthetic-rnc"));
  await assert.rejects(run(withRnc, creds, []), /JIRA_LOGIN_DATA_MISSING:company_identifier/);
  // Unidentified required control: no AuthFlow available -> explicit reason, nothing filled.
  const blockedCalls: string[] = [];
  const noFlow = { ...port(blockedCalls), authenticate: undefined, async observeClassicLogin() { return { blocked: "JIRA_LOGIN_FIELD_UNIDENTIFIED" }; } };
  await assert.rejects(discoverJiraScenario({ ...scenario, authIntent: "full_authentication", steps: ['Presionar "Solicitar"'] },
    noFlow, {}, () => {}, () => false, undefined, creds), /JIRA_LOGIN_FIELD_UNIDENTIFIED/);
  assert.ok(!blockedCalls.some(call => call.startsWith("fill:")));
});

test("full authentication falls back to the configured AuthFlow when no classic form is observed", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", steps: ['Presionar "Solicitar"'] },
    classicPort(calls, null), {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls, ["navigate", "observe-login", "authenticate", "click:Solicitar"]);
  assert.equal(discovered.sourceScenario.auth?.required, true);
});
test("classic login -> SMS verification -> continuation: an authored click on the already-satisfied login submit is not repeated", async () => {
  const calls: string[] = [];
  const visible = new Set(["Solicitar código por SMS"]); // the login form (and its submit) is gone after login
  const p = { ...classicPort(calls), async isTargetVisible(target: string) { calls.push(`visible:${target}`); return visible.has(target); } };
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", expectedResult: "",
    steps: ['Presionar "Ingresar"', 'Presionar "Solicitar código por SMS"', 'Presionar "Continuar"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls, ["navigate", "observe-login", "fill:Usuario", "fill:Contraseña", "click:Ingresar", "visible:Ingresar",
    "click:Solicitar código por SMS", "click:Continuar"]);
  assert.equal(calls.filter(call => call === "click:Ingresar").length, 1);
  assert.equal(discovered.sourceScenario.auth?.required, false, "authored verification steps own the OTP stage");
});
test("AA-105 style: asserting 'SMS' visibility is not authored verification, AuthFlow still runs", async () => {
  const calls: string[] = [];
  const p = { ...classicPort(calls), async observeAuthStage() { calls.push("observe-stage"); return "otp"; } };
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", expectedResult: "",
    steps: ['Presionar "Solicitar"', 'Validar que esté visible "SMS"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.ok(calls.includes("authenticate"), "AuthFlow must run before business steps");
  assert.equal(discovered.sourceScenario.auth?.required, true);
});
test("jiraAuthorsVerification only matches auth-code actions", () => {
  assert.equal(jiraAuthorsVerification('Presionar "Solicitar código por SMS"'), true);
  assert.equal(jiraAuthorsVerification('Ingresar código de acceso "123456"'), true);
  assert.equal(jiraAuthorsVerification('Confirmar código de acceso'), true);
  assert.equal(jiraAuthorsVerification('Validar código OTP'), true);
  assert.equal(jiraAuthorsVerification('Confirmar token de transferencia'), false);
  assert.equal(jiraAuthorsVerification('Validar que esté visible "SMS"'), false);
  assert.equal(jiraAuthorsVerification('Ingresar token de transferencia "987654"'), false);
  assert.equal(jiraAuthorsVerification('Presionar "Activar notificaciones por SMS"'), false);
});
test("classic login that lands on an unauthored OTP stage continues through AuthFlow after the login steps", async () => {
  const calls: string[] = [];
  const p = { ...classicPort(calls), async observeAuthStage() { calls.push("observe-stage"); return "otp"; } };
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", expectedResult: "", steps: ['Presionar "Solicitar"'] },
    p, {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls, ["navigate", "observe-login", "fill:Usuario", "fill:Contraseña", "click:Ingresar", "observe-stage", "authenticate", "click:Solicitar"]);
  assert.equal(discovered.sourceScenario.auth?.required, true);
  assert.equal(discovered.sourceScenario.auth?.insertionAfterStepIndex, 4);
});
test("implicit login (no authIntent, no authored login) also completes a pending OTP gate before business steps", async () => {
  const calls: string[] = [];
  const p = { ...classicPort(calls), async observeAuthStage() { calls.push("observe-stage"); return "otp"; } };
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: undefined, expectedResult: "",
    steps: ["Abrir la aplicación configurada del proyecto", 'Presionar "Solicitar"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls, ["navigate", "observe-login", "fill:Usuario", "fill:Contraseña", "click:Ingresar", "observe-stage", "authenticate", "click:Solicitar"]);
  assert.equal(discovered.sourceScenario.auth?.required, true);
  assert.equal(discovered.sourceScenario.auth?.insertionAfterStepIndex, 4);
});
test("observed otp stage is handed to authenticate so the flow does not restart from home", async () => {
  const stages: Array<string | undefined> = [];
  const p = { ...classicPort([]), async observeAuthStage() { return "otp"; }, async authenticate(stage?: string) { stages.push(stage); return { success: true }; } };
  await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", expectedResult: "", steps: ['Presionar "Solicitar"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(stages, ["otp"]);
});
test("createJiraPlaywrightPort forwards the observed stage to the auth flow", async () => {
  const seen: Array<string | undefined> = [];
  const page = new EventEmitter() as unknown as Page;
  const port = createJiraPlaywrightPort(page, "http://127.0.0.1:4173/", async stage => { seen.push(stage); return { success: true }; });
  await port.authenticate!("otp");
  await port.authenticate!();
  assert.deepEqual(seen, ["otp", undefined]);
});
// Fake clock: wait() advances time instantly, so no real sleeping.
function stageDeps(frames: string[][], timeoutMs?: number) {
  let t = 0, i = 0;
  const snap = (texts: string[]) => ({ elements: texts.map(text => ({ text, visible: true })) });
  return { scan: async () => snap(frames[Math.min(i++, frames.length - 1)]), wait: async (ms: number) => { t += ms; }, now: () => t, timeoutMs,
    elapsed: () => t };
}
test("auth stage observation waits through a loading state longer than the old 4s poll and returns the OTP stage", async () => {
  const loading = Array.from({ length: 20 }, () => ["Validando credenciales..."]); // 20 x 300ms = 6s > 4s
  const deps = stageDeps([...loading, ["Código de verificación", "Confirmar código"]]);
  assert.equal(await observeAuthStageSettled(deps), "otp");
  assert.ok(deps.elapsed() > 4000);
});
const codeGateDeps = (label: string) => {
  const els = [{ text: "Verificación de acceso", visible: true }, { text: "Confirma tu identidad para continuar al portal empresarial", visible: true },
    { text: label, visible: true }, { tagName: "input", inputType: "text", elementType: "input", label, visible: true }, { tagName: "button", text: "Continuar", visible: true }];
  return { scan: async () => ({ elements: els }), wait: async () => {}, now: (() => { let t = 0; return () => (t += 300); })(), timeoutMs: 6000 };
};
test("auth stage observation classifies the access-code gate (native input + 'Código de acceso') as otp", async () => {
  assert.equal(await observeAuthStageSettled(codeGateDeps("Código de acceso")), "otp");
});
test("auth stage observation does not classify a security-token-only input as otp", async () => {
  assert.notEqual(await observeAuthStageSettled(codeGateDeps("Token de seguridad")), "otp");
});
test("auth stage observation returns undefined immediately on authenticated landing", async () => {
  const deps = stageDeps([["Menú principal", "Transacciones y servicios"]]);
  assert.equal(await observeAuthStageSettled(deps), undefined);
  assert.equal(deps.elapsed(), 0);
});
test("auth stage observation stays bounded when loading never settles", async () => {
  const deps = stageDeps([["Cargando"]], 3000);
  assert.equal(await observeAuthStageSettled(deps), undefined);
  assert.ok(deps.elapsed() <= 3300);
});
test("implicit login without a pending auth stage does not invoke AuthFlow", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario, authIntent: undefined, expectedResult: "", steps: ['Presionar "Solicitar"'] },
    { ...classicPort(calls), async observeAuthStage() { return undefined; } }, {}, () => {}, () => false, undefined, creds);
  assert.ok(!calls.includes("authenticate"));
  assert.equal(discovered.sourceScenario.auth?.required, false);
});
test("a login control still visible after the implicit login (e.g. invalid credentials) is clicked as authored", async () => {
  const calls: string[] = [];
  const p = { ...classicPort(calls), async isTargetVisible() { return true; } };
  await discoverJiraScenario({ ...scenario, authIntent: "full_authentication", expectedResult: "", steps: ['Presionar "Ingresar"'] }, p, {}, () => {}, () => false, undefined, creds);
  assert.equal(calls.filter(call => call === "click:Ingresar").length, 2);
});
test("no-login and gate-observation scenarios never authenticate or probe for a login form", async () => {
  const calls: string[] = [];
  await discoverJiraScenario(scenario, classicPort(calls), {}, () => {}, () => false, undefined, creds);
  assert.deepEqual(calls, ["navigate", "click:Solicitar", "assert:true"]);
  const noLogin: string[] = [];
  await discoverJiraScenario({ ...scenario, authIntent: undefined, steps: ['Presionar "Solicitar"'], expectedResult: "" }, classicPort(noLogin), {}, () => {}, () => false, undefined, undefined);
  assert.deepEqual(noLogin, ["navigate", "click:Solicitar"]);
});

test("unsupported authentication is rejected instead of silently skipped", async () => {
  await assert.rejects(discoverJiraScenario({ ...scenario, authIntent: "full_authentication" }, { ...port([]), authenticate: undefined }), /JIRA_AUTH_FLOW_UNAVAILABLE/);
  await assert.rejects(discoverJiraScenario({ ...scenario, steps: ["Navegar a solicitudes"] }, port([])), /SETUP_OR_ACTION_POLICY_UNSUPPORTED/);
});
test("an expected gate on a click never suppresses the click; source step numbering is preserved", async () => {
  const calls: string[] = [], progress: number[] = [], phases: string[] = [];
  await discoverJiraScenario({ ...scenario, steps: ['Presionar "Solicitar"\nEsperado:pantalla de autenticación para iniciar sesión'] }, port(calls), {}, async (i, phase) => {
    await new Promise(resolve => setTimeout(resolve, 0));
    progress.push(i);
    phases.push(phase);
  });
  assert.deepEqual(calls, ["navigate", "click:Solicitar", "assert:true"]);
  assert.deepEqual(progress, [1, 1, 1, 1]);
  assert.deepEqual(phases, ["resolving", "passed", "resolving", "passed"], "async evidence callbacks complete in step order");
});
test("explicit command keys remain presses on their field, never clicks on a key name", async () => {
  const calls: string[] = [];
  const discovered = await discoverJiraScenario({ ...scenario, steps: ['Presionar "Enter" en "Contraseña"'] }, port(calls));
  assert.deepEqual(calls, ["navigate", "press:Contraseña"]);
  assert.equal(discovered.plan.steps[1].value, "Enter");
});
test("unbacked auth gates are rejected by the compiler", async () => {
  const d = await discoverJiraScenario(scenario, port([]));
  const c = buildSpecExecutionContract(d.plan, d.sourceScenario);
  c.steps[2].oracle!.backed = false;
  const compiled = compileDeterministicSpec(c, { targetSpecPath: path.resolve(".artifacts/jira-fixture/case.spec.ts") });
  assert.ok(compiled.unsupportedCapabilities.some(e => e.includes("auth_gate_unbacked")));
});

test("observed native selection transports its exact field to the runtime completion probe", async () => {
  const p = { ...port([]), async act(step: Parameters<JiraBrowserPort['act']>[0]) {
    step.selectionControlKind = "native_select" as const;
    return { strategy: "css" as const, value: "#currency" };
  } };
  const d = await discoverJiraScenario({ ...scenario, steps: ['Seleccionar "USD" en "Moneda"'] }, p);
  const compiled = compileDeterministicSpec(buildSpecExecutionContract(d.plan, d.sourceScenario), { targetSpecPath: path.resolve(".artifacts/jira-fixture/case.spec.ts") });
  assert.deepEqual(compiled.unsupportedCapabilities, []);
  assert.match(compiled.source, /technicalTargetRefs: \['css:#currency'\]/);
  assert.match(compiled.source, /selectOption/);
  assert.doesNotMatch(compiled.source, /playwrightRecorderEvidence/);
});

test("explicit absence preserves negative polarity through Jira compilation", async () => {
 for (const label of ['Resumen de productos','Application dashboard']) {
  const calls:string[]=[];
  const result=await discoverJiraScenario({...scenario,steps:['Validar que se muestre "Error"', `Validar que no se muestre "${label}"`]}, {...port(calls),async assertAbsent(target){calls.push('absent:'+target);return {absent:true};}});
  assert.ok(calls.includes('absent:'+label));
  const {compileJiraSpec}=await import('./jira-spec-compiler');
  const compiled=compileJiraSpec({plan:result.plan,sourceScenario:result.sourceScenario,appSlug:'synthetic',sectionSlug:'section',automationId:'fixture',specPath:'fixture/case.spec.ts'});
  assert.deepEqual(compiled.unsupported,[]);
  assert.ok(compiled.source.includes('await assertJiraSpecAbsentText(page, '+JSON.stringify(label)+')'));
 }
});
test("absence fails without observed context or when the page contradicts it", async () => {
 await assert.rejects(discoverJiraScenario({...scenario,steps:['Validar que no se muestre "Panel"']},{...port([]),async assertAbsent(){return {absent:true};}}),/OBSERVED_CONTEXT/);
 await assert.rejects(discoverJiraScenario({...scenario,steps:['Validar que se muestre "Error"','Validar que no se muestre "Panel"']},{...port([]),async assertAbsent(){throw new Error('still visible');}}),/still visible/);
});

test("absence runtime inspects every exact match and waits for visible duplicates", async () => {
 const {assertJiraSpecAbsentText}=await import('./jira-spec-runtime');
 let scans=0;
 const page={getByText(target:string,options:unknown){assert.equal(target,'Panel');assert.deepEqual(options,{exact:true});return {async all(){scans++;return [{async isVisible(){return false;}},{async isVisible(){return scans < 2;}}];}};}};
 await assertJiraSpecAbsentText(page as never,'Panel');assert.ok(scans>=2);
 await assert.rejects(assertJiraSpecAbsentText(page as never,''),/TARGET_MISSING/);
});

test("channel requests are authored semantic clicks certified only by live port targets", async () => {
 for(const channel of ['SMS','email']) {
  let seen='';const result=await discoverJiraScenario({...scenario,steps:[`Solicitar el código por ${channel}.`]}, {...port([]),async act(_step,target){seen=target;return {strategy:'role',role:'button',name:'Observed send control'};}});
  assert.equal(seen,`Solicitar el código por ${channel}`);
  assert.equal(result.plan.steps[1].action,'click');
  assert.equal((result.plan.steps[1].target as {name:string}).name,'Observed send control');
 }
});
test("conditional outcomes remain blocked until test setup is declared",async()=>{
 for(const step of ['Validar que se muestre "Rate" cuando aplique.','Presionar "Continue" con la condición de que la transferencia no se complete.']) {
 await assert.rejects(discoverJiraScenario({...scenario,steps:[step]},port([])),/TEST_CONDITION_UNDECLARED/);
 }
});

test("Jira native selection chooses a semantic account match while preserving specific criteria",()=>{
 const options=[
  {value:'acct-current-001',label:'001 · Cuenta Corriente · DOP'},
  {value:'acct-savings-002',label:'002 · Cuenta de Ahorros · DOP'},
 ];
 assert.deepEqual(resolveJiraNativeOption(options,'Cuenta corriente'),options[0]);
 assert.deepEqual(resolveJiraNativeOption(options,'Cuenta ahorros'),options[1]);
 const repeated=[...options,{value:'acct-current-003',label:'003 · Cuenta corriente · USD'}];
 assert.ok([options[0],repeated[2]].includes(resolveJiraNativeOption(repeated,'Cuenta corriente')!));
 assert.deepEqual(resolveJiraNativeOption(repeated,'Cuenta corriente USD'),repeated[2]);
 assert.equal(resolveJiraNativeOption(options,'Cuenta nómina'),undefined);
 const addressDuration=[
  {value:'',label:'Seleccione una opción'},
  {value:'under-one-year',label:'Menos de 1 año'},
  {value:'one-to-three-years',label:'De 1 a 3 años'},
 ];
 assert.equal(resolveJiraNativeOption(addressDuration,'Dato ficticio de prueba'),undefined);
 assert.deepEqual(resolveJiraNativeOption(addressDuration,'Dato ficticio de prueba',true),addressDuration[1]);
 assert.equal(resolveJiraNativeOption(addressDuration,'Más de 10 años'),undefined);
});

test("Jira native account option matching handles vowel-ending plural labels",()=>{
 const option={value:'qa-current',label:'Cuenta Corrientes'};
 assert.deepEqual(resolveJiraNativeOption([option],'Cuenta Corriente'),option);
});

test("Jira waits for an async SPA form after a click before resolving the next input", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button id="accounts">Cuentas Propias</button>`);
    await page.getByRole("button", { name: "Cuentas Propias" }).click();
    await page.evaluate(() => window.setTimeout(() => {
      const input = document.createElement("input");
      input.setAttribute("aria-label", "Cuenta de origen");
      input.id = "origin";
      document.body.append(input);
    }, 80));
    const snapshot = await scanCurrentPage(page);
    const step = { action: "fill", description: "Ingresar cuenta de origen", target: { strategy: "label", value: "cuenta de origen" } } as ExecutionPlanStep;
    const resolved = await resolveJiraStepTargetAfterClick(page, step, "cuenta de origen", snapshot);
    assert.equal(resolved.status, "resolved");
    assert.ok(resolved.locator);
    assert.equal(await resolved.locator!.getAttribute("id"), "origin");
  } finally {
    await browser.close();
  }
});

test("Jira semantic row ordinals bind repeated table fields to the requested row", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table>
        <thead><tr><th>Concepto</th><th>Importe mensual</th><th>Frecuencia</th></tr></thead>
        <tbody>
          <tr data-row-key="income-1"><td><select aria-label="Tipo de ingreso fila 1"><option value="">Seleccione tipo</option><option value="salary">Salario</option><option value="fees">Honorarios</option></select></td><td><input aria-label="Importe mensual"></td><td><select aria-label="Frecuencia"><option value="">Seleccione frecuencia</option><option value="monthly">Mensual</option></select></td></tr>
          <tr data-row-key="income-2"><td><select aria-label="Tipo de ingreso fila 2"><option value="">Seleccione tipo</option><option value="salary">Salario</option><option value="fees">Honorarios</option></select></td><td><input aria-label="Importe mensual"></td><td><select aria-label="Frecuencia"><option value="">Seleccione frecuencia</option><option value="monthly">Mensual</option></select></td></tr>
        </tbody>
      </table>`);
    const typeStep: ExecutionPlanStep = { index: 1, action: "select", description: "select type" };
    const type = await resolveJiraStepTargetAfterClick(page, typeStep, "Tipo", await scanCurrentPage(page), "Seleccionar tipo de ingreso de la segunda fila en Tipo");
    assert.equal(type.status, "resolved");
    assert.equal(await type.locator!.evaluate(element => element.closest("tr")?.getAttribute("data-row-key")), "income-2");
    await type.locator!.selectOption("fees");
    const amountStep: ExecutionPlanStep = { index: 2, action: "fill", description: "fill amount" };
    const amount = await resolveJiraStepTargetAfterClick(page, amountStep, "Importe mensual", await scanCurrentPage(page), "Ingresar importe mensual de la segunda fila en Importe mensual");
    assert.equal(amount.status, "resolved");
    assert.equal(await amount.locator!.evaluate(element => element.closest("tr")?.getAttribute("data-row-key")), "income-2");
    await amount.locator!.fill("1250");
    assert.deepEqual(await page.locator("tbody tr").evaluateAll(rows => rows.map(row => ({
      type: (row.querySelector("select") as HTMLSelectElement).value,
      amount: (row.querySelector("input") as HTMLInputElement).value,
    }))), [{ type: "", amount: "" }, { type: "fees", amount: "1250" }]);
  } finally {
    await browser.close();
  }
});

test("Jira explicit row select fails closed instead of using a slider or textbox from another row", async () => {
  const browser = await chromium.launch({ headless: true });
  __setJiraDomTargetResolverForTesting(async () => undefined);
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><tbody>
        <tr data-row-key="r1"><td><input type="range" aria-label="Plazo"></td></tr>
        <tr data-row-key="r2"><td>vacía</td></tr>
      </tbody></table>`);
    const step: ExecutionPlanStep = { index: 1, action: "select", description: "select term" };
    // Immediate resolver: the AfterClick variant would wait the 90s DOM deadline for a deliberately missing control.
    const slider = await resolveJiraStepTarget(page, step, "Plazo", await scanCurrentPage(page), "Seleccionar plazo de la segunda fila en Plazo");
    assert.equal(slider.status, "not_found");
    await page.setContent(`
      <table><tbody>
        <tr data-row-key="r1"><td><input aria-label="Plazo"></td></tr>
        <tr data-row-key="r2"><td>vacía</td></tr>
      </tbody></table>`);
    const textbox = await resolveJiraStepTarget(page, step, "Plazo", await scanCurrentPage(page), "Seleccionar plazo de la segunda fila en Plazo");
    assert.equal(textbox.status, "not_found");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

// Mirrors the lab app: state + render() rebuilds EVERY row node on each add; only ids/data-row-id persist.
// `stable: false` renders rows without any id/name/data attribute (identity not observable).
const ADDED_ROW_TABLE = (addCount: number, stable = true) => `
  <table><tbody id="rows"></tbody></table>
  <button type="button" id="add">Agregar fila</button>
  <script>(() => {
    const state = { ids: [1], next: 2 };
    const stable = ${stable};
    const render = () => { document.getElementById("rows").innerHTML = state.ids.map(id =>
      "<tr" + (stable ? ' data-row-id="' + id + '"' : "") + "><td><select" + (stable ? ' id="freq-' + id + '"' : "") + ' aria-label="Frecuencia">' +
      '<option value="">Seleccione</option><option value="m">Mensual</option></select></td></tr>').join(""); };
    render();
    document.getElementById("add").onclick = () => { for (let i = 0; i < ${addCount}; i += 1) state.ids.push(state.next++); render(); };
  })();</script>`;

async function clickAddRowAndObserve(page: import("@playwright/test").Page) {
  await snapshotJiraRows(page);
  await page.getByRole("button", { name: "Agregar fila" }).click();
  return markJiraAddedRow(page);
}

test("Jira added-row wording resolves controls only inside the one observed new row", async () => {
  const browser = await chromium.launch({ headless: true });
  __setJiraDomTargetResolverForTesting(async () => undefined);
  try {
    const page = await browser.newPage();
    await page.setContent(ADDED_ROW_TABLE(1));
    const oldRow = await page.locator("tr[data-row-id='1']").elementHandle();
    assert.equal(await clickAddRowAndObserve(page), true);
    // render() replaced the pre-existing row node; it kept identity through data-row-id/id, so only row 2 is new.
    assert.equal(await oldRow!.evaluate(el => el.isConnected), false);
    assert.equal(await page.locator("[data-qa-jira-added-row]").getAttribute("data-row-id"), "2");
    const step: ExecutionPlanStep = { index: 1, action: "select", description: "select frequency" };
    const result = await resolveJiraStepTarget(page, step, "Frecuencia", await scanCurrentPage(page),
      "Seleccionar frecuencia en la fila agregada", page.locator("[data-qa-jira-added-row]"));
    assert.equal(result.status, "resolved");
    // Row 1 is also named "Frecuencia": prove the resolved control lives in the new row by identity, not position.
    assert.equal(await result.locator!.evaluate(el => el.closest("tr")!.hasAttribute("data-qa-jira-added-row")), true);
    await result.locator!.selectOption("m");
    assert.deepEqual(await page.locator("select").evaluateAll(els => els.map(el => (el as HTMLSelectElement).value)), ["", "m"]);
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

// Whole-table replacement after an intervening submit: rows keep observed ids/names but lose the DOM marker.
const REPLACED_ROWS_TABLE = `
  <table><tbody id="rows"></tbody></table>
  <button type="button" id="add">Agregar fila</button>
  <script>(() => {
    const state = { ids: [1], next: 2 };
    window.__ids = state.ids;
    const render = () => { document.getElementById("rows").innerHTML = state.ids.map(id =>
      '<tr><td><input name="amount-' + id + '" aria-label="Monto"></td></tr>').join(""); };
    render();
    window.__render = render;
    document.getElementById("add").onclick = () => { state.ids.push(state.next++); render(); };
  })();</script>`;

test("Jira added row is re-identified by observed identity after whole-table replacement", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(500);
    await page.setContent(REPLACED_ROWS_TABLE);
    assert.equal(await clickAddRowAndObserve(page), true);
    await page.locator("input[name='amount-1']").fill("100");
    // Intervening submit: every row node replaced, marker lost, ids/names preserved.
    await page.evaluate(() => (window as any).__render());
    assert.equal(await page.locator("[data-qa-jira-added-row]").count(), 0);
    const row = await relocateJiraAddedRow(page);
    assert.ok(row);
    await row!.getByRole("textbox", { name: "Monto" }).fill("0");
    assert.deepEqual(await page.locator("input").evaluateAll(els => els.map(el => (el as HTMLInputElement).value)), ["", "0"]);
    // Identity lost: no row carries the observed tokens any more.
    await page.evaluate(() => { document.querySelector("input[name='amount-2']")!.setAttribute("name", "renamed"); });
    assert.equal(await relocateJiraAddedRow(page), undefined);
    // Identity duplicated: two rows carry the observed tokens.
    await page.evaluate(() => { document.querySelector("input[name='renamed']")!.setAttribute("name", "amount-2");
      document.querySelector("input[name='amount-1']")!.setAttribute("name", "amount-2"); });
    assert.equal(await relocateJiraAddedRow(page), undefined);
  } finally {
    await browser.close();
  }
});

test("Jira added-row fill resolves a semantically aliased label only inside the relocated row", async () => {
  const browser = await chromium.launch({ headless: true });
  __setJiraDomTargetResolverForTesting(async () => undefined);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(500);
    await page.setContent(`
      <table><tbody id="rows"></tbody></table>
      <button type="button" id="add">Agregar fila</button>
      <script>(() => {
        const state = { ids: [1], next: 2 };
        const render = () => { document.getElementById("rows").innerHTML = state.ids.map(id =>
          '<tr><td><input name="amount-' + id + '" aria-label="Importe de ingreso fila ' + id + '"></td></tr>').join(""); };
        render();
        window.__render = render;
        document.getElementById("add").onclick = () => { state.ids.push(state.next++); render(); };
      })();</script>`);
    assert.equal(await clickAddRowAndObserve(page), true);
    await page.evaluate(() => (window as any).__render()); // marker lost; identity survives
    const step: ExecutionPlanStep = { index: 1, action: "fill", description: "Ingresar importe en la fila agregada" };
    const target = "Importe mensual de la fila agregada";
    const resolve = async () => resolveJiraStepTarget(page, step, target, await scanCurrentPage(page), target, await relocateJiraAddedRow(page));
    const result = await resolve();
    assert.equal(result.status, "resolved");
    await result.locator!.fill("0");
    assert.deepEqual(await page.locator("input").evaluateAll(els => els.map(el => (el as HTMLInputElement).value)), ["", "0"]);
    // Ambiguity inside the row: a second qualifying control fails closed.
    await page.evaluate(() => { document.querySelector("input[name='amount-2']")!.insertAdjacentHTML("afterend", '<input aria-label="Importe adicional">'); });
    assert.equal((await resolve()).status, "ambiguous");
    // Lost identity: fails closed without searching the page.
    await page.evaluate(() => { document.querySelector("input[name='amount-2']")!.setAttribute("name", "renamed"); });
    assert.equal((await resolve()).status, "ambiguous");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira added-row wording fails closed when no unique new row identity is proven", async () => {
  const browser = await chromium.launch({ headless: true });
  __setJiraDomTargetResolverForTesting(async () => undefined);
  try {
    const page = await browser.newPage();
    const step: ExecutionPlanStep = { index: 1, action: "select", description: "select frequency" };
    const context = "Seleccionar frecuencia en la fila agregada";
    page.setDefaultTimeout(500); // bounded readiness for the "nothing new" cases
    // Two rows added by one click: ambiguous identity.
    await page.setContent(ADDED_ROW_TABLE(2));
    assert.equal(await clickAddRowAndObserve(page), false);
    const ambiguous = await resolveJiraStepTarget(page, step, "Frecuencia", await scanCurrentPage(page), context,
      page.locator("[data-qa-jira-added-row]"));
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.locator, undefined);
    // Click adds nothing: nothing to associate.
    await page.setContent(ADDED_ROW_TABLE(0));
    assert.equal(await clickAddRowAndObserve(page), false);
    // Rows expose no id/name/data attribute: structural identity is not observable, even though a row was added.
    await page.setContent(ADDED_ROW_TABLE(1, false));
    assert.equal(await clickAddRowAndObserve(page), false);
    // Unscoped select (no added-row wording, no observation) keeps its normal resolution on a re-rendered table.
    await page.setContent(ADDED_ROW_TABLE(0));
    const unscoped = await resolveJiraStepTarget(page, step, "Frecuencia", await scanCurrentPage(page), "Seleccionar frecuencia");
    assert.equal(unscoped.status, "resolved");
    assert.equal(await unscoped.locator!.getAttribute("id"), "freq-1");
    // No add-row click observed at all.
    const unobserved = await resolveJiraStepTarget(page, step, "Frecuencia", await scanCurrentPage(page), context);
    assert.equal(unobserved.status, "ambiguous");
    assert.equal(unobserved.matchReason, "added_row_identity_unproven");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira add-row detection is wording-only and unscoped selects keep their behavior", async () => {
  assert.equal(jiraRefersToAddedRow("Seleccionar frecuencia en la nueva fila"), true);
  assert.equal(jiraRefersToAddedRow("Select frequency in the newly added row"), true);
  assert.equal(jiraRefersToAddedRow("Seleccionar frecuencia en la segunda fila"), false);
  assert.equal(jiraRefersToAddedRow("Seleccionar frecuencia"), false);
  const browser = await chromium.launch({ headless: true });
  __setJiraDomTargetResolverForTesting(async () => undefined);
  try {
    const page = await browser.newPage();
    await page.setContent(`<label>Moneda<select id="c"><option value="">Seleccione</option><option value="usd">USD</option></select></label>`);
    const step: ExecutionPlanStep = { index: 1, action: "select", description: "select currency" };
    const result = await resolveJiraStepTarget(page, step, "Moneda", await scanCurrentPage(page), "Seleccionar moneda");
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.getAttribute("id"), "c");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira fill tries the observed-editable fallback immediately instead of waiting on an SMS request button", async () => {
  const browser = await chromium.launch({ headless: true });
  __setJiraDomTargetResolverForTesting(async (_intent, candidates) => {
    const textbox = candidates.find(candidate => candidate.role === "textbox" || candidate.tagName === "input");
    return textbox ? { candidateId: textbox.id, confidence: 0.95 } : undefined;
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button type="button">Enviar código SMS</button><label>Código de acceso<input id="access"></label>`);
    const step: ExecutionPlanStep = { index: 1, action: "fill", description: "fill sms code" };
    const startedAt = Date.now();
    const result = await resolveJiraStepTarget(page, step, "Código SMS", await scanCurrentPage(page), "Ingresar código SMS en Código SMS");
    assert.ok(Date.now() - startedAt < 10000, "button candidate must not be waited on");
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.getAttribute("id"), "access");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira contextual ordinal binds duplicate accessible labels to the named entity", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<label>Nombre de referencia 1<input value=""></label><label>Nombre de referencia 2<input value=""></label>`);
    const step: ExecutionPlanStep = { index: 1, action: "fill", description: "fill reference name" };
    const result = await resolveJiraStepTargetAfterClick(page, step, "Nombre", await scanCurrentPage(page), "Ingresar nombre de referencia 2 en Nombre");
    assert.equal(result.status, "resolved");
    await result.locator!.fill("Referencia Dos");
    assert.deepEqual(await page.locator("input").evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)), ["", "Referencia Dos"]);
  } finally {
    await browser.close();
  }
});

test("Jira selection uses an explicit repeated-entity qualifier to resolve the matching field", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<label>Relación de referencia 1<select id="reference-1"><option>Familiar</option></select></label>
      <label>Relación de referencia 2<select id="reference-2"><option>Familiar</option></select></label>`);
    const step: ExecutionPlanStep = { index: 67, action: "select", description: 'Seleccionar relación en "Relación" de referencia 1.' };
    const result = await resolveJiraStepTarget(page, step, "Relación", await scanCurrentPage(page), step.description);
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.getAttribute("id"), "reference-1");
  } finally {
    await browser.close();
  }
});

test("Jira selection assistance receives the full step context for a semantic UI label", async () => {
  const browser = await chromium.launch({ headless: true });
  let receivedIntent = "";
  __setJiraDomTargetResolverForTesting(async (intent, candidates) => {
    receivedIntent = intent;
    const candidate = candidates.find(item => item.label === "¿Autorizas consulta de historial crediticio?");
    return candidate && /seleccionar autorización/i.test(intent) ? { candidateId: candidate.id, confidence: 0.9 } : undefined;
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<label for="credit">¿Autorizas consulta de historial crediticio?</label>
      <select id="credit"><option>Sí, autorizo</option><option>No autorizo</option></select>`);
    const description = 'Seleccionar autorización en "Autorización de consulta crediticia".';
    const step: ExecutionPlanStep = { index: 77, action: "select", description };
    const result = await resolveJiraStepTarget(page, step, "Autorización de consulta crediticia", await scanCurrentPage(page), description);
    assert.equal(result.status, "resolved");
    assert.match(receivedIntent, /seleccionar autorización/i);
    assert.equal(await result.locator!.getAttribute("id"), "credit");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira action assistance receives the full step context when labels differ", async () => {
  const browser = await chromium.launch({ headless: true });
  let receivedIntent = "";
  __setJiraDomTargetResolverForTesting(async (intent, candidates) => {
    receivedIntent = intent;
    const candidate = candidates.find(item => item.label === "Revisar solicitud");
    return candidate ? { candidateId: candidate.id, confidence: 0.9 } : undefined;
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button>Revisar solicitud</button>`);
    const step: ExecutionPlanStep = { index: 1, action: "click", description: "click continue" };
    const result = await resolveJiraStepTargetAfterClick(page, step, "Continuar", await scanCurrentPage(page), "Presionar Continuar para revisar la solicitud personal");
    assert.equal(result.status, "resolved");
    assert.match(receivedIntent, /revisar la solicitud personal/i);
    assert.equal(await result.locator!.innerText(), "Revisar solicitud");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira continue resolves only one observed forward-stage action", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button>Volver</button><button>Revisar solicitud</button>`);
    const step: ExecutionPlanStep = { index: 1, action: "click", description: "click continue" };
    const result = await resolveJiraStepTargetAfterClick(page, step, "Continuar", await scanCurrentPage(page), "Presionar Continuar para revisar la solicitud");
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.innerText(), "Revisar solicitud");
  } finally {
    await browser.close();
  }
});

test("business scenario without login steps satisfies an observed classic login gate with profile credentials; explicit or gated scenarios do not", async () => {
  const { discoverJiraScenario } = await import("./jira-semantic-executor");
  const run = async (steps: string[], authIntent: "gate_observation" | undefined, implicit = true) => {
    const calls: string[] = [];
    const browser = { async navigate() { calls.push("navigate"); }, async observeClassicLogin() { calls.push("observe"); return { username: "Usuario", password: "Contraseña", submit: "Entrar" }; },
      async act(_s: unknown, target: string, value?: string) { calls.push(`act:${target}:${value ?? ""}`); return { strategy: "css" as const, value: "#x" }; },
      async assert(target: string) { calls.push(`assert:${target}`); return { observedText: target }; } };
    const discovered = await discoverJiraScenario({ scenarioId: "J-1", sourceIssueKey: "AA-1", title: "t", steps, expectedResult: "", authIntent },
      browser as never, {}, undefined, undefined, undefined, implicit ? { username: "u1", password: "p1" } : undefined);
    return { calls, discovered };
  };
  const business = await run(['Validar que se muestre "Inicio"'], undefined);
  assert.deepEqual(business.calls, ["navigate", "observe", "act:Usuario:u1", "act:Contraseña:p1", "act:Entrar:", "assert:Inicio"]);
  assert.deepEqual(business.discovered.runtimeEntries.map(e => e.key), ["auth.username", "auth.password"]);
  assert.ok(!JSON.stringify(business.discovered.plan).includes("p1"));
  const compiled = compileJiraSpec({ plan: business.discovered.plan, sourceScenario: business.discovered.sourceScenario,
    appSlug: "generic-app", sectionSlug: "jira-aa-1", automationId: "auth-fixture", specPath: path.resolve(".artifacts/tmp/auth-fixture/case.spec.ts") });
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /resolveJiraSpecValue\("auth\.username"/);
  assert.match(compiled.source, /resolveJiraSpecValue\("auth\.password"/);
  assert.ok(!compiled.source.includes("u1") && !compiled.source.includes("p1"));
  const explicit = await run(['Ingresar "synthetic-user" en "Usuario"', 'Ingresar "synthetic-pass" en "Contraseña"', 'Presionar "Entrar"'], undefined);
  assert.ok(!explicit.calls.includes("observe"));
  assert.ok(!explicit.calls.some(c => c.includes(":u1") || c.includes(":p1")));
  assert.equal(explicit.calls.filter(c => c.startsWith("act:")).length, 3);
  assert.ok(!explicit.discovered.runtimeEntries.some(e => e.key.startsWith("auth.")));
  assert.ok(!(await run(['Validar que se muestre "Inicio"'], "gate_observation")).calls.includes("observe"));
  assert.ok(!(await run(['Validar que se muestre "Inicio"'], undefined, false)).calls.includes("observe"));
});

test("Jira visible-text assertion can bind an exact signed-in identity from the non-navigation header and compiles that scope", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<header><nav><a>Inicio</a></nav><div><span>María Pérez</span></div></header><main><h1>Bienvenida</h1></main>');
    const port = createJiraPlaywrightPort(page, "http://localhost/");
    const headerObservation = await port.assert("María Pérez", false);
    assert.equal(headerObservation.observedText, "María Pérez");
    assert.equal(headerObservation.assertionScope, "header");
    const pageObservation = await port.assert("Bienvenida", false);
    assert.equal(pageObservation.observedText, "Bienvenida");
    assert.equal(pageObservation.assertionScope, undefined);

    const { discoverJiraScenario } = await import("./jira-semantic-executor");
    const discovered = await discoverJiraScenario({ scenarioId: "AA-1:jira:1", sourceIssueKey: "AA-1", title: "Signed-in identity",
      steps: ['Validar que se muestre "María Pérez"'], expectedResult: "" }, { ...port, async navigate() {} } as never);
    const step = discovered.plan.steps.find(item => item.action === "assertVisible");
    assert.equal(step?.target && typeof step.target === "object" ? step.target.assertionScope : undefined, "header");
    assert.equal(discovered.sourceScenario.observableOracles?.[0]?.details?.assertionScope, "header");
    const compiled = compileJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario, appSlug: "generic-app",
      sectionSlug: "jira-aa-1", automationId: "header-assertion", specPath: path.resolve(".artifacts/tmp/header-assertion/case.spec.ts") });
    assert.deepEqual(compiled.unsupported, []);
    assert.match(compiled.source, /assertJiraSpecHeaderText\(page, "María Pérez"/);
  } finally {
    await browser.close();
  }
});

test("Jira classic-login observation requires one unambiguous visible form", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<h1>Iniciar sesión</h1><form><label for="user">Usuario</label><input id="user"><label for="pass">Contraseña</label><input id="pass" type="password"><button type="submit">Entrar</button></form>`);
    const port = createJiraPlaywrightPort(page, "http://localhost/");
    assert.deepEqual(await port.observeClassicLogin?.(), { username: "Usuario", password: "Contraseña", submit: "Entrar" });
    await page.setContent(`<h1>Iniciar sesión</h1><form><label for="user">Usuario</label><input id="user"><label for="pass1">Contraseña</label><input id="pass1" type="password"><label for="pass2">Confirmar contraseña</label><input id="pass2" type="password"><button type="submit">Entrar</button></form>`);
    assert.equal(await port.observeClassicLogin?.(), undefined);
    // Business-style form: RNC + Usuario + Contraseña. Roles come from labels, not position.
    await page.setContent(`<form><label for="rnc">RNC</label><input id="rnc"><label for="user">Usuario</label><input id="user"><label for="pass">Contraseña</label><input id="pass" type="password"><button type="submit">Entrar</button></form>`);
    assert.deepEqual(await port.observeClassicLogin?.(), { username: "Usuario", password: "Contraseña", submit: "Entrar",
      extra: [{ label: "RNC", role: "company_identifier" }] });
    // Unknown optional control is ignored; unknown required control blocks with a reason.
    await page.setContent(`<form><label for="u">Usuario</label><input id="u"><label for="n">Apodo</label><input id="n"><label for="p">Contraseña</label><input id="p" type="password"><button type="submit">Entrar</button></form>`);
    assert.deepEqual(await port.observeClassicLogin?.(), { username: "Usuario", password: "Contraseña", submit: "Entrar" });
    await page.setContent(`<form><label for="u">Usuario</label><input id="u"><label for="n">Apodo</label><input id="n" required><label for="p">Contraseña</label><input id="p" type="password"><button type="submit">Entrar</button></form>`);
    assert.deepEqual(await port.observeClassicLogin?.(), { blocked: "JIRA_LOGIN_FIELD_UNIDENTIFIED" });
  } finally {
    await browser.close();
  }
});
