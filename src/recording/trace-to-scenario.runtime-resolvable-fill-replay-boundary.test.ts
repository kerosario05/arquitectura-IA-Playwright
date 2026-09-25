import assert from "node:assert/strict";
import test from "node:test";
import { buildHappyPathScenario } from "./trace-to-scenario";
import { toSharedMcpScenario } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget, SessionTrace } from "./session-trace.types";

/**
 * DIAGNOSE (recordingId=ba0dec1c-7db8-4793-9ef6-676c9fad98c8): a reported hypothesis claimed
 * `trace-to-scenario.ts`'s `!target.locators.length` branch (which sets `hasUncertainSteps=true`
 * for a locator-less fill) blocks Recording Replay with "falta cobertura técnica para una acción
 * ejecutable" even when the fill has valid `runtime_resolution_required` authority
 * (associatedField/semanticField/technicalTargetCandidates present).
 *
 * REFUTED by direct evidence: `hasUncertainSteps` only feeds `scenario.technicalReadiness`
 * (trace-to-scenario.ts) and the scenario-level `readiness.technicalReadiness`
 * (canonical-recording-contract.ts's `evaluateRecordingReadiness`) -- neither of which the
 * QA-Lab-facing contract (`toSharedMcpScenario`) uses to decide `mcpExecutable`/
 * `executionReadiness`. That contract already uses `evaluateRecordedScenarioExecutionReadiness`'s
 * per-action `resolutionState`/`runtimeResolutionRequired` carve-out (canonical-recording-
 * contract.ts ~547-658), which is fully independent of `hasUncertainSteps`. This test locks in
 * that already-correct separation across the real `buildHappyPathScenario` -> `toSharedMcpScenario`
 * boundary -- no production code needed to change.
 */

function fillNoLocator(seq: number, field: string, opts: { withCandidate: boolean; withAssociatedField: boolean }): RecordedEvent {
  return {
    seq, t: seq * 100, kind: "fill", screenKey: "form", url: "/form", value: `valor-${seq}`,
    target: {
      label: opts.withAssociatedField ? field : "control",
      ...(opts.withAssociatedField ? { associatedField: field } : {}),
      role: "textbox",
      locators: [],
      ...(opts.withCandidate ? {
        technicalTargetCandidates: [{
          targetType: "editable",
          semanticRole: "editable",
          locatorCandidates: [{ strategy: "css", value: `#f${seq}` }],
          interactionEvidence: ["input"],
          confidence: 0.7,
          validatedByInteraction: true,
        }],
      } : {}),
    } as unknown as RecordedTarget,
  };
}

function traceOf(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "ba0dec1c-7db8-4793-9ef6-676c9fad98c8",
    projectSlug: "p", appSlug: "app", platform: "web",
    baseUrl: "http://diag.test", startedAt: new Date().toISOString(), status: "completed",
    events, screens: [{ screenKey: "form", url: "/form" } as any],
  } as unknown as SessionTrace;
}

test("1/runtimeResolvableFill+7/crossBoundary. a locator-less fill with associatedField+candidate authority reaches mcpExecutable=true through the real buildHappyPathScenario -> toSharedMcpScenario boundary", () => {
  const events = [fillNoLocator(1, "Colaborador", { withCandidate: true, withAssociatedField: true })];
  const scenario = buildHappyPathScenario(traceOf(events), events);
  const mcp = toSharedMcpScenario(scenario, "app");
  assert.equal(mcp.mcpExecutable, true, "execution availability is not gated by hasUncertainSteps");
  assert.equal(mcp.executionReadiness, "ready");
  assert.equal(mcp.nonExecutableCriteria, "");
});

test("2/readinessSeparation. technical/promotion readiness stay reduced even while execution is allowed", () => {
  const events = [fillNoLocator(1, "Colaborador", { withCandidate: true, withAssociatedField: true })];
  const scenario = buildHappyPathScenario(traceOf(events), events);
  assert.equal(scenario.hasUncertainSteps, true, "review flag is unaffected -- this is not what this ticket changes");
  assert.equal(scenario.technicalReadiness, false);
  const mcp = toSharedMcpScenario(scenario, "app");
  assert.equal(mcp.executionReadinessAudit?.executionReady, true);
  assert.equal(mcp.executionReadinessAudit?.technicalReady, false);
  assert.equal(mcp.executionReadinessAudit?.promotionReady, false);
  assert.equal(mcp.publishableToTestManagement, false, "9/promotionStillBlocked");
});

test("3/noAuthority. a locator-less fill with no field/candidate authority at all stays replay-blocked", () => {
  const events = [fillNoLocator(1, "Colaborador", { withCandidate: false, withAssociatedField: false })];
  const scenario = buildHappyPathScenario(traceOf(events), events);
  const mcp = toSharedMcpScenario(scenario, "app");
  assert.equal(mcp.mcpExecutable, false);
  assert.equal(mcp.executionReadiness, "blocked_execution_contract");
});

test("8/multipleFills. eight fills with the same runtime-resolvable shape all reach mcpExecutable=true", () => {
  const events = Array.from({ length: 8 }, (_, i) => fillNoLocator(i + 1, `Campo${i + 1}`, { withCandidate: true, withAssociatedField: true }));
  const scenario = buildHappyPathScenario(traceOf(events), events);
  assert.equal(scenario.hasUncertainSteps, true);
  const mcp = toSharedMcpScenario(scenario, "app");
  assert.equal(mcp.mcpExecutable, true);
  assert.equal(mcp.executionReadiness, "ready");
});

test("10/noSyntheticLocator. no locator is fabricated for the runtime-resolvable fill -- technicalTargetRefs/locators stay empty", () => {
  const events = [fillNoLocator(1, "Colaborador", { withCandidate: true, withAssociatedField: true })];
  const scenario = buildHappyPathScenario(traceOf(events), events);
  const interaction = scenario.canonicalInteractions?.find((i) => i.action === "fill");
  assert.deepEqual(interaction?.technicalTargetRefs, []);
});
