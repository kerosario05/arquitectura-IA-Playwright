"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const step_intent_parser_1 = require("./step-intent-parser");
(0, node_test_1.default)("keeps a generic leading row scope as action metadata", () => {
    const parsed = (0, step_intent_parser_1.parseStepIntent)("En la primera fila, ingresar [x] en campo Y");
    strict_1.default.equal(parsed.length, 1);
    strict_1.default.equal(parsed[0]?.type, "action_fill");
    strict_1.default.equal(parsed[0]?.rowScope, 1);
    strict_1.default.equal(parsed[0]?.valueKey, "x");
    strict_1.default.equal(parsed[0]?.actionTarget, "Y");
    strict_1.default.equal(parsed.some((intent) => intent.type === "assertion"), false);
});
(0, node_test_1.default)("preserves a value key and associated field for a generic grid selection", () => {
    const [intent] = (0, step_intent_parser_1.parseStepIntent)("En la segunda fila, seleccionar la opción [currency] en el campo Moneda asociado a Ingresos");
    strict_1.default.equal(intent?.type, "action_select");
    strict_1.default.equal(intent?.rowScope, 2);
    strict_1.default.equal(intent?.actionTarget, "Moneda");
    strict_1.default.equal(intent?.selectionField, "Moneda");
    strict_1.default.equal(intent?.associatedField, "Ingresos");
    strict_1.default.equal(intent?.valueKey, "currency");
});
(0, node_test_1.default)("keeps expected value keys on row-scoped assertions", () => {
    const [intent] = (0, step_intent_parser_1.parseStepIntent)("En la primera fila, validar que valor autocompletado sea [expected]");
    strict_1.default.equal(intent?.type, "assertion");
    strict_1.default.equal(intent?.rowScope, 1);
    strict_1.default.equal(intent?.expectedValueKey, "expected");
});
