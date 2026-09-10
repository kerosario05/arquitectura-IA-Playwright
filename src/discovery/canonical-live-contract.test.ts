import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { parseScenarioStepsForDiscovery, evaluateEarlyCompletion, buildCandidateRequiredData } from "./case-discovery";
import { parseStepIntent } from "./step-intent-parser";
import type { AssertionTargetInput } from "./assertion-resolver";
import { EvidenceRecorder } from "../evidence/evidence-recorder";
import { extractTestRailInputRequirements } from "../testrail/testrail-input-requirements-adapter";
import { transformTestRailCaseForRuntime } from "../testrail/testrail-runtime-transformer";
import { extractCanonicalInputRequirements } from "../testrail/testrail-canonical-adapter";
import { normalizeTestRailCase } from "../testrail/testrail-normalizer";

test("canonical parser emits structured oracle types for row, structural, and container assertions", () => {
  const row = parseStepIntent("En la segunda fila, validar que el nombre sea [employee_2.expected_name]")[0];
  const structural = parseStepIntent("Validar que se agregue una segunda línea")[0];
  const container = parseStepIntent("Dentro de la sección, validar que exista [employee_1.document]")[0];

  assert.equal(row.canonicalAssertion?.oracleType, "row_scoped_value");
  assert.equal(row.expectedValueKey, "employee_2.expected_name");
  assert.equal(row.rowScope, 2);
  assert.equal(structural.canonicalAssertion?.oracleType, "structural_row_count");
  assert.equal(container.canonicalAssertion?.oracleType, "entity_within_container");
});

test("scenario projection preserves canonical oracle and binds its prerequisite", () => {
  const parsed = parseScenarioStepsForDiscovery({
    title: "structured scenario",
    steps: [
      { index: 1, action: "Clic en agregar una nueva fila" },
      { index: 2, action: "Validar que se agregue una segunda línea" },
      { index: 3, action: "En la segunda fila, validar que el nombre sea [employee_2.expected_name]" },
    ],
  } as any);

  const structural = parsed.assertionTargets.find((target) => target.canonicalAssertion?.oracleType === "structural_row_count");
  const row = parsed.assertionTargets.find((target) => target.canonicalAssertion?.oracleType === "row_scoped_value");
  assert.equal(structural?.triggerStepIndex, 1);
  assert.equal(row?.triggerStepIndex, 2);
  assert.equal(row?.expectedValueKey, "employee_2.expected_name");
});

test("future structured oracle is not eligible before its trigger", () => {
  const assertion: AssertionTargetInput = {
    index: 5,
    action: "Validar que el nombre sea [employee_1.expected_name]",
    target: "el nombre sea [employee_1.expected_name]",
    source: "action",
    rowScope: 1,
    expectedValueKey: "employee_1.expected_name",
    canonicalAssertion: {
      intent: "validation_present",
      expectedState: "el nombre sea [employee_1.expected_name]",
      oracleType: "row_scoped_value",
      prerequisite: "source_value_resolved",
    },
    triggerStepIndex: 4,
  };
  const result = evaluateEarlyCompletion(
    { title: "", url: "", elements: [], summary: { buttons: 0, inputs: 0, links: 0, headings: 0, dialogs: 0 } } as any,
    [assertion],
    [],
    undefined,
    { currentStepIndex: 2 },
  );
  assert.equal(result.deferredAssertions.length, 1);
  assert.equal(result.pendingAssertions.length, 0);
  assert.equal(result.satisfied, false);
});

test("candidate requiredData declares consumed auth keys before plan validation", () => {
  const requiredData = buildCandidateRequiredData({
    runtimeInputRequirements: [
      { key: "auth.company_identifier", required: true, source: "user_entered" },
      { key: "auth.username", required: true, source: "user_entered" },
      { key: "auth.password", required: true, source: "user_entered" },
    ],
  } as any, [
    { index: 1, action: "fill", target: { strategy: "text", value: "company" }, valueKey: "auth.company_identifier" },
    { index: 2, action: "fill", target: { strategy: "text", value: "username" }, valueKey: "auth.username" },
    { index: 3, action: "fill", target: { strategy: "text", value: "password" }, valueKey: "auth.password" },
  ] as any);
  const declared = new Set(requiredData.map((entry) => entry.key));
  assert.deepEqual([...declared].sort(), ["auth.company_identifier", "auth.password", "auth.username"]);
  assert.equal(requiredData.every((entry) => entry.resolved), true);
});

