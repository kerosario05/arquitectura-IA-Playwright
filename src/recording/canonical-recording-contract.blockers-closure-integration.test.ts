import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { toSharedMcpScenario } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import type { SemanticRuntimeEvidence } from "./structural-owner-identity";

/**
 * THE INTEGRATION TEST THAT MATTERS (recordingId=e224287e-...): one physical-shaped, non-Fenix
 * scenario combining BOTH former blockers in a single canonical/readiness pass --
 *
 * 1. login click: certified (technical target present, resolutionState=certified).
 * 2. sensitive password fill: valueKey required, no captured literal, SECURE runtime value
 *    supplied via the generic key->value mechanism (Blocker B) -> ready=true.
 * 3. unresolved custom click: no technical target, no structural/related-control evidence, a
 *    captured SemanticRuntimeEvidence (Blocker A) -> semanticRuntimeEligible=true ->
 *    runtimeResolutionRequired=true -> ready=true.
 *
 * Asserts the exact readiness split the ticket requires: executionReady=true while
 * technicalReady=false (the semantic-only click has zero technical target coverage) and
 * promotionReady stays appropriately gated (a runtime_resolution_required action is present).
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://integration-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "/inicio" } as any],
  } as unknown as SessionTrace;
}

type RecorderInternals = { onInteraction(raw: unknown): Promise<void> };

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://integration-fixture.test",
    framesDir: path.join(os.tmpdir(), "blockers-closure-integration-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  return { recorder, events };
}

function semanticEvidence(): SemanticRuntimeEvidence {
  return {
    source: "visible_text",
    normalizedValue: "Metodo de verificacion",
    targetTag: "div",
    scopeAlternatives: [{ scopeIdentity: { strategy: "id", value: "verification-scope" }, captureMatchCount: 1 }],
    captureUniqueTarget: true,
  };
}

test("INTEGRATION: certified login + secure password (supplied) + semantic-only click -> executionReady=true for both formerly-blocking actions, technicalReady=false, promotionReady appropriately gated", async () => {
  const { recorder, events } = newRecorder();

  // 1. certified login click.
  await recorder.onInteraction({ kind: "click", role: "button", domId: "login-submit", label: "Iniciar sesion" } as any);

  // 2. sensitive password fill -- no captured literal (real Capture V2 shape for a sensitive edit).
  await recorder.onInteraction({
    kind: "input",
    role: "textbox",
    inputType: "password",
    domId: "clave_verificacion",
    label: "clave_verificacion",
    sensitive: true,
    valueSource: "user",
  } as any);

  // 3. unresolved custom click -- no technical target, no structural/related-control evidence,
  // only a captured SemanticRuntimeEvidence.
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "control", // generic -- admission-rejected, structural/related-control absent
    semanticRuntimeEvidence: semanticEvidence(),
  } as any);

  const scenario = buildHappyPathScenario(trace(events), events);
  const requirement = (scenario.runtimeInputRequirements ?? []).find((r) => r.sensitive === true);
  assert.ok(requirement, "the password requirement must exist");

  const contract = toSharedMcpScenario(scenario, "app", { [requirement!.valueKey]: "supplied-secure-value" });

  const loginAction = contract.executionReadinessAudit.actions.find((a: any) => a.actionType === "click" && !a.blockReasons?.length && a !== undefined);
  const passwordAction = contract.executionReadinessAudit.actions.find((a: any) => a.valueKey === requirement!.valueKey);
  const semanticClickAction = contract.canonicalInteractions.find((c: any) => c.semanticRuntimeEvidence);

  assert.ok(passwordAction, "password action present");
  assert.equal(passwordAction!.runtimeValueResolved, true, "Blocker B closed: secure value resolved via key->value");
  assert.equal(passwordAction!.ready, true);

  assert.ok(semanticClickAction, "Blocker A closed: semanticRuntimeEvidence reached the canonical interaction");
  assert.equal(semanticClickAction!.resolutionState, "runtime_resolution_required");
  const semanticReadinessAction = contract.executionReadinessAudit.actions.find((a: any) => a.actionId === semanticClickAction!.id);
  assert.equal(semanticReadinessAction?.ready, true);
  assert.equal((semanticReadinessAction as any)?.runtimeResolutionRequired, true);

  assert.equal(contract.executionReadinessAudit.executionReady, true, "both formerly-blocking actions are now ready");
  assert.equal(contract.executionReadinessAudit.technicalReady, false, "the semantic-only click has zero technical target coverage -- never falsely marked certified");
  assert.equal(contract.executionReadinessAudit.promotionReady, false, "a runtime_resolution_required action is present -- promotion stays gated, never forced");

  assert.doesNotMatch(JSON.stringify(contract.executionReadinessAudit), /supplied-secure-value/, "no plaintext in the readiness/diagnostic surface");
});
