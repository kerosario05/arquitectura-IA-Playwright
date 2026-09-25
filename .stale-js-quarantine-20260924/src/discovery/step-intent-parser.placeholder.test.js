"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const step_intent_parser_1 = require("./step-intent-parser");
const cases = [
    ["auth.company_identifier", "RNC de la empresa"],
    ["auth.username", "Nombre de usuario"],
    ["auth.password", "Contraseña"],
    ["employee_1.document", "Cédula empleado 1"],
    ["a.b.c", "Campo"],
];
for (const [key, field] of cases) {
    (0, node_test_1.default)(`preserves placeholder ${key}`, () => {
        const parsed = (0, step_intent_parser_1.parseStepIntent)(`Ingresar el valor [${key}] en el campo "${field}".`);
        strict_1.default.equal(parsed.length, 1);
        strict_1.default.equal(parsed[0]?.type, "action_fill");
        strict_1.default.equal(parsed[0]?.actionTarget, field);
        strict_1.default.equal(parsed[0]?.valueKey, key);
    });
}
(0, node_test_1.default)("preserves a real sentence delimiter", () => {
    const parsed = (0, step_intent_parser_1.parseStepIntent)('Ingresar el valor [auth.company_identifier] en el campo "RNC de la empresa". Continuar.');
    strict_1.default.equal(parsed.length, 2);
    strict_1.default.equal(parsed[0]?.valueKey, "auth.company_identifier");
});
