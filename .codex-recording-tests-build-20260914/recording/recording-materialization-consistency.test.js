"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const scenario_preview_types_1 = require("../types/scenario-preview.types");
const recording_store_1 = require("./recording-store");
const semantic_recording_1 = require("./semantic-recording");
const canonical_recording_contract_1 = require("./canonical-recording-contract");
const recordingId = "f40e3007-7b94-4b92-9c6c-33b2bc573f0b";
const scenarioId = "REC-F40E3007-01";
const appSlug = "portalempresarial";
function materializedPrimary() {
    const trace = (0, recording_store_1.loadTrace)(appSlug, recordingId);
    if (!trace)
        throw new Error(`Missing persisted trace ${recordingId}`);
    const scenario = (0, recording_store_1.loadScenarios)(appSlug, recordingId).find((candidate) => candidate.scenarioId === scenarioId);
    strict_1.default.ok(scenario, `Missing persisted scenario ${scenarioId}`);
    const semanticModel = (0, semantic_recording_1.buildSemanticRecordingModel)(trace);
    return (0, canonical_recording_contract_1.applyRuntimeDatasetValues)((0, canonical_recording_contract_1.hydrateCanonicalInteractionsFromSemanticModel)(scenario, semanticModel), {});
}
(0, node_test_1.default)("recording materialization keeps compound selection and amount authority separate", () => {
    const persisted = (0, recording_store_1.loadScenarios)(appSlug, recordingId).find((scenario) => scenario.scenarioId === scenarioId);
    strict_1.default.ok(persisted);
    strict_1.default.equal(persisted.requiredData.find((field) => field.key === "entity_1.ingresos_valor")?.exampleValue, "15000");
    const materialized = materializedPrimary();
    const amountKey = "entity_1.ingresos_valor";
    strict_1.default.equal(materialized.requiredData.find((field) => field.key === amountKey)?.exampleValue, "15000");
    strict_1.default.equal(materialized.runtimeDataset?.resolvedValues[amountKey], "15000");
    strict_1.default.equal(materialized.testRailSteps.find((step) => step.valueKey === amountKey)?.renderedStep, "Ingresar \"15000\" en \"Ingresos\"");
    strict_1.default.equal(materialized.testRailSteps.find((step) => step.valueKey === "entity_1.ingresos_seleccion")?.renderedStep, "Seleccionar \"DOP\" en \"Ingresos\"");
    const contract = (0, canonical_recording_contract_1.toSharedMcpScenario)(materialized, appSlug);
    const amountAction = contract.recordingExecutionContract?.actions.find((action) => action.valueKey === amountKey);
    const selectionAction = contract.recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_1.ingresos_seleccion");
    strict_1.default.equal(amountAction?.value, "15000");
    strict_1.default.equal(selectionAction?.value, "DOP");
    strict_1.default.equal(contract.runtimeInputRequirements.find((requirement) => requirement.valueKey === amountKey)?.value, "15000");
    strict_1.default.equal(contract.steps.find((step) => step.includes("Ingresos") && step.startsWith("Ingresar")), "Ingresar \"15000\" en \"Ingresos\"");
});
(0, node_test_1.default)("preview and generated-case artifacts are materialized from the corrected contract", () => {
    const contract = (0, canonical_recording_contract_1.toSharedMcpScenario)(materializedPrimary(), appSlug);
    const virtualCase = (0, scenario_preview_types_1.toVirtualCase)(contract, 0);
    const amountStep = "Ingresar \"15000\" en \"Ingresos\"";
    strict_1.default.ok(virtualCase.steps.includes(amountStep));
    strict_1.default.equal(virtualCase.recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_1.ingresos_valor")?.value, "15000");
    const artifactDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "recording-materialization-"));
    try {
        node_fs_1.default.mkdirSync(node_path_1.default.join(artifactDir, "generated-cases"));
        node_fs_1.default.writeFileSync(node_path_1.default.join(artifactDir, "preview-scenarios.json"), JSON.stringify([virtualCase], null, 2));
        node_fs_1.default.writeFileSync(node_path_1.default.join(artifactDir, "generated-cases", `${virtualCase.id}.json`), JSON.stringify(virtualCase, null, 2));
        const preview = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(artifactDir, "preview-scenarios.json"), "utf8"))[0];
        const generatedCase = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(artifactDir, "generated-cases", `${virtualCase.id}.json`), "utf8"));
        strict_1.default.ok(preview.steps.includes(amountStep));
        strict_1.default.ok(generatedCase.steps.includes(amountStep));
        strict_1.default.equal(preview.recordingExecutionContract.actions.find((action) => action.valueKey === "entity_1.ingresos_valor").value, "15000");
        strict_1.default.equal(generatedCase.recordingExecutionContract.actions.find((action) => action.valueKey === "entity_1.ingresos_valor").value, "15000");
    }
    finally {
        node_fs_1.default.rmSync(artifactDir, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("structured extras are technical prerequisites, not unauthorized functional actions", () => {
    const persisted = (0, recording_store_1.loadScenarios)(appSlug, recordingId).find((scenario) => scenario.scenarioId === scenarioId);
    strict_1.default.ok(persisted);
    const humanInteractionIds = new Set(persisted.testRailSteps.map((step) => step.interactionId).filter(Boolean));
    const contract = (0, canonical_recording_contract_1.toSharedMcpScenario)(materializedPrimary(), appSlug);
    const actions = contract.recordingExecutionContract?.actions ?? [];
    const extraActions = actions.filter((action) => !humanInteractionIds.has(action.interactionId));
    strict_1.default.equal(persisted.testRailSteps.length, 18);
    strict_1.default.equal(actions.length, 22);
    strict_1.default.deepEqual(extraActions.map((action) => action.interactionId), [
        "interaction-68",
        "interaction-75",
        "interaction-78",
        "interaction-93",
        "interaction-146",
    ]);
    strict_1.default.equal(extraActions.length, 5);
    strict_1.default.equal(extraActions.filter((action) => action.actionType === "check" || action.actionType === "click" || action.actionType === "select").length, 5);
    strict_1.default.equal(extraActions.filter((action) => action.actionType === "fill" || action.actionType === "select").length, 0);
});
