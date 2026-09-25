"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hydratePersistedScenarios = hydratePersistedScenarios;
const canonical_recording_contract_1 = require("./canonical-recording-contract");
/**
 * Restores persisted scenarios without deriving new suggestions or changing their IDs.
 * The persisted catalog remains authoritative; the semantic model is only used to repair
 * compatible runtime/presentation projections of each stored scenario.
 */
function hydratePersistedScenarios(scenarios, semanticModel) {
    if (!semanticModel)
        return [...scenarios];
    return scenarios.map((scenario) => (0, canonical_recording_contract_1.applyRuntimeDatasetValues)((0, canonical_recording_contract_1.hydrateCanonicalInteractionsFromSemanticModel)(scenario, semanticModel), {}));
}
