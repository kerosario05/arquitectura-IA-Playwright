"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const step_intent_parser_1 = require("./step-intent-parser");
(0, node_test_1.default)("keeps an assertion with internal commas as one parent intent", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Validar que, mientras el control "subject" permanezca inválido, la acción "advance" permanezca deshabilitada y no permita continuar.');
    strict_1.default.equal(intents.length, 1);
    strict_1.default.equal(intents[0]?.type, "assertion");
    strict_1.default.equal(intents[0]?.canonicalAssertion?.intent, "transition_blocked");
    strict_1.default.equal(intents[0]?.canonicalAssertion?.condition, 'el control "subject" permanezca inválido');
    strict_1.default.equal(intents[0]?.canonicalAssertion?.childExpectations?.length, 2);
});
(0, node_test_1.default)("keeps multiple que clauses in the same assertion parent", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Al salir del campo "subject", validar que el control quede inválido y que se muestre un mensaje asociado al dato ingresado.');
    strict_1.default.equal(intents.length, 1);
    strict_1.default.equal(intents[0]?.type, "assertion");
    strict_1.default.equal(intents[0]?.canonicalAssertion?.trigger, "leave_field");
    strict_1.default.equal(intents[0]?.canonicalAssertion?.childExpectations?.length, 2);
});
