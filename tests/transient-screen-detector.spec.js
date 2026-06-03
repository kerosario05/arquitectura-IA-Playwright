"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const transient_screen_detector_1 = require("../src/discovery/transient-screen-detector");
function makeSnapshot(elements, url) {
    return {
        url: url || "https://example.com",
        title: "Test Page",
        elements: elements,
        summary: {
            totalElements: elements.length,
            buttons: elements.filter(e => e.tagName === "button").length,
            inputs: elements.filter(e => e.tagName === "input").length
        }
    };
}
(0, test_1.test)("detectTransientScreen detects 'Redirigiendo...' as transient", () => {
    const snapshot = makeSnapshot([
        { text: "Redirigiendo al menú de operaciones...", tagName: "p" }
    ], "https://example.com/authentication-success");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
    (0, test_1.expect)(result.reason).toBe("redirecting_after_auth");
    (0, test_1.expect)(result.confidence).toBeGreaterThanOrEqual(0.5);
});
(0, test_1.test)("detectTransientScreen detects 'Cargando...' as transient", () => {
    const snapshot = makeSnapshot([
        { text: "Cargando...", tagName: "p" }
    ]);
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
    (0, test_1.expect)(result.reason).toBe("loading");
});
(0, test_1.test)("detectTransientScreen detects 'Autenticación exitosa' + 'Redirigiendo' as transient", () => {
    const snapshot = makeSnapshot([
        { text: "¡Autenticación exitosa!", tagName: "h2" },
        { text: "Redirigiendo al menú de operaciones...", tagName: "p" }
    ], "https://example.com/authentication-success");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
    (0, test_1.expect)(result.reason).toBe("redirecting_after_auth");
});
(0, test_1.test)("detectTransientScreen detects URL /authentication-success as transient", () => {
    const snapshot = makeSnapshot([
        { text: "Identidad validada", tagName: "h2" }
    ], "https://example.com/authentication-success");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
});
(0, test_1.test)("detectTransientScreen does not mark functional screen as transient", () => {
    const snapshot = makeSnapshot([
        { text: "Transacciones y Servicios", tagName: "h2" },
        { text: "Generar cartas", tagName: "button" },
        { text: "Estado de cuenta", tagName: "button" },
        { text: "Consulta de balance", tagName: "button" },
        { text: "Pago de productos", tagName: "button" }
    ], "https://example.com/operations-menu");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(false);
});
(0, test_1.test)("detectTransientScreen detects 'Código verificado exitosamente' as transient", () => {
    const snapshot = makeSnapshot([
        { text: "¡Código verificado exitosamente!", tagName: "p" },
        { text: "Autenticación exitosa", tagName: "h2" }
    ]);
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
    (0, test_1.expect)(result.reason).toBe("success_intermediate");
});
(0, test_1.test)("detectTransientScreen detects 'Por favor espere' as transient", () => {
    const snapshot = makeSnapshot([
        { text: "Por favor espere", tagName: "p" },
        { text: "Procesando su solicitud...", tagName: "p" }
    ]);
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
});
(0, test_1.test)("detectTransientScreen returns false for empty snapshot", () => {
    const snapshot = makeSnapshot([]);
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(false);
});
(0, test_1.test)("detectTransientScreen considers product list with visible cards as stable", () => {
    const snapshot = makeSnapshot([
        { text: "Cuenta de Ahorros ****4962", tagName: "div" },
        { text: "Saldo: RD$ 10,000.00", tagName: "p" },
        { text: "Activa", tagName: "span" },
        { text: "Seleccionar", tagName: "button" }
    ], "https://example.com/generate-letters");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(false);
});
(0, test_1.test)("detectTransientScreen considers '0 productos' as transient (data_loading)", () => {
    const snapshot = makeSnapshot([
        { text: "0 productos", tagName: "p" },
        { text: "Continuar (0 productos)", tagName: "button" }
    ], "https://example.com/generate-letters");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
    (0, test_1.expect)(result.reason).toBe("data_loading");
});
(0, test_1.test)("detectTransientScreen considers 'Cargando productos' as transient", () => {
    const snapshot = makeSnapshot([
        { text: "Cargando productos...", tagName: "p" }
    ], "https://example.com/generate-letters");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(true);
    (0, test_1.expect)(result.reason).toBe("data_loading");
});
(0, test_1.test)("detectTransientScreen stable when product cards visible and no loading", () => {
    const snapshot = makeSnapshot([
        { text: "Cuenta de Ahorros ****4962", tagName: "div" },
        { text: "Saldo: RD$ 10,000.00", tagName: "p" },
        { text: "Activa", tagName: "span" },
        { text: "Tarjeta de Crédito ****1234", tagName: "div" },
        { text: "Limite: RD$ 50,000.00", tagName: "p" },
        { text: "Activa", tagName: "span" }
    ], "https://example.com/generate-letters");
    const result = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
    (0, test_1.expect)(result.transient).toBe(false);
});
