import test from "node:test";
import assert from "node:assert/strict";
import { reinsertRestoredStep } from "./persisted-scenario-hydration";

const scenario = (): any => ({
  testRailSteps: [{ interactionId: "interaction-1", content: "Presionar \"B\"", stepNumber: 1 }, { interactionId: "interaction-5", content: "c", stepNumber: 2 }],
  webSteps: [{ interactionId: "interaction-1" }, { interactionId: "interaction-5" }],
  stepTargets: [{ stepIndex: 0, description: "b", strategy: "role", value: "button|B" }, { stepIndex: 1, description: "c", strategy: "css", value: "c" }],
  canonicalInteractions: [
    { id: "interaction-1", controlIdentity: "ctl-B", action: "click" },
    { id: "interaction-3", controlIdentity: "ctl-B", action: "click", sourceEventRefs: ["event-3"], technicalTargetRefs: ["role:button|B"] },
  ],
});

test("a restored repeated click goes back in interaction order with the same text", () => {
  const out: any = reinsertRestoredStep(scenario(), "interaction-3");
  assert.deepEqual(out.testRailSteps.map((s: any) => s.interactionId), ["interaction-1", "interaction-3", "interaction-5"]);
  assert.deepEqual(out.testRailSteps.map((s: any) => s.stepNumber), [1, 2, 3]);
  assert.equal(out.testRailSteps[1].content, "Presionar \"B\"");
  assert.deepEqual(out.webSteps[1].target, { strategy: "role", value: "button|B" });
  assert.deepEqual(out.stepTargets.map((t: any) => t.stepIndex), [0, 1, 2]);
});

test("an interaction that already has a step is left alone", () => {
  const s = scenario();
  assert.equal(reinsertRestoredStep(s, "interaction-1"), s);
});
