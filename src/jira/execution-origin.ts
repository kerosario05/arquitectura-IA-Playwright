export type ExecutionOrigin = { kind: "jira_generated"; jiraKey: string } | { kind: "recorded_session"; recordingId: string };
export type ExecutionEngine = "jira_semantic" | "recording_replay";

/**
 * Recover Jira provenance only for a historical scenario-preview rerun whose persisted
 * scenarios all point to the same valid Jira issue and carry no Recording lineage. This is
 * intentionally stricter than inferring Jira from a missing recordingId.
 */
export function inferLegacyJiraRerunOrigin(
  jiraKey: unknown,
  scenarios: Array<{
    scenarioId?: unknown;
    sourceIssueKey?: unknown;
    recordingId?: unknown;
    recordedScenarioId?: unknown;
    recordingExecutionContract?: unknown;
    canonicalInteractions?: unknown;
    recordingHumanContent?: unknown;
  }>,
): Extract<ExecutionOrigin, { kind: "jira_generated" }> | undefined {
  if (typeof jiraKey !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(jiraKey) || scenarios.length === 0) return undefined;
  const allCarryJiraOrigin = scenarios.every((scenario) =>
    typeof scenario.scenarioId === "string" && scenario.scenarioId.trim().length > 0
    && scenario.sourceIssueKey === jiraKey
    && !scenario.recordingId && !scenario.recordedScenarioId && !scenario.recordingExecutionContract
    && !scenario.canonicalInteractions && scenario.recordingHumanContent !== true,
  );
  return allCarryJiraOrigin ? { kind: "jira_generated", jiraKey } : undefined;
}

export function isScenarioEligibleForEngine(engine: ExecutionEngine | "legacy", scenario: { mcpExecutable?: boolean; validation?: { valid?: boolean; errors?: string[] } }): boolean {
  if (engine === "jira_semantic") {
    // Jira scenarios are run through Discovery, which reports a concrete step
    // failure and keeps the scenario editable. Generation findings are not an
    // admission gate; they remain visible as review diagnostics.
    return true;
  }
  return scenario.validation?.valid !== false && scenario.mcpExecutable === true;
}

/** An absent recording is never evidence of Jira provenance. Legacy requests stay on their existing route. */
export function resolveExecutionEngine(request: {
  executionEngine?: unknown; scenarioOrigin?: unknown; jiraKey?: unknown; recordingId?: unknown;
  scenarios?: Array<{ scenarioId?: string; recordingId?: string; recordingExecutionContract?: unknown; sourceIssueKey?: string }>;
}): ExecutionEngine | "legacy" {
  const origin = request.scenarioOrigin as Partial<ExecutionOrigin> | undefined;
  if (!origin && !request.executionEngine) return "legacy";
  if (origin?.kind === "recorded_session" && request.executionEngine === "recording_replay" && origin.recordingId) return "recording_replay";
  if (origin?.kind !== "jira_generated" || request.executionEngine !== "jira_semantic"
    || !/^[A-Z][A-Z0-9_]*-\d+$/.test(origin.jiraKey ?? "")) throw new Error("INVALID_EXECUTION_ORIGIN");
  if (request.jiraKey && request.jiraKey !== origin.jiraKey) throw new Error("JIRA_PROVENANCE_MISMATCH");
  if (request.recordingId || request.scenarios?.some(s => s.recordingId || s.recordingExecutionContract)) throw new Error("RECORDING_CANNOT_USE_JIRA_ENGINE");
  if (request.scenarios?.some(s => s.sourceIssueKey !== origin.jiraKey)) throw new Error("JIRA_SCENARIO_PROVENANCE_MISMATCH");
  if (!request.scenarios?.length || request.scenarios.some(s => !s.scenarioId?.trim())
    || new Set(request.scenarios.map(s => s.scenarioId)).size !== request.scenarios.length) throw new Error("JIRA_SCENARIO_ID_INVALID");
  return "jira_semantic";
}
