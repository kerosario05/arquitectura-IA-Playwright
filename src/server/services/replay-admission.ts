import type { ReplayAdmissionRejection } from "../../types/scenario-preview.types";

export type ReplayAdmissionInput = {
  requestedScenarioIds: string[];
  evaluatedScenarioIds: string[];
  eligibleScenarioIds: string[];
  admittedScenarioIds: string[];
  evaluatedRejectedScenarios: ReplayAdmissionRejection[];
  nonRequestedRejectedCandidates?: ReplayAdmissionRejection[];
};

export type ReplayAdmissionResult = {
  requestedCount: number;
  eligibleCount: number;
  acceptedCount: number;
  requestedRejectedCount: number;
  requestedRejectedScenarioIds: string[];
  requestedRejectedScenarios: ReplayAdmissionRejection[];
  nonRequestedRejectedCandidates: ReplayAdmissionRejection[];
};

/**
 * Projects already-evaluated execution data into the replay admission contract.
 * Generation/catalog rejection is deliberately kept outside requested rejection.
 */
export function resolveReplayAdmission(input: ReplayAdmissionInput): ReplayAdmissionResult {
  const requested = new Set(input.requestedScenarioIds);
  const evaluated = new Set(input.evaluatedScenarioIds);
  const unique = (ids: string[]) => [...new Set(ids)];
  const requestedRejectedScenarios = input.evaluatedRejectedScenarios.filter(
    (rejection) => requested.has(rejection.scenarioId) && evaluated.has(rejection.scenarioId),
  );
  const nonRequestedRejectedCandidates = [
    ...input.evaluatedRejectedScenarios.filter((rejection) => !requested.has(rejection.scenarioId)),
    ...(input.nonRequestedRejectedCandidates ?? []).filter((rejection) => !requested.has(rejection.scenarioId)),
  ].filter((rejection, index, candidates) => candidates.findIndex((candidate) => candidate.scenarioId === rejection.scenarioId) === index);
  const eligibleScenarioIds = unique(input.eligibleScenarioIds.filter((scenarioId) => requested.has(scenarioId) && evaluated.has(scenarioId)));
  const acceptedScenarioIds = unique(input.admittedScenarioIds.filter((scenarioId) => requested.has(scenarioId) && evaluated.has(scenarioId)));

  return {
    requestedCount: input.requestedScenarioIds.length,
    eligibleCount: eligibleScenarioIds.length,
    acceptedCount: acceptedScenarioIds.length,
    requestedRejectedCount: requestedRejectedScenarios.length,
    requestedRejectedScenarioIds: requestedRejectedScenarios.map((rejection) => rejection.scenarioId),
    requestedRejectedScenarios,
    nonRequestedRejectedCandidates,
  };
}
