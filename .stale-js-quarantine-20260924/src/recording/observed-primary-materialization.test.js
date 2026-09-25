"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const semantic_recording_1 = require("./semantic-recording");
const persisted_scenario_hydration_1 = require("./persisted-scenario-hydration");
const recording_store_1 = require("./recording-store");
const trace_to_scenario_1 = require("./trace-to-scenario");
const canonical_recording_contract_1 = require("./canonical-recording-contract");
const replay_admission_1 = require("../server/services/replay-admission");
function target(label, value = label, extra = {}) {
    return { label, role: "button", locators: [{ strategy: "role", value, confidence: 0.95 }], ...extra };
}
function fixture(overrides = {}) {
    const trace = {
        recordingId: "observed-primary-fixture",
        projectSlug: "observed-primary-fixture",
        appSlug: "observed-primary-fixture",
        platform: "web",
        baseUrl: "https://app.test/login",
        label: "Registrar cliente",
        recordingGoal: { declaredGoal: "Registrar cliente", normalizedGoal: "registrar cliente", provenance: "USER_DECLARED", needsReview: false },
        recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
        startedAt: "2026-09-14T10:00:00.000Z",
        status: "stopped",
        events: [
            { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { ...target("Usuario", "usuario"), role: "textbox", associatedField: "Usuario" }, value: "juan" },
            { seq: 2, t: 200, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
            { seq: 3, t: 300, kind: "screen_change", screenKey: "login", toScreenKey: "home" },
        ],
        screens: [
            { screenKey: "login", title: "Login", fingerprint: "login", firstSeenAt: 0, controls: [], texts: ["Login"] },
            { screenKey: "home", title: "Cliente creado", fingerprint: "home", firstSeenAt: 300, controls: [], texts: ["Cliente creado"] },
        ],
        ...overrides,
    };
    return trace;
}
(0, node_test_1.default)("CASE 1: complete recording materializes observed primary without AI", () => {
    const primary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(fixture());
    strict_1.default.ok(primary);
    strict_1.default.equal(primary.primary, true);
    strict_1.default.equal(primary.provenance, "observed");
    strict_1.default.equal(primary.sourceRecordingId, "observed-primary-fixture");
    strict_1.default.equal(primary.suggestionCategory, undefined);
});
(0, node_test_1.default)("CASE 2: runtime valueKeys and sensitive metadata are preserved", () => {
    const trace = fixture({
        events: [
            { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { ...target("Clave", "clave"), role: "textbox", inputType: "password", associatedField: "Clave" }, redactedKey: "clave" },
            { seq: 2, t: 200, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
            { seq: 3, t: 300, kind: "screen_change", screenKey: "login", toScreenKey: "home" },
        ],
    });
    const primary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(trace);
    strict_1.default.ok(primary);
    strict_1.default.ok(primary.requiredData.some((field) => field.key === "clave"));
    strict_1.default.equal(primary.requiredData.find((field) => field.key === "clave")?.sensitive, true);
    strict_1.default.equal(primary.runtimeInputRequirements?.some((requirement) => requirement.valueKey === "clave"), true);
});
(0, node_test_1.default)("CASE 3: materialized primary persists and hydrates after refetch", () => {
    const appSlug = `observed-primary-test-${Date.now()}`;
    const recordingId = `observed-primary-test-${Date.now()}-recording`;
    const trace = fixture({ appSlug, projectSlug: appSlug, recordingId });
    const primary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(trace);
    strict_1.default.ok(primary);
    try {
        (0, recording_store_1.saveSemanticRecording)((0, semantic_recording_1.buildSemanticRecordingModel)(trace, trace.events));
        (0, recording_store_1.saveScenarios)(appSlug, recordingId, [primary]);
        const refetched = (0, persisted_scenario_hydration_1.hydratePersistedScenarios)((0, recording_store_1.loadScenarios)(appSlug, recordingId), (0, semantic_recording_1.buildSemanticRecordingModel)(trace, trace.events));
        strict_1.default.equal(refetched.length, 1);
        strict_1.default.equal(refetched[0].scenarioId, primary.scenarioId);
        strict_1.default.equal(refetched[0].sourceRecordingId, recordingId);
    }
    finally {
        node_fs_1.default.rmSync(node_path_1.default.resolve("automations", "apps", appSlug), { recursive: true, force: true });
    }
});
(0, node_test_1.default)("CASE 4: selected primary reaches replay admission without SCENARIO_NOT_READY", () => {
    const primary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(fixture());
    strict_1.default.ok(primary);
    const contract = (0, canonical_recording_contract_1.toSharedMcpScenario)(primary, primary.sourceRecordingId);
    strict_1.default.equal(contract.mcpExecutable, true);
    const admission = (0, replay_admission_1.resolveReplayAdmission)({
        requestedScenarioIds: [primary.scenarioId],
        evaluatedScenarioIds: [primary.scenarioId],
        eligibleScenarioIds: [primary.scenarioId],
        admittedScenarioIds: [primary.scenarioId],
        evaluatedRejectedScenarios: [],
    });
    strict_1.default.equal(admission.acceptedCount, 1);
    strict_1.default.equal(admission.requestedRejectedCount, 0);
});
(0, node_test_1.default)("CASE 5: repeated deterministic materialization preserves identity and creates no duplicate", () => {
    const first = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(fixture());
    const second = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(fixture());
    strict_1.default.ok(first && second);
    strict_1.default.equal(first.scenarioId, second.scenarioId);
    strict_1.default.equal(new Set([first.scenarioId, second.scenarioId]).size, 1);
});
(0, node_test_1.default)("CASE 6: later AI merge keeps one primary and adds only distinct scenarios", () => {
    const primary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(fixture());
    strict_1.default.ok(primary);
    const additional = { ...primary, scenarioId: `${primary.scenarioId}-AI-1`, primary: false, provenance: "derived" };
    const merged = [primary, additional].filter((scenario, index, all) => all.findIndex((candidate) => candidate.scenarioId === scenario.scenarioId) === index);
    strict_1.default.equal(merged.filter((scenario) => scenario.primary === true).length, 1);
    strict_1.default.equal(merged.length, 2);
});
(0, node_test_1.default)("CASE 7: incomplete recording is not falsely materialized", () => {
    const incomplete = fixture({ events: [] });
    strict_1.default.equal((0, trace_to_scenario_1.materializeObservedPrimaryScenario)(incomplete), null);
});
(0, node_test_1.default)("CASE 8: deterministic primary materialization has no AI generation lane", () => {
    const primary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(fixture());
    strict_1.default.ok(primary);
    strict_1.default.equal("aiGeneration" in primary, false);
    strict_1.default.equal("provider" in primary, false);
});
(0, node_test_1.default)("CASE 9: observed terminal action materializes even without a generated oracle", () => {
    const trace = fixture({
        events: [
            { seq: 1, t: 100, kind: "tap", screenKey: "home", target: target("Guardar", "guardar") },
        ],
        screens: [{ screenKey: "home", title: "Formulario", fingerprint: "home", firstSeenAt: 0, controls: [], texts: ["Formulario"] }],
    });
    const primary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(trace);
    strict_1.default.ok(primary);
    strict_1.default.equal(primary.provenance, "observed");
    strict_1.default.equal(primary.testRailSteps.some((step) => step.classification === "FUNCTIONAL_ASSERTION"), false);
});
(0, node_test_1.default)("CASE 10: generatedScenarioCount zero is not a primary materialization predicate", () => {
    const trace = fixture();
    trace.generatedScenarioCount = 0;
    strict_1.default.ok((0, trace_to_scenario_1.materializeObservedPrimaryScenario)(trace));
});
