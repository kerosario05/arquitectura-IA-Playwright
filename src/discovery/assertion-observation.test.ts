import assert from "node:assert/strict";
import test from "node:test";
import {
  captureAssertionObservationSnapshot,
  classifyNetworkActivity,
  diffAssertionObservation,
  writeAssertionObservationArtifact,
} from "./assertion-observation";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function snapshot(overrides: Record<string, unknown> = {}): any {
  return {
    urlPath: "/form",
    focusedIdentity: "input|name=field",
    controls: [{
      identity: "input|name=field",
      tagName: "input",
      ariaInvalid: "false",
      ariaDescribedBy: "",
      disabled: false,
      required: true,
      focused: true,
      validity: { valid: true, valueMissing: false, typeMismatch: false, patternMismatch: false },
      validationNodeIds: [],
    }],
    validationNodes: [],
    forms: [{ identity: "form", valid: true }],
    fingerprint: "synthetic",
    ...overrides,
  };
}

test("captures bounded structural state without reading field values", async () => {
  const page = {
    url: () => "https://example.test/form",
    evaluate: async () => snapshot(),
  };
  const result = await captureAssertionObservationSnapshot(page);
  assert.equal(result.urlPath, "/form");
  assert.equal(result.controls[0].identity, "input|name=field");
  assert.equal("value" in result.controls[0], false);
  assert.match(result.fingerprint, /^[a-f0-9]{16}$/);
});

test("detects valid-to-invalid mutation and associated validation node", () => {
  const before = snapshot();
  const after = snapshot({
    controls: [{ ...before.controls[0], ariaInvalid: "true", validationNodeIds: ["field-error"], validity: { ...before.controls[0].validity, valid: false, patternMismatch: true } }],
    validationNodes: [{ identity: "span|id=field-error", role: "alert", id: "field-error" }],
    forms: [{ identity: "form", valid: false }],
  });
  const diff = diffAssertionObservation(before, after, true);
  assert.equal(diff.changed, true);
  assert.equal(diff.validationMutation, true);
  assert.equal(diff.accessibilityMutation, true);
  assert.equal(diff.formStateChanged, true);
  assert.equal(diff.networkActivityDetected, true);
});

test("does not invent a mutation when before and after are equal", () => {
  const same = snapshot();
  const diff = diffAssertionObservation(same, same);
  assert.deepEqual(diff.changedPaths, []);
  assert.equal(diff.changed, false);
  assert.equal(diff.validationMutation, false);
  assert.equal(diff.navigationMutation, false);
});

test("observation artifact keeps requirement lineage and excludes sensitive values", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "assertion-observation-"));
  try {
    const artifactPath = await writeAssertionObservationArtifact(directory, {
      version: "1.0",
      scenarioId: "synthetic-scenario",
      caseId: 17,
      requirementId: "requirement:synthetic:validation",
      requirementRefs: ["requirement:synthetic:validation"],
      triggerActionIdentity: { action: "trigger", stepIndex: 2 },
      before: snapshot(),
      after: snapshot(),
      mutation: diffAssertionObservation(snapshot(), snapshot()),
      network: { eventCount: 0, classification: "unknown" },
      createdAt: new Date().toISOString(),
    });
    const saved = await fs.readFile(artifactPath, "utf8");
    assert.match(saved, /requirement:synthetic:validation/);
    assert.doesNotMatch(saved, /password|secret|sensitive-runtime-value/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("classifies network activity conservatively from safe transport metadata", () => {
  assert.equal(classifyNetworkActivity([{ method: "GET", resourceType: "xhr", state: "completed", status: 200 }]), "lookup");
  assert.equal(classifyNetworkActivity([{ method: "POST", resourceType: "fetch", state: "completed", status: 200 }]), "submit");
  assert.equal(classifyNetworkActivity([{ method: "POST", resourceType: "fetch", state: "completed", status: 422 }]), "validation");
  assert.equal(classifyNetworkActivity([{ method: "GET", resourceType: "document", state: "completed", status: 200 }], "/form", "/next"), "navigation");
  assert.equal(classifyNetworkActivity([{ method: "POST", resourceType: "websocket", state: "pending" }]), "unknown");
});
