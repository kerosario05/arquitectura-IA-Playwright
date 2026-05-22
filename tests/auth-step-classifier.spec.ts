import { test, expect } from "@playwright/test";
import {
  isAuthRelatedStep,
  isAuthContinueStep,
  shouldSkipStepAsAuthConsumed,
  markFunctionalStepAfterAuth,
  createAuthGateState,
  type AuthGateState
} from "../src/discovery/auth-step-classifier";

test("isAuthRelatedStep detects 'Cédula de identidad dominicana'", () => {
  expect(isAuthRelatedStep("Cédula de identidad dominicana")).toBe(true);
  expect(isAuthRelatedStep("cedula de identidad dominicana")).toBe(true);
});

test("isAuthRelatedStep detects 'Código OTP'", () => {
  expect(isAuthRelatedStep("Código OTP")).toBe(true);
  expect(isAuthRelatedStep("codigo otp")).toBe(true);
});

test("isAuthRelatedStep detects 'Confirmar código'", () => {
  expect(isAuthRelatedStep("Confirmar código")).toBe(true);
  expect(isAuthRelatedStep("confirmar codigo")).toBe(true);
});

test("isAuthRelatedStep detects identification-related targets", () => {
  expect(isAuthRelatedStep("Identificación del cliente")).toBe(true);
  expect(isAuthRelatedStep("tipo de identificación")).toBe(true);
  expect(isAuthRelatedStep("número de identificación")).toBe(true);
  expect(isAuthRelatedStep("ingrese el número")).toBe(true);
});

test("isAuthRelatedStep detects phone confirmation targets", () => {
  expect(isAuthRelatedStep("confirmar número de teléfono")).toBe(true);
  expect(isAuthRelatedStep("teléfono registrado")).toBe(true);
});

test("isAuthRelatedStep detects credential targets", () => {
  expect(isAuthRelatedStep("usuario")).toBe(true);
  expect(isAuthRelatedStep("contraseña")).toBe(true);
  expect(isAuthRelatedStep("password")).toBe(true);
});

test("isAuthRelatedStep detects PIN and token targets", () => {
  expect(isAuthRelatedStep("PIN")).toBe(true);
  expect(isAuthRelatedStep("token")).toBe(true);
});

test("isAuthRelatedStep returns false for functional targets", () => {
  expect(isAuthRelatedStep("Generar cartas")).toBe(false);
  expect(isAuthRelatedStep("Carta de referencia")).toBe(false);
  expect(isAuthRelatedStep("cuenta de ahorro activa")).toBe(false);
});

test("'continuar' is not auth-related without authGateState", () => {
  expect(isAuthRelatedStep("continuar")).toBe(false);
  expect(isAuthRelatedStep("Continuar")).toBe(false);
});

test("'continuar' is auth-related when authGateState indicates completed", () => {
  const authState: AuthGateState = {
    completed: true,
    completedAtStepIndex: 0,
    completedAfterTarget: "transacciones y servicio",
    stagesCompleted: ["identification", "phone_confirmation", "otp", "authenticated"],
    consumedAuthTargets: ["Cédula de identidad dominicana", "continuar"],
    skippedAuthSteps: [],
    authConsumedOpen: true,
    functionalStepSeenAfterAuth: false
  };

  expect(isAuthRelatedStep("continuar", authState)).toBe(true);
  expect(isAuthRelatedStep("Continuar", authState)).toBe(true);
  expect(isAuthContinueStep("continuar", authState)).toBe(true);
});

test("'continuar' is not auth-related when authConsumedOpen is false", () => {
  const authState: AuthGateState = {
    completed: true,
    completedAtStepIndex: 0,
    completedAfterTarget: "transacciones y servicio",
    stagesCompleted: ["identification", "phone_confirmation", "otp", "authenticated"],
    consumedAuthTargets: ["Cédula de identidad dominicana", "continuar"],
    skippedAuthSteps: [],
    authConsumedOpen: false,
    functionalStepSeenAfterAuth: true
  };

  expect(isAuthRelatedStep("continuar", authState)).toBe(false);
  expect(isAuthContinueStep("continuar", authState)).toBe(false);
});

test("functional 'Continuar' is not skipped after auth segment ends", () => {
  const authState: AuthGateState = {
    completed: true,
    completedAtStepIndex: 0,
    completedAfterTarget: "transacciones y servicio",
    stagesCompleted: ["identification", "phone_confirmation", "otp", "authenticated"],
    consumedAuthTargets: ["Cédula de identidad dominicana"],
    skippedAuthSteps: [],
    authConsumedOpen: false,
    functionalStepSeenAfterAuth: true
  };

  expect(isAuthRelatedStep("Carta de referencia", authState)).toBe(false);
  expect(isAuthRelatedStep("Generar cartas", authState)).toBe(false);
  expect(isAuthRelatedStep("continuar", authState)).toBe(false);
});

