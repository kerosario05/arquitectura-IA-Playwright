import { expect, test } from "@playwright/test";
import { classifyStepIntent } from "../src/plans/step-intent-classifier";

test("Ingresar cédula is fill", () => {
  expect(classifyStepIntent("Ingresar cédula")).toBe("fill");
});

test("Presionar consultar is click", () => {
  expect(classifyStepIntent("Presionar consultar")).toBe("click");
});

test("Validar resultado is assert", () => {
  expect(classifyStepIntent("Validar resultado")).toBe("assert");
});

test("Iniciar sesión is login", () => {
  expect(classifyStepIntent("Iniciar sesión")).toBe("login");
});

test("Esperar carga is wait", () => {
  expect(classifyStepIntent("Esperar carga")).toBe("wait");
});

test("ambiguous text is unknown", () => {
  expect(classifyStepIntent("Revisar algo")).toBe("unknown");
});
