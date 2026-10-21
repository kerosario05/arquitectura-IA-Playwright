export const JIRA_PREVIEW_TESTRAIL_UNSUPPORTED = "jira_preview_testrail_publish_unsupported";

/** jira_semantic preview never reaches the TestRail publisher; fail closed if asked to. */
export function getJiraPreviewTestRailGuardError(
  engine: string,
  body: { publishToTestRail?: unknown; createTestRun?: unknown } | undefined,
): { ok: false; error: string; message: string } | null {
  if (engine !== "jira_semantic") return null;
  if (body?.publishToTestRail !== true && body?.createTestRun !== true) return null;
  return {
    ok: false,
    error: JIRA_PREVIEW_TESTRAIL_UNSUPPORTED,
    message: "scenario-preview jira_semantic no publica en TestRail. Usa /api/runs/launch-execution.",
  };
}
