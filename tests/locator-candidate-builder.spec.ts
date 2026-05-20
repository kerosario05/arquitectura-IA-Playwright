import { expect, test } from "@playwright/test";
import { buildCandidateLocators } from "../src/explorer/locator-candidate-builder";

test("testId creates high confidence locator", () => {
  const locators = buildCandidateLocators({ testId: "login-btn" });
  expect(locators[0]).toMatchObject({ strategy: "testId", confidence: 0.95 });
});

test("role and name creates role locator", () => {
  const locators = buildCandidateLocators({ role: "button", name: "Entrar" });
  expect(locators.some((locator) => locator.strategy === "role")).toBe(true);
});

test("label creates label locator", () => {
  const locators = buildCandidateLocators({ label: "Usuario" });
  expect(locators.some((locator) => locator.strategy === "label")).toBe(true);
});

test("placeholder creates placeholder locator", () => {
  const locators = buildCandidateLocators({ placeholder: "Correo" });
  expect(locators.some((locator) => locator.strategy === "placeholder")).toBe(true);
});

test("id creates low confidence css locator", () => {
  const locators = buildCandidateLocators({ id: "username" });
  const css = locators.find((locator) => locator.strategy === "css");
  expect(css?.confidence).toBe(0.55);
});

test("does not generate empty locators", () => {
  const locators = buildCandidateLocators({});
  expect(locators).toHaveLength(0);
});
