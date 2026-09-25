import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, validateInteractionStateSequence, evaluateRecordedScenarioExecutionReadiness, enrichRecordedScenarioContract } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * FIRST_LOSS: `buildCanonicalInteractions`'s `ownedTransitionSeqs` loop -- which prevents a
 * navigation already represented by a real action's own `routeAfter` from ALSO being emitted as
 * its own, separate, standalone `navigation` interaction -- only ever considered `tap`/`fill` as
 * candidates that could "own" a transition. `press` never has a pointer anchor (no mouse gesture
 * precedes a keyboard command), so a navigation a press alone caused (e.g. Enter submitting a
 * form) was NEVER marked owned. It doubled up as its own standalone `navigation` interaction
 * whose own screenBeforeRef/routeBefore never lined up with the press's own
 * screenAfterRef/routeAfter the way the SAME real transition's single representation should --
 * `validateInteractionStateSequence` correctly flagged that broken chain as
 * "secuencia de estados incompatible", but the real bug was the duplication upstream, not the
 * validator itself.
 *
 * Fixed by adding `press` to the SAME `ownedTransitionSeqs` candidate check tap/fill already
 * use -- a press never has a pointer anchor, so it always takes their existing "no anchor"
 * fallback (`causalTransition(...).event`), exactly mirroring tap/fill's own behavior.
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://state-sequence-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "login", url: "/login" } as any],
  } as unknown as SessionTrace;
}

test("3/4. a press-caused transition remains a functional, state-compatible sequence after a preceding fill", () => {
  const events = [
    { seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "input", locators: [{ strategy: "css", value: "#password" }] }, value: "secret", valueSource: "user" },
    { seq: 1, t: 2, kind: "press", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#password" }] }, note: "Enter" },
    { seq: 2, t: 3, kind: "navigate", screenKey: "login", url: "/dashboard" },
  ] as never;
  const interactions = buildCanonicalInteractions(events);
  const press = interactions.find((interaction) => interaction.action === "press");
  assert.ok(press, "press must produce its own canonical interaction");
  assert.equal(press!.key, "Enter");
  assert.equal(press!.routeAfter, "/dashboard", "the press correctly claims the transition it caused");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("no duplicate standalone navigation interaction is created for a transition a press already owns", () => {
  const events = [
    { seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "input", locators: [{ strategy: "css", value: "#password" }] }, value: "secret", valueSource: "user" },
    { seq: 1, t: 2, kind: "press", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#password" }] }, note: "Enter" },
    { seq: 2, t: 3, kind: "navigate", screenKey: "login", url: "/dashboard" },
  ] as never;
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((interaction) => interaction.action === "navigation").length, 0, "the navigation is represented once, via the press's own routeAfter -- never a second time");
});

test("4b. a press with NO preceding fill can still legitimately own the transition it causes", () => {
  const events = [
    { seq: 0, t: 1, kind: "press", screenKey: "search", url: "/search", target: { label: "Buscar", associatedField: "Buscar", role: "textbox", locators: [{ strategy: "css", value: "#q" }] }, note: "Enter" },
    { seq: 1, t: 2, kind: "navigate", screenKey: "search", url: "/search/results" },
  ] as never;
  const interactions = buildCanonicalInteractions(events);
  const press = interactions.find((interaction) => interaction.action === "press");
  assert.equal(press?.routeAfter, "/search/results");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("2/fillFill. fill, fill on the same screen with no transition evidence: compatible", () => {
  const events = [
    { seq: 0, t: 1, kind: "fill", screenKey: "form", url: "/form", target: { label: "Usuario", associatedField: "Usuario", role: "input", locators: [{ strategy: "css", value: "#user" }] }, value: "qauser" },
    { seq: 1, t: 2, kind: "fill", screenKey: "form", url: "/form", target: { label: "Contraseña", associatedField: "Contraseña", role: "input", locators: [{ strategy: "css", value: "#password" }] }, value: "secret" },
  ] as never;
  const interactions = buildCanonicalInteractions(events);
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("1/setupFill. the fixed 'Abrir la aplicación...' setup row never creates a fictitious conflict with the first real user action", async () => {
  const events: RecordedEvent[] = [
    { seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Usuario", associatedField: "Usuario", role: "input", locators: [{ strategy: "css", value: "#user" }] }, value: "qauser" } as never,
  ];
  const scenario = buildHappyPathScenario(trace(events), events);
  assert.equal(scenario.stateSequenceValid, true);
});

test("7/runtimeResolutionRequired. a structurally-eligible action pending live re-resolution is never itself a state-sequence conflict", () => {
  const events = [
    { seq: 0, t: 1, kind: "tap", screenKey: "form", url: "/form", target: { role: "button", associatedField: "Depurar", locators: [] } },
  ] as never;
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  assert.deepEqual(validateInteractionStateSequence(canonical), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("8/realConflict. a genuine cross-screen jump with no owned transition stays blocked -- no false pass", () => {
  const result = validateInteractionStateSequence([
    { id: "a", controlIdentity: "a", action: "click", sourceEventRefs: [], technicalTargetRefs: [], screenBeforeRef: "screen-a", screenAfterRef: "screen-a", routeBefore: "/a", routeAfter: "/a", confidence: 1 },
    { id: "b", controlIdentity: "b", action: "click", sourceEventRefs: [], technicalTargetRefs: [], screenBeforeRef: "screen-b", screenAfterRef: "screen-b", routeBefore: "/b", routeAfter: "/b", confidence: 1 },
  ] as never);
  assert.equal(result.stateSequenceValid, false);
  assert.equal(result.stateSequenceIssues.length, 1);
});

test("9/order. fill, press, navigate, fill -- exact interaction order preserved", () => {
  const events = [
    { seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Usuario", associatedField: "Usuario", role: "input", locators: [{ strategy: "css", value: "#user" }] }, value: "qauser" },
    { seq: 1, t: 2, kind: "press", screenKey: "login", url: "/login", target: { label: "Usuario", associatedField: "Usuario", role: "textbox", locators: [{ strategy: "css", value: "#user" }] }, note: "Enter" },
    { seq: 2, t: 3, kind: "navigate", screenKey: "login", url: "/dashboard" },
    { seq: 3, t: 4, kind: "fill", screenKey: "dashboard", url: "/dashboard", target: { label: "Buscar", associatedField: "Buscar", role: "input", locators: [{ strategy: "css", value: "#search" }] }, value: "algo" },
  ] as never;
  const interactions = buildCanonicalInteractions(events);
  assert.deepEqual(interactions.map((i) => i.action), ["fill", "press", "fill"]);
});

test("10/generic. no app/project/value hardcode: the mechanism generalizes to an arbitrary press/route pair", () => {
  const events = [
    { seq: 0, t: 1, kind: "press", screenKey: "cualquier-pantalla", url: "/cualquier-ruta", target: { label: "Cualquier Campo", associatedField: "Cualquier Campo", role: "textbox", locators: [{ strategy: "css", value: "#cualquier-id" }] }, note: "Tab" },
    { seq: 1, t: 2, kind: "navigate", screenKey: "cualquier-pantalla", url: "/otra-ruta-cualquiera" },
  ] as never;
  const interactions = buildCanonicalInteractions(events);
  const press = interactions.find((i) => i.action === "press");
  assert.equal(press?.key, "Tab");
  assert.equal(press?.routeAfter, "/otra-ruta-cualquiera");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});
