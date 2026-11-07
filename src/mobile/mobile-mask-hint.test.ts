import assert from "node:assert/strict";
import test from "node:test";
import { isMaskHint, looksLikeEmail } from "./mobile-mask-hint";

test("un hint de máscara es un patrón de dígitos/placeholders con separadores", () => {
  assert.equal(isMaskHint("402-0000000-7"), true);
  assert.equal(isMaskHint("(809) 000-0000"), true);
  assert.equal(isMaskHint("##/##/####"), true);
});

test("un hint de texto con símbolos NO es máscara (correo, texto libre)", () => {
  assert.equal(isMaskHint("correo@dominio.com"), false);
  assert.equal(isMaskHint("Ingresa tu correo electrónico"), false);
  assert.equal(isMaskHint("usuario.nombre"), false);
  assert.equal(isMaskHint("Contraseña"), false);
  assert.equal(isMaskHint("*********"), false);
  assert.equal(isMaskHint("••••••••"), false);
  assert.equal(isMaskHint(""), false);
});

test("reconoce correos para escribirlos tal cual", () => {
  assert.equal(looksLikeEmail("nombre.apellido@banco.com.do"), true);
  assert.equal(looksLikeEmail("402-2467955-1"), false);
});
