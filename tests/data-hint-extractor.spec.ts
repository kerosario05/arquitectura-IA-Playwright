import { expect, test } from "@playwright/test";
import { extractDataHintsFromElementText } from "../src/explorer/data-hint-extractor";

test("maps cedula with accent normalization", () => {
  const hints = extractDataHintsFromElementText("Ingrese Cédula del cliente");
  expect(hints).toContain("cedula");
});

test("maps codigo otp pin hints", () => {
  const hints = extractDataHintsFromElementText("Código OTP PIN");
  expect(hints).toEqual(expect.arrayContaining(["codigo", "otp", "pin"]));
});

test("maps monto and amount to monto", () => {
  const hints = extractDataHintsFromElementText("Monto amount valor");
  expect(hints).toContain("monto");
});

test("maps cuenta account and prestamo loan", () => {
  const hints = extractDataHintsFromElementText("cuenta account préstamo loan");
  expect(hints).toEqual(expect.arrayContaining(["cuenta", "prestamo"]));
});

test("returns unique values", () => {
  const hints = extractDataHintsFromElementText("usuario user username usuario");
  const unique = new Set(hints);
  expect(unique.size).toBe(hints.length);
});
