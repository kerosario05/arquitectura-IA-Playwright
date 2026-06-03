"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const data_hint_extractor_1 = require("../src/explorer/data-hint-extractor");
(0, test_1.test)("maps cedula with accent normalization", () => {
    const hints = (0, data_hint_extractor_1.extractDataHintsFromElementText)("Ingrese Cédula del cliente");
    (0, test_1.expect)(hints).toContain("cedula");
});
(0, test_1.test)("maps codigo otp pin hints", () => {
    const hints = (0, data_hint_extractor_1.extractDataHintsFromElementText)("Código OTP PIN");
    (0, test_1.expect)(hints).toEqual(test_1.expect.arrayContaining(["codigo", "otp", "pin"]));
});
(0, test_1.test)("maps monto and amount to monto", () => {
    const hints = (0, data_hint_extractor_1.extractDataHintsFromElementText)("Monto amount valor");
    (0, test_1.expect)(hints).toContain("monto");
});
(0, test_1.test)("maps cuenta account and prestamo loan", () => {
    const hints = (0, data_hint_extractor_1.extractDataHintsFromElementText)("cuenta account préstamo loan");
    (0, test_1.expect)(hints).toEqual(test_1.expect.arrayContaining(["cuenta", "prestamo"]));
});
(0, test_1.test)("returns unique values", () => {
    const hints = (0, data_hint_extractor_1.extractDataHintsFromElementText)("usuario user username usuario");
    const unique = new Set(hints);
    (0, test_1.expect)(unique.size).toBe(hints.length);
});
