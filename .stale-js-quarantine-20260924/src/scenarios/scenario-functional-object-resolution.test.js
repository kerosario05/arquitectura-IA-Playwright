"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const functional_object_resolver_1 = require("./functional-object-resolver");
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
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
describe("A. Functional object resolution (A1-A5)", () => {
    test("A1: BDD requirement resolves a real object, never 'dado que'", () => {
        const r = (0, functional_object_resolver_1.resolveFunctionalObject)({
            id: "R1",
            sourceText: "Dado que soy cliente del banco, quiero ingresar mi documento de identidad (cedula o pasaporte)",
            action: "fill",
            category: "input_field",
        }, { huModel: { requiredFields: ["documento de identidad"], selectableEntities: ["document"] } });
        node_assert_1.default.notStrictEqual(r.object, "dado que");
        node_assert_1.default.ok(r.object, "must resolve a concrete object");
        node_assert_1.default.strictEqual(r.source, "field");
        node_assert_1.default.strictEqual(r.backed, true);
    });
    test("A2: requirement referencing a concrete field resolves from the field", () => {
        const r = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "Completar el campo de cedula para generar", action: "fill", category: "input_field" }, { huModel: { requiredFields: ["cedula"] } });
        node_assert_1.default.strictEqual(r.object, "cedula");
        node_assert_1.default.strictEqual(r.source, "field");
        node_assert_1.default.strictEqual(r.backed, true);
    });
    test("A3: requirement with no identifiable object returns null, no invention", () => {
        const r = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "Validar que el flujo se ejecute correctamente", action: "validate", category: "ui_validation" }, { huModel: { requiredFields: ["rnc"] } });
        node_assert_1.default.strictEqual(r.object, null);
        node_assert_1.default.strictEqual(r.backed, false);
    });
    test("A4: 'entry' is an internal token, never a functional object", () => {
        const cls = (0, functional_object_resolver_1.classifySemanticObject)("entry");
        node_assert_1.default.strictEqual(cls.valid, false);
        node_assert_1.default.strictEqual(cls.kind, "internal");
        const r = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "Validar entry", action: "validate", category: "ui_validation" }, { huModel: {} });
        node_assert_1.default.strictEqual(r.object, null);
        node_assert_1.default.strictEqual(r.backed, false);
    });
    test("A5: 'found' is an internal token, never a functional object", () => {
        const cls = (0, functional_object_resolver_1.classifySemanticObject)("found");
        node_assert_1.default.strictEqual(cls.valid, false);
        node_assert_1.default.strictEqual(cls.kind, "internal");
        const r = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "Validar found", action: "validate", category: "ui_validation" }, { huModel: {} });
        node_assert_1.default.strictEqual(r.object, null);
        node_assert_1.default.strictEqual(r.backed, false);
    });
});
describe("B. Semantic title contract (B6-B10)", () => {
    test("B6: 'Ejecutar flujo completo de dado que' is invalid", () => {
        const v = (0, functional_object_resolver_1.validateSemanticScenarioTitle)("Ejecutar flujo completo de dado que");
        node_assert_1.default.strictEqual(v.valid, false);
        node_assert_1.default.strictEqual(v.reason, "invalid_or_missing_functional_object");
        node_assert_1.default.strictEqual(v.object, "dado que");
    });
    test("B7: 'Validar entry' is invalid", () => {
        const v = (0, functional_object_resolver_1.validateSemanticScenarioTitle)("Validar entry");
        node_assert_1.default.strictEqual(v.valid, false);
        node_assert_1.default.strictEqual(v.reason, "invalid_or_missing_functional_object");
        node_assert_1.default.strictEqual(v.object, "entry");
    });
    test("B8: 'Validar found' is invalid", () => {
        const v = (0, functional_object_resolver_1.validateSemanticScenarioTitle)("Validar found");
        node_assert_1.default.strictEqual(v.valid, false);
        node_assert_1.default.strictEqual(v.reason, "invalid_or_missing_functional_object");
        node_assert_1.default.strictEqual(v.object, "found");
    });
    test("B9: action + backed object passes the contract", () => {
        const ctx = { huModel: { requiredFields: ["documento de identidad"] } };
        const v = (0, functional_object_resolver_1.validateSemanticScenarioTitle)("Completar documento de identidad", ctx);
        node_assert_1.default.strictEqual(v.valid, true);
        node_assert_1.default.ok(v.object, "must carry an object");
    });
    test("B10: title ending in a preposition is invalid", () => {
        const v = (0, functional_object_resolver_1.validateSemanticScenarioTitle)("Validar estado del");
        node_assert_1.default.strictEqual(v.valid, false);
        node_assert_1.default.strictEqual(v.reason, "invalid_or_missing_functional_object");
    });
});
describe("C. Deterministic local repair (C11-C12)", () => {
    test("C11: bad title + backed object is repaired locally and valid", () => {
        const ctx = { huModel: { requiredFields: ["documento de identidad"] }, featureName: "documento de identidad" };
        const r = (0, functional_object_resolver_1.repairSemanticScenarioTitle)("Ejecutar flujo completo de dado que", ctx);
        node_assert_1.default.strictEqual(r.repaired, true);
        node_assert_1.default.strictEqual(r.valid, true);
        node_assert_1.default.strictEqual(r.title, "Ejecutar flujo completo de documento de identidad");
    });
    test("C12: bad title + no backed object stays unrepairable (no visible scenario)", () => {
        const r = (0, functional_object_resolver_1.repairSemanticScenarioTitle)("Validar entry", {});
        node_assert_1.default.strictEqual(r.repaired, false);
        node_assert_1.default.strictEqual(r.valid, false);
        node_assert_1.default.strictEqual(r.title, "Validar entry");
    });
});
describe("D. Coverage-repair guard (D13-D14)", () => {
    test("D13: gap with invalid object produces no scenario (guard blocks)", () => {
        const resolved = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "Validar entry", action: "validate", category: "ui_validation" }, { huModel: {} });
        node_assert_1.default.strictEqual(resolved.object, null);
        node_assert_1.default.strictEqual(resolved.backed, false);
        const hasValidTarget = !!resolved.object && (0, functional_object_resolver_1.classifySemanticObject)(resolved.object).valid;
        node_assert_1.default.strictEqual(hasValidTarget, false);
    });
    test("D14: gap with backed object produces a valid semantic title", () => {
        const resolved = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "Completar el campo documento de identidad para continuar", action: "fill", category: "input_field" }, { huModel: { requiredFields: ["documento de identidad"] } });
        node_assert_1.default.strictEqual(resolved.object, "documento de identidad");
        node_assert_1.default.strictEqual(resolved.backed, true);
        const v = (0, functional_object_resolver_1.validateSemanticScenarioTitle)(`Completar ${resolved.object}`, {
            huModel: { requiredFields: ["documento de identidad"] },
        });
        node_assert_1.default.strictEqual(v.valid, true);
    });
});
describe("E. required_fields_flow (E15-E16)", () => {
    test("E15: compatible huModel field yields a concrete required-fields object", () => {
        const resolved = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "documento de identidad", action: "fill", category: "input_field" }, { huModel: { requiredFields: ["documento de identidad"] } });
        node_assert_1.default.strictEqual(resolved.object, "documento de identidad");
        node_assert_1.default.strictEqual(resolved.source, "field");
        node_assert_1.default.strictEqual(resolved.backed, true);
        const v = (0, functional_object_resolver_1.validateSemanticScenarioTitle)(`Completar datos requeridos de ${resolved.object}`, {
            huModel: { requiredFields: ["documento de identidad"] },
        });
        node_assert_1.default.strictEqual(v.valid, true);
    });
    test("E16: fields exist but none corresponds — no invented association", () => {
        const r = (0, functional_object_resolver_1.resolveFunctionalObject)({ sourceText: "Validar que el flujo se ejecute correctamente", action: "validate", category: "ui_validation" }, { huModel: { requiredFields: ["rnc"] } });
        node_assert_1.default.strictEqual(r.object, null);
        node_assert_1.default.notStrictEqual(r.object, "rnc");
    });
});
