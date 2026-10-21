import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

test("recorded check and uncheck verbs remain executable even with slash labels", () => {
  for (const verb of ["Marcar", "Desmarcar"]) {
    const intents = parseStepIntent(`${verb} "Preferencia A/B"`);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].type, "action_click");
    assert.equal(intents[0].actionTarget, "Preferencia A/B");
    assert.equal(intents[0].actionVerb, verb.toLowerCase());
  }
});

test("keeps an assertion with internal commas as one parent intent", () => {
  const intents = parseStepIntent(
    'Validar que, mientras el control "subject" permanezca inválido, la acción "advance" permanezca deshabilitada y no permita continuar.'
  );

  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.type, "assertion");
  assert.equal(intents[0]?.canonicalAssertion?.intent, "transition_blocked");
  assert.equal(intents[0]?.canonicalAssertion?.condition, 'el control "subject" permanezca inválido');
  assert.equal(intents[0]?.canonicalAssertion?.childExpectations?.length, 2);
});

test("keeps multiple que clauses in the same assertion parent", () => {
  const intents = parseStepIntent(
    'Al salir del campo "subject", validar que el control quede inválido y que se muestre un mensaje asociado al dato ingresado.'
  );

  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.type, "assertion");
  assert.equal(intents[0]?.canonicalAssertion?.trigger, "leave_field");
  assert.equal(intents[0]?.canonicalAssertion?.childExpectations?.length, 2);
});

test('parses an explicit activation verb as a click action with its observed label', () => {
  const intents = parseStepIntent('Activar "Continuar"');

  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.type, 'action_click');
  assert.equal(intents[0]?.actionTarget, 'Continuar');
});
