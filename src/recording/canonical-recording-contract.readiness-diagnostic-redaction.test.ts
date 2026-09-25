import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * TEMPORARY DIAGNOSTIC TICKET: `[recording-readiness-action]` / `[recording-readiness-action-result]`
 * / `[recording-readiness-summary]` were added to `evaluateRecordedScenarioExecutionReadiness`
 * and the canonical-interaction builder purely to observe the REAL blocked scenario's readiness
 * decision without a live repro. This is the one focal safety test the ticket asks for: the
 * redaction contract itself -- these diagnostic logs must never leak a recordedValue, a dataset
 * literal, or a sensitive/identification literal, only structural metadata (ids, field-name
 * labels, booleans, counts, decision strings).
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://readiness-diagnostic-fixture.test",
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
    baseUrl: "http://readiness-diagnostic-fixture.test",
    framesDir: path.join(os.tmpdir(), "readiness-diagnostic-redaction-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  return { recorder, events };
}

const SENSITIVE_IDENTIFICATION_LITERAL = "1234567890";
const SENSITIVE_PASSWORD_LITERAL = "s3cr3t-p4ss";

test("15/diagnosticRedaction. readiness diagnostic logs never include recordedValue/dataset/password/identification literals", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", domId: "password", label: "Contraseña", value: SENSITIVE_PASSWORD_LITERAL });
  await recorder.onInteraction({ kind: "press", key: "Enter", role: "textbox", associatedField: "Contraseña" });
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "Solicitud multiproducto" });
  await recorder.onInteraction({ kind: "input", role: "textbox", columnIdentity: "numero_de_identificacion", value: SENSITIVE_IDENTIFICATION_LITERAL });
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "Depurar" });

  const calls: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => { calls.push(args); };
  try {
    const scenario = buildHappyPathScenario(trace(events), events);
    const canonical = buildCanonicalInteractions(events);
    const enriched = enrichRecordedScenarioContract(scenario, canonical);
    evaluateRecordedScenarioExecutionReadiness(enriched);
  } finally {
    console.info = originalInfo;
  }

  const diagnosticCalls = calls.filter((args) =>
    typeof args[0] === "string" && args[0].startsWith("[recording-readiness"),
  );
  assert.ok(diagnosticCalls.length > 0, "expected at least one diagnostic log to have fired");

  const serialized = JSON.stringify(diagnosticCalls);
  assert.ok(!serialized.includes(SENSITIVE_IDENTIFICATION_LITERAL), "identification literal must never be logged");
  assert.ok(!serialized.includes(SENSITIVE_PASSWORD_LITERAL), "password literal must never be logged");
  assert.ok(!serialized.includes("recordedValue"), "no recordedValue key must ever be logged");
  assert.ok(!serialized.includes("\"value\""), "no raw dataset value key must ever be logged");
});
