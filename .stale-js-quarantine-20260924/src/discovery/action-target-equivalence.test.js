"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const action_target_equivalence_1 = require("./action-target-equivalence");
(0, node_test_1.default)("does not deduplicate compound actions that share a target label", () => {
    strict_1.default.equal((0, action_target_equivalence_1.areEquivalentActionTargets)({ actionType: "action_select", target: "Ingresos", valueKey: "ingresos_seleccion" }, { actionType: "action_fill", target: "Ingresos", valueKey: "ingresos_valor" }), false);
});
(0, node_test_1.default)("does not deduplicate check and click actions with the same label", () => {
    strict_1.default.equal((0, action_target_equivalence_1.areEquivalentActionTargets)({ actionType: "action_click", recordingActionType: "check", target: "Seleccionar fila", valueKey: "row.selection" }, { actionType: "action_click", recordingActionType: "click", target: "Seleccionar fila", valueKey: "row.selection" }), false);
});
(0, node_test_1.default)("deduplicates only identical structured consecutive actions", () => {
    strict_1.default.equal((0, action_target_equivalence_1.areEquivalentActionTargets)({ actionType: "action_click", target: "Ingresos", technicalTargetRefs: ["role:button:Ingresos"] }, { actionType: "action_click", target: " ingresos ", technicalTargetRefs: ["role:button:Ingresos"] }), true);
});
