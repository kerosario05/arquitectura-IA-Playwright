import type { JiraIssueSource } from "../scenarios/scenario-types";
import { jiraAcceptanceClauses, jiraScenarioQualityGaps, uncoveredAcceptanceClauses } from "./jira-scenario-generator";

export type JiraGenerationExpectation = {
  issueKey: string;
  criterionId: string;
  /** Maintainer-authored checks grounded in the HU; never supplied by the generating model. */
  allStepPatterns: string[];
  forbiddenStepPatterns?: string[];
};
export type JiraGenerationEvaluationInput = {
  issues: JiraIssueSource[];
  scenarios: Record<string, unknown>[];
  expectations?: JiraGenerationExpectation[];
};

/** Offline evaluation only. Never changes scenarios, publishes, repairs or calls an LLM. */
export function evaluateGeneratedJiraSuite(input: JiraGenerationEvaluationInput) {
  const clauses = input.issues.flatMap(issue => jiraAcceptanceClauses(issue).map(clause => ({ issueKey: issue.key, ...clause })));
  const matchesRef = (ref: string, clauseId: string) => ref === clauseId || ref.startsWith(`${clauseId}.`)
    || (clauseId.endsWith(".1") && ref === clauseId.split(".")[0]);
  const stepsOf = (scenario: Record<string, unknown>) => Array.isArray(scenario.steps)
    ? scenario.steps.filter((step): step is string => typeof step === "string") : [];
  const refsOf = (scenario: Record<string, unknown>) => Array.isArray(scenario.acceptanceCriteriaRefs)
    ? scenario.acceptanceCriteriaRefs.filter((ref): ref is string => typeof ref === "string") : [];
  const missingCriteria = input.issues.flatMap(issue => uncoveredAcceptanceClauses(issue, input.scenarios)
    .map(clause => ({ issueKey: issue.key, criterionId: clause.id })));
  const scenarioProblems = input.scenarios.flatMap((scenario, index) => {
    const steps = stepsOf(scenario);
    const refs = refsOf(scenario);
    const errors = new Set(jiraScenarioQualityGaps(scenario, steps));
    if (!input.issues.some(issue => issue.key === scenario.sourceIssueKey)) errors.add("unknown_source_issue");
    if (!steps.length) errors.add("empty_steps");
    if (!refs.length) errors.add("missing_criterion_refs");
    if (refs.some(ref => !clauses.some(clause => clause.issueKey === scenario.sourceIssueKey && matchesRef(ref, clause.id)))) {
      errors.add("unknown_criterion_ref");
    }
    const validation = scenario.validation as { valid?: boolean } | undefined;
    if (validation?.valid === false) errors.add("generation_marked_invalid");
    return errors.size ? [{ scenarioIndex: index, reasons: [...errors] }] : [];
  });
  const expectationResults = (input.expectations ?? []).map(expectation => {
    const known = clauses.some(clause => clause.issueKey === expectation.issueKey && clause.id === expectation.criterionId);
    const required = expectation.allStepPatterns.map(pattern => new RegExp(pattern, "iu"));
    const forbidden = (expectation.forbiddenStepPatterns ?? []).map(pattern => new RegExp(pattern, "iu"));
    const passed = known && required.length > 0 && input.scenarios.some(scenario => {
      if (scenario.sourceIssueKey !== expectation.issueKey || !refsOf(scenario).some(ref => matchesRef(ref, expectation.criterionId))) return false;
      const steps = stepsOf(scenario);
      return required.every(pattern => steps.some(step => pattern.test(step)))
        && forbidden.every(pattern => steps.every(step => !pattern.test(step)));
    });
    return { issueKey: expectation.issueKey, criterionId: expectation.criterionId, passed };
  });
  const structuralPassed = clauses.length > 0 && missingCriteria.length === 0 && scenarioProblems.length === 0;
  const independentlyUncheckedCriteria = clauses.filter(clause => !expectationResults.some(result =>
    result.issueKey === clause.issueKey && result.criterionId === clause.id && result.passed))
    .map(clause => ({ issueKey: clause.issueKey, criterionId: clause.id }));
  return {
    version: 1,
    scenarioCount: input.scenarios.length,
    sourceCriterionCount: clauses.length,
    coveredCriterionCount: clauses.length - missingCriteria.length,
    missingCriteria, scenarioProblems, expectationResults,
    independentChecksConfigured: expectationResults.length,
    independentlyUncheckedCriteria,
    structuralPassed,
    evaluationPassed: structuralPassed && expectationResults.length > 0 && independentlyUncheckedCriteria.length === 0
      && expectationResults.every(result => result.passed),
    semanticCertification: "not_performed" as const,
    scope: "offline_generation_quality_not_execution_certification" as const,
  };
}
