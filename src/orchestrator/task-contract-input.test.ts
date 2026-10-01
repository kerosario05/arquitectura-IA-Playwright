import assert from "node:assert/strict";
import test from "node:test";
import { explicitRuntimeUrlFromMessage } from "./task-contract-input";

test("preserves explicitly labeled runtimeUrl from the user request", () => {
  assert.equal(explicitRuntimeUrlFromMessage('project=roke runtimeUrl=https://example.test/ steps=6'), "https://example.test/");
});

test("does not infer runtimeUrl from a navigation sentence or unrelated URL", () => {
  assert.equal(explicitRuntimeUrlFromMessage('navigate https://example.test/ and reproduce the flow'), undefined);
});

test("rejects non-HTTP explicit runtime URLs", () => {
  assert.equal(explicitRuntimeUrlFromMessage("runtimeUrl=file:///tmp/app"), undefined);
});
