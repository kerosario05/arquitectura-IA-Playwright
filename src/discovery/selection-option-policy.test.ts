import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelectionOption } from "./selection-option-policy";

const options = [
  { label: "Checking / 200002", value: "b" },
  { label: "Checking / 200001", value: "a" },
  { label: "Savings / 300001", value: "c", disabled: true },
];
const choose = (value: string, source = options, strict = false) => resolveSelectionOption(value, source, option => option, strict);
test("significant category words ignore connectors, order, accents and regular plurals", () => {
  const source = [{label:"Cuenta de Ahorro / 300001",value:"savings"}, {label:"Cuenta Corriente / 200001",value:"checking"}];
  for (const request of ["ahorros", "cuenta de ahorros", "cuenta ahorros", "ahorros cuenta", "CUENTA AHORROS"]) {
    assert.equal(choose(request,source).chosen?.value,"savings",request);
  }
  assert.equal(choose("metodos entrega",[{label:"Método de entrega / 700001",value:"delivery"}]).chosen?.value,"delivery");
  for (const request of ["cuenta ahorros premium", "sin ahorros", "de la", "cuenta ahorros 300001", "30000"]) {
    assert.equal(choose(request,source).mode,"missing",request);
  }
  assert.equal(choose("cuenta ahorros",source,true).mode,"missing");
  assert.equal(choose("cuenta ahorros",[...source,{label:"cuenta ahorros",value:"exact"}]).chosen?.value,"exact");
});
test("regular category plurals match whole words without relaxing identities or recording authority", () => {
  const source = [{label:"Cuenta de Ahorro / 300001", value:"savings"}, {label:"Cuenta Corrientes / 200001", value:"checking"}];
  assert.equal(choose("Cuenta de Ahorros", source).chosen?.value, "savings");
  assert.equal(choose("Cuenta Corriente", source).chosen?.value, "checking");
  assert.equal(choose("Delivery Methods", [{label:"Delivery Method / 800001",value:"delivery"}]).chosen?.value,"delivery");
  assert.equal(choose("Cuenta de Ahorros", source, true).mode,"missing");
  assert.equal(choose("Cuenta de Ahorros / 300001", source).mode,"missing");
  assert.equal(choose("Cuenta de Ahorros", [{label:"Cuenta de Ahorradores",value:"other"}]).mode,"missing");
});
test("generic category chooses repeatably independent of observation order", () => {
  assert.equal(choose("Checking").chosen?.value, "a");
  assert.equal(choose("Checking", [...options].reverse()).chosen?.value, "a");
});
test("explicit option value and numeric identity take priority", () => {
  assert.equal(choose("b").chosen?.label, "Checking / 200002");
  assert.equal(choose("200002").chosen?.value, "b");
  assert.equal(choose("999999").mode, "missing");
  assert.equal(choose("20000").mode, "missing", "numeric prefixes must not select another identity");
});
test("disabled, empty, exact text preference and captured uniqueness", () => {
  assert.equal(choose("Savings").mode, "missing");
  assert.equal(choose("").mode, "missing");
  assert.equal(choose("Checking", [...options, { label: "Checking", value: "exact" }]).chosen?.value, "exact");
  assert.equal(choose("Checking", options, true).mode, "ambiguous");
});
test("repeated explicit identities remain ambiguous and accents normalize", () => {
  assert.equal(choose("200002", [...options, {label: "Checking / 200002", value: "duplicate"}]).mode, "ambiguous");
  assert.equal(choose("credito", [{label: "Crédito premium", value: "credit"}]).chosen?.value, "credit");
});
