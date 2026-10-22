import assert from "node:assert/strict";
import test from "node:test";
import { declaredActionsOwnAuthStage, detectAuthGate } from "./auth-gate-detector";
import type { PageSnapshot } from "../types/page-snapshot.types";

const snapshot = (elements: Array<Record<string, unknown>>): PageSnapshot => ({
  version: "1.0",
  url: "https://example.test/",
  title: "t",
  capturedAt: "now",
  elements: elements.map((el, i) => ({ id: `e${i}`, visible: true, candidateLocators: [], dataHints: [], ...el })) as any,
  summary: { totalElements: elements.length, buttons: 0, links: 0, inputs: elements.filter((e) => e.type === "input").length, selects: 0, tables: 0, dialogs: 0, headings: 0 },
});

const loginElements = [
  { type: "input", tagName: "input", label: "Usuario" },
  { type: "input", tagName: "input", label: "Contraseña", inputType: "password" },
  { type: "button", tagName: "button", text: "Ingresar" },
];

test("generic token wording in page copy does not create a token gate on a login screen", () => {
  const detection = detectAuthGate(snapshot([
    ...loginElements,
    { type: "text", tagName: "p", text: "Nunca comparta su token con nadie" },
  ]));
  assert.equal(detection.gateType, "classic_login");
  assert.notEqual(detection.stage, "token");
});

test("an actual token field still detects a token gate", () => {
  const detection = detectAuthGate(snapshot([
    { type: "input", tagName: "input", placeholder: "Ingrese su token" },
    { type: "button", tagName: "button", text: "Continuar" },
  ]));
  assert.equal(detection.stage, "token");
  assert.equal(detection.gateType, "token_gate");
});

test("declared actions own an auth stage only through an explicit stage action", () => {
  const declared = [
    { action: 'Seleccionar "SMS"', target: "SMS" },
    { action: 'Ingresar "123456" en "Código"', target: "Código" },
    { action: 'Presionar "Continuar"', target: "Continuar" },
  ];
  assert.equal(declaredActionsOwnAuthStage("otp", declared), true);
  assert.equal(declaredActionsOwnAuthStage("pin", declared), false);
  assert.equal(declaredActionsOwnAuthStage("otp", [{ action: 'Presionar "Continuar"', target: "Continuar" }]), false);
  assert.equal(declaredActionsOwnAuthStage("otp", []), false);
});
