"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const promises_1 = __importDefault(require("node:fs/promises"));
const case_discovery_1 = require("./case-discovery");
const step_intent_parser_1 = require("./step-intent-parser");
const evidence_recorder_1 = require("../evidence/evidence-recorder");
const testrail_input_requirements_adapter_1 = require("../testrail/testrail-input-requirements-adapter");
const testrail_runtime_transformer_1 = require("../testrail/testrail-runtime-transformer");
const testrail_canonical_adapter_1 = require("../testrail/testrail-canonical-adapter");
const testrail_normalizer_1 = require("../testrail/testrail-normalizer");
(0, node_test_1.default)("canonical parser emits structured oracle types for row, structural, and container assertions", () => {
    const row = (0, step_intent_parser_1.parseStepIntent)("En la segunda fila, validar que el nombre sea [employee_2.expected_name]")[0];
    const structural = (0, step_intent_parser_1.parseStepIntent)("Validar que se agregue una segunda línea")[0];
    const container = (0, step_intent_parser_1.parseStepIntent)("Dentro de la sección, validar que exista [employee_1.document]")[0];
    strict_1.default.equal(row.canonicalAssertion?.oracleType, "row_scoped_value");
    strict_1.default.equal(row.expectedValueKey, "employee_2.expected_name");
    strict_1.default.equal(row.rowScope, 2);
    strict_1.default.equal(structural.canonicalAssertion?.oracleType, "structural_row_count");
    strict_1.default.equal(container.canonicalAssertion?.oracleType, "entity_within_container");
});
(0, node_test_1.default)("scenario projection preserves canonical oracle and binds its prerequisite", () => {
    const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)({
        title: "structured scenario",
        steps: [
            { index: 1, action: "Clic en agregar una nueva fila" },
            { index: 2, action: "Validar que se agregue una segunda línea" },
            { index: 3, action: "En la segunda fila, validar que el nombre sea [employee_2.expected_name]" },
        ],
    });
    const structural = parsed.assertionTargets.find((target) => target.canonicalAssertion?.oracleType === "structural_row_count");
    const row = parsed.assertionTargets.find((target) => target.canonicalAssertion?.oracleType === "row_scoped_value");
    strict_1.default.equal(structural?.triggerStepIndex, 1);
    strict_1.default.equal(row?.triggerStepIndex, 2);
    strict_1.default.equal(row?.expectedValueKey, "employee_2.expected_name");
});
(0, node_test_1.default)("future structured oracle is not eligible before its trigger", () => {
    const assertion = {
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
    const result = (0, case_discovery_1.evaluateEarlyCompletion)({ title: "", url: "", elements: [], summary: { buttons: 0, inputs: 0, links: 0, headings: 0, dialogs: 0 } }, [assertion], [], undefined, { currentStepIndex: 2 });
    strict_1.default.equal(result.deferredAssertions.length, 1);
    strict_1.default.equal(result.pendingAssertions.length, 0);
    strict_1.default.equal(result.satisfied, false);
});
(0, node_test_1.default)("candidate requiredData declares consumed auth keys before plan validation", () => {
    const requiredData = (0, case_discovery_1.buildCandidateRequiredData)({
        runtimeInputRequirements: [
            { key: "auth.company_identifier", required: true, source: "user_entered" },
            { key: "auth.username", required: true, source: "user_entered" },
            { key: "auth.password", required: true, source: "user_entered" },
        ],
    }, [
        { index: 1, action: "fill", target: { strategy: "text", value: "company" }, valueKey: "auth.company_identifier" },
        { index: 2, action: "fill", target: { strategy: "text", value: "username" }, valueKey: "auth.username" },
        { index: 3, action: "fill", target: { strategy: "text", value: "password" }, valueKey: "auth.password" },
    ]);
    const declared = new Set(requiredData.map((entry) => entry.key));
    strict_1.default.deepEqual([...declared].sort(), ["auth.company_identifier", "auth.password", "auth.username"]);
    strict_1.default.equal(requiredData.every((entry) => entry.resolved), true);
});
(0, node_test_1.default)("fresh input contract remains complete through Canonical, candidate, and persisted partial plan", () => {
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
    ];
    const declarations = [
        ["RNC", "auth.company_identifier", "text"],
        ["Usuario", "auth.username", "text"],
        ["Contraseña", "auth.password", "secret"],
        ...[1, 2].flatMap((ordinal) => employeeFields.map(([field, type]) => [
            `Empleado ${ordinal} ${field}`,
            `employee_${ordinal}.${field}`,
            type,
        ])),
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
    };
    const testrail = (0, testrail_input_requirements_adapter_1.extractTestRailInputRequirements)(rawCase);
    const runtime = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)(rawCase);
    const normalized = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
    const scenario = {
        ...normalized,
        raw: rawCase,
        canonicalInputRequirements: (0, testrail_canonical_adapter_1.extractCanonicalInputRequirements)(rawCase),
        runtimeInputRequirements: runtime.inputRequirements,
    };
    const partialSteps = [
        { index: 1, action: "fill", valueKey: "auth.company_identifier" },
        { index: 2, action: "fill", valueKey: "auth.username" },
        { index: 3, action: "fill", valueKey: "auth.password" },
    ];
    const candidate = (0, case_discovery_1.buildCandidateRequiredData)(scenario, partialSteps);
    const persisted = JSON.parse(JSON.stringify({ requiredData: candidate })).requiredData;
    const authoritativeKeys = new Set(testrail.requirements.map((requirement) => requirement.key));
    const currentKeys = new Set(candidate.map((requirement) => requirement.key));
    const missingKeys = [...authoritativeKeys].filter((key) => !currentKeys.has(key));
    strict_1.default.equal(testrail.requirements.length, 25);
    strict_1.default.equal((0, testrail_canonical_adapter_1.extractCanonicalInputRequirements)(rawCase).length, 25);
    strict_1.default.equal(runtime.inputRequirements.length, 25);
    strict_1.default.equal(candidate.length, 25);
    strict_1.default.equal(persisted.length, 25);
    strict_1.default.deepEqual(missingKeys, []);
    strict_1.default.deepEqual(candidate.filter((requirement) => !authoritativeKeys.has(requirement.key)).map((requirement) => requirement.key), []);
    strict_1.default.equal(candidate.filter((requirement) => requirement.key.startsWith("auth.")).length, 3);
    strict_1.default.equal(candidate.filter((requirement) => requirement.key.startsWith("employee_1.")).length, 11);
    strict_1.default.equal(candidate.filter((requirement) => requirement.key.startsWith("employee_2.")).length, 11);
    strict_1.default.equal(candidate.find((requirement) => requirement.key === "employee_1.expected_name")?.valueRole, "expected_oracle");
    strict_1.default.equal(candidate.find((requirement) => requirement.key === "employee_2.expected_birth_date")?.valueRole, "expected_oracle");
});
(0, node_test_1.default)("successful capture does not become scenario success after failed discovery", async () => {
    const outputRoot = node_path_1.default.join(node_os_1.default.tmpdir(), `qa-evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const recorder = new evidence_recorder_1.EvidenceRecorder({
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
        screenshot: async ({ path: filePath }) => { await promises_1.default.writeFile(filePath, Buffer.from("png")); },
    };
    await recorder.captureStep(page, 1, "click", { status: "passed" });
    recorder.setExecutionStatuses({ discoveryStatus: "exploration_failed", functionalStatus: "not_run" });
    const record = await recorder.finish();
    strict_1.default.equal(record.captureStatus, "success");
    strict_1.default.equal(record.discoveryStatus, "exploration_failed");
    strict_1.default.equal(record.functionalStatus, "not_run");
    strict_1.default.equal(record.status, "Fallido");
    strict_1.default.equal(record.statusContradiction, false);
    await promises_1.default.rm(outputRoot, { recursive: true, force: true });
});
