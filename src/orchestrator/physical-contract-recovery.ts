import { enrichRecordingReference } from "./qa-lab-reference-context";
import type { TaskContract } from "./types";

export type PhysicalContractRecovery = {
  task: TaskContract;
  recoveredFields: string[];
  conflicts: string[];
  missingFields: string[];
};

/** Reconcile a recording task with its exact saved artifact before the physical gate runs. */
export function recoverRecordingPhysicalContract(repoRoot: string, task: TaskContract): PhysicalContractRecovery {
  if (!task.physicalValidationRequired || task.qaLabReference?.kind !== "recording") {
    return { task, recoveredFields: [], conflicts: [], missingFields: [] };
  }

  const resolved = enrichRecordingReference(repoRoot, task.qaLabReference);
  const conflicts: string[] = [];
  if (task.projectSlug && resolved.projectSlug && task.projectSlug.toLowerCase() !== resolved.projectSlug.toLowerCase()) {
    conflicts.push(`Task project ${task.projectSlug} differs from recording project ${resolved.projectSlug}`);
  }

  const recoveredFields: string[] = [];
  const next: TaskContract = { ...task, qaLabReference: resolved };
  if (!next.projectSlug && resolved.projectSlug) { next.projectSlug = resolved.projectSlug; recoveredFields.push("projectSlug"); }
  if (!next.runtimeUrl && resolved.runtimeUrl) { next.runtimeUrl = resolved.runtimeUrl; recoveredFields.push("runtimeUrl"); }
  if (!next.steps?.length && resolved.steps?.length) { next.steps = resolved.steps; recoveredFields.push("steps"); }

  const missingFields = [
    ...(!next.qaLabBaseUrl ? ["qaLabBaseUrl"] : []),
    ...(!next.projectSlug ? ["projectSlug"] : []),
    ...(!next.runtimeUrl ? ["runtimeUrl"] : []),
    ...(!next.steps?.length ? ["steps"] : []),
  ];
  return { task: next, recoveredFields, conflicts, missingFields };
}
