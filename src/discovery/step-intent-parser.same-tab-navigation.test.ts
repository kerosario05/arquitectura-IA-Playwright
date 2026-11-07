import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

test("a recorded same-tab navigation is an executable action, like opening a new tab", () => {
  const [navigate] = parseStepIntent('Navegar al link "https://srvqacgowb01.local.bsc.com:5000/requests/11213/edit"');
  assert.equal(navigate.type, "action_click");
  assert.equal(navigate.actionVerb, "navigate");
  assert.equal(navigate.actionTarget, "https://srvqacgowb01.local.bsc.com:5000/requests/11213/edit");
  const [enlace] = parseStepIntent('Navegar al enlace "http://localhost:4311/"');
  assert.equal(enlace.type, "action_click");
  assert.equal(enlace.actionVerb, "navigate");
});

test("menu navigation and the new-tab step keep their previous meaning", () => {
  assert.equal(parseStepIntent("Ingresar a Solicitudes > Nueva solicitud")[0].type, "navigation_path");
  assert.equal(parseStepIntent('Abrir una pestaña nueva y navegar al link "http://localhost:4311/"')[0].type, "action_click");
  assert.notEqual(parseStepIntent("Navegar a Solicitudes en curso")[0].actionVerb, "navigate");
});
