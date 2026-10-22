import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssertionTargets } from "./assertion-resolver";
import { resolveFeedbackMessageAssertion } from "./feedback-message-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

function snapshot(text?: string): PageSnapshot {
  return { version: "1.0", capturedAt: new Date().toISOString(), url: "https://fixture.test/login", title: "fixture",
    summary: { totalElements: text ? 1 : 0, links: 0, buttons: 0, inputs: 0, selects: 0, tables: 0, dialogs: 1, headings: 0 },
    elements: text ? [{ id: "feedback", type: "text", role: "alert", tagName: "div", text, visible: true,
      candidateLocators: [], dataHints: [] }] : [] };
}

test("declared credential rejection validates actual UI feedback and retains the observed text", () => {
  for (const [expected, observed] of [
    ["problema de credenciales", "Usuario o Contraseña inválidos."],
    ["invalid credentials", "Invalid username or password."],
  ]) {
    const requirement = { index: 7, action: `Validar que se muestre "${expected}".`, target: expected, source: "action" as const };
    const [result] = resolveAssertionTargets(snapshot(observed), [requirement]);
    assert.equal(result.status, "passed");
    assert.equal(result.matchedText, observed);
    for (const unrelated of [undefined, "Service unavailable", "Usuario y Contraseña", "Operación exitosa", "Session expired"]) {
      const [failure] = resolveAssertionTargets(snapshot(unrelated), [requirement]);
      assert.notEqual(failure.status, "passed", `unrelated feedback must not prove credential rejection: ${unrelated}`);
    }
  }
});

test("credential rejection in a generic modal body is recognized without ARIA feedback roles", () => {
  const genericModal = snapshot("Usuario o Contraseña inválidos.");
  genericModal.elements[0].role = "generic";
  const result = resolveFeedbackMessageAssertion(genericModal, "Fenix informa el problema de credenciales.");
  assert.equal(result.passed, true);
  assert.equal(result.capturedMessage?.text, "Usuario o Contraseña inválidos.");
});

test('credential rejection cannot be consumed by the mere presence of the login form',()=>{
 for(const expected of ['problema de credenciales','invalid credentials']) {
  const page=snapshot();
  page.summary.inputs=2;
  page.elements=[
   {id:'user',type:'input',tagName:'input',label:expected==='invalid credentials'?'Credentials':'Credenciales',visible:true,candidateLocators:[],dataHints:[]},
   {id:'pass',type:'input',tagName:'input',label:'Contraseña',visible:true,candidateLocators:[],dataHints:[]},
  ];
  const requirement={index:7,action:`Validar que se muestre "${expected}"`,target:expected,source:'action' as const};
  const [result]=resolveAssertionTargets(page,[requirement],{executedActions:[{action:'Presionar "Iniciar sesión"',target:'Iniciar sesión',status:'found'}]});
  assert.equal(result.status,'needs_assertion_resolution');
  assert.notEqual(result.reason,'satisfied_by_form_field_presence');
 }
});