test("fresh input contract remains complete through Canonical, candidate, and persisted partial plan", () => {
  const employeeFields = [
    ["document", "text"],
    ["expected_name", "text"],
    ["expected_birth_date", "date"],
    ["position", "text"],
    ["currency", "select"],
    ["income", "number"],
    ["email", "email"],
    ["residential_phone", "tel"],
    ["phone", "tel"],
    ["hire_date", "date"],
    ["expected_section", "select"],
  ] as const;
  const declarations = [
    ["RNC", "auth.company_identifier", "text"],
    ["Usuario", "auth.username", "text"],
    ["Contraseña", "auth.password", "secret"],
    ...[1, 2].flatMap((ordinal) => employeeFields.map(([field, type]) => [
      `Empleado ${ordinal} ${field}`,
      `employee_${ordinal}.${field}`,
      type,
    ] as const)),
  ];
  const rawCase = {
    id: 99001,
    title: "Fresh contract fixture",
    custom_preconds: [
      "Datos de ejecución requeridos:",
      ...declarations.map(([label, key, type], index) => `${index + 1}. - ${label} (${key}, ${type})`),
    ].join("\n"),
    custom_steps_separated: [
      { content: "Ingresar [auth.company_identifier]." },
      { content: "Ingresar [auth.username]." },
      { content: "Ingresar [auth.password]." },
    ],
  } as any;

  const testrail = extractTestRailInputRequirements(rawCase);
  const runtime = transformTestRailCaseForRuntime(rawCase);
  const normalized = normalizeTestRailCase(rawCase);
  const scenario = {
    ...normalized,
    raw: rawCase,
    canonicalInputRequirements: extractCanonicalInputRequirements(rawCase),
    runtimeInputRequirements: runtime.inputRequirements,
  } as any;
  const partialSteps = [
    { index: 1, action: "fill", valueKey: "auth.company_identifier" },
    { index: 2, action: "fill", valueKey: "auth.username" },
    { index: 3, action: "fill", valueKey: "auth.password" },
  ] as any;
  const candidate = buildCandidateRequiredData(scenario, partialSteps);
  const persisted = JSON.parse(JSON.stringify({ requiredData: candidate })).requiredData;
  const authoritativeKeys = new Set(testrail.requirements.map((requirement) => requirement.key));
  const currentKeys = new Set(candidate.map((requirement) => requirement.key));
  const missingKeys = [...authoritativeKeys].filter((key) => !currentKeys.has(key));

  assert.equal(testrail.requirements.length, 25);
  assert.equal(extractCanonicalInputRequirements(rawCase).length, 25);
  assert.equal(runtime.inputRequirements.length, 25);
  assert.equal(candidate.length, 25);
  assert.equal(persisted.length, 25);
  assert.deepEqual(missingKeys, []);
  assert.deepEqual(
    candidate.filter((requirement) => !authoritativeKeys.has(requirement.key)).map((requirement) => requirement.key),
    [],
  );
  assert.equal(candidate.filter((requirement) => requirement.key.startsWith("auth.")).length, 3);
  assert.equal(candidate.filter((requirement) => requirement.key.startsWith("employee_1.")).length, 11);
  assert.equal(candidate.filter((requirement) => requirement.key.startsWith("employee_2.")).length, 11);
  assert.equal(candidate.find((requirement) => requirement.key === "employee_1.expected_name")?.valueRole, "expected_oracle");
  assert.equal(candidate.find((requirement) => requirement.key === "employee_2.expected_birth_date")?.valueRole, "expected_oracle");
});

test("successful capture does not become scenario success after failed discovery", async () => {
  const outputRoot = path.join(os.tmpdir(), `qa-evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const recorder = new EvidenceRecorder({
    appSlug: "fixture-app",
    sectionSlug: "fixture-section",
    scenarioId: "fixture-case",
    scenarioTitle: "fixture",
    outputRoot,
  }, {
    enabled: true,
    docxEnabled: false,
    perScenarioDocx: false,
    templatePath: "unused.docx",
    outputRoot,
    screenshotMode: "after_step",
    fullPage: false,
    failOnError: true,
    analystName: "",
    preserveTemplateLayout: true,
  });
  const page = {
    isClosed: () => false,
    screenshot: async ({ path: filePath }: { path: string }) => { await fs.writeFile(filePath, Buffer.from("png")); },
  } as any;
  await recorder.captureStep(page, 1, "click", { status: "passed" });
  recorder.setExecutionStatuses({ discoveryStatus: "exploration_failed", functionalStatus: "not_run" });
  const record = await recorder.finish();
  assert.equal(record.captureStatus, "success");
  assert.equal(record.discoveryStatus, "exploration_failed");
  assert.equal(record.functionalStatus, "not_run");
  assert.equal(record.status, "Fallido");
  assert.equal(record.statusContradiction, false);
  await fs.rm(outputRoot, { recursive: true, force: true });
});
