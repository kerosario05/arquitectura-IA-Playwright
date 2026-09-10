import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeControlIdentity, matchControlIdentity } from "./control-identity";
import type { ExecutionPlanStep } from "./execution-plan.types";
import type { SnapshotElement } from "./page-snapshot.types";

const control = (id: string, role = "textbox"): SnapshotElement => ({
  id,
  type: "input",
  tagName: "input",
  inputType: "email",
  role,
  name: "contact-input",
  visible: true,
  candidateLocators: [{ strategy: "role", role, name: "contact-input", confidence: 1 }],
  dataHints: [],
});

test("builds a deterministic structural identity independent of positional snapshot id", () => {
  const first = buildRuntimeControlIdentity(control("el-1"));
  const second = buildRuntimeControlIdentity(control("el-99"));
  assert.ok(first);
  assert.deepEqual(first, second);
  assert.equal(first?.source, "runtime");
});

test("matches equivalent controls and rejects structurally different controls without text fuzzy matching", () => {
  const first = buildRuntimeControlIdentity(control("el-1"));
  const equivalent = buildRuntimeControlIdentity(control("el-2"));
  const different = buildRuntimeControlIdentity(control("el-3", "combobox"));
  assert.equal(matchControlIdentity(first, equivalent), "match");
  assert.equal(matchControlIdentity(first, different), "no_match");
  assert.equal(matchControlIdentity(first, null), "unknown");
});

test("returns null for insufficient metadata and preserves the identity bundle", () => {
  assert.equal(buildRuntimeControlIdentity({}), null);
  const identity = buildRuntimeControlIdentity(control("el-1"));
  assert.ok(identity);
  const step: ExecutionPlanStep = {
    index: 1,
    action: "fill",
    controlIdentity: identity,
    requirementRefs: ["req-1"],
    inputIntent: { mode: "leave_unset", requirementRefs: ["req-1"] },
  };
  assert.equal(step.controlIdentity?.fingerprint, identity.fingerprint);
  assert.deepEqual(JSON.parse(JSON.stringify(step)).controlIdentity, JSON.parse(JSON.stringify(identity)));
});
