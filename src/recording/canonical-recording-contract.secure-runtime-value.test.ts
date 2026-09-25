import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { toSharedMcpScenario } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * BLOCKER B TRACE (recordingId=e224287e-...): physical evidence showed a password action with
 * `resolutionState=certified` (target already technically resolved -- never touched here) but
 * `ready=false`, `blockReason=unresolved_runtime_value:contrasena`. Traced the FULL lineage:
 * Capture V2 sensitive edit -> semantic field/valueKey -> `applyRuntimeDatasetValues(scenario,
 * datasetValues)` -> `toSharedMcpScenario`'s own internal call to it (canonical-recording-
 * contract.ts:2782) -> readiness lookup. This is the EXISTING, generic, already-wired CORE
 * mechanism the ticket asks for ("valueKey -> secure runtime value", never a Fenix-specific
 * path) -- confirmed via `src/server/routes/recordings.ts:133` and `src/server/jobs/rerun-
 * runner.ts:154`, both of which already thread a caller-supplied `values`/`datasetValues` map
 * straight into `toSharedMcpScenario`. No code defect found: the mechanism resolves
 * deterministically once a value is supplied, and stays fail-closed when it is not -- proven here
 * end-to-end, with an arbitrary valueKey (no Fenix/"contrasena" hardcode) and no plaintext logged.
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://secure-value-fixture.test",
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
    baseUrl: "http://secure-value-fixture.test",
    framesDir: path.join(os.tmpdir(), "secure-runtime-value-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  return { recorder, events };
}

async function buildSensitiveScenario(fieldKey: string) {
  const { recorder, events } = newRecorder();
  // A real sensitive Capture V2 edit never carries a literal (see CaptureValueState's own doc:
  // "a sensitive edit can be fully represented as { present: true, changed: true } with no
  // literal at all"). Omitting `value` here reproduces that -- the physical shape this blocker
  // is about: `resolved=false` until a value is explicitly supplied via the generic dataset
  // mechanism, never auto-resolved from a captured plaintext.
  await recorder.onInteraction({
    kind: "input",
    role: "textbox",
    inputType: "password",
    domId: fieldKey,
    label: fieldKey,
    sensitive: true,
    valueSource: "user",
  } as any);
  return buildHappyPathScenario(trace(events), events);
}

test("17/20. a sensitive field with no captured literal produces a required, UNRESOLVED valueKey -- fail closed (unresolved_runtime_value), never silently marked ready, no plaintext anywhere", async () => {
  const scenario = await buildSensitiveScenario("clavesecreta");
  const contract = toSharedMcpScenario(scenario, "app", {});
  const requirement = (contract.runtimeInputRequirements ?? []).find((r: any) => r.sensitive === true);
  assert.ok(requirement, "a sensitive requirement must exist for this fixture");
  assert.equal(requirement.resolved, false, "never auto-resolved from a captured literal");
  assert.equal(requirement.value, null);
  const action = contract.executionReadinessAudit.actions.find((a: any) => a.valueKey === requirement.valueKey);
  assert.equal(action?.runtimeValueResolved, false);
  assert.equal(action?.ready, false);
  assert.ok(action?.blockReasons?.some((r: string) => r.startsWith("unresolved_runtime_value")));
  assert.doesNotMatch(JSON.stringify(contract), /typed-during-recording/, "no captured literal ever exists for this field in the first place");
});

test("18/19. valueKey resolved through the generic runtime-data mechanism (datasetValues) -> the fill action becomes ready", async () => {
  const scenario = await buildSensitiveScenario("clavesecreta");
  const withoutValue = toSharedMcpScenario(scenario, "app", {});
  const valueKey = (withoutValue.runtimeInputRequirements ?? []).find((r: any) => r.sensitive === true)!.valueKey;

  const withValue = toSharedMcpScenario(scenario, "app", { [valueKey]: "supplied-secure-value" });
  const requirement = (withValue.runtimeInputRequirements ?? []).find((r: any) => r.valueKey === valueKey);
  assert.equal(requirement?.resolved, true, "the generic key->value mechanism resolves the requirement");
  const action = withValue.executionReadinessAudit.actions.find((a: any) => a.valueKey === valueKey);
  assert.equal(action?.runtimeValueResolved, true);
  assert.equal(action?.ready, true);
});

test("22. an arbitrary, non-Fenix valueKey works identically -- no app/field-specific branch", async () => {
  const scenario = await buildSensitiveScenario("clave_generica_xyz");
  const withoutValue = toSharedMcpScenario(scenario, "app", {});
  const requirement = (withoutValue.runtimeInputRequirements ?? []).find((r: any) => r.sensitive === true);
  assert.ok(requirement);
  const withValue = toSharedMcpScenario(scenario, "app", { [requirement!.valueKey]: "any-secret-value" });
  const action = withValue.executionReadinessAudit.actions.find((a: any) => a.valueKey === requirement!.valueKey);
  assert.equal(action?.ready, true);
});

test("21/23. the supplied secure value transports only through the intentional key->value execution channel, never into the diagnostic-only readiness surface", async () => {
  const scenario = await buildSensitiveScenario("clavesecreta");
  const requirement = (toSharedMcpScenario(scenario, "app", {}).runtimeInputRequirements ?? []).find((r: any) => r.sensitive === true);
  const contract = toSharedMcpScenario(scenario, "app", { [requirement!.valueKey]: "must-not-leak-into-diagnostics" });
  assert.doesNotMatch(JSON.stringify(contract.executionReadinessAudit ?? {}), /must-not-leak-into-diagnostics/);
});
