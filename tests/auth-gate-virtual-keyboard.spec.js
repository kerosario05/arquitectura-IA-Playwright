"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const auth_gate_detector_1 = require("../src/discovery/auth-gate-detector");
function makeSnapshot(elements) {
    return {
        url: "https://example.com",
        title: "Test Page",
        elements: elements,
        summary: {
            totalElements: elements.length,
            buttons: elements.filter(e => e.tagName === "button").length,
            inputs: elements.filter(e => e.tagName === "input").length
        }
    };
}
(0, test_1.test)("detects identification_input with 'Número de identificación' + 'Ingrese el número'", () => {
    const snapshot = makeSnapshot([
        { text: "Número de identificación", tagName: "label" },
        { text: "Ingrese el número", tagName: "p" },
        { className: "virtual-keyboard numeric-keypad", tagName: "div" },
        { text: "Continuar", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("identification_input");
    (0, test_1.expect)(result.requiredInputs).toContain("identificationNumber");
    (0, test_1.expect)(result.confidence).toBeGreaterThanOrEqual(0.6);
});
(0, test_1.test)("identification_input requires identificationNumber", () => {
    const snapshot = makeSnapshot([
        { text: "Numero de identificacion", tagName: "label" },
        { text: "Ingrese el numero", tagName: "p" },
        { className: "keypad-container", tagName: "div" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("identification_input");
    (0, test_1.expect)(result.requiredInputs).toEqual(["identificationNumber"]);
});
(0, test_1.test)("detects identification_input with numeric buttons even without explicit class", () => {
    const snapshot = makeSnapshot([
        { text: "Número de identificación", tagName: "label" },
        { text: "0", tagName: "button" },
        { text: "1", tagName: "button" },
        { text: "2", tagName: "button" },
        { text: "3", tagName: "button" },
        { text: "4", tagName: "button" },
        { text: "5", tagName: "button" },
        { text: "6", tagName: "button" },
        { text: "7", tagName: "button" },
        { text: "8", tagName: "button" },
        { text: "9", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("identification_input");
    (0, test_1.expect)(result.hasVirtualKeyboard).toBe(false);
});
(0, test_1.test)("does not confuse identification_type_selection with identification_input", () => {
    const snapshot = makeSnapshot([
        { text: "Identificación del cliente", tagName: "h2" },
        { text: "Seleccione su tipo de identificación", tagName: "p" },
        { text: "Cédula de identidad dominicana", tagName: "button" },
        { text: "Pasaporte extranjero", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("identification_type_selection");
    (0, test_1.expect)(result.requiredInputs).toContain("identificationType");
    (0, test_1.expect)(result.requiredInputs).not.toContain("identificationNumber");
});
(0, test_1.test)("detects OTP with virtual keyboard", () => {
    const snapshot = makeSnapshot([
        { text: "Código OTP", tagName: "h2" },
        { text: "Ingrese el código", tagName: "p" },
        { className: "virtual-keyboard numeric-keypad", tagName: "div" },
        { text: "Confirmar código", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("otp");
    (0, test_1.expect)(result.requiredInputs).toContain("otp");
    (0, test_1.expect)(result.hasVirtualKeyboard).toBe(true);
});
(0, test_1.test)("reports continueButtonPresent when continuar button exists", () => {
    const snapshot = makeSnapshot([
        { text: "Número de identificación", tagName: "label" },
        { text: "Ingrese el número", tagName: "p" },
        { className: "virtual-keyboard", tagName: "div" },
        { text: "Continuar", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.continueButtonPresent).toBe(true);
});
(0, test_1.test)("reports hasNativeInput when input elements exist", () => {
    const snapshot = makeSnapshot([
        { text: "Número de identificación", tagName: "label" },
        { tagName: "input" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.hasNativeInput).toBe(true);
});
(0, test_1.test)("masked identificationNumber shows last 4 digits", () => {
    const { maskValue } = require("../src/discovery/auth-input-resolver");
    (0, test_1.expect)(maskValue("40224679551")).toBe("*******9551");
    (0, test_1.expect)(maskValue("1234")).toBe("****");
    (0, test_1.expect)(maskValue("123")).toBe("****");
    (0, test_1.expect)(maskValue("")).toBe("");
});
