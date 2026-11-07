import assert from "node:assert/strict";
import test from "node:test";
import { formatBareCedulaForService } from "./mobile-identity-format";

test("formatea una cédula de 11 dígitos como la muestra la app", () => {
  assert.equal(formatBareCedulaForService("numero_de_documento", "40224679551"), "402-2467955-1");
});

test("no toca valores ya formateados, otros campos ni otros largos", () => {
  assert.equal(formatBareCedulaForService("numero_de_documento", "402-2467955-1"), "402-2467955-1");
  assert.equal(formatBareCedulaForService("codigo_de_6_digitos", "40224679551"), "40224679551");
  assert.equal(formatBareCedulaForService("numero_de_documento", "123456"), "123456");
  assert.equal(formatBareCedulaForService("numero_de_documento", undefined), undefined);
});
