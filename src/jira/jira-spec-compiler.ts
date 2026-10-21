import path from "node:path";
import type { ExecutionPlan, ExecutionPlanStep, PlanTarget } from "../types/execution-plan.types";
import { resolveJiraSpecVerificationTimeoutMs } from "./jira-spec-timeout";
import { parseJiraDownloadExpectation } from "./jira-download-assertion";

export type JiraSpecScenarioMetadata = {
  auth?: { required?: boolean; insertionAfterStepIndex?: number; flowAlias?: string };
  observableOracles?: Array<{ type: string; stepIndex?: number; polarity?: "positive" | "negative"; target?: string; backed?: boolean; details?: Record<string, unknown> }>;
};

export type JiraSpecCompileInput = {
  plan: ExecutionPlan;
  sourceScenario: JiraSpecScenarioMetadata;
  appSlug: string;
  sectionSlug: string;
  automationId: string;
  specPath: string;
  verificationTimeoutMs?: number;
};

export type JiraSpecCompileResult = { source: string; unsupported: string[] };

function quote(value: string): string { return JSON.stringify(value); }

function portableImport(fromFile: string, targetFile: string): string {
  let relative = path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, "/").replace(/\.ts$/, "");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function targetLiteral(target: ExecutionPlanStep["target"]): string | undefined {
  return target && typeof target === "object" ? JSON.stringify(target) : undefined;
}

