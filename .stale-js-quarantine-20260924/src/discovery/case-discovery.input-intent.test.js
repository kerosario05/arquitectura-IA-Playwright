"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const case_discovery_1 = require("./case-discovery");
function scenario(step = {}) {
    return {
        source: "testrail",
        externalId: "external",
        caseId: 1,
        title: "scenario",
        steps: [{ index: 1, action: "fill the control", dataHints: [], ...step }],
    };
}
(0, node_test_1.default)("propagates action input metadata and requirement refs into ordered steps", () => {
    const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario({
        requirementRefs: ["req-a", "req-b"],
        inputIntent: { mode: "set_value" },
    }));
    strict_1.default.deepEqual(parsed.orderedSteps[0]?.requirementRefs, ["req-a", "req-b"]);
    strict_1.default.deepEqual(parsed.orderedSteps[0]?.inputIntent, { mode: "set_value" });
    const scenarioRefs = { ...scenario({ inputIntent: { mode: "preserve_state" } }), stepRequirementRefs: [
            { stepIndex: 1, requirementId: "req-c" },
            { stepIndex: 1, requirementId: "req-d" },
        ] };
    const parsedScenarioRefs = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenarioRefs);
    strict_1.default.deepEqual(parsedScenarioRefs.orderedSteps[0]?.requirementRefs, ["req-c", "req-d"]);
    strict_1.default.deepEqual(parsedScenarioRefs.orderedSteps[0]?.inputIntent, { mode: "preserve_state" });
});
(0, node_test_1.default)("preserves every structured input intent and does not infer from target text", () => {
    for (const mode of ["leave_unset", "invalid_value", "preserve_state", "set_value"]) {
        const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario({ inputIntent: { mode } }));
        strict_1.default.deepEqual(parsed.orderedSteps[0]?.inputIntent, { mode });
    }
    const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario({ action: "leave the email empty" }));
    strict_1.default.equal(parsed.orderedSteps[0]?.inputIntent, undefined);
});
(0, node_test_1.default)("projects plan metadata without turning it into values or derived text", () => {
    strict_1.default.deepEqual((0, case_discovery_1.projectScenarioInputMetadata)({
        requirementRefs: ["req-a", "req-b"],
        inputIntent: { mode: "leave_unset", requirementRefs: ["req-a"] },
    }), {
        requirementRefs: ["req-a", "req-b"],
        inputIntent: { mode: "leave_unset", requirementRefs: ["req-a"] },
    });
    strict_1.default.deepEqual((0, case_discovery_1.projectScenarioInputMetadata)({ inputIntent: { mode: "preserve_state", requirementRefs: ["req-nested"] } }), {
        inputIntent: { mode: "preserve_state", requirementRefs: ["req-nested"] },
        requirementRefs: ["req-nested"],
    });
    const planStep = {
        index: 1,
        action: "fill",
        target: { strategy: "label", value: "control" },
        ...(0, case_discovery_1.projectScenarioInputMetadata)({ inputIntent: { mode: "invalid_value" }, requirementRefs: ["req-c"] }),
    };
    strict_1.default.deepEqual(planStep.inputIntent, { mode: "invalid_value" });
    strict_1.default.deepEqual(planStep.requirementRefs, ["req-c"]);
    strict_1.default.equal("value" in planStep && typeof planStep.value === "string", false);
});
(0, node_test_1.default)("preserves namespaced placeholder fill metadata through discovery projection", () => {
    const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)({
        ...scenario(),
        steps: [
            { index: 1, action: 'Ingresar el valor [auth.company_identifier] en el campo "RNC de la empresa".', dataHints: [] },
            { index: 2, action: 'Ingresar el valor [auth.username] en el campo "Nombre de usuario".', dataHints: [] },
            { index: 3, action: 'Ingresar el valor [auth.password] en el campo "Contraseña".', dataHints: [] },
        ],
    });
    strict_1.default.deepEqual(parsed.actionTargets.map((item) => ({
        actionType: item.actionType,
        target: item.target,
        valueKey: item.valueKey,
        valueSource: item.valueSource,
    })), [
        { actionType: "action_fill", target: "RNC de la empresa", valueKey: "auth.company_identifier", valueSource: "unknown" },
        { actionType: "action_fill", target: "Nombre de usuario", valueKey: "auth.username", valueSource: "unknown" },
        { actionType: "action_fill", target: "Contraseña", valueKey: "auth.password", valueSource: "unknown" },
    ]);
});
(0, node_test_1.default)("selects fill dispatch for unknown placeholder source without forcing runtime override", () => {
    strict_1.default.equal((0, case_discovery_1.isFillActionTarget)({ actionType: "action_fill", valueKey: "namespace.key", valueSource: "unknown" }), true);
    strict_1.default.equal((0, case_discovery_1.isFillActionTarget)({ actionType: "action_click", valueKey: "namespace.key", valueSource: "unknown" }), false);
});
(0, node_test_1.default)("recording replay consumes structured action authority instead of rendered human text", () => {
    const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)({
        ...scenario({ action: 'Ingresar "123456" en "Campo"' }),
        recordingExecutionContract: {
            actions: [{
                    actionType: "fill",
                    humanStep: 'Ingresar "123456" en "Campo"',
                    semanticField: "Campo",
                    targetRef: "field-a",
                    technicalTargetRef: "css:#field-a",
                    technicalTargetRefs: ["css:#field-a"],
                    technicalTargetCandidates: [{
                            strategy: "css",
                            value: "#field-a",
                            source: "recorded_dom",
                            confidence: 0.99,
                        }],
                    valueKey: "input.a",
                    valueRole: "action_input",
                    runtimeValueSource: "dataset",
                    stepIndex: 0,
                }],
            runtimeInputRequirements: [{
                    valueKey: "input.a",
                    value: "123456",
                    source: "RECORDED_CONFIRMED",
                    sensitive: false,
                    valueRole: "action_input",
                }],
            datasetBindings: { "input.a": "123456" },
        },
    });
    strict_1.default.equal(parsed.actionTargets.length, 1);
    strict_1.default.equal(parsed.actionTargets[0]?.target, "Campo");
    strict_1.default.equal(parsed.actionTargets[0]?.valueKey, "input.a");
    strict_1.default.equal(parsed.actionTargets[0]?.valueSource, "test_data");
    strict_1.default.equal(parsed.orderedSteps[0]?.target, "Campo");
    strict_1.default.equal(parsed.orderedSteps[0]?.valueKey, "input.a");
    strict_1.default.equal(parsed.orderedSteps[0]?.technicalTargetCandidates?.[0]?.value, "#field-a");
});
(0, node_test_1.default)("recording replay repairs legacy duplicate indices without dropping compound actions", () => {
    const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)({
        ...scenario(),
        recordingExecutionContract: {
            actions: [
                { actionType: "select", humanStep: "Seleccionar", targetRef: "Ingresos", valueKey: "currency", stepIndex: 8 },
                { actionType: "fill", humanStep: "Ingresar", targetRef: "Ingresos", valueKey: "amount", stepIndex: 8 },
                { actionType: "check", humanStep: "Marcar", targetRef: "row", valueKey: "row.selected", stepIndex: 9 },
            ],
            runtimeInputRequirements: [],
        },
    });
    strict_1.default.deepEqual(parsed.actionTargets.map((item) => item.index), [1, 2, 3]);
    strict_1.default.deepEqual(parsed.actionTargets.map((item) => item.recordingActionType), ["select", "fill", "check"]);
    strict_1.default.equal(parsed.actionTargets.length, 3);
});
(0, node_test_1.default)("recording replay preserves the semantic field as the selection authority", () => {
    const parsed = (0, case_discovery_1.parseScenarioStepsForDiscovery)({
        ...scenario(),
        recordingExecutionContract: {
            actions: [{
                    actionType: "select",
                    humanStep: 'Seleccionar "cédula" en "Tipo de ID"',
                    semanticField: "Tipo de ID",
                    targetRef: "cell:Tipo de ID",
                    valueKey: "entity_1.tipo_de_id_seleccion",
                    runtimeValueSource: "dataset",
                    stepIndex: 1,
                }],
            runtimeInputRequirements: [],
        },
    });
    strict_1.default.equal(parsed.actionTargets[0]?.selectionField, "Tipo de ID");
    strict_1.default.equal(parsed.orderedSteps[0]?.selectionField, "Tipo de ID");
});
