import test from "node:test";
import assert from "node:assert/strict";
import { classifyPendingActionsForEarlyCompletion } from "./early-completion-policy";

const completedAuth = { completed: true, completedAtStepIndex: 4, completedAfterTarget: "Continuar", stagesCompleted: [], consumedAuthTargets: [], skippedAuthSteps: [], authConsumedOpen: true, functionalStepSeenAfterAuth: false };

test("post-auth business email remains functionally required", () => {
  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: [{ index: 12, target: "Correo electrónico", action: "fill", actionType: "action_fill" } as any],
    executedStepIndices: new Set([0, 1, 2, 3]),
    authGateState: completedAuth,
    skippedSteps: [],
  });
  assert.deepEqual(result.authConsumed, []);
  assert.equal(result.functionalRequired[0]?.target, "Correo electrónico");
});

test("pre-auth credential-like target remains auth-consumed", () => {
  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: [{ index: 1, target: "Correo electrónico", action: "fill", actionType: "action_fill" } as any],
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [],
  });
  assert.equal(result.authConsumed[0]?.target, "Correo electrónico");
});
