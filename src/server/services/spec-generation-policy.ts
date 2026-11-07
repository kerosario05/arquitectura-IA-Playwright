export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export function isJiraSpecGenerationEnabled(env: EnvironmentValues = process.env): boolean {
  return !["false", "0", "off", "no", "disabled"].includes(
    (env.JIRA_SPEC_GENERATION_ENABLED ?? "true").trim().toLowerCase(),
  );
}

export function isJiraDiscoveryOnlyPass(input: {
  childExitCode: number;
  childStatus?: string;
  specGenerationStatus?: string;
}): boolean {
  return input.childExitCode === 0
    && input.childStatus === "passed"
    && input.specGenerationStatus === "skipped";
}
