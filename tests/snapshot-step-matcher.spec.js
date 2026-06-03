"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const snapshot_step_matcher_1 = require("../src/plans/snapshot-step-matcher");
const baseSnapshot = {
    version: "1.0",
    url: "https://example.com",
    title: "Example",
    capturedAt: new Date().toISOString(),
    elements: [
        {
            id: "e1",
            type: "input",
            label: "Cédula",
            visible: true,
            candidateLocators: [{ strategy: "label", value: "Cédula", confidence: 0.85 }],
            dataHints: ["cedula"]
        },
        {
            id: "e2",
            type: "input",
            placeholder: "Código OTP",
            visible: true,
            candidateLocators: [{ strategy: "placeholder", value: "Código OTP", confidence: 0.8 }],
            dataHints: ["codigo", "otp"]
        },
        {
            id: "e3",
            type: "button",
            text: "Consultar",
            visible: true,
            candidateLocators: [{ strategy: "text", value: "Consultar", confidence: 0.75 }],
            dataHints: []
        }
    ],
    summary: { totalElements: 3, buttons: 1, links: 0, inputs: 2, selects: 0, tables: 0, dialogs: 0, headings: 0 }
};
(0, test_1.test)("matches by label", () => {
    const result = (0, snapshot_step_matcher_1.findBestElementForStep)("Ingresar cedula", baseSnapshot, ["input"]);
    (0, test_1.expect)(result.element?.id).toBe("e1");
});
(0, test_1.test)("matches by placeholder", () => {
    const result = (0, snapshot_step_matcher_1.findBestElementForStep)("Escribir OTP", baseSnapshot, ["input"]);
    (0, test_1.expect)(result.element?.id).toBe("e2");
});
(0, test_1.test)("matches by text", () => {
    const result = (0, snapshot_step_matcher_1.findBestElementForStep)("Presionar Consultar", baseSnapshot, ["button"]);
    (0, test_1.expect)(result.element?.id).toBe("e3");
});
(0, test_1.test)("preferred type increases confidence", () => {
    const withBonus = (0, snapshot_step_matcher_1.findBestElementForStep)("Consultar", baseSnapshot, ["button"]);
    const withoutBonus = (0, snapshot_step_matcher_1.findBestElementForStep)("Consultar", baseSnapshot, ["input"]);
    (0, test_1.expect)(withBonus.confidence).toBeGreaterThan(withoutBonus.confidence);
});
(0, test_1.test)("disabled element is penalized", () => {
    const snapshot = { ...baseSnapshot, elements: [{ ...baseSnapshot.elements[0], disabled: true }] };
    const result = (0, snapshot_step_matcher_1.findBestElementForStep)("Ingresar cedula", snapshot, ["input"]);
    (0, test_1.expect)(result.confidence).toBeLessThan(0.8);
});
(0, test_1.test)("no candidate locators penalizes confidence", () => {
    const snapshot = { ...baseSnapshot, elements: [{ ...baseSnapshot.elements[0], candidateLocators: [] }] };
    const result = (0, snapshot_step_matcher_1.findBestElementForStep)("Ingresar cedula", snapshot, ["input"]);
    (0, test_1.expect)(result.confidence).toBeLessThan(0.8);
});
