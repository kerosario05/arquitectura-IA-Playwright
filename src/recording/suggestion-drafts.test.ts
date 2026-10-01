import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecordedScenario } from "./trace-to-scenario";
import { carryReviewDrafts, diffDerivedScenarios, isReviewDraft, reviewDraftBlockReason, toReviewDraft, type SuggestionCandidate } from "./suggestion-drafts";

function scenario(scenarioId: string, title = scenarioId, expected = "ok", extra: Partial<RecordedScenario> = {}): RecordedScenario {
  return {
    scenarioId,
    title,
    description: "",
    preconditions: ["Acceso"],
    kind: "happy_path",
    provenance: "observed",
    mobileSteps: [],
    webSteps: [],
    testRailSteps: [{ content: "Presionar \"Tarjetas\"", expected }],
    requiredData: [],
    stepTargets: [],
    sourceRecordingId: "rec",
    hasUncertainSteps: false,
    ...extra,
  } as RecordedScenario;
}

test("a regeneration that reproduces the same scenarios reports them all unchanged (recording 2920301b)", () => {
  const before = [scenario("REC-01"), scenario("REC-01-FLOW-1"), scenario("REC-01-FLOW-2")];
  const again = before.map((entry) => ({ ...entry }));
  assert.deepEqual(diffDerivedScenarios(before, again), { added: [], updated: [], removed: [], unchanged: ["REC-01", "REC-01-FLOW-1", "REC-01-FLOW-2"] });
});

test("added, updated and removed scenarios are told apart by what a reviewer reads", () => {
  const before = [scenario("REC-01"), scenario("REC-01-FLOW-1"), scenario("REC-01-FLOW-2")];
  const after = [scenario("REC-01"), scenario("REC-01-FLOW-1", "REC-01-FLOW-1", "Se muestra el detalle"), scenario("REC-01-AI-x")];
  assert.deepEqual(diffDerivedScenarios(before, after), { added: ["REC-01-AI-x"], updated: ["REC-01-FLOW-1"], removed: ["REC-01-FLOW-2"], unchanged: ["REC-01"] });
});

function candidate(): SuggestionCandidate {
  return {
    candidateId: "cand-1",
    title: "Desde \"Más detalles del producto\": volver con \"Volver\"",
    rejectionReason: "goal_coherence_failed",
    scenario: scenario("REC-01-AI-volver", "Desde \"Más detalles del producto\": volver con \"Volver\"", "ok", {
      replayEligible: true,
      canonicalInteractions: [{ interactionId: "i-1" }] as unknown as RecordedScenario["canonicalInteractions"],
      readiness: { executionReadiness: true, technicalReadiness: true } as unknown as RecordedScenario["readiness"],
    }),
  };
}

test("a kept draft can never run: no interactions, no replay, no execution readiness", () => {
  const draft = toReviewDraft(candidate(), "REC-01", [scenario("REC-01")]);
  assert.equal(draft.scenarioId, "REC-01-DRAFT-1");
  assert.equal(isReviewDraft(draft), true);
  assert.equal(draft.replayEligible, false);
  assert.equal(draft.primary, false);
  assert.deepEqual(draft.canonicalInteractions, []);
  assert.equal((draft.readiness as { executionReadiness: boolean }).executionReadiness, false);
  assert.equal(draft.oracleAuthority, "review_required");
  assert.match(reviewDraftBlockReason(draft)!, /borrador sugerido/);
  assert.equal(reviewDraftBlockReason(scenario("REC-01")), undefined);
});

test("draft ids never collide with an existing draft", () => {
  const first = toReviewDraft(candidate(), "REC-01", [scenario("REC-01")]);
  const second = toReviewDraft(candidate(), "REC-01", [scenario("REC-01"), first]);
  assert.equal(second.scenarioId, "REC-01-DRAFT-2");
});

test("a regeneration keeps the reviewer's drafts after what it derived, and reports them unchanged", () => {
  const draft = toReviewDraft(candidate(), "REC-01", [scenario("REC-01")]);
  const previous = [scenario("REC-01"), draft];
  const next = carryReviewDrafts([scenario("REC-01")], previous);
  assert.deepEqual(next.map((entry) => entry.scenarioId), ["REC-01", "REC-01-DRAFT-1"]);
  assert.deepEqual(diffDerivedScenarios(previous, next).unchanged, ["REC-01", "REC-01-DRAFT-1"]);
});