test("shouldSkipStepAsAuthConsumed returns false without authGateState", () => {
  expect(shouldSkipStepAsAuthConsumed("Cédula de identidad dominicana")).toBe(false);
  expect(shouldSkipStepAsAuthConsumed("continuar")).toBe(false);
});

test("shouldSkipStepAsAuthConsumed returns true for auth targets after AuthFlow completes", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  expect(shouldSkipStepAsAuthConsumed("Cédula de identidad dominicana", authState)).toBe(true);
  expect(shouldSkipStepAsAuthConsumed("continuar", authState)).toBe(true);
  expect(shouldSkipStepAsAuthConsumed("confirmar código", authState)).toBe(true);
});

test("shouldSkipStepAsAuthConsumed returns false for functional targets after AuthFlow", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  expect(shouldSkipStepAsAuthConsumed("Carta de referencia", authState)).toBe(false);
  expect(shouldSkipStepAsAuthConsumed("Generar cartas", authState)).toBe(false);
  expect(shouldSkipStepAsAuthConsumed("cuenta de ahorro activa", authState)).toBe(false);
});

test("createAuthGateState creates correct state structure", () => {
  const state = createAuthGateState("transacciones y servicio", 2, ["identification", "otp", "authenticated"]);

  expect(state.completed).toBe(true);
  expect(state.completedAfterTarget).toBe("transacciones y servicio");
  expect(state.completedAtStepIndex).toBe(2);
  expect(state.stagesCompleted).toEqual(["identification", "otp", "authenticated"]);
  expect(state.consumedAuthTargets).toContain("Cédula de identidad dominicana");
  expect(state.consumedAuthTargets).toContain("continuar");
  expect(state.skippedAuthSteps).toEqual([]);
  expect(state.authConsumedOpen).toBe(true);
  expect(state.functionalStepSeenAfterAuth).toBe(false);
});

test("markFunctionalStepAfterAuth closes authConsumedOpen for functional target", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  expect(authState.authConsumedOpen).toBe(true);
  expect(authState.functionalStepSeenAfterAuth).toBe(false);

  markFunctionalStepAfterAuth("Generar cartas", authState);

  expect(authState.authConsumedOpen).toBe(false);
  expect(authState.functionalStepSeenAfterAuth).toBe(true);
});

test("markFunctionalStepAfterAuth does not close for auth keyword target", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  markFunctionalStepAfterAuth("Cédula de identidad dominicana", authState);

  expect(authState.authConsumedOpen).toBe(true);
  expect(authState.functionalStepSeenAfterAuth).toBe(false);
});

test("'continuar' is skipped just after AuthFlow when authConsumedOpen is true", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  expect(shouldSkipStepAsAuthConsumed("continuar", authState)).toBe(true);
  expect(authState.authConsumedOpen).toBe(true);
});

test("'continuar' is NOT skipped after a functional step", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  markFunctionalStepAfterAuth("Generar cartas", authState);

  expect(shouldSkipStepAsAuthConsumed("continuar", authState)).toBe(false);
});

test("'continuar' is NOT skipped after product_condition target", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  markFunctionalStepAfterAuth("cuenta de ahorros", authState);

  expect(shouldSkipStepAsAuthConsumed("continuar", authState)).toBe(false);
});

test("'Generar cartas' closes authConsumedOpen", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  markFunctionalStepAfterAuth("Generar cartas", authState);

  expect(authState.authConsumedOpen).toBe(false);
  expect(shouldSkipStepAsAuthConsumed("continuar", authState)).toBe(false);
});

test("'Carta de referencia' closes authConsumedOpen", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  markFunctionalStepAfterAuth("Carta de referencia", authState);

  expect(authState.authConsumedOpen).toBe(false);
});

test("'cuenta de ahorros' closes authConsumedOpen", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  markFunctionalStepAfterAuth("cuenta de ahorros", authState);

  expect(authState.authConsumedOpen).toBe(false);
});

test("C37869 scenario: does not skip Continuar after selecting product", () => {
  const authState = createAuthGateState("transacciones y servicio", 0, ["identification", "otp", "authenticated"]);

  expect(shouldSkipStepAsAuthConsumed("Cédula de identidad dominicana", authState)).toBe(true);
  expect(shouldSkipStepAsAuthConsumed("continuar", authState)).toBe(true);

  markFunctionalStepAfterAuth("Generar cartas", authState);
  expect(shouldSkipStepAsAuthConsumed("Generar cartas", authState)).toBe(false);

  markFunctionalStepAfterAuth("Carta de referencia", authState);
  expect(shouldSkipStepAsAuthConsumed("Carta de referencia", authState)).toBe(false);

  markFunctionalStepAfterAuth("cuenta de ahorros", authState);
  expect(shouldSkipStepAsAuthConsumed("cuenta de ahorros", authState)).toBe(false);

  expect(shouldSkipStepAsAuthConsumed("continuar", authState)).toBe(false);

  markFunctionalStepAfterAuth("A quien pueda interesar", authState);
  expect(shouldSkipStepAsAuthConsumed("A quien pueda interesar", authState)).toBe(false);
});
