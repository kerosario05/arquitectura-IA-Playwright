"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const step_intent_parser_1 = require("./step-intent-parser");
(0, node_test_1.default)("preserves the field relationship for option selections", () => {
    const [intent] = (0, step_intent_parser_1.parseStepIntent)('Seleccionar la opción "Cédula" en el campo de tipo de identificación.');
    strict_1.default.equal(intent?.type, "action_select");
    strict_1.default.equal(intent?.actionTarget, "Cédula");
    strict_1.default.equal(intent?.selectionField, "tipo de identificación");
});
(0, node_test_1.default)("does not add a field relationship to a standalone option selection", () => {
    const [intent] = (0, step_intent_parser_1.parseStepIntent)('Seleccionar la opción "Cédula".');
    strict_1.default.equal(intent?.type, "action_select");
    strict_1.default.equal(intent?.actionTarget, "Cédula");
    strict_1.default.equal(intent?.selectionField, undefined);
});
