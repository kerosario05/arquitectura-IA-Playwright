import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMethodIntentFromStep } from "./pom-classification";

test("visibility assertion patterns remain valid when a primary action is visible", () => {
  const intent = deriveMethodIntentFromStep({
    action: "assertVisible",
    target: { strategy: "text", value: "Validar que el botón Continuar esté visible" },
    description: ""
  } as any);

  assert.equal(intent, "expect_primary_action_visible");
});
