"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const automation_naming_1 = require("../src/automations/automation-naming");
(0, test_1.test)("sanitizeAutomationFileName converts to lowercase", () => {
    const result = (0, automation_naming_1.sanitizeAutomationFileName)("Mi Prueba");
    (0, test_1.expect)(result).toBe("mi-prueba");
});
(0, test_1.test)("sanitizeAutomationFileName replaces spaces with hyphens", () => {
    const result = (0, automation_naming_1.sanitizeAutomationFileName)("mi prueba de prueba");
    (0, test_1.expect)(result).toBe("mi-prueba-de-prueba");
});
(0, test_1.test)("sanitizeAutomationFileName removes accents", () => {
    const result = (0, automation_naming_1.sanitizeAutomationFileName)("Información De Pruebas");
    (0, test_1.expect)(result).toBe("informacion-de-pruebas");
});
(0, test_1.test)("sanitizeAutomationFileName removes invalid Windows characters", () => {
    const result = (0, automation_naming_1.sanitizeAutomationFileName)("mi<prueba>:prueba*.txt");
    (0, test_1.expect)(result).toBe("mi-prueba-prueba-txt");
});
(0, test_1.test)("sanitizeAutomationFileName removes multiple consecutive hyphens", () => {
    const result = (0, automation_naming_1.sanitizeAutomationFileName)("mi  prueba___test");
    (0, test_1.expect)(result).toBe("mi-prueba-test");
});
(0, test_1.test)("sanitizeAutomationFileName limits length to 120", () => {
    const long = "a".repeat(200);
    const result = (0, automation_naming_1.sanitizeAutomationFileName)(long);
    (0, test_1.expect)(result.length).toBeLessThanOrEqual(120);
});
(0, test_1.test)("sanitizeAutomationFileName handles special characters", () => {
    const result = (0, automation_naming_1.sanitizeAutomationFileName)("login-test@#$%site");
    (0, test_1.expect)(result).toBe("login-test-site");
});
(0, test_1.test)("sanitizeAutomationFileName handles empty string", () => {
    const result = (0, automation_naming_1.sanitizeAutomationFileName)("");
    (0, test_1.expect)(result).toBe("automation");
});
(0, test_1.test)("buildAutomationId uses externalId as prefix (lowercased)", () => {
    const id = (0, automation_naming_1.buildAutomationId)({
        externalId: "C37616",
        title: "Acceso al modulo"
    });
    (0, test_1.expect)(id).toMatch(/^c37616-/);
});
(0, test_1.test)("buildAutomationId uses caseId when no externalId", () => {
    const id = (0, automation_naming_1.buildAutomationId)({
        caseId: 37616,
        title: "Acceso al modulo"
    });
    (0, test_1.expect)(id).toMatch(/^37616-/);
});
(0, test_1.test)("buildAutomationId uses title when no externalId or caseId", () => {
    const id = (0, automation_naming_1.buildAutomationId)({
        title: "Acceso al modulo"
    });
    (0, test_1.expect)(id).toBe("acceso-al-modulo");
});
(0, test_1.test)("buildAutomationId sanitizes title including accents and invalid chars", () => {
    const id = (0, automation_naming_1.buildAutomationId)({
        externalId: "C37616",
        title: "Información De Pruebas: Test"
    });
    (0, test_1.expect)(id).toBe("c37616-informacion-de-pruebas-test");
});
(0, test_1.test)("buildAutomationId keeps id under reasonable length", () => {
    const id = (0, automation_naming_1.buildAutomationId)({
        externalId: "C37616",
        title: "a".repeat(200)
    });
    (0, test_1.expect)(id.length).toBeLessThan(130);
});
