/** One TestRail step representation for Launcher and Test Design. Values are never substituted here. */
export function scenarioCaseSteps(steps: readonly (string | { action: string; expected?: string })[]) {
  return steps.map(step => ({
    content: (typeof step === "string" ? step : step.action).replace(/^\d+[.)]\s*/, "").trim(),
    ...(typeof step !== "string" && step.expected?.trim() ? { expected: step.expected.trim() } : {}),
  })).filter(step => step.content.length > 0);
}
