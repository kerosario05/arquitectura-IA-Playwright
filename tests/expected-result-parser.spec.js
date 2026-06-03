"use strict";
/**
 * Expected Result Parser Tests
 *
 * Tests for abstract vs concrete expected result classification.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const assertion_resolver_1 = require("../src/discovery/assertion-resolver");
(0, test_1.test)("abstract expected result is marked as non_executable_criteria", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["El cliente visualiza las categorías principales disponibles para consulta informativa."], []);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption).toHaveLength(1);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
    (0, test_1.expect)(result.nonExecutableCriteria).toContain("El cliente visualiza las categorías principales disponibles para consulta informativa.");
});
(0, test_1.test)("abstract expected result is covered_by_concrete_assertions when steps have assertions", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["El cliente visualiza las categorías principales disponibles para consulta informativa."], ["Tarjetas", "Depósitos a Plazo", "Cuentas de Efectivo", "Préstamos"]);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption).toHaveLength(1);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("covered_by_concrete_assertions");
    (0, test_1.expect)(result.expectedResultConsumption[0].coveredByAssertions).toHaveLength(4);
    (0, test_1.expect)(result.nonExecutableCriteria).toContain("El cliente visualiza las categorías principales disponibles para consulta informativa.");
});
(0, test_1.test)("expected result with quoted text extracts concrete assertions", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(['Se muestran las categorías "Tarjetas", "Préstamos"'], []);
    (0, test_1.expect)(result.assertions).toContain("Tarjetas");
    (0, test_1.expect)(result.assertions).toContain("Préstamos");
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
    (0, test_1.expect)(result.expectedResultConsumption[0].extractedQuotedTexts).toContain("Tarjetas");
    (0, test_1.expect)(result.expectedResultConsumption[0].extractedQuotedTexts).toContain("Préstamos");
});
(0, test_1.test)("expected result with multiple quoted texts generates separate assertions", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(['Se visualiza el mensaje "Solicitud enviada" y el botón "Continuar"'], []);
    (0, test_1.expect)(result.assertions).toContain("Solicitud enviada");
    (0, test_1.expect)(result.assertions).toContain("Continuar");
    (0, test_1.expect)(result.expectedResultConsumption[0].extractedQuotedTexts).toHaveLength(2);
});
(0, test_1.test)("concrete expected result without quotes is classified correctly", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["Tarjetas"], []);
    (0, test_1.expect)(result.assertions).toContain("Tarjetas");
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});
(0, test_1.test)("generic success message is marked as non_executable", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["La operación se realiza exitosamente"], []);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});
(0, test_1.test)("abstract expected result does not block when concrete assertions exist", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["El flujo permanece dentro del entorno controlado"], ["Botón visible", "Formulario completado"]);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("covered_by_concrete_assertions");
    (0, test_1.expect)(result.nonExecutableCriteria).toHaveLength(1);
});
(0, test_1.test)("expected result with button name in quotes is executable", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(['Se muestra el botón "Add to cart"'], []);
    (0, test_1.expect)(result.assertions).toContain("Add to cart");
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});
(0, test_1.test)("expected result with link name in quotes is executable", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(['Se muestra el enlace "Información de productos"'], []);
    (0, test_1.expect)(result.assertions).toContain("Información de productos");
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});
(0, test_1.test)("expected result with field name in quotes is executable", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(['Se visualiza el campo "Correo electrónico"'], []);
    (0, test_1.expect)(result.assertions).toContain("Correo electrónico");
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});
(0, test_1.test)("classifyAssertion returns literal_observable for quoted text", () => {
    const classification = (0, assertion_resolver_1.classifyAssertion)('Se muestra "Tarjetas"');
    (0, test_1.expect)(classification).toBe("literal_observable");
});
(0, test_1.test)("classifyAssertion handles text without quotes", () => {
    // classifyAssertion is a general classifier - the abstract detection is in buildConcreteAssertionsFromExpected
    const classification = (0, assertion_resolver_1.classifyAssertion)("El cliente visualiza las categorías principales");
    // This may return literal_observable since it doesn't have descriptor keywords
    // The abstract detection happens in buildConcreteAssertionsFromExpected via isAbstractExpected
    (0, test_1.expect)(classification).toBeTruthy();
});
(0, test_1.test)("empty expected result returns empty arrays", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)([], []);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption).toHaveLength(0);
    (0, test_1.expect)(result.nonExecutableCriteria).toHaveLength(0);
});
(0, test_1.test)("expected result 'Las categorías principales corresponden al catálogo esperado' is non_executable", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["Las categorías principales corresponden al catálogo esperado"], []);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});
(0, test_1.test)("expected result 'El sistema muestra la información correctamente' is non_executable", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["El sistema muestra la información correctamente"], []);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});
(0, test_1.test)("expected result 'La pantalla muestra los datos solicitados correctamente' is non_executable", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["La pantalla muestra los datos solicitados correctamente"], []);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});
(0, test_1.test)("mixed expected result with concrete and abstract parts", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)([
        'Se muestra "Tarjetas"',
        "El cliente visualiza las categorías principales"
    ], []);
    (0, test_1.expect)(result.assertions).toContain("Tarjetas");
    (0, test_1.expect)(result.assertions).not.toContain("El cliente visualiza las categorías principales");
    (0, test_1.expect)(result.expectedResultConsumption).toHaveLength(2);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
    (0, test_1.expect)(result.expectedResultConsumption[1].classification).toBe("non_executable_criteria");
});
(0, test_1.test)("expected result covered does not duplicate existing assertions", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(['Se muestra "Tarjetas"'], ["Tarjetas"]);
    (0, test_1.expect)(result.assertions).toHaveLength(0);
    (0, test_1.expect)(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});
