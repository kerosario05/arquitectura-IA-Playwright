import assert from "node:assert/strict";
import test from "node:test";
import { isJiraResultCountAssertion, isJiraResultCountText } from "./jira-result-count";

test("recognizes result-count indicator assertions only", () => {
  assert.equal(isJiraResultCountAssertion("el indicador de cantidad de resultados"), true);
  assert.equal(isJiraResultCountAssertion("result count indicator"), true);
  assert.equal(isJiraResultCountAssertion("sin resultados"), false);
  assert.equal(isJiraResultCountAssertion("la tabla de movimientos"), false);
  assert.equal(isJiraResultCountAssertion("resultados"), false);
});

test("accepts only a compact visible count label as evidence", () => {
  assert.equal(isJiraResultCountText("1 resultados"), true);
  assert.equal(isJiraResultCountText(" 12\nResults "), true);
  assert.equal(isJiraResultCountText("Resultados"), false);
  assert.equal(isJiraResultCountText("1–1 de 1 movimientos"), false);
  assert.equal(isJiraResultCountText("Mostrando 1 resultados con filtros aplicados"), false);
});
