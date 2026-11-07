import assert from "node:assert/strict";
import test from "node:test";
import { findMaskedPhoneLabels, isMaskedPhoneLabel } from "./mobile-masked-phone";

test("reconoce teléfonos enmascarados y nada más", () => {
  assert.equal(isMaskedPhoneLabel("(829) ***-**00"), true);
  assert.equal(isMaskedPhoneLabel("(809) ***-**96"), true);
  assert.equal(isMaskedPhoneLabel("Enviar código"), false);
  assert.equal(isMaskedPhoneLabel("829-555-1234"), false);
  assert.equal(isMaskedPhoneLabel(undefined), false);
});

test("lista los teléfonos enmascarados de la pantalla sin repetirlos", () => {
  const xml = `<n content-desc="(829) ***-**96" text=""/><n content-desc="(829) ***-**96" text="(829) ***-**96"/>
    <n content-desc="Enviar código" text="Enviar código"/><n text="(809) ***-**11"/>`;
  assert.deepEqual(findMaskedPhoneLabels(xml), ["(829) ***-**96", "(809) ***-**11"]);
  assert.deepEqual(findMaskedPhoneLabels("<n text='x'/>"), []);
});
