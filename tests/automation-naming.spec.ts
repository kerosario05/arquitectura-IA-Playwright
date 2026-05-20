import { test, expect } from "@playwright/test";
import {
  buildAutomationId,
  sanitizeAutomationFileName
} from "../src/automations/automation-naming";

test("sanitizeAutomationFileName converts to lowercase", () => {
  const result = sanitizeAutomationFileName("Mi Prueba");
  expect(result).toBe("mi-prueba");
});

test("sanitizeAutomationFileName replaces spaces with hyphens", () => {
  const result = sanitizeAutomationFileName("mi prueba de prueba");
  expect(result).toBe("mi-prueba-de-prueba");
});

test("sanitizeAutomationFileName removes accents", () => {
  const result = sanitizeAutomationFileName("Información De Pruebas");
  expect(result).toBe("informacion-de-pruebas");
});

test("sanitizeAutomationFileName removes invalid Windows characters", () => {
  const result = sanitizeAutomationFileName("mi<prueba>:prueba*.txt");
  expect(result).toBe("mi-prueba-prueba-txt");
});

test("sanitizeAutomationFileName removes multiple consecutive hyphens", () => {
  const result = sanitizeAutomationFileName("mi  prueba___test");
  expect(result).toBe("mi-prueba-test");
});

test("sanitizeAutomationFileName limits length to 120", () => {
  const long = "a".repeat(200);
  const result = sanitizeAutomationFileName(long);
  expect(result.length).toBeLessThanOrEqual(120);
});

test("sanitizeAutomationFileName handles special characters", () => {
  const result = sanitizeAutomationFileName("login-test@#$%site");
  expect(result).toBe("login-test-site");
});

test("sanitizeAutomationFileName handles empty string", () => {
  const result = sanitizeAutomationFileName("");
  expect(result).toBe("automation");
});

test("buildAutomationId uses externalId as prefix (lowercased)", () => {
  const id = buildAutomationId({
    externalId: "C37616",
    title: "Acceso al modulo"
  });
  expect(id).toMatch(/^c37616-/);
});

test("buildAutomationId uses caseId when no externalId", () => {
  const id = buildAutomationId({
    caseId: 37616,
    title: "Acceso al modulo"
  });
  expect(id).toMatch(/^37616-/);
});

test("buildAutomationId uses title when no externalId or caseId", () => {
  const id = buildAutomationId({
    title: "Acceso al modulo"
  });
  expect(id).toBe("acceso-al-modulo");
});

test("buildAutomationId sanitizes title including accents and invalid chars", () => {
  const id = buildAutomationId({
    externalId: "C37616",
    title: "Información De Pruebas: Test"
  });
  expect(id).toBe("c37616-informacion-de-pruebas-test");
});

test("buildAutomationId keeps id under reasonable length", () => {
  const id = buildAutomationId({
    externalId: "C37616",
    title: "a".repeat(200)
  });
  expect(id.length).toBeLessThan(130);
});