import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, toSharedMcpScenario } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

const selection = { sourceKind: "input" as const, startOffset: 0, endOffset: 8, endAtSourceEnd: false };

function events(): RecordedEvent[] {
  return [
    {
      seq: 1, t: 10, kind: "value_source", screenKey: "portal", pageKey: "tab-1",
      url: "https://portal.example/requests/MPN-3239",
      target: { label: "Número de solicitud", tag: "input", locators: [{ strategy: "css", value: "#request-id", confidence: 1 }] },
      valueSelection: selection,
    },
    {
      seq: 2, t: 20, kind: "navigate", screenKey: "bizagi", pageKey: "tab-2", opensNewPage: true,
      url: "https://bizagi.example/approvals",
    },
    {
      seq: 3, t: 30, kind: "fill", screenKey: "bizagi", pageKey: "tab-2", url: "https://bizagi.example/approvals",
      target: { label: "Buscar solicitud", tag: "input", locators: [{ strategy: "css", value: "#search", confidence: 1 }] },
      valueSource: "application", dependsOnEventRef: "event-1",
    },
  ] as RecordedEvent[];
}

test("mock: canonical recording and execution contract preserve the source pageKey for a pasted value", () => {
  const traceEvents = events();
  const source = buildCanonicalInteractions(traceEvents).find((interaction) => interaction.action === "system_observation");
  assert.equal(source?.pageKey, "tab-1");
  assert.equal(source?.runtimeValueCapture?.sourcePageKey, "tab-1");

  const trace = {
    recordingId: "value-transfer-mock",
    projectSlug: "portal-comercial",
    appSlug: "portal-comercial",
    platform: "web",
    baseUrl: "https://portal.example",
    startedAt: new Date(0).toISOString(),
    status: "completed",
    events: traceEvents,
    screens: [{ screenKey: "portal", url: "https://portal.example" }, { screenKey: "bizagi", url: "https://bizagi.example" }],
  } as unknown as SessionTrace;
  const scenario = buildHappyPathScenario(trace, traceEvents);
  const contract = toSharedMcpScenario(scenario, "portal-comercial");
  const capture = contract.recordingExecutionContract?.runtimeValueCaptures?.find((item: any) => item.sourceEventRef === "event-1");
  assert.equal(capture?.sourcePageKey, "tab-1");
  assert.equal(capture?.captureBeforeInteractionId, "interaction-2");
});

test("mock: a value source emitted after the fill that consumes it is still captured before leaving its page", () => {
  const [source, navigate, fill] = events();
  // Stream order: navigate, fill, then the value_source observation linked afterwards.
  const traceEvents = [
    { ...navigate, seq: 1 },
    { ...fill, seq: 2, dependsOnEventRef: "event-3" },
    { ...source, seq: 3 },
  ] as RecordedEvent[];
  const trace = {
    recordingId: "value-transfer-late-source",
    projectSlug: "portal-comercial",
    appSlug: "portal-comercial",
    platform: "web",
    baseUrl: "https://portal.example",
    startedAt: new Date(0).toISOString(),
    status: "completed",
    events: traceEvents,
    screens: [{ screenKey: "portal", url: "https://portal.example" }, { screenKey: "bizagi", url: "https://bizagi.example" }],
  } as unknown as SessionTrace;
  const contract = toSharedMcpScenario(buildHappyPathScenario(trace, traceEvents), "portal-comercial");
  const capture = contract.recordingExecutionContract?.runtimeValueCaptures?.find((item: any) => item.sourceEventRef === "event-3");
  assert.ok(capture, "late value source must still produce a runtime capture");
  assert.equal(capture?.sourcePageKey, "tab-1");
});
