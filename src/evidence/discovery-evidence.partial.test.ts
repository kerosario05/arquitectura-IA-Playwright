import assert from "node:assert/strict";
import test from "node:test";
import { isValidPartialDiscovery } from "./discovery-evidence";

const step = (status: string, error?: string) => ({ index: 1, action: "click", status, error }) as any;
const partial = (extra: Record<string, unknown> = {}) => ({ status: "discovered_partial", steps: [step("found"), step("found")], ...extra }) as any;

test("partial discovery with clean steps is a pass (same rule the job result uses)", () => {
  assert.equal(isValidPartialDiscovery(partial()), true);
});

test("partial discovery with a failed step, failure reason, target or error is not a pass", () => {
  assert.equal(isValidPartialDiscovery(partial({ failedAtStep: 3 })), false);
  assert.equal(isValidPartialDiscovery(partial({ failedTarget: "X" })), false);
  assert.equal(isValidPartialDiscovery(partial({ failedReason: "target_not_found" })), false);
  assert.equal(isValidPartialDiscovery(partial({ steps: [step("found"), step("not_found")] })), false);
  assert.equal(isValidPartialDiscovery(partial({ steps: [step("found", "boom")] })), false);
});

test("other statuses and empty runs are never a valid partial", () => {
  assert.equal(isValidPartialDiscovery({ status: "discovered_passed", steps: [step("found")] } as any), false);
  assert.equal(isValidPartialDiscovery(partial({ steps: [] })), false);
  assert.equal(isValidPartialDiscovery(undefined), false);
});
