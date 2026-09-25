import assert from "node:assert/strict";
import test from "node:test";
import { resolveActionTarget } from "./target-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

/**
 * DIAGNOSE-only instrumentation (jobId a368285a-e35d-4a01-9873-88bd49d97bc7): confirms, before any
 * recorded-target resolution is attempted, whether `opts.associatedField` -- the only existing
 * generic owner-lineage channel on `resolveActionTarget` -- actually reaches this boundary for a
 * transient `role=option` step. This test proves the new `[recorded-target-lineage]` line reports
 * that (and nothing else), and that it changes NOTHING about the eventual resolution outcome.
 */

function fakeSnapshot(): PageSnapshot {
  return {
    version: "1.0",
    url: "https://example.test/requests/1/edit",
    title: "",
    capturedAt: new Date().toISOString(),
    elements: [],
    summary: { totalElements: 0, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0 },
  } as unknown as PageSnapshot;
}

function notFoundLocator() {
  return {
    count: async () => 0,
    isVisible: async () => false,
    isEnabled: async () => true,
  };
}

function fakePage() {
  return {
    url: () => "https://example.test/requests/1/edit",
    locator: () => notFoundLocator(),
    getByRole: () => notFoundLocator(),
    getByTestId: () => notFoundLocator(),
    getByPlaceholder: () => notFoundLocator(),
    getByLabel: () => notFoundLocator(),
    getByText: () => notFoundLocator(),
    evaluate: async () => undefined,
  } as any;
}

async function captureLineageLog(options: Parameters<typeof resolveActionTarget>[3]): Promise<string | undefined> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    await resolveActionTarget(fakePage(), fakeSnapshot(), "Cuentas de Efectivo", options);
  } finally {
    console.log = originalLog;
  }
  return lines.find((entry) => entry.startsWith("[recorded-target-lineage]"));
}

test("1/lineageLineShape. the diagnostic line reports role/booleans/counts only, before any resolution attempt", async () => {
  const line = await captureLineageLog({
    recordedTechnicalTargetRefs: ["role:option|Cuentas de Efectivo"],
    associatedField: undefined,
  });
  assert.ok(line, "expected a [recorded-target-lineage] line to be logged");
  assert.match(line!, /candidateRole=option\b/);
  assert.match(line!, /associatedFieldPresent=false/);
  assert.match(line!, /associatedFieldNormalizedPresent=false/);
  assert.match(line!, /recordedRefsPresent=true/);
  assert.match(line!, /recordedTargetsPresent=false/);
  assert.ok(!line!.includes("Cuentas de Efectivo"), "the accessible name / associatedField's own text must never be logged");
});

test("2/associatedFieldPresentReflected. when associatedField IS set on opts, the line reflects it as a boolean only -- never the field's own text", async () => {
  const line = await captureLineageLog({
    recordedTechnicalTargetRefs: ["role:option|Cuentas de Efectivo"],
    associatedField: "Categoría de producto",
  });
  assert.ok(line);
  assert.match(line!, /associatedFieldPresent=true/);
  assert.match(line!, /associatedFieldNormalizedPresent=true/);
  assert.ok(!line!.includes("Categoría de producto"), "associatedField's own text must never be logged, only its presence");
});

test("3/noRefsNoTargets. with neither recorded refs nor recorded targets, both presence flags are false -- no crash, no fabricated evidence", async () => {
  const line = await captureLineageLog({ associatedField: undefined });
  assert.ok(line);
  assert.match(line!, /recordedRefsPresent=false/);
  assert.match(line!, /recordedTargetsPresent=false/);
  assert.match(line!, /candidateRole=\(none\)/);
});

/**
 * FIRST_LOSS fix (recordingId=1f9415f3-...): a click with NO technicalTargetRefs but a valid
 * `playwrightRecorderEvidence` (carried unchanged from the structured recording contract, per
 * `RecordingExecutionAction.playwrightRecorderEvidence`, through `ActionTargetItem`, into
 * `resolveActionTarget`'s options) must resolve scoped to `scopeIdentity`, never fall through to
 * the global contextual resolver that previously produced `ambiguous_contextual_option`. Runtime
 * uniqueness is revalidated live (never trusted from capture time); zero or multiple matches
 * within the scope stay fail-closed, same as `resolvePlaywrightRecorderTarget`'s own unit tests.
 */
function scopedRecorderFakePage(matchCountInScope: number) {
  const scopeTarget = {
    count: async () => matchCountInScope,
    isVisible: async () => matchCountInScope === 1,
    isEnabled: async () => matchCountInScope === 1,
  };
  const scope = {
    count: async () => 1,
    getByText: () => scopeTarget,
    getByRole: () => scopeTarget,
    getByLabel: () => scopeTarget,
    getByPlaceholder: () => scopeTarget,
    getByTestId: () => scopeTarget,
  };
  const notFound = notFoundLocator();
  return {
    url: () => "https://example.test/onlinebanking/IdentifyUser",
    locator: (selector: string) => (selector === '[id="IdentifyUserForm"]' ? scope : notFound),
    getByRole: () => notFound,
    getByTestId: () => notFound,
    getByPlaceholder: () => notFound,
    getByLabel: () => notFound,
    getByText: () => notFound,
    evaluate: async () => undefined,
  } as any;
}

const smsRecorderEvidence = {
  kind: "text" as const,
  normalizedName: "SMS",
  targetTag: "div",
  scopeIdentity: { strategy: "id" as const, value: "IdentifyUserForm" },
  runtimeResolutionRequired: true as const,
};

test("4/recorderEvidenceScopedResolution. a click with no technicalTargetRefs but valid playwrightRecorderEvidence resolves scoped, never via the global contextual resolver", async () => {
  const result = await resolveActionTarget(scopedRecorderFakePage(1), fakeSnapshot(), "SMS", {
    playwrightRecorderEvidence: smsRecorderEvidence,
  });
  assert.equal(result.status, "resolved");
  assert.equal((result as { matchReason?: string }).matchReason, "playwright_recorder_evidence_current_dom");
});

test("5/recorderEvidenceZeroMatchesFailsClosed. zero matches inside the recorded scope fails closed, never falls back to an ambiguous global search silently succeeding", async () => {
  const result = await resolveActionTarget(scopedRecorderFakePage(0), fakeSnapshot(), "SMS", {
    playwrightRecorderEvidence: smsRecorderEvidence,
  });
  assert.notEqual(result.status, "resolved");
});

test("6/recorderEvidenceMultipleMatchesFailsClosed. two matches inside the recorded scope fails closed -- never nth()/first()/index authority", async () => {
  const result = await resolveActionTarget(scopedRecorderFakePage(2), fakeSnapshot(), "SMS", {
    playwrightRecorderEvidence: smsRecorderEvidence,
  });
  assert.notEqual(result.status, "resolved");
});