export function compileJiraSpec(input: JiraSpecCompileInput): JiraSpecCompileResult {
  const unsupported: string[] = [];
  const runtimePath = portableImport(input.specPath, path.resolve("src/jira/jira-spec-runtime.ts"));
  const authPath = input.sourceScenario.auth?.required
    ? portableImport(input.specPath, path.resolve("automations/apps", input.appSlug, "flows/auth.flow.ts"))
    : undefined;
  if (input.sourceScenario.auth?.required && input.sourceScenario.auth.insertionAfterStepIndex === undefined) {
    unsupported.push("auth_flow_insertion_point_missing");
  }
  const authOracles = new Set((input.sourceScenario.observableOracles ?? [])
    .filter(oracle => oracle.type === "auth_gate")
    .map(oracle => oracle.stepIndex));
  const semanticAssertionCount = input.plan.steps.filter(step => step.action === "assertVisible" || step.action === "assertText").length;
  const assertionAiTimeoutMs = Number(process.env.AI_JIRA_ASSERTION_TIMEOUT_MS);
  const verificationTimeoutMs = resolveJiraSpecVerificationTimeoutMs(
    input.plan.steps.length,
    input.verificationTimeoutMs,
    semanticAssertionCount,
    assertionAiTimeoutMs,
  );
  const lines = [
    `import { test, expect } from "@playwright/test";`,
    `import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from ${quote(runtimePath)};`,
    ...(authPath ? [`import { AuthFlow, setAuthFlowTestData } from ${quote(authPath)};`] : []),
    "",
    `test(${quote(input.plan.scenario.title)}, async ({ page }, testInfo) => {`,
    `  test.setTimeout(Math.max(test.info().timeout, ${verificationTimeoutMs}));`,
    `  const appSlug = ${quote(input.appSlug)};`,
    `  const sectionSlug = ${quote(input.sectionSlug)};`,
    `  const automationId = ${quote(input.automationId)};`,
    `  const baseUrl = process.env.APP_BASE_URL;`,
    `  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");`,
    ...(authPath ? [`  const authTestData = await resolveJiraSpecAuthTestData(appSlug);`,
      `  setAuthFlowTestData(authTestData);`,
      `  const authFlow = new AuthFlow(page);`] : []),
    "",
  ];

  // The auth gate (e.g. OTP after a recorded classic login) can follow any step kind, not only navigation.
  let authEmitted = false;
  const emitAuthAfter = (stepIndex: number) => {
    if (!authPath || authEmitted || input.sourceScenario.auth?.insertionAfterStepIndex !== stepIndex) return;
    authEmitted = true;
    // A recorded classic login submit (click after auth.* fills) must reach a recognized post-submit state before AuthFlow.
    const step = input.plan.steps.find(item => item.index === stepIndex);
    if (step?.action === "click" && input.plan.steps.some(item => item.index < stepIndex && item.action === "fill" && /^auth[._]/i.test(item.valueKey ?? ""))) {
      lines.push(`  const postLoginGate = await awaitJiraSpecPostLoginTransition(page);`);
      lines.push(`  if (postLoginGate === "access_code_gate") {`);
      lines.push(`    await completeJiraSpecAccessCodeGate(page, authTestData, ${quote(input.sourceScenario.auth.flowAlias ?? "defaultClient")});`);
      lines.push(`  } else {`);
      lines.push(`    const authResult = await authFlow.ensureAuthenticated({ alias: ${quote(input.sourceScenario.auth.flowAlias ?? "defaultClient")} });`);
      lines.push(`    if (!authResult.success) throw new Error("JIRA_SPEC_AUTH_FLOW_FAILED");`);
      lines.push(`  }`, "");
      return;
    }
    lines.push(`  const authResult = await authFlow.ensureAuthenticated({ alias: ${quote(input.sourceScenario.auth.flowAlias ?? "defaultClient")} });`);
    lines.push(`  if (!authResult.success) throw new Error("JIRA_SPEC_AUTH_FLOW_FAILED");`, "");
  };
  const lastRequiredStepIndex = input.plan.steps.filter(step => !step.optional).at(-1)?.index;
  for (const step of input.plan.steps) {
    if (step.optional) continue;
    const isFinalStep = step.index === lastRequiredStepIndex;
    const label = step.description ? `  // ${step.index}. ${step.description.replace(/[\r\n]+/g, " ").replace(/\*\//g, "")}` : `  // ${step.index}. ${step.action}`;
    lines.push(label);
    lines.push(`  await reportJiraSpecStepStart(testInfo, ${step.index});`);
    const targetJson = targetLiteral(step.target);
    const targetVar = `target${step.index}`;
    const oracleAuthGate = authOracles.has(step.index);
    const fieldValidationOracle = (input.sourceScenario.observableOracles ?? []).find(oracle => oracle.type === "field_validation" && oracle.stepIndex === step.index);
    if (step.action === "navigate") {
      if (step.target === "APP_BASE_URL") lines.push(`  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });`);
      else if (step.target && typeof step.target === "object" && step.target.strategy === "url" && step.target.value) {
        lines.push(`  await navigateJiraSpecRoute(page, ${quote(step.target.value)}, baseUrl);`);
      } else unsupported.push(`step_${step.index}:navigation_target_unsupported`);
    } else if (step.action === "assertVisible" && (input.sourceScenario.observableOracles ?? []).some(oracle => oracle.stepIndex === step.index && oracle.details?.kind === "download_content")) {
      // File-content requirement: never downgrade to page-text visibility.
      const expectation = parseJiraDownloadExpectation(step.description ?? "");
      if (!expectation || expectation.unparsed) unsupported.push(`step_${step.index}:download_expectation_unparseable`);
      else lines.push(`  await ${expectation.tableBound ? "assertJiraSpecTableBoundDownload" : "assertJiraSpecDownloadContent"}(page, ${JSON.stringify(expectation)}, ${step.timeoutMs ?? 15000});`);
    } else if (step.action === "assertVisible" && (input.sourceScenario.observableOracles ?? []).some(oracle => oracle.stepIndex === step.index && oracle.details?.kind === "table_row_match")) {
      // Never downgrade a bound row assertion to container-text visibility: every gate below fails closed.
      const rowOracle = input.sourceScenario.observableOracles!.find(oracle => oracle.stepIndex === step.index && oracle.details?.kind === "table_row_match")!;
      const keys = rowOracle.details?.boundValueKeys;
      const container = step.target && typeof step.target === "object" && step.target.strategy === "text" ? step.target.value : undefined;
      // Keys must be strings naming earlier plain fill steps of this plan (never credentials, never invented keys).
      const fillKeys = new Set(input.plan.steps.filter(item => item.index < step.index && item.action === "fill" && item.valueKey).map(item => item.valueKey!));
      const keysValid = Array.isArray(keys) && keys.length > 0 && keys.every(key => typeof key === "string" && fillKeys.has(key) && !/^auth[._]/i.test(key));
      if (rowOracle.type !== "runtime_state" || !rowOracle.backed || !container || rowOracle.target !== container || rowOracle.details?.matchedRows !== 1 || !keysValid) {
        unsupported.push(`step_${step.index}:table_row_match_spec_unsupported`);
      } else {
        lines.push(`  const rowValues${step.index} = [${(keys as string[]).map(key => `await resolveJiraSpecValue(${quote(key)}, appSlug, sectionSlug, automationId)`).join(", ")}];`);
        lines.push(`  await assertJiraSpecRowMatch(page, ${quote(container)}, rowValues${step.index}, ${step.timeoutMs ?? 15000});`);
      }
    } else if (step.action === "assertVisible" && fieldValidationOracle) {
      const expectedTarget = step.target && typeof step.target === "object" && step.target.strategy === "text" ? step.target.value : undefined;
      if (!fieldValidationOracle.backed || !fieldValidationOracle.target || fieldValidationOracle.target !== expectedTarget) unsupported.push(`step_${step.index}:field_validation_oracle_unbacked`);
      else lines.push(`  await assertJiraSpecFieldValidation(page, ${quote(fieldValidationOracle.target)}, ${step.timeoutMs ?? 15000});`);
    } else if (step.action === "assertVisible" && (input.sourceScenario.observableOracles ?? []).some(oracle => oracle.stepIndex === step.index && oracle.polarity === "negative")) {
      const oracle = input.sourceScenario.observableOracles!.find(item=>item.stepIndex === step.index && item.polarity === "negative")!;
      if (!oracle.backed || !oracle.target || !step.target || typeof step.target !== "object" || step.target.strategy !== "text" || step.target.value !== oracle.target) unsupported.push(`step_${step.index}:absence_oracle_unbacked`);
      else lines.push(`  await assertJiraSpecAbsentText(page, ${quote(oracle.target)});`);
    } else if (step.action === "assertVisible" && oracleAuthGate) {
      lines.push(`  await assertJiraSpecAuthGate(page);`);
    } else if (step.action === "assertVisible" || step.action === "assertText") {
      const expected = step.action === "assertText"
        ? step.expected ?? step.value
        : step.target && typeof step.target === "object" ? step.target.value ?? step.target.name : undefined;
      if (!expected) unsupported.push(`step_${step.index}:assertion_expected_text_missing`);
      else lines.push(`  await assertJiraSpecVisibleText(page, ${quote(expected)}, ${step.timeoutMs ?? 15000}${step.description?.trim() ? `, ${quote(step.description.trim())}` : ""});`);
    } else if (["click", "fill", "select", "press", "check", "uncheck", "waitFor"].includes(step.action)) {
      if (!targetJson) { unsupported.push(`step_${step.index}:target_missing`); continue; }
      const segmentedCode = step.action === "fill" && step.target && typeof step.target === "object"
        && step.target.strategy === "semantic" && step.target.metadata?.repairType === "jira_segmented_code";
      if (segmentedCode) {
        if (!step.valueKey) { unsupported.push(`step_${step.index}:value_key_missing`); continue; }
        lines.push(`  const value${step.index} = await resolveJiraSpecValue(${quote(step.valueKey)}, appSlug, sectionSlug, automationId);`);
        lines.push(`  await fillJiraSpecSegmentedCode(page, value${step.index}, ${targetJson});`);
        lines.push(`  await reportJiraSpecStepComplete(page, testInfo, ${step.index}, false, ${isFinalStep});`);
        lines.push("");
        emitAuthAfter(step.index);
        continue;
      }
      const semanticIntent = step.description?.trim();
      if (step.action === "click") {
        lines.push(`  await clickJiraSpecTarget(page, ${targetJson}${semanticIntent ? `, 2500, ${quote(semanticIntent)}` : ""});`);
        lines.push(`  await reportJiraSpecStepComplete(page, testInfo, ${step.index}, true, ${isFinalStep});`);
        lines.push("");
        emitAuthAfter(step.index);
        continue;
      }
      lines.push(`  const ${targetVar} = await resolveJiraSpecTarget(page, ${targetJson}${semanticIntent ? `, 2500, ${quote(semanticIntent)}` : ""});`);
      if (step.action === "fill") {
        if (!step.valueKey) { unsupported.push(`step_${step.index}:value_key_missing`); continue; }
        lines.push(`  const value${step.index} = await resolveJiraSpecValue(${quote(step.valueKey)}, appSlug, sectionSlug, automationId);`);
        lines.push(`  await ${targetVar}.fill(value${step.index});`);
        lines.push(`  if (await ${targetVar}.inputValue() !== value${step.index}) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");`);
      } else if (step.action === "select") {
        if (!step.valueKey) { unsupported.push(`step_${step.index}:value_key_missing`); continue; }
        lines.push(`  const value${step.index} = await resolveJiraSpecValue(${quote(step.valueKey)}, appSlug, sectionSlug, automationId);`);
        lines.push(`  await performJiraSpecSelection(${targetVar}, value${step.index});`);
      } else if (step.action === "press") {
        if (!step.value) { unsupported.push(`step_${step.index}:press_key_missing`); continue; }
        lines.push(`  await ${targetVar}.press(${quote(step.value)});`);
      } else if (step.action === "check") lines.push(`  await ${targetVar}.check();`);
      else if (step.action === "uncheck") lines.push(`  await ${targetVar}.uncheck();`);
      else if (step.action === "waitFor") lines.push(`  await expect(${targetVar}).toBeVisible({ timeout: ${step.timeoutMs ?? 15000} });`);
    } else if (step.action === "assertUrl") {
      const expected = step.expected ?? (step.target && typeof step.target === "object" ? step.target.value : undefined);
      if (!expected) unsupported.push(`step_${step.index}:assertion_url_missing`);
      else lines.push(`  await expect(page).toHaveURL(${quote(expected)});`);
    } else if (step.action === "screenshot" || step.action === "noop") {
      if (step.action === "screenshot") lines.push(`  await page.screenshot({ fullPage: true });`);
    } else {
      unsupported.push(`step_${step.index}:action_unsupported:${step.action}`);
    }
    const captureScreen = ["navigate", "select", "check", "uncheck", "screenshot"].includes(step.action);
    lines.push(`  await reportJiraSpecStepComplete(page, testInfo, ${step.index}, ${captureScreen}, ${isFinalStep});`);
    lines.push("");
    emitAuthAfter(step.index);
  }
  if (authPath && !authEmitted && input.sourceScenario.auth?.insertionAfterStepIndex !== undefined) {
    unsupported.push(`auth_flow_insertion_step_not_emitted:${input.sourceScenario.auth.insertionAfterStepIndex}`);
  }
  lines.push("});", "");
  return { source: lines.join("\n"), unsupported };
}
