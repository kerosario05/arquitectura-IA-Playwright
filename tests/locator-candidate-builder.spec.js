"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const locator_candidate_builder_1 = require("../src/explorer/locator-candidate-builder");
(0, test_1.test)("testId creates high confidence locator", () => {
    const locators = (0, locator_candidate_builder_1.buildCandidateLocators)({ testId: "login-btn" });
    (0, test_1.expect)(locators[0]).toMatchObject({ strategy: "testId", confidence: 0.95 });
});
(0, test_1.test)("role and name creates role locator", () => {
    const locators = (0, locator_candidate_builder_1.buildCandidateLocators)({ role: "button", name: "Entrar" });
    (0, test_1.expect)(locators.some((locator) => locator.strategy === "role")).toBe(true);
});
(0, test_1.test)("label creates label locator", () => {
    const locators = (0, locator_candidate_builder_1.buildCandidateLocators)({ label: "Usuario" });
    (0, test_1.expect)(locators.some((locator) => locator.strategy === "label")).toBe(true);
});
(0, test_1.test)("placeholder creates placeholder locator", () => {
    const locators = (0, locator_candidate_builder_1.buildCandidateLocators)({ placeholder: "Correo" });
    (0, test_1.expect)(locators.some((locator) => locator.strategy === "placeholder")).toBe(true);
});
(0, test_1.test)("id creates low confidence css locator", () => {
    const locators = (0, locator_candidate_builder_1.buildCandidateLocators)({ id: "username" });
    const css = locators.find((locator) => locator.strategy === "css");
    (0, test_1.expect)(css?.confidence).toBe(0.55);
});
(0, test_1.test)("does not generate empty locators", () => {
    const locators = (0, locator_candidate_builder_1.buildCandidateLocators)({});
    (0, test_1.expect)(locators).toHaveLength(0);
});
