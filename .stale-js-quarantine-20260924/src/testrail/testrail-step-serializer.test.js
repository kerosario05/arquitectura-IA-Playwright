"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const testrail_step_serializer_1 = require("./testrail-step-serializer");
const testrail_normalizer_1 = require("./testrail-normalizer");
(0, node_test_1.default)("serializeTestRailSteps matches the working TestRail rich-text format and preserves canonical cardinality", () => {
    const steps = [
        { content: "Abrir la aplicación", expected: "La pantalla inicial carga" },
        { content: "Ingresar \"130598983\" en \"RNC\"" },
        { content: "Presionar Validar", expected: "La empresa queda validada" },
    ];
    const serialized = (0, testrail_step_serializer_1.serializeTestRailSteps)(steps);
    strict_1.default.equal(serialized, '<ol>\n<li>Abrir la aplicación<br />Esperado: La pantalla inicial carga</li>\n<li>Ingresar &quot;130598983&quot; en &quot;RNC&quot;</li>\n<li>Presionar Validar<br />Esperado: La empresa queda validada</li>\n</ol>\n');
    strict_1.default.match(serialized, /<ol>/);
    strict_1.default.match(serialized, /<li>/);
    strict_1.default.equal(steps.length, 3);
});
(0, node_test_1.default)("shared serializer round-trips canonical step count and expected association", () => {
    const serialized = (0, testrail_step_serializer_1.serializeTestRailSteps)([
        { content: "Abrir", expected: "Disponible" },
        { content: "Guardar", expected: "Confirmar" },
        { content: "Cerrar" },
    ]);
    const normalized = (0, testrail_normalizer_1.normalizeTestRailCase)({ id: 991, title: "Round trip", custom_steps: serialized });
    strict_1.default.equal(normalized.steps.length, 3);
    strict_1.default.deepEqual(normalized.steps.map((step) => ({ action: step.action, expected: step.expected })), [
        { action: "Abrir", expected: "Disponible" },
        { action: "Guardar", expected: "Confirmar" },
        { action: "Cerrar", expected: undefined },
    ]);
});
(0, node_test_1.default)("presentation ordinal is emitted exactly once by the ol/li serializer", () => {
    const serialized = (0, testrail_step_serializer_1.serializeTestRailSteps)([
        { content: "1. Abrir" },
        { content: "2) Seleccionar" },
        { content: "3. Guardar", expected: "3. Confirmado" },
    ]);
    strict_1.default.equal(serialized, "<ol>\n<li>Abrir</li>\n<li>Seleccionar</li>\n<li>Guardar<br />Esperado: 3. Confirmado</li>\n</ol>\n");
    strict_1.default.equal((serialized.match(/<li>/g) ?? []).length, 3);
    strict_1.default.equal((serialized.match(/\b\d+[.)]\s/g) ?? []).length, 1);
});
