"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const trace_to_scenario_1 = require("./trace-to-scenario");
const semantic_recording_1 = require("./semantic-recording");
const scenario_to_testrail_1 = require("./scenario-to-testrail");
function trace(overrides = {}) {
    return {
        recordingId: "recording-goal-test",
        projectSlug: "project-test",
        appSlug: "app-test",
        platform: "web",
        baseUrl: "https://app.test",
        label: "Fallback label",
        startedAt: new Date(0).toISOString(),
        status: "stopped",
        events: [],
        screens: [{
                screenKey: "screen-a",
                title: "Formulario",
                fingerprint: "technical-fingerprint",
                firstSeenAt: 0,
                controls: [],
                texts: ["Formulario"],
            }],
        ...overrides,
    };
}
function fillEvent(valueSource = "user") {
    return {
        seq: 0,
        t: 1,
        kind: "fill",
        screenKey: "screen-a",
        value: valueSource === "application" ? "derived" : "input",
        valueSource,
        target: {
            label: valueSource === "application" ? "Nombre resultante" : "Nombre cliente",
            role: "textbox",
            locators: [{ strategy: "aria-label", value: valueSource === "application" ? "result" : "name" }],
        },
    };
}
(0, node_test_1.test)("recording goal is explicit and keeps its declared authority", () => {
    const goal = (0, semantic_recording_1.normalizeRecordingGoal)("  Crear   cliente. ");
    strict_1.default.deepEqual(goal, {
        declaredGoal: "Crear cliente.",
        normalizedGoal: "Crear cliente",
        provenance: "USER_DECLARED",
        needsReview: false,
    });
});
(0, node_test_1.test)("one goal produces one primary scenario from the complete trace", () => {
    const current = trace({
        recordingGoal: (0, semantic_recording_1.normalizeRecordingGoal)("Crear cliente"),
        events: [fillEvent()],
    });
    const primary = (0, trace_to_scenario_1.buildHappyPathScenario)(current, current.events);
    strict_1.default.equal(primary.primary, true);
    strict_1.default.equal(primary.title, "Crear cliente");
    strict_1.default.equal(primary.containsUnexecutedActions, false);
    strict_1.default.equal(primary.traceBacked, true);
});
(0, node_test_1.test)("irrelevant controls are rejected while relevant alternatives remain candidates", () => {
    const irrelevant = (0, trace_to_scenario_1.buildHappyPathScenario)(trace(), []);
    const related = { ...irrelevant, title: "Tipo de cliente", requiredData: [], testRailSteps: [{ content: "Elegir tipo de cliente", expected: "Aceptado" }] };
    const unrelated = { ...irrelevant, title: "Ayuda", requiredData: [], testRailSteps: [{ content: "Abrir ayuda", expected: "Se muestra ayuda" }] };
    const result = (0, trace_to_scenario_1.filterGoalScopedSuggestions)("Crear cliente", [related, unrelated]);
    strict_1.default.equal(result.suggestions.length, 1);
    strict_1.default.equal(result.irrelevantCandidatesRejected, 1);
    strict_1.default.equal(result.suggestions[0].primary, false);
    strict_1.default.ok((result.suggestions[0].goalRelevanceScore ?? 0) >= 0.35);
});
(0, node_test_1.test)("shared entity text does not rescue an unrelated navigation alternative", () => {
    const base = (0, trace_to_scenario_1.buildHappyPathScenario)(trace(), []);
    const unrelatedNavigation = {
        ...base,
        title: "Alternativa observada: Registro Digital Nuevos Colaboradores",
        description: "Abrir una navegación independiente del flujo actual.",
        testRailSteps: [{ content: "Seleccionar Registro Digital Nuevos Colaboradores", expected: "Se abre otra funcionalidad" }],
    };
    const result = (0, trace_to_scenario_1.filterGoalScopedSuggestions)("Agregar varios colaboradores", [unrelatedNavigation]);
    strict_1.default.equal(result.suggestions.length, 0);
    strict_1.default.equal(result.irrelevantCandidatesRejected, 1);
});
(0, node_test_1.test)("semantic identity deduplicates wording variants", () => {
    const base = (0, trace_to_scenario_1.buildHappyPathScenario)(trace(), []);
    const one = { ...base, title: "Tipo de cliente", testRailSteps: [{ content: "Elegir tipo de cliente", expected: "ok" }] };
    const two = { ...base, title: "Seleccionar tipo cliente", testRailSteps: [{ content: "Elegir tipo de cliente", expected: "ok" }] };
    strict_1.default.equal((0, trace_to_scenario_1.deduplicateGoalSuggestions)([one, two]).duplicatesRemoved, 1);
});
(0, node_test_1.test)("partial traces remain usable and application changes are derived outputs", () => {
    const current = trace({
        recordingGoal: (0, semantic_recording_1.normalizeRecordingGoal)("Crear cliente"),
        events: [fillEvent("user"), { ...fillEvent("application"), seq: 1, dependsOnEventRef: "event-1" }],
    });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(current, current.events);
    strict_1.default.equal(model.semanticEvents.length, 2);
    strict_1.default.equal(model.datasets.find((item) => item.valueRole === "runtime_derived_oracle")?.source, "OBSERVED");
    strict_1.default.deepEqual(model.datasets.find((item) => item.valueRole === "runtime_derived_oracle")?.dependsOn, ["nombre_cliente"]);
});
(0, node_test_1.test)("QA credential persistence is always enabled by the recording contract", () => {
    strict_1.default.deepEqual((0, semantic_recording_1.normalizeRecordingDataPolicy)(), {
        persistRecordedValues: true,
        persistQaCredentials: true,
        includeQaCredentialsInTestRail: true,
    });
    strict_1.default.deepEqual((0, semantic_recording_1.normalizeRecordingDataPolicy)({ persistQaCredentials: false, includeQaCredentialsInTestRail: false }), {
        persistRecordedValues: true,
        persistQaCredentials: true,
        includeQaCredentialsInTestRail: true,
    });
    strict_1.default.deepEqual((0, semantic_recording_1.normalizeRecordingDataPolicy)({ persistQaCredentials: true, includeQaCredentialsInTestRail: true }), {
        persistRecordedValues: true,
        persistQaCredentials: true,
        includeQaCredentialsInTestRail: true,
    });
});
(0, node_test_1.test)("TestRail preview keeps the primary first and includes QA credentials by contract", () => {
    const primary = (0, trace_to_scenario_1.buildHappyPathScenario)(trace({ recordingGoal: (0, semantic_recording_1.normalizeRecordingGoal)("Crear cliente") }), []);
    primary.requiredData.push({ key: "auth_password", label: "Password", stepIndex: 1, sensitive: true, exampleValue: "fixture-only" });
    const referenceOnly = (0, scenario_to_testrail_1.toPublishableScenario)(primary, "app-test", "recording-goal-test", (0, semantic_recording_1.normalizeRecordingDataPolicy)());
    const allowed = (0, scenario_to_testrail_1.toPublishableScenario)(primary, "app-test", "recording-goal-test", (0, semantic_recording_1.normalizeRecordingDataPolicy)({
        persistQaCredentials: true,
        includeQaCredentialsInTestRail: true,
    }));
    strict_1.default.equal(referenceOnly.dataRequirements, "auth_password=fixture-only");
    strict_1.default.equal(allowed.dataRequirements, "auth_password=fixture-only");
    strict_1.default.equal(primary.primary, true);
});
(0, node_test_1.test)("human preview uses rendered values while the execution template stays key-based", () => {
    const current = trace({
        recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: true },
        events: [{
                ...fillEvent(),
                target: { ...fillEvent().target, label: "Identificador", locators: [{ strategy: "aria-label", value: "Identificador" }] },
                value: "ABC123",
            }],
    });
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(current, current.events);
    const preview = (0, scenario_to_testrail_1.toPublishableScenario)(scenario, "app-test", "recording-goal-test", current.recordingDataPolicy);
    strict_1.default.equal(scenario.webSteps[1]?.value, undefined);
    strict_1.default.equal(scenario.webSteps[1]?.valueKey, "identificador");
    strict_1.default.match(preview.steps[1], /ABC123/);
    strict_1.default.ok(!preview.steps[1].includes("Esperado:"));
});
(0, node_test_1.test)("TestRail uses rendered values under the invariant credential policy", () => {
    const baseEvent = fillEvent();
    const event = {
        ...baseEvent,
        value: "fixture-secret",
        target: { ...baseEvent.target, label: "Contraseña", inputType: "password" },
    };
    const protectedTrace = trace({
        events: [event],
        recordingDataPolicy: (0, semantic_recording_1.normalizeRecordingDataPolicy)(),
    });
    const protectedScenario = (0, trace_to_scenario_1.buildHappyPathScenario)(protectedTrace, protectedTrace.events);
    const protectedPreview = (0, scenario_to_testrail_1.toPublishableScenario)(protectedScenario, "app-test", "recording-goal-test", protectedTrace.recordingDataPolicy);
    strict_1.default.ok(protectedPreview.steps.some((step) => step.includes("fixture-secret")));
    const allowedTrace = trace({
        events: [event],
        recordingDataPolicy: (0, semantic_recording_1.normalizeRecordingDataPolicy)({ persistQaCredentials: true, includeQaCredentialsInTestRail: true }),
    });
    const allowedScenario = (0, trace_to_scenario_1.buildHappyPathScenario)(allowedTrace, allowedTrace.events);
    const allowedPreview = (0, scenario_to_testrail_1.toPublishableScenario)(allowedScenario, "app-test", "recording-goal-test", allowedTrace.recordingDataPolicy);
    strict_1.default.ok(allowedPreview.steps.some((step) => step.includes("fixture-secret")));
});
(0, node_test_1.test)("selection values are materialized without replacing the runtime target", () => {
    const current = trace({
        events: [{
                seq: 0,
                t: 1,
                kind: "tap",
                screenKey: "screen-a",
                target: {
                    label: "Moneda",
                    role: "combobox",
                    associatedField: "currency",
                    afterValue: "DOP",
                    locators: [{ strategy: "role", value: "combobox|Moneda" }],
                },
            }],
    });
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(current, current.events);
    strict_1.default.equal(scenario.webSteps[1]?.value, undefined);
    strict_1.default.equal(scenario.webSteps[1]?.valueKey, "currency");
    strict_1.default.match(scenario.testRailSteps[1]?.content ?? "", /\[currency\]/);
    strict_1.default.match(scenario.testRailSteps[1]?.renderedStep ?? "", /DOP/);
});
(0, node_test_1.test)("editing the confirmed dataset updates rendered steps without changing the template", () => {
    const current = trace({
        events: [fillEvent()],
    });
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(current, current.events);
    const original = scenario.testRailSteps[1];
    const edited = (0, trace_to_scenario_1.materializeRecordedScenario)(scenario, { nombre_cliente: "valor-editado" });
    strict_1.default.equal(original?.stepTemplate, 'Ingresar [nombre_cliente] en "Nombre cliente"');
    strict_1.default.equal(edited.testRailSteps[1]?.stepTemplate, original?.stepTemplate);
    strict_1.default.equal(edited.testRailSteps[1]?.renderedStep, 'Ingresar "valor-editado" en "Nombre cliente"');
});
(0, node_test_1.test)("live refresh ignores non-semantic polling noise", () => {
    const base = { events: [fillEvent()], screens: trace().screens };
    const noisy = { events: [{ ...fillEvent(), target: { ...fillEvent().target, beforeValue: "old", afterValue: "input" } }], screens: trace().screens };
    const meaningful = { events: [{ ...fillEvent(), seq: 1, t: 50, target: { ...fillEvent().target, label: "Correo" } }], screens: trace().screens };
    strict_1.default.equal((0, semantic_recording_1.hasSignificantSemanticChange)(undefined, base), true);
    strict_1.default.equal((0, semantic_recording_1.hasSignificantSemanticChange)(base, noisy), false);
    strict_1.default.equal((0, semantic_recording_1.hasSignificantSemanticChange)(base, meaningful), true);
});
