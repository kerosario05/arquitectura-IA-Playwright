import type { RecordedLocator, RecordedTechnicalTarget } from "./session-trace.types";

/** Transports already-captured locator identity without deriving or rewriting it. */
export function preserveCapturedTechnicalTargetLocators(
  technicalTargets: RecordedTechnicalTarget[] | undefined,
  capturedLocators: RecordedLocator[],
): RecordedTechnicalTarget[] | undefined {
  if (!technicalTargets?.length || !capturedLocators.length || technicalTargets.length !== 1) return technicalTargets;
  return technicalTargets.map((technicalTarget) => technicalTarget.locatorCandidates.length > 0
    ? technicalTarget
    : { ...technicalTarget, locatorCandidates: [...capturedLocators] });
}
