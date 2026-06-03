"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const auth_gate_detector_1 = require("../src/discovery/auth-gate-detector");
const auth_flow_helpers_1 = require("../src/discovery/auth-flow-helpers");
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
// ==========================================
// AuthGateDetector tests
// ==========================================
(0, test_1.test)("detects identification type selection screen", () => {
    const snapshot = makeSnapshot([
        { text: "Identificación del cliente", tagName: "h2" },
        { text: "Seleccione su tipo de identificación", tagName: "p" },
        { text: "Cédula de identidad dominicana", tagName: "button" },
        { text: "Pasaporte extranjero", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("identification_type_selection");
    (0, test_1.expect)(result.gateType).toBe("customer_identification_otp");
    (0, test_1.expect)(result.confidence).toBeGreaterThanOrEqual(0.6);
    (0, test_1.expect)(result.evidence.length).toBeGreaterThan(0);
    (0, test_1.expect)(result.requiredInputs).toContain("identificationType");
});
(0, test_1.test)("detects identification input screen with virtual keyboard", () => {
    const snapshot = makeSnapshot([
        { text: "Número de identificación", tagName: "label" },
        { text: "Ingrese el número", tagName: "p" },
        { className: "virtual-keyboard numeric-keypad", tagName: "div" },
        { text: "Continuar", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("identification_input");
    (0, test_1.expect)(result.gateType).toBe("customer_identification_otp");
    (0, test_1.expect)(result.confidence).toBeGreaterThanOrEqual(0.6);
    (0, test_1.expect)(result.requiredInputs).toContain("identificationNumber");
    (0, test_1.expect)(result.hasVirtualKeyboard).toBe(true);
    (0, test_1.expect)(result.continueButtonPresent).toBe(true);
});
(0, test_1.test)("detects phone confirmation screen", () => {
    const snapshot = makeSnapshot([
        { text: "Confirmar número de teléfono", tagName: "h2" },
        { text: "Estaremos enviándole un código de verificación", tagName: "p" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("phone_confirmation");
    (0, test_1.expect)(result.gateType).toBe("customer_identification_otp");
});
(0, test_1.test)("detects OTP screen", () => {
    const snapshot = makeSnapshot([
        { text: "Código OTP", tagName: "h2" },
        { text: "Ingrese el código de verificación", tagName: "p" },
        { text: "Confirmar código", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("otp");
    (0, test_1.expect)(result.gateType).toBe("customer_identification_otp");
});
(0, test_1.test)("does not detect auth gate on functional screen", () => {
    const snapshot = makeSnapshot([
        { text: "Generar cartas", tagName: "h2" },
        { text: "Carta de referencia", tagName: "button" },
        { text: "Cuenta de ahorro", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(false);
});
(0, test_1.test)("does not detect auth gate on product list", () => {
    const snapshot = makeSnapshot([
        { text: "Tarjetas", tagName: "h2" },
        { text: "Tarjeta de Crédito Visa Gold", tagName: "button" },
        { text: "Tarjeta de Crédito Visa Platinum", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(false);
});
(0, test_1.test)("detects OTP with virtual keyboard indicator", () => {
    const snapshot = makeSnapshot([
        { text: "Código de Verificación", tagName: "h2" },
        { className: "otp-input-container otp-field", tagName: "div" },
        { className: "virtual-keypad numeric-keyboard", tagName: "div" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("otp");
});
// ==========================================
// isLikelyAuthGate tests
// ==========================================
(0, test_1.test)("isLikelyAuthGate returns true for identification text", () => {
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("Identificación del cliente")).toBe(true);
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("identificacion del cliente")).toBe(true);
});
(0, test_1.test)("isLikelyAuthGate returns true for OTP text", () => {
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("Código OTP")).toBe(true);
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("codigo otp")).toBe(true);
});
(0, test_1.test)("isLikelyAuthGate returns true for phone confirmation text", () => {
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("Confirmar número de teléfono")).toBe(true);
});
(0, test_1.test)("isLikelyAuthGate returns false for functional text", () => {
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("Generar cartas")).toBe(false);
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("Tarjeta de Crédito")).toBe(false);
    (0, test_1.expect)((0, auth_flow_helpers_1.isLikelyAuthGate)("Cuenta de ahorro")).toBe(false);
});
// ==========================================
// AuthFlow spec generation tests
// ==========================================
(0, test_1.test)("buildAuthFlowSpecImport generates correct import", () => {
    const import1 = (0, auth_flow_helpers_1.buildAuthFlowSpecImport)("default");
    (0, test_1.expect)(import1).toContain("AuthFlow");
    (0, test_1.expect)(import1).toContain("setAuthFlowTestData");
    (0, test_1.expect)(import1).toContain("auth.flow");
});
(0, test_1.test)("buildAuthFlowInstantiation generates correct code", () => {
    const code = (0, auth_flow_helpers_1.buildAuthFlowInstantiation)();
    (0, test_1.expect)(code).toContain("new AuthFlow(page)");
});
(0, test_1.test)("buildAuthFlowCall generates correct call with options", () => {
    const code = (0, auth_flow_helpers_1.buildAuthFlowCall)({ alias: "defaultClient", landing: "transactions_menu" });
    (0, test_1.expect)(code).toContain("ensureAuthenticated");
    (0, test_1.expect)(code).toContain("defaultClient");
    (0, test_1.expect)(code).toContain("transactions_menu");
});
(0, test_1.test)("buildAuthFlowCall generates call with minimal options", () => {
    const code = (0, auth_flow_helpers_1.buildAuthFlowCall)({});
    (0, test_1.expect)(code).toContain("ensureAuthenticated");
});
// ==========================================
// Stronger AuthGate signal tests
// ==========================================
(0, test_1.test)("single 'Log in' button alone does not trigger AuthGate", () => {
    const snapshot = makeSnapshot([
        { text: "Log in", tagName: "button" },
        { text: "Welcome to our site", tagName: "h1" },
        { text: "Browse products", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(false);
});
(0, test_1.test)("single 'Email' text alone does not trigger AuthGate", () => {
    const snapshot = makeSnapshot([
        { text: "Contact us at email@example.com", tagName: "p" },
        { text: "About us", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(false);
});
(0, test_1.test)("single 'Usuario' text alone does not trigger AuthGate", () => {
    const snapshot = makeSnapshot([
        { text: "Usuario registrado", tagName: "span" },
        { text: "Dashboard", tagName: "h1" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(false);
});
(0, test_1.test)("AuthGate triggers with multiple credential keywords", () => {
    const snapshot = makeSnapshot([
        { text: "Usuario", tagName: "label" },
        { text: "Contraseña", tagName: "label" },
        { text: "Iniciar sesión", tagName: "button" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("credentials");
});
(0, test_1.test)("AuthGate triggers with strong keyword + form context", () => {
    const snapshot = makeSnapshot([
        { text: "Password", tagName: "label" },
        { tagName: "input" },
        { tagName: "input" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("credentials");
});
(0, test_1.test)("public page with 'Log in' link and functional content does not trigger AuthGate", () => {
    const snapshot = makeSnapshot([
        { text: "Log in", tagName: "a" },
        { text: "Sign up", tagName: "a" },
        { text: "Featured Products", tagName: "h1" },
        { text: "Product A - $50", tagName: "div" },
        { text: "Product B - $75", tagName: "div" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(false);
});
(0, test_1.test)("auth form with username and password fields triggers AuthGate", () => {
    const snapshot = makeSnapshot([
        { text: "Username", tagName: "label" },
        { text: "Password", tagName: "label" },
        { text: "Log in", tagName: "button" },
        { tagName: "input" },
        { tagName: "input" }
    ]);
    const result = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
    (0, test_1.expect)(result.detected).toBe(true);
    (0, test_1.expect)(result.stage).toBe("credentials");
    (0, test_1.expect)(result.requiredInputs).toContain("username");
    (0, test_1.expect)(result.requiredInputs).toContain("password");
});
