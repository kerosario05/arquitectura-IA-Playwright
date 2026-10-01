import type { RecordedScenario } from "./trace-to-scenario";

/**
 * What a regeneration changed, and the suggestions a reviewer may keep as drafts.
 *
 * "Generar escenarios" used to answer a regeneration that changed nothing exactly like one that
 * changed everything: the panel showed the same list and the click looked dead (recording
 * 2920301b). The derivation now reports its difference against what was persisted before it, and
 * every suggestion the quality gate discarded stays visible with its reason -- a reviewer can keep
 * one as a draft, which is documentation only: never executed, promoted or published.
 */

export type DerivationChanges = {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
};

/** The content a reviewer reads: an id whose title, steps or preconditions changed was updated. */
function scenarioContentKey(scenario: RecordedScenario): string {
  return JSON.stringify({
    title: scenario.title,
    kind: scenario.kind,
    preconditions: scenario.preconditions,
    steps: scenario.testRailSteps.map((step) => [step.content, step.expected ?? ""]),
  });
}

export function diffDerivedScenarios(previous: readonly RecordedScenario[], next: readonly RecordedScenario[]): DerivationChanges {
  const before = new Map(previous.map((scenario) => [scenario.scenarioId, scenarioContentKey(scenario)]));
  const nextIds = new Set(next.map((scenario) => scenario.scenarioId));
  const changes: DerivationChanges = { added: [], updated: [], removed: [], unchanged: [] };
  for (const scenario of next) {
    const prior = before.get(scenario.scenarioId);
    if (prior === undefined) changes.added.push(scenario.scenarioId);
    else if (prior === scenarioContentKey(scenario)) changes.unchanged.push(scenario.scenarioId);
    else changes.updated.push(scenario.scenarioId);
  }
  for (const scenario of previous) {
    if (!nextIds.has(scenario.scenarioId)) changes.removed.push(scenario.scenarioId);
  }
  return changes;
}

/** A suggestion the last derivation discarded, kept materialized so it can become a draft. */
export type SuggestionCandidate = {
  candidateId: string;
  title: string;
  rejectionReason?: string;
  scenario: RecordedScenario;
};

export function isReviewDraft(scenario: Pick<RecordedScenario, "reviewDraft">): boolean {
  return scenario.reviewDraft === true;
}

/**
 * The draft a reviewer keeps from a discarded suggestion. Everything that could let it run is
 * removed, not just flagged: no recorded interactions, no replay eligibility, no readiness.
 */
export function toReviewDraft(candidate: SuggestionCandidate, primaryScenarioId: string, existing: readonly RecordedScenario[]): RecordedScenario {
  const prefix = `${primaryScenarioId}-DRAFT-`;
  const taken = new Set(existing.map((scenario) => scenario.scenarioId));
  let index = 1;
  while (taken.has(`${prefix}${index}`)) index += 1;
  const { promotedSpec: _promotedSpec, testRailCaseId: _testRailCaseId, ...rest } = candidate.scenario as RecordedScenario & { promotedSpec?: unknown };
  return {
    ...rest,
    scenarioId: `${prefix}${index}`,
    primary: false,
    reviewDraft: true,
    replayEligible: false,
    technicalReadiness: false,
    containsUnexecutedActions: true,
    oracleAuthority: "review_required",
    canonicalInteractions: [],
    entityActionBlocks: [],
    readiness: candidate.scenario.readiness
      ? { ...candidate.scenario.readiness, executionReadiness: false, technicalReadiness: false }
      : undefined,
  } as RecordedScenario;
}

/** Drafts are the reviewer's decision: a regeneration keeps them after what it derived. */
export function carryReviewDrafts(next: readonly RecordedScenario[], previous: readonly RecordedScenario[]): RecordedScenario[] {
  const nextIds = new Set(next.map((scenario) => scenario.scenarioId));
  return [...next, ...previous.filter((scenario) => isReviewDraft(scenario) && !nextIds.has(scenario.scenarioId))];
}

/** Why a scenario may not run or be published, or undefined when it is not a draft. */
export function reviewDraftBlockReason(scenario: Pick<RecordedScenario, "reviewDraft" | "title">): string | undefined {
  return isReviewDraft(scenario)
    ? `"${scenario.title}" es un borrador sugerido: grábalo para poder ejecutarlo o publicarlo`
    : undefined;
}
