export type DiscoveryLiveCaseStartedInput = {
  caseId: number;
  title: string;
  index: number;
  total: number;
  steps: string[];
};

export function buildDiscoveryLiveCaseStartedEvent(input: DiscoveryLiveCaseStartedInput) {
  return {
    type: "case_started" as const,
    caseId: `C${input.caseId}`,
    title: input.title,
    index: input.index,
    total: input.total,
    steps: input.steps.map((step) => step.replace(/^([\s]*Ingresar\s+)"[^"]*"(\s+en\s+)/i, '$1"[REDACTED]"$2')),
  };
}

export function buildDiscoveryLiveCaseFinishedEvent(input: {
  caseId: number;
  title: string;
  passed: boolean;
  failedAtStep?: number;
}) {
  return {
    type: "case_finished" as const,
    caseId: `C${input.caseId}`,
    title: input.title,
    status: input.passed ? "passed" as const : "failed" as const,
    ...(Number.isInteger(input.failedAtStep) && Number(input.failedAtStep) > 0
      ? { failedAtStep: Number(input.failedAtStep) }
      : {}),
  };
}
