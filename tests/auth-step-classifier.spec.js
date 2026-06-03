"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const auth_step_classifier_1 = require("../src/discovery/auth-step-classifier");
(0, test_1.test)("isAuthRelatedStep detects 'Cédula de identidad dominicana'", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Cédula de identidad dominicana")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("cedula de identidad dominicana")).toBe(true);
});
(0, test_1.test)("isAuthRelatedStep detects 'Código OTP'", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Código OTP")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("codigo otp")).toBe(true);
});
(0, test_1.test)("isAuthRelatedStep detects 'Confirmar código'", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Confirmar código")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("confirmar codigo")).toBe(true);
});
(0, test_1.test)("isAuthRelatedStep detects identification-related targets", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Identificación del cliente")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("tipo de identificación")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("número de identificación")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("ingrese el número")).toBe(true);
});
(0, test_1.test)("isAuthRelatedStep detects phone confirmation targets", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("confirmar número de teléfono")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("teléfono registrado")).toBe(true);
});
(0, test_1.test)("isAuthRelatedStep detects credential targets", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("usuario")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("contraseña")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("password")).toBe(true);
});
(0, test_1.test)("isAuthRelatedStep detects PIN and token targets", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("PIN")).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("token")).toBe(true);
});
(0, test_1.test)("isAuthRelatedStep returns false for functional targets", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Generar cartas")).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Carta de referencia")).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("cuenta de ahorro activa")).toBe(false);
});
(0, test_1.test)("'continuar' is not auth-related without authGateState", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("continuar")).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Continuar")).toBe(false);
});
(0, test_1.test)("'continuar' is auth-related when authGateState indicates completed", () => {
    const authState = {
        completed: true,
        completedAtStepIndex: 0,
        completedAfterTarget: "transacciones y servicio",
        stagesCompleted: ["identification", "phone_confirmation", "otp", "authenticated"],
        consumedAuthTargets: ["Cédula de identidad dominicana", "continuar"],
        skippedAuthSteps: [],
        authConsumedOpen: true,
        functionalStepSeenAfterAuth: false
    };
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("continuar", authState)).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Continuar", authState)).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthContinueStep)("continuar", authState)).toBe(true);
});
(0, test_1.test)("'continuar' is not auth-related when authConsumedOpen is false", () => {
    const authState = {
        completed: true,
        completedAtStepIndex: 0,
        completedAfterTarget: "transacciones y servicio",
        stagesCompleted: ["identification", "phone_confirmation", "otp", "authenticated"],
        consumedAuthTargets: ["Cédula de identidad dominicana", "continuar"],
        skippedAuthSteps: [],
        authConsumedOpen: false,
        functionalStepSeenAfterAuth: true
    };
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("continuar", authState)).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthContinueStep)("continuar", authState)).toBe(false);
});
(0, test_1.test)("functional 'Continuar' is not skipped after auth segment ends", () => {
    const authState = {
        completed: true,
        completedAtStepIndex: 0,
        completedAfterTarget: "transacciones y servicio",
        stagesCompleted: ["identification", "phone_confirmation", "otp", "authenticated"],
        consumedAuthTargets: ["Cédula de identidad dominicana"],
        skippedAuthSteps: [],
        authConsumedOpen: false,
        functionalStepSeenAfterAuth: true
    };
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Carta de referencia", authState)).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("Generar cartas", authState)).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.isAuthRelatedStep)("continuar", authState)).toBe(false);
});
(0, test_1.test)("shouldSkipStepAsAuthConsumed returns false without authGateState", () => {
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("Cédula de identidad dominicana")).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar")).toBe(false);
});
(0, test_1.test)("shouldSkipStepAsAuthConsumed returns true for auth targets after AuthFlow completes", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("Cédula de identidad dominicana", authState)).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar", authState)).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("confirmar código", authState)).toBe(true);
});
(0, test_1.test)("shouldSkipStepAsAuthConsumed returns false for functional targets after AuthFlow", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("Carta de referencia", authState)).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("Generar cartas", authState)).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("cuenta de ahorro activa", authState)).toBe(false);
});
(0, test_1.test)("createAuthGateState creates correct state structure", () => {
    const state = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 2, ["identification", "otp", "authenticated"]);
    (0, test_1.expect)(state.completed).toBe(true);
    (0, test_1.expect)(state.completedAfterTarget).toBe("transacciones y servicio");
    (0, test_1.expect)(state.completedAtStepIndex).toBe(2);
    (0, test_1.expect)(state.stagesCompleted).toEqual(["identification", "otp", "authenticated"]);
    (0, test_1.expect)(state.consumedAuthTargets).toContain("Cédula de identidad dominicana");
    (0, test_1.expect)(state.consumedAuthTargets).toContain("continuar");
    (0, test_1.expect)(state.skippedAuthSteps).toEqual([]);
    (0, test_1.expect)(state.authConsumedOpen).toBe(true);
    (0, test_1.expect)(state.functionalStepSeenAfterAuth).toBe(false);
});
(0, test_1.test)("markFunctionalStepAfterAuth closes authConsumedOpen for functional target", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, test_1.expect)(authState.authConsumedOpen).toBe(true);
    (0, test_1.expect)(authState.functionalStepSeenAfterAuth).toBe(false);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("Generar cartas", authState);
    (0, test_1.expect)(authState.authConsumedOpen).toBe(false);
    (0, test_1.expect)(authState.functionalStepSeenAfterAuth).toBe(true);
});
(0, test_1.test)("markFunctionalStepAfterAuth does not close for auth keyword target", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("Cédula de identidad dominicana", authState);
    (0, test_1.expect)(authState.authConsumedOpen).toBe(true);
    (0, test_1.expect)(authState.functionalStepSeenAfterAuth).toBe(false);
});
(0, test_1.test)("'continuar' is skipped just after AuthFlow when authConsumedOpen is true", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar", authState)).toBe(true);
    (0, test_1.expect)(authState.authConsumedOpen).toBe(true);
});
(0, test_1.test)("'continuar' is NOT skipped after a functional step", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("Generar cartas", authState);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar", authState)).toBe(false);
});
(0, test_1.test)("'continuar' is NOT skipped after product_condition target", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("cuenta de ahorros", authState);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar", authState)).toBe(false);
});
(0, test_1.test)("'Generar cartas' closes authConsumedOpen", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("Generar cartas", authState);
    (0, test_1.expect)(authState.authConsumedOpen).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar", authState)).toBe(false);
});
(0, test_1.test)("'Carta de referencia' closes authConsumedOpen", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("Carta de referencia", authState);
    (0, test_1.expect)(authState.authConsumedOpen).toBe(false);
});
(0, test_1.test)("'cuenta de ahorros' closes authConsumedOpen", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("cuenta de ahorros", authState);
    (0, test_1.expect)(authState.authConsumedOpen).toBe(false);
});
(0, test_1.test)("C37869 scenario: does not skip Continuar after selecting product", () => {
    const authState = (0, auth_step_classifier_1.createAuthGateState)("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("Cédula de identidad dominicana", authState)).toBe(true);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar", authState)).toBe(true);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("Generar cartas", authState);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("Generar cartas", authState)).toBe(false);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("Carta de referencia", authState);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("Carta de referencia", authState)).toBe(false);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("cuenta de ahorros", authState);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("cuenta de ahorros", authState)).toBe(false);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("continuar", authState)).toBe(false);
    (0, auth_step_classifier_1.markFunctionalStepAfterAuth)("A quien pueda interesar", authState);
    (0, test_1.expect)((0, auth_step_classifier_1.shouldSkipStepAsAuthConsumed)("A quien pueda interesar", authState)).toBe(false);
});
