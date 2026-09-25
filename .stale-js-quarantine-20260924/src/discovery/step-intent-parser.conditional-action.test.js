"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const step_intent_parser_1 = require("./step-intent-parser");
(0, node_test_1.default)("parses visible conditional click as an optional action", () => {
    const [intent] = (0, step_intent_parser_1.parseStepIntent)("Si el botón 'Salir' está visible, hacer clic en el botón 'Salir'.");
    strict_1.default.equal(intent?.type, "action_click");
    strict_1.default.equal(intent?.conditionalAction?.operation, "click");
    strict_1.default.equal(intent?.conditionalAction?.condition.type, "visibility");
    strict_1.default.equal(intent?.conditionalAction?.condition.target, "Salir");
    strict_1.default.equal(intent?.conditionalAction?.actionTarget, "Salir");
    strict_1.default.equal(intent?.conditionalAction?.skipAllowedWhenConditionFalse, true);
});
(0, node_test_1.default)("parses presence conditional select without making it an assertion", () => {
    const [intent] = (0, step_intent_parser_1.parseStepIntent)("En caso de que la opción 'Tipo' esté presente, seleccionar la opción 'Tipo'.");
    strict_1.default.equal(intent?.type, "action_select");
    strict_1.default.equal(intent?.conditionalAction?.operation, "select");
    strict_1.default.equal(intent?.conditionalAction?.condition.type, "presence");
    strict_1.default.notEqual(intent?.type, "assertion");
});
