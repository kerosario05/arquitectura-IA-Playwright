"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const target_alias_resolver_1 = require("./target-alias-resolver");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(_name, fn) {
    console.log(`\n${_name}`);
    fn();
}
const profile = {
    aliases: {
        "Volver al listado de productos": "Volver",
        "Regresar al listado": "Volver",
        "Ir a inicio": "Inicio",
    },
};
const emptyProfile = {};
describe("resolveTargetWithAliases", () => {
    test("no routeProfile: returns not resolved", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Volver al listado", undefined);
        node_assert_1.default.strictEqual(result.resolved, false);
        node_assert_1.default.strictEqual(result.source, "none");
    });
    test("no aliases: returns not resolved", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Volver al listado", emptyProfile);
        node_assert_1.default.strictEqual(result.resolved, false);
        node_assert_1.default.strictEqual(result.source, "none");
    });
    test("target matches alias value exactly: resolves to canonical key", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Volver", profile);
        node_assert_1.default.ok(result.resolved);
        node_assert_1.default.strictEqual(result.resolvedTarget, "Volver");
        node_assert_1.default.strictEqual(result.matchedValue, "Volver");
        node_assert_1.default.ok(result.confidence >= 0.9);
    });
    test("target text contains alias key (long form): resolves to short value", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Hacer clic en Volver al listado de productos", profile);
        node_assert_1.default.ok(result.resolved);
        node_assert_1.default.strictEqual(result.resolvedTarget, "Volver");
        node_assert_1.default.ok(result.confidence >= 0.8);
    });
    test("target partially matches alias by token overlap: resolves with moderate confidence", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Regresar a listado productos", profile);
        node_assert_1.default.ok(result.resolved);
        node_assert_1.default.strictEqual(result.resolvedTarget, "Volver");
        node_assert_1.default.ok(result.confidence >= 0.7);
    });
    test("target with no token overlap: not resolved", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Configuración avanzada", profile);
        node_assert_1.default.strictEqual(result.resolved, false);
    });
    test("non-matching short target: not resolved", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Guardar", profile);
        node_assert_1.default.strictEqual(result.resolved, false);
    });
    test("alias from one appSlug does not apply to another (empty profile check)", () => {
        const otherProfile = {
            aliases: { "Productos activos": "Activos" },
        };
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Volver al listado", otherProfile);
        node_assert_1.default.strictEqual(result.resolved, false);
    });
    test("navigate step with descriptive text is resolved", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Ir a inicio", profile);
        node_assert_1.default.ok(result.resolved);
        node_assert_1.default.strictEqual(result.resolvedTarget, "Inicio");
    });
    test("returns originalTarget unchanged", () => {
        const result = (0, target_alias_resolver_1.resolveTargetWithAliases)("Volver al listado de productos", profile);
        node_assert_1.default.strictEqual(result.originalTarget, "Volver al listado de productos");
    });
});
