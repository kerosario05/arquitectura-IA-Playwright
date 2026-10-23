import path from "node:path";
import { buildEvidencePaths } from "../evidence/evidence-paths";
import type { ExecutionPlan } from "../types/execution-plan.types";

export type JiraReuseEvidenceContext = {
  appSlug: string;
  sectionSlug: string;
  sectionName?: string;
  runId: string;
  caseId: number;
  specPath: string;
  issueKey?: string;
  requirement?: string;
  expectedResult?: string;
  acceptanceCriteria?: string[];
  preconditions?: string[];
  testType?: string;
  testApproach?: string;
  dataLabels?: Record<string, string>;
};

/** Only exact Jira specs launched inside a QA Lab job opt into this reporter. */
export function jiraReuseEvidenceOptions(specSource: string, context: JiraReuseEvidenceContext | undefined) {
  if (!context || !/from\s+["'][^"']*\/jira-spec-runtime["']/.test(specSource)) return undefined;
  const paths = buildEvidencePaths({ ...context, scenarioId: `C${context.caseId}`, scenarioTitle: "" });
  return {
    configPath: "playwright.config.jira-reuse.ts",
    contextJson: JSON.stringify(context),
    outputDir: path.resolve(paths.scenarioDir, "playwright"),
  };
}

/**
 * Adds runtime-only progress and screenshot hooks to a temporary execution copy of an
 * older promoted Jira spec. The promoted source file stays byte-for-byte unchanged.
 */
export function instrumentPromotedJiraSpecForEvidence(
  specSource: string,
  plan: ExecutionPlan,
): string | undefined {
  if (/reportJiraSpecStep(Start|Complete)/.test(specSource)) return specSource;

  const runtimeImport = specSource.match(/^\s*import\s*\{([^}]*)\}\s*from\s*(["'])([^"']*\/jira-spec-runtime)\2\s*;?\s*$/m);
  if (!runtimeImport || !/async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>/.test(specSource)) return undefined;
  const requiredSteps = plan.steps.filter(step => !step.optional);
  if (requiredSteps.length === 0) return undefined;
  const finalRequiredStepIndex = requiredSteps.at(-1)?.index;

  const lines = specSource.split(/\r?\n/);
  const stepByIndex = new Map(requiredSteps.map(step => [step.index, step]));
  const comments = new Set<number>();
  for (const line of lines) {
    const match = line.match(/^\s*\/\/\s*(\d+)\.\s+/);
    if (match && stepByIndex.has(Number(match[1]))) comments.add(Number(match[1]));
  }
  if (requiredSteps.some(step => !comments.has(step.index))) return undefined;

  const requestedHelpers = ["reportJiraSpecStepComplete", "reportJiraSpecStepStart"];
  const existingNames = new Set(runtimeImport[1].split(",").map(name => name.trim()).filter(Boolean));
  const mergedNames = [...existingNames, ...requestedHelpers.filter(name => !existingNames.has(name))];
  const importLine = `import { ${mergedNames.join(", ")} } from ${runtimeImport[2]}${runtimeImport[3]}${runtimeImport[2]};`;
  let importReplaced = false;
  const instrumented: string[] = [];
  let activeStep: number | undefined;
  let lastCommentedStep: number | undefined;

  for (const line of lines) {
    const comment = line.match(/^\s*\/\/\s*(\d+)\.\s+/);
    const commentedStep = comment ? Number(comment[1]) : undefined;
    if (commentedStep !== undefined && stepByIndex.has(commentedStep)) {
      if (activeStep !== undefined) {
        const previous = stepByIndex.get(activeStep)!;
        const captureScreen = ["navigate", "click", "fill", "select", "check", "uncheck", "screenshot"].includes(previous.action);
        const isFinalStep = previous.index === finalRequiredStepIndex;
        instrumented.push(`  await reportJiraSpecStepComplete(page, testInfo, ${activeStep}, ${captureScreen}, ${isFinalStep});`);
      }
      instrumented.push(line);
      instrumented.push(`  await reportJiraSpecStepStart(testInfo, ${commentedStep});`);
      activeStep = commentedStep;
      lastCommentedStep = commentedStep;
      continue;
    }

    if (activeStep !== undefined && line.trim() === "});" && lastCommentedStep === activeStep) {
      const current = stepByIndex.get(activeStep)!;
      const captureScreen = ["navigate", "click", "fill", "select", "check", "uncheck", "screenshot"].includes(current.action);
      const isFinalStep = current.index === finalRequiredStepIndex;
      instrumented.push(`  await reportJiraSpecStepComplete(page, testInfo, ${activeStep}, ${captureScreen}, ${isFinalStep});`);
      activeStep = undefined;
    }
    if (!importReplaced && line === runtimeImport[0].trim()) {
      instrumented.push(importLine);
      importReplaced = true;
      continue;
    }
    instrumented.push(line);
  }

  if (!importReplaced || activeStep !== undefined) return undefined;
  return instrumented.join("\n").replace(
    /async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>/,
    "async ({ page }, testInfo) =>",
  );
}

/** Match the actual spec stack frame to its preceding generated step comment. */
export function failedJiraSpecStep(specSource: string, specPath: string, stacks: string[]): number | undefined {
  const normalizedPath = path.resolve(specPath).replace(/\\/g, "/");
  for (const stack of stacks) {
    const normalized = stack.replace(/\\/g, "/");
    const offset = normalized.indexOf(`${normalizedPath}:`);
    if (offset < 0) continue;
    const line = Number(normalized.slice(offset + normalizedPath.length + 1).match(/^\d+/)?.[0]);
    if (!line) continue;
    const comments = [...specSource.split(/\r?\n/).slice(0, line).join("\n").matchAll(/^\s*\/\/\s*(\d+)\.\s+/gm)];
    if (comments.length) return Number(comments.at(-1)![1]);
  }
  return undefined;
}
