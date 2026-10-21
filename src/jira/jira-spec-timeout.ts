const DEFAULT_JIRA_SPEC_VERIFICATION_TIMEOUT_MS = 90_000;
const MAX_JIRA_SPEC_VERIFICATION_TIMEOUT_MS = 600_000;
const JIRA_SPEC_VERIFICATION_BUDGET_PER_STEP_MS = 12_000;
const JIRA_SPEC_ASSERTION_POLL_BUDGET_MS = 15_000;
const DEFAULT_JIRA_SPEC_ASSERTION_AI_TIMEOUT_MS = 45_000;

/** Shared budget for the generated Playwright test and its parent verifier. */
export function resolveJiraSpecVerificationTimeoutMs(
  stepCount: number,
  requestedTimeoutMs?: number,
  semanticAssertionCount = 0,
  assertionAiTimeoutMs = DEFAULT_JIRA_SPEC_ASSERTION_AI_TIMEOUT_MS,
): number {
  if (Number.isFinite(requestedTimeoutMs) && Number(requestedTimeoutMs) > 0) {
    return Math.min(Number(requestedTimeoutMs), MAX_JIRA_SPEC_VERIFICATION_TIMEOUT_MS);
  }
  const safeStepCount = Number.isFinite(stepCount) ? Math.max(1, Math.ceil(stepCount)) : 1;
  const safeAssertionCount = Number.isFinite(semanticAssertionCount) ? Math.max(0, Math.ceil(semanticAssertionCount)) : 0;
  const safeAiTimeoutMs = Number.isFinite(assertionAiTimeoutMs) && assertionAiTimeoutMs > 0
    ? assertionAiTimeoutMs : DEFAULT_JIRA_SPEC_ASSERTION_AI_TIMEOUT_MS;
  const stepBudget = safeStepCount * JIRA_SPEC_VERIFICATION_BUDGET_PER_STEP_MS
    + safeAssertionCount * (JIRA_SPEC_ASSERTION_POLL_BUDGET_MS + safeAiTimeoutMs);
  return Math.min(MAX_JIRA_SPEC_VERIFICATION_TIMEOUT_MS,
    Math.max(DEFAULT_JIRA_SPEC_VERIFICATION_TIMEOUT_MS, stepBudget));
}
