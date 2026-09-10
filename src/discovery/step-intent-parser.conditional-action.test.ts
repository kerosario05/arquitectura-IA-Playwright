import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

test("parses visible conditional click as an optional action", () => {
  const [intent] = parseStepIntent("Si el botón 'Salir' está visible, hacer clic en el botón 'Salir'.");

  assert.equal(intent?.type, "action_click");
  assert.equal(intent?.conditionalAction?.operation, "click");
  assert.equal(intent?.conditionalAction?.condition.type, "visibility");
  assert.equal(intent?.conditionalAction?.condition.target, "Salir");
  assert.equal(intent?.conditionalAction?.actionTarget, "Salir");
  assert.equal(intent?.conditionalAction?.skipAllowedWhenConditionFalse, true);
});

test("parses presence conditional select without making it an assertion", () => {
  const [intent] = parseStepIntent("En caso de que la opción 'Tipo' esté presente, seleccionar la opción 'Tipo'.");

  assert.equal(intent?.type, "action_select");
  assert.equal(intent?.conditionalAction?.operation, "select");
  assert.equal(intent?.conditionalAction?.condition.type, "presence");
  assert.notEqual(intent?.type, "assertion");
});
