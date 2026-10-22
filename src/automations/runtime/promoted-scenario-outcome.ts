export type ScenarioOutcomeCheck = {
  hasFinalAssertion: boolean;
  failureMessages: string[];
  expectedVisibleTargets: string[];
  /** A declared credential-rejection assertion already passed: the auth-gate rejection screen is terminal. */
  terminalRejectionObserved?: boolean;
};

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function evaluatePromotedScenarioOutcome(input: ScenarioOutcomeCheck): "verified" | "PROMOTED_UNEXPECTED_BUSINESS_ERROR" | "PROMOTED_FINAL_OUTCOME_UNVERIFIED" {
  const expected = input.expectedVisibleTargets.map(normalized).filter(Boolean);
  const unexpected = input.failureMessages.some(message => {
    const observed = normalized(message);
    return !input.hasFinalAssertion || !expected.some(target => observed.includes(target));
  });
  if (unexpected) return "PROMOTED_UNEXPECTED_BUSINESS_ERROR";
  return input.hasFinalAssertion ? "verified" : "PROMOTED_FINAL_OUTCOME_UNVERIFIED";
}
