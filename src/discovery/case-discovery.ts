import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { createAIExplorer, type AIExplorer } from "../ai/ai-explorer";
import { scanCurrentPage } from "../explorer/page-scanner";
import { buildProposedObjects } from "./proposed-object-builder";
import { waitForPageReady } from "../browser/page-readiness";
import {
  resolveActionTarget,
  resolveAssociatedActionTarget,
  clickResolvedTarget,
  resolveSnapshotElementLocator,
  shouldInvokeAiAssistedDiscovery,
  resolveFillTarget
} from "./target-resolver";
import { resolveLoginForm, type LoginFormResolution } from "./login-resolver";
import { runAiAssistedDiscovery, type AiAssistedDiscoveryConfig } from "./ai-assisted-discovery";
import {
  buildConcreteAssertionsFromExpected,
  resolveAssertionTargets,
  type AssertionTargetInput
} from "./assertion-resolver";
import {
  parseStepIntent,
  type ParsedStepIntent,
  type ActionTargetItem,
  type FillValueSource
} from "./step-intent-parser";
import type {
  CaseDiscoveryResult,
  DiscoveryStepResult,
  DiscoveredObject
} from "../types/discovery.types";
import type { TestScenario, TestScenarioStep } from "../types/testrail.types";
import type { ExecutionPlan, ExecutionPlanStep } from "../types/execution-plan.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { TestDataMap, TestDataValue } from "../types/env.types";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCleanTarget(action: string): { type: "click" | "assert" | "setup_route" | "skip" | "unknown"; target: string } {
  const intents = parseStepIntent(action);

  const setupIntent = intents.find((i) => i.type === "setup_route");
  if (setupIntent) {
    return { type: "setup_route", target: setupIntent.actionTarget ?? "" };
  }
  const clickIntent = intents.find((i) => i.type === "action_click" || i.type === "action_select");
  if (clickIntent?.actionTarget) {
    return { type: "click", target: clickIntent.actionTarget };
  }

  const assertIntent = intents.find((i) => i.type === "assertion");
  if (assertIntent?.actionTarget) {
    return { type: "assert", target: assertIntent.actionTarget };
  }

  return { type: "unknown", target: action };
}

export function extractAssertionTargets(expectedText: string): string[] {
  if (!expectedText) return [];

  const targets: string[] = [];
  const lines = expectedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Strip leading markdown list markers like "- " or "* "
    const clean = line.replace(/^[-*]\s+/, "").trim();
    if (clean) {
      targets.push(clean);
    }
  }

  return targets;
}

export type ExecutableStep = {
  stepIndex: number;
  originalText: string;
  type: "assertion" | "action_fill" | "action_click" | "action_select" | "optional_action" | "navigation_segment" | "skip";
  target?: string;
  value?: string;
  valueKey?: string;
  valueSource?: FillValueSource;
  isOptional?: boolean;
  source: "action" | "expected" | "expanded_nav";
};

export function parseScenarioStepsForDiscovery(scenario: TestScenario): {
  actionTargets: ActionTargetItem[];
  assertionTargets: AssertionTargetInput[];
  skippedActions: { index: number; action: string }[];
  setupIntents: ParsedStepIntent[];
  orderedSteps: ExecutableStep[];
} {
  const actionTargets: ActionTargetItem[] = [];
  const assertionTargets: AssertionTargetInput[] = [];
  const skippedActions: { index: number; action: string }[] = [];
  const setupIntents: ParsedStepIntent[] = [];
  const orderedSteps: ExecutableStep[] = [];

  const findExistingAssertionByTarget = (target: string): boolean =>
    assertionTargets.some((a) => a.source === "action" && normalizeText(a.target) === normalizeText(target));

  for (const step of scenario.steps) {
    const intents = parseStepIntent(step.action);

    for (const intent of intents) {
      if (intent.type === "precondition_context" || intent.type === "navigation_path" || intent.type === "setup_route") {
        setupIntents.push({ ...intent, originalText: step.action });
      } else if (intent.type === "setup_authentication") {
        setupIntents.push({ ...intent, originalText: step.action, priority: step.index });
      } else if (intent.type === "assertion" && intent.actionTarget && !intent.isOptional) {
        orderedSteps.push({
          stepIndex: step.index,
          originalText: step.action,
          type: "assertion",
          target: intent.actionTarget,
          source: "action"
        });
        assertionTargets.push({
          index: step.index,
          action: step.action,
          target: intent.actionTarget,
          source: "action"
        });
      } else if (intent.type === "unknown") {
        assertionTargets.push({
          index: step.index,
          action: step.action,
          target: intent.originalText,
          source: "action"
        });
      } else if (intent.actionTarget) {
        let targetText = intent.actionTarget;
        let associatedEntity = intent.associatedEntity;

        // composite_action: target the action button, not the product name
        if (intent.type === "composite_action") {
          if (intent.actionVerb === "add_to_cart") {
            targetText = "Add to cart";
          } else if (intent.actionVerb?.startsWith("remove")) {
            targetText = "Remove";
          }
          associatedEntity = intent.associatedEntity ?? intent.actionTarget;
        }

        const item: ActionTargetItem = {
          index: step.index,
          action: step.action,
          target: targetText,
          isOptional: intent.isOptional,
          associatedEntity,
          actionType: intent.type,
          semanticRole: intent.semanticRole,
          relationContext: intent.relationContext
        };
        if (intent.valueSource === "test_data" || intent.valueSource === "literal") {
          item.valueSource = intent.valueSource;
          if (intent.valueKey) item.valueKey = intent.valueKey;
          if (intent.value) item.value = intent.value;
        }
        actionTargets.push(item);
        orderedSteps.push({
          stepIndex: step.index,
          originalText: step.action,
          type: intent.isOptional ? "optional_action" : (intent.type === "action_fill" ? "action_fill" : intent.type === "action_select" ? "action_select" : "action_click"),
          target: targetText,
          valueKey: intent.valueKey,
          value: intent.value,
          valueSource: item.valueSource,
          isOptional: intent.isOptional,
          source: "action"
        });
      }
    }
  }

  if (scenario.steps.length > 0) {
    const lastStep = scenario.steps[scenario.steps.length - 1];
    if (lastStep.expected) {
      const expectedTargets = extractAssertionTargets(lastStep.expected);
      const concreteTargets = buildConcreteAssertionsFromExpected(expectedTargets);
      for (const target of concreteTargets) {
        if (findExistingAssertionByTarget(target)) {
          continue;
        }
        assertionTargets.push({ index: lastStep.index, action: target, target, source: "expected" });
        orderedSteps.push({
          stepIndex: lastStep.index,
          originalText: target,
          type: "assertion",
          target,
          source: "expected"
        });
      }
    }
  }

  return { actionTargets, assertionTargets, skippedActions, setupIntents, orderedSteps };
}

type PageState = {
  url: string;
  bodyText: string;
  elementCount: number;
};

async function capturePageState(page: Page): Promise<PageState> {
  const url = page.url();
  const bodyText = await page.evaluate(() => {
    return (document.body?.textContent ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  });
  const elementCount = await page.evaluate(() => document.querySelectorAll("*").length);
  return { url, bodyText, elementCount };
}

export function evaluateEarlyCompletion(
  snapshot: PageSnapshot,
  assertionTargets: AssertionTargetInput[],
  remainingActionTargets: ActionTargetItem[]
): {
  checked: boolean;
  satisfied: boolean;
  satisfiedAssertions: string[];
  pendingAssertions: string[];
  blockingAssertions: string[];
  skippedAssertions: string[];
  weakSignals: string[];
  skippedReason?: string;
  skippedRemainingActions: number;
} {
  if (assertionTargets.length === 0) {
    return { checked: false, satisfied: false, satisfiedAssertions: [], pendingAssertions: [], blockingAssertions: [], skippedAssertions: [], weakSignals: [], skippedRemainingActions: 0 };
  }

  const resolutionResults = resolveAssertionTargets(snapshot, assertionTargets);
  
  const satisfiedAssertions: string[] = [];
  const pendingAssertions: string[] = [];
  const skippedAssertions: string[] = [];
  const weakSignals: string[] = [];

  for (let i = 0; i < resolutionResults.length; i++) {
    const res = resolutionResults[i];
    const input = assertionTargets[i];
    const isExpectedSource = input?.source === "expected";

    const isWeakDescriptor = (isExpectedSource && (
      res.classification === "semantic_descriptor" ||
      res.classification === "expected_only" ||
      res.classification === "ambiguous_assertion" ||
      res.classification === "composite_assertion"
    )) || res.isWeakSignal === true;

    const isSkippable = (res.status === "skipped_semantic_descriptor") || isWeakDescriptor;

    const isMandatory = !isSkippable && (
      res.classification === "literal_observable" ||
      res.classification === "structural_assertion" ||
      res.classification === "composite_assertion" ||
      res.classification === "semantic_descriptor"
    );

    if (res.status === "passed" || res.status === "satisfied_by_children") {
      satisfiedAssertions.push(res.assertionText);
    } else if (isSkippable) {
      skippedAssertions.push(res.assertionText);
      if ((res as any).isWeakSignal) {
        weakSignals.push(res.assertionText);
      }
    } else if (isMandatory) {
      pendingAssertions.push(res.assertionText);
    }
  }

  const SENSITIVE_VERBS = ["pagar", "comprar", "submit", "enviar", "confirmar", "delete", "eliminar", "borrar", "guardar", "save", "finalizar", "completar"];
  const hasSensitiveActionsRemaining = remainingActionTargets.some(a => 
    SENSITIVE_VERBS.some(v => a.action.toLowerCase().includes(v))
  );

  let satisfied = pendingAssertions.length === 0 && satisfiedAssertions.length > 0;
  
  if (hasSensitiveActionsRemaining && satisfied) {
    const explicitMandatorySatisfied = resolutionResults.some(res => 
      (res.classification === "literal_observable" || res.classification === "structural_assertion" || res.classification === "composite_assertion" || res.classification === "semantic_descriptor") &&
      (res.status === "passed" || res.status === "satisfied_by_children")
    );
    if (!explicitMandatorySatisfied) {
      satisfied = false;
    }
  }

  const allSkippedAreWeak = skippedAssertions.length > 0 && weakSignals.length === skippedAssertions.length;
  const skippedReason = skippedAssertions.length > 0
    ? allSkippedAreWeak ? "synthetic_generic_descriptor" : "mixed_descriptors"
    : undefined;

  return {
    checked: true,
    satisfied,
    satisfiedAssertions,
    pendingAssertions,
    blockingAssertions: pendingAssertions,
    skippedAssertions,
    weakSignals,
    skippedReason,
    skippedRemainingActions: remainingActionTargets.length
  };
}

function hasPageTransition(before: PageState, after: PageState, targetText: string): boolean {
  if (before.url !== after.url) {
    return true;
  }

  const normalizedTarget = normalizeText(targetText);
  const targetDisappeared = !after.bodyText.includes(normalizedTarget);
  if (targetDisappeared) {
    return true;
  }

  const bodyDiffRatio = computeTextDiffRatio(before.bodyText, after.bodyText);
  if (bodyDiffRatio > 0.05) {
    return true;
  }

  if (Math.abs(before.elementCount - after.elementCount) > 5) {
    return true;
  }

  return false;
}

function computeTextDiffRatio(text1: string, text2: string): number {
  const maxLen = Math.max(text1.length, text2.length);
  if (maxLen === 0) return 0;

  let diffChars = 0;
  const len = Math.max(text1.length, text2.length);
  for (let i = 0; i < len; i++) {
    if (text1[i] !== text2[i]) {
      diffChars++;
    }
  }

  return diffChars / maxLen;
}

async function scanAndCollectObjects(
  page: Page,
  stepIndex: number,
  evidenceDir: string
): Promise<{ elementsCount: number; objects: DiscoveredObject[]; url: string; title: string; snapshot: PageSnapshot }> {
  const snapshot = await scanCurrentPage(page);
  const candidates = buildProposedObjects(snapshot.elements);

  const objects: DiscoveredObject[] = [];
  for (const c of candidates) {
    if (c.confidence >= 0.5) {
      objects.push({
        key: c.key,
        name: c.name,
        type: c.type,
        locator: c.locator,
        aliases: [c.name.toLowerCase()],
        discoveredAt: new Date().toISOString(),
        sourceStep: stepIndex,
        confidence: c.confidence
      });
    }
  }

  const evidencePath = path.join(evidenceDir, `step-${stepIndex}-snapshot.json`);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(evidencePath, JSON.stringify(snapshot, null, 2), "utf-8");

  return {
    elementsCount: snapshot.elements.length,
    objects,
    url: snapshot.url,
    title: snapshot.title,
    snapshot
  };
}

export type CaseDiscoveryOptions = {
  page: Page;
  scenario: TestScenario;
  evidenceDir: string;
  pendingObjectsPath: string;
  pendingPlansPath: string;
  appBaseUrl: string;
  testData?: TestDataMap;
  loginAction?: () => Promise<void>;
  aiAssistedDiscovery?: {
    explorer?: AIExplorer;
    config?: Partial<AiAssistedDiscoveryConfig>;
  };
};

const DEFAULT_AI_ASSISTED_DISCOVERY_CONFIG: AiAssistedDiscoveryConfig = {
  enabled: false,
  confidenceThreshold: 0.85,
  requireApprovalThreshold: 0.7,
  maxAttempts: 3,
  sensitiveActions: ["fill", "select"]
};

function getAiConstraints(): string[] {
  return [
    "forbid external systems such as Jira",
    "forbid stable registry mutation",
    "disallow invented elements outside snapshot",
    "disallow bypassing framework validations"
  ];
}

function buildFailureResult(
  scenario: TestScenario,
  steps: DiscoveryStepResult[],
  discoveredObjects: DiscoveredObject[],
  planSteps: ExecutionPlanStep[],
  pendingObjectsPath: string,
  pendingPlansPath: string,
  evidenceDir: string,
  failedAtStep: number,
  failedTarget: string,
  failedReason: string,
  allDiscoveredObjects: DiscoveredObject[]
): CaseDiscoveryResult {
  const partialPlan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "needs_discovery",
    scenario: {
      source: "testrail",
      externalId: scenario.externalId,
      caseId: scenario.caseId,
      title: scenario.title
    },
    requiredData: [],
    steps: planSteps,
    notes: [`Discovery failed at step ${failedAtStep}: ${failedReason} - "${failedTarget}"`],
    createdAt: new Date().toISOString()
  };

  return {
    version: "1.0",
    caseId: scenario.caseId,
    caseTitle: scenario.title,
    discoveredAt: new Date().toISOString(),
    status: "exploration_failed",
    steps,
    discoveredObjects: allDiscoveredObjects,
    candidatePlan: partialPlan,
    pendingObjectsPath,
    pendingPlansPath,
    evidenceDir,
    failedAtStep,
    failedTarget,
    failedReason
  };
}

export async function runCaseDiscovery(options: CaseDiscoveryOptions): Promise<CaseDiscoveryResult> {
  const { page, scenario, evidenceDir, pendingObjectsPath, pendingPlansPath, appBaseUrl, testData, loginAction } = options;
  const aiConfig: AiAssistedDiscoveryConfig = {
    ...DEFAULT_AI_ASSISTED_DISCOVERY_CONFIG,
    ...options.aiAssistedDiscovery?.config
  };
  const aiExplorer = options.aiAssistedDiscovery?.explorer ?? createAIExplorer();

  const steps: DiscoveryStepResult[] = [];
  const allDiscoveredObjects: DiscoveredObject[] = [];
  const planSteps: ExecutionPlanStep[] = [];
  let failedAtStep: number | undefined;
  let failedTarget: string | undefined;
  let failedReason: string | undefined;
  let earlyCompletionSatisfied = false;

  await mkdir(evidenceDir, { recursive: true });

  planSteps.push({
    index: planSteps.length + 1,
    action: "navigate",
    description: `Navigate to ${appBaseUrl}`,
    target: "APP_BASE_URL"
  });

  if (loginAction) {
    planSteps.push({
      index: planSteps.length + 1,
      action: "login",
      description: "Execute login"
    });
  }

  await page.goto(appBaseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });

  const initialScan = await scanAndCollectObjects(page, 0, evidenceDir);
  allDiscoveredObjects.push(...initialScan.objects);

  const parsed = parseScenarioStepsForDiscovery(scenario);
  console.log(`[discovery:case] Parsed action targets: ${parsed.actionTargets.map((t) => t.target).join(", ")}`);
  console.log(`[discovery:case] Parsed assertion targets: ${parsed.assertionTargets.map((t) => t.target).join(", ")}`);

  if (parsed.setupIntents.length > 0) {
    for (const si of parsed.setupIntents) {
      if (si.type === "navigation_path" && si.path) {
        console.log(`[discovery:case] Parsed setup route (navigation): ${si.path.join(" > ")}`);
      } else if (si.type === "precondition_context") {
        console.log(`[discovery:case] Parsed setup route (context): ${si.context}`);
      } else if (si.type === "setup_route") {
        const target = si.actionTarget === "APP_BASE_URL" ? appBaseUrl : si.actionTarget ?? appBaseUrl;
        console.log(`[discovery:case] Setup route detected: using ${target}`);
      }
    }
  }

  const expandedActionTargets = [...parsed.actionTargets];

  for (const si of parsed.setupIntents) {
    if (si.type === "navigation_path" && si.path) {
      const navTargets = si.path.map((segment, idx) => ({
        index: si.priority + idx,
        action: `Navigate: ${segment}`,
        target: segment
      }));
      expandedActionTargets.unshift(...navTargets);
    }
  }

  if (parsed.skippedActions.length > 0) {
    for (const skipped of parsed.skippedActions) {
      console.log(`[discovery:case] Skipping: ${skipped.action}`);
      steps.push({ index: skipped.index, action: skipped.action, status: "skipped" });
    }
  }

  const orderedItems: Array<{
    index: number;
    type: "action" | "assertion" | "nav_segment";
    actionTarget?: ActionTargetItem;
    executableStep?: ExecutableStep;
    navTarget?: { target: string; action: string };
  }> = [];

  for (const si of parsed.setupIntents) {
    if (si.type === "navigation_path" && si.path) {
      si.path.forEach((segment, idx) => {
        orderedItems.push({
          index: si.priority + idx,
          type: "nav_segment",
          navTarget: { target: segment, action: `Navigate: ${segment}` }
        });
      });
    }
  }

  for (const at of expandedActionTargets) {
    orderedItems.push({ index: at.index, type: "action", actionTarget: at });
  }

  for (const es of parsed.orderedSteps) {
    if (es.type === "assertion" || es.type === "optional_action") {
      orderedItems.push({ index: es.stepIndex, type: "assertion", executableStep: es });
    }
  }

  orderedItems.sort((a, b) => a.index - b.index || 0);

  let currentSnapshot = initialScan.snapshot;

  // --- Execute setup_authentication (login) intents ---
  for (const si of parsed.setupIntents) {
    if (si.type !== "setup_authentication") continue;

    const keys = si.valueKeys ?? [];
    const key1 = keys[0] ?? si.valueKey ?? "usuario_valido";
    const key2 = keys[1] ?? "contrasena_valida";

    const testDataMap = testData ?? {};
    const value1 = key1 in testDataMap ? String(testDataMap[key1]) : undefined;
    const value2 = key2 in testDataMap ? String(testDataMap[key2]) : undefined;

    if (!value1 || !value2) {
      const missingKeys = [];
      if (!value1) missingKeys.push(`"${key1}"`);
      if (!value2) missingKeys.push(`"${key2}"`);
      const errorMsg = `Missing test data value for key(s): ${missingKeys.join(", ")}`;

      console.log(`[discovery:case] Setup auth failed: ${errorMsg}`);
      steps.push({
        index: si.priority,
        action: si.originalText,
        status: "not_found",
        targetText: si.originalText,
        error: errorMsg
      });
      failedAtStep = si.priority;
      failedTarget = si.originalText;
      failedReason = "missing_test_data";

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      ).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      );
    }

    console.log(`[discovery:case] Resolving login form for setup authentication...`);
    const loginForm = await resolveLoginForm(page, currentSnapshot, keys);

    if (loginForm.status === "needs_setup_resolution") {
      console.log(`[discovery:case] Login form resolution failed: ${loginForm.diagnosis}`);
      steps.push({
        index: si.priority,
        action: si.originalText,
        status: "needs_setup_resolution",
        targetText: si.originalText,
        error: loginForm.diagnosis,
        attemptedLocators: loginForm.fields.map((f) => f.strategy)
      });
      failedAtStep = si.priority;
      failedTarget = si.originalText;
      failedReason = "needs_setup_resolution";

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      ).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      );
    }

    if (loginForm.confidence < 0.4) {
      console.log(`[discovery:case] Login form confidence too low: ${loginForm.confidence}`);
      steps.push({
        index: si.priority,
        action: si.originalText,
        status: "needs_setup_resolution",
        targetText: si.originalText,
        error: `Login form confidence too low (${loginForm.confidence.toFixed(2)}). ${loginForm.diagnosis}`
      });
      failedAtStep = si.priority;
      failedTarget = si.originalText;
      failedReason = "needs_setup_resolution";

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      ).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      );
    }

    if (loginForm.userField) {
      console.log(`[discovery:case] Login: filling user field with "${value1}"`);
      try {
        await loginForm.userField.locator.fill(value1);
      } catch (err) {
        steps.push({
          index: si.priority,
          action: si.originalText,
          status: "not_found",
          targetText: si.originalText,
          error: `Failed to fill user field: ${err instanceof Error ? err.message : String(err)}`
        });
        failedAtStep = si.priority;
        failedTarget = si.originalText;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: `Login: fill user field (key: ${key1})`,
        target: { strategy: "login_resolver" as any, value: loginForm.userField.matchedText, exact: false }
      });
    }

    if (loginForm.passwordField) {
      console.log(`[discovery:case] Login: filling password field`);
      try {
        await loginForm.passwordField.locator.fill(value2);
      } catch (err) {
        steps.push({
          index: si.priority,
          action: si.originalText,
          status: "not_found",
          targetText: si.originalText,
          error: `Failed to fill password field: ${err instanceof Error ? err.message : String(err)}`
        });
        failedAtStep = si.priority;
        failedTarget = si.originalText;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: `Login: fill password field (key: ${key2})`,
        target: { strategy: "login_resolver" as any, value: "password", exact: false }
      });
    }

    if (loginForm.submitButton) {
      console.log(`[discovery:case] Login: clicking submit button "${loginForm.submitButton.text}"`);
      try {
        await loginForm.submitButton.locator.click();
      } catch (err) {
        steps.push({
          index: si.priority,
          action: si.originalText,
          status: "not_found",
          targetText: si.originalText,
          error: `Failed to click login submit button: ${err instanceof Error ? err.message : String(err)}`
        });
        failedAtStep = si.priority;
        failedTarget = si.originalText;
        failedReason = "click_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: `Login: click submit`,
        target: { strategy: "login_resolver" as any, value: loginForm.submitButton.text, exact: false }
      });
    }

    await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
    const loginScan = await scanAndCollectObjects(page, si.priority, evidenceDir);
    currentSnapshot = loginScan.snapshot;
    allDiscoveredObjects.push(...loginScan.objects);

    steps.push({
      index: si.priority,
      action: si.originalText,
      status: "found",
      targetText: si.originalText,
      snapshotUrl: loginScan.url,
      snapshotTitle: loginScan.title,
      elementsFound: loginScan.elementsCount,
      evidencePath: path.join(evidenceDir, `step-${si.priority}-snapshot.json`)
    });

    console.log(`[discovery:case] Setup authentication completed successfully.`);
  }

  for (const orderedItem of orderedItems) {
    if (orderedItem.type === "assertion") {
      const es = orderedItem.executableStep!;
      if (es.isOptional) {
        console.log(`[discovery:case] Skipping optional assertion: ${es.target}`);
        steps.push({
          index: es.stepIndex,
          action: es.originalText,
          status: "skipped",
          targetText: es.target,
          error: `Optional assertion skipped.`
        });
        continue;
      }

      const assertionTargetInputs: AssertionTargetInput[] = [{
        index: es.stepIndex,
        action: es.originalText,
        target: es.target ?? "",
        source: "action"
      }];

      const resolutionResults = resolveAssertionTargets(currentSnapshot, assertionTargetInputs);
      for (const assertionResult of resolutionResults) {
        const mappedStatus: DiscoveryStepResult["status"] =
          assertionResult.status === "passed"
            ? "found"
            : assertionResult.status === "satisfied_by_children"
              ? "satisfied_by_children"
              : assertionResult.status === "skipped_semantic_descriptor"
                ? "skipped_semantic_descriptor"
                : assertionResult.status === "needs_assertion_resolution"
                  ? "needs_assertion_resolution"
                  : "not_found";

        steps.push({
          index: es.stepIndex,
          action: es.originalText,
          status: mappedStatus,
          targetText: assertionResult.assertionText,
          evidencePath: path.join(evidenceDir, `step-${es.stepIndex}-assertion.json`),
          assertionClassification: assertionResult.classification,
          assertionStatus: assertionResult.status,
          matchedText: assertionResult.matchedText,
          confidence: assertionResult.confidence,
          error: assertionResult.status === "failed" || assertionResult.status === "needs_assertion_resolution" ? assertionResult.reason : undefined,
          closestCandidates: assertionResult.closestCandidates,
          visibleTexts: assertionResult.visibleTexts,
          descriptorTypes: assertionResult.descriptorTypes,
          subject: assertionResult.subject,
          matchedTokens: assertionResult.matchedTokens,
          structuralSignals: assertionResult.structuralSignals,
          childAssertionsUsed: assertionResult.childAssertionsUsed
        });

        if (assertionResult.status === "passed" && assertionResult.classification === "literal_observable") {
          planSteps.push({
            index: planSteps.length + 1,
            action: "assertText",
            description: `Assert: ${assertionResult.assertionText}`,
            target: { strategy: "text", value: assertionResult.assertionText, exact: false },
            expected: assertionResult.assertionText
          });
        } else if (assertionResult.status === "failed" || assertionResult.status === "needs_assertion_resolution") {
          if (!failedAtStep && es.source === "action") {
            failedAtStep = es.stepIndex;
            failedTarget = assertionResult.assertionText;
            failedReason = assertionResult.status === "needs_assertion_resolution"
              ? "needs_assertion_resolution"
              : "assertion_not_found";
          }
        }
      }
      continue;
    }

    if (orderedItem.type === "nav_segment") {
      const nav = orderedItem.navTarget!;
      console.log(`[discovery:case] Resolving nav segment: ${nav.target}`);
      const resolution = await resolveActionTarget(page, currentSnapshot, nav.target);
      if (resolution.status !== "resolved" || !resolution.locator) {
        console.log(`[discovery:case] Nav segment not found: ${nav.target}`);
        steps.push({
          index: orderedItem.index,
          action: nav.action,
          status: "not_found",
          targetText: nav.target,
          error: `Nav segment target "${nav.target}" not found`
        });
        failedAtStep = orderedItem.index;
        failedTarget = nav.target;
        failedReason = "target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      await clickResolvedTarget(resolution.locator, false);
      await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
      const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
      currentSnapshot = scan.snapshot;
      allDiscoveredObjects.push(...scan.objects);

      steps.push({
        index: orderedItem.index,
        action: nav.action,
        status: "found",
        targetText: nav.target,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        evidencePath: path.join(evidenceDir, `step-${orderedItem.index}-snapshot.json`)
      });

      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: nav.action,
        target: { strategy: "text", value: nav.target, exact: false }
      });
      continue;
    }

    const actionTarget = orderedItem.actionTarget!;
    if (actionTarget.valueSource === "test_data" && actionTarget.valueKey) {
      console.log(`[discovery:case] Resolving fill target: ${actionTarget.target}`);
      console.log(`[discovery:case] Using test data key: ${actionTarget.valueKey}`);

      const testDataMap = testData ?? {};
      if (!(actionTarget.valueKey in testDataMap)) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Missing test data value for key "${actionTarget.valueKey}"`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "missing_test_data";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      const rawValue = testDataMap[actionTarget.valueKey] as TestDataValue;
      const fillValue = String(rawValue);

      const resolution = await resolveFillTarget(page, currentSnapshot, actionTarget.target);

      if (resolution.status === "not_found") {
        if (actionTarget.isOptional) {
          console.log(`[discovery:case] Optional fill target not found, skipping: ${actionTarget.target}`);
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "skipped",
            targetText: actionTarget.target,
            error: `Optional fill target "${actionTarget.target}" not found on current page.`
          });
          continue;
        }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill target "${actionTarget.target}" not found on current page. ${resolution.editableCandidatesCount} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "not_editable") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const nonEditable = resolution.nonEditableMatch;
        const errorMsg = nonEditable
          ? `Fill target "${actionTarget.target}" matched non-editable element <${nonEditable.tag}>: "${nonEditable.text}". ${resolution.editableCandidatesCount} editable candidates evaluated.`
          : `Fill target "${actionTarget.target}" matched non-editable element. ${resolution.editableCandidatesCount} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_editable",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: resolution.attemptedLocators,
          matchedText: nonEditable?.text
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_editable";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      console.log(`[discovery:case] Filling target: ${actionTarget.target} (strategy: ${resolution.locatorStrategy}, confidence: ${resolution.confidence.toFixed(2)})`);

      try {
        await resolution.locator!.fill(fillValue);
      } catch (err) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Fill failed: ${err instanceof Error ? err.message : String(err)}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = scan.snapshot;
      allDiscoveredObjects.push(...scan.objects);

      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "found",
        targetText: actionTarget.target,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
        semanticRole: actionTarget.semanticRole,
        relationContext: actionTarget.relationContext
      });

      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: actionTarget.action,
        target: { strategy: "text", value: actionTarget.target, exact: false }
      });

      continue;
    }

    if (actionTarget.valueSource === "literal" && actionTarget.value) {
      console.log(`[discovery:case] Resolving fill target: ${actionTarget.target}`);
      console.log(`[discovery:case] Using literal value: ${actionTarget.value}`);

      const resolution = await resolveFillTarget(page, currentSnapshot, actionTarget.target);

      if (resolution.status === "not_found") {
        if (actionTarget.isOptional) {
          console.log(`[discovery:case] Optional fill target not found, skipping: ${actionTarget.target}`);
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "skipped",
            targetText: actionTarget.target,
            error: `Optional fill target "${actionTarget.target}" not found on current page.`
          });
          continue;
        }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill target "${actionTarget.target}" not found on current page. ${resolution.editableCandidatesCount} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "not_editable") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const nonEditable = resolution.nonEditableMatch;
        const errorMsg = nonEditable
          ? `Fill target "${actionTarget.target}" matched non-editable element <${nonEditable.tag}>: "${nonEditable.text}". ${resolution.editableCandidatesCount} editable candidates evaluated.`
          : `Fill target "${actionTarget.target}" matched non-editable element. ${resolution.editableCandidatesCount} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_editable",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: resolution.attemptedLocators,
          matchedText: nonEditable?.text
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_editable";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      console.log(`[discovery:case] Filling target: ${actionTarget.target} (strategy: ${resolution.locatorStrategy}, confidence: ${resolution.confidence.toFixed(2)})`);

      try {
        await resolution.locator!.fill(actionTarget.value);
      } catch (err) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Fill failed: ${err instanceof Error ? err.message : String(err)}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = scan.snapshot;
      allDiscoveredObjects.push(...scan.objects);

      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "found",
        targetText: actionTarget.target,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
        semanticRole: actionTarget.semanticRole,
        relationContext: actionTarget.relationContext
      });

      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: actionTarget.action,
        target: { strategy: "text", value: actionTarget.target, exact: false }
      });

      continue;
    }

    if (actionTarget.associatedEntity) {
      console.log(`[discovery:case] Resolving associated target: ${actionTarget.target} (entity: ${actionTarget.associatedEntity})`);

      const associatedResolution = await resolveAssociatedActionTarget(page, currentSnapshot, actionTarget.target, actionTarget.associatedEntity);
      const diag = associatedResolution.diagnostics;

      if (associatedResolution.status === "resolved") {
        console.log(`[discovery:case] Associated target resolved: ${actionTarget.target} (strategy: ${associatedResolution.locatorStrategy}, confidence: ${associatedResolution.confidence.toFixed(2)})`);

        try {
          await clickResolvedTarget(associatedResolution.locator!, false);
        } catch {
          try {
            await clickResolvedTarget(associatedResolution.locator!, true);
          } catch (err) {
            const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = scan.snapshot;
            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "not_found",
              targetText: actionTarget.target,
              snapshotUrl: scan.url,
              snapshotTitle: scan.title,
              elementsFound: scan.elementsCount,
              error: `Associated action click failed: ${err instanceof Error ? err.message : String(err)}`,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
            });
            failedAtStep = actionTarget.index;
            failedTarget = actionTarget.target;
            failedReason = "click_failed";
            await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
            await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects).candidatePlan ?? {}, null, 2), "utf-8");
            return buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects);
          }
        }

        await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        allDiscoveredObjects.push(...scan.objects);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext
        });

        planSteps.push({
          index: planSteps.length + 1,
          action: "click",
          description: `${actionTarget.action} [associated: ${actionTarget.associatedEntity}]`,
          target: { strategy: associatedResolution.locatorStrategy as any, value: actionTarget.target, exact: false }
        });

        continue;
      }

      // Associated resolution failed
      let failedReasonText = associatedResolution.status;
      let errorMsg = `Associated target resolution failed: ${associatedResolution.matchReason}. Action "${actionTarget.target}" with entity "${actionTarget.associatedEntity}".`;
      if (diag.candidateContainers.length > 0) {
        errorMsg += ` Containers: [${diag.candidateContainers.slice(0, 3).map((c) => `${c.tagName}(${c.entityMatchText.slice(0, 30)})`).join(", ")}]`;
      }
      if (diag.candidateActions.length > 0) {
        errorMsg += ` Actions: [${diag.candidateActions.slice(0, 3).map((a) => `"${a.actionText}"(${a.combinedScore.toFixed(2)})`).join(", ")}]`;
      }
      if (diag.reason) {
        errorMsg += ` ${diag.reason}`;
      }

      const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = scan.snapshot;

      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "not_found",
        targetText: actionTarget.target,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        error: errorMsg,
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
      });

      failedAtStep = actionTarget.index;
      failedTarget = actionTarget.target;
      failedReason = associatedResolution.status === "needs_associated_target_resolution" ? "needs_associated_target_resolution" : (associatedResolution.status === "associated_entity_not_found" ? "associated_entity_not_found" : "associated_action_not_found");

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects);
    }

    console.log(`[discovery:case] Resolving target: ${actionTarget.target}`);

    const resolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
      semanticRole: actionTarget.semanticRole,
      relationContext: actionTarget.relationContext
    });

    if (resolution.status === "resolved" && resolution.confidence >= aiConfig.confidenceThreshold && resolution.locator) {
      console.log(`[discovery:case] Deterministic target resolved: ${actionTarget.target} (confidence: ${resolution.confidence.toFixed(2)})`);
    }

    const remainingActionTargets = parsed.actionTargets.filter(a => a.index >= actionTarget.index);
    const needsEarlyCompletionCheck =
      resolution.status === "not_found" ||
      resolution.status === "ambiguous" ||
      resolution.status === "locator_resolution_failed" ||
      resolution.confidence < aiConfig.confidenceThreshold;

    const earlyCompletion = evaluateEarlyCompletion(currentSnapshot, parsed.assertionTargets, remainingActionTargets);

    if (earlyCompletion.satisfied) {
      earlyCompletionSatisfied = true;
      console.log(`[discovery:case] Early completion satisfied at step ${actionTarget.index}. Skipping remaining actions.`);
      for (const rem of remainingActionTargets) {
        if (rem.index === actionTarget.index) {
          steps.push({
            index: rem.index,
            action: rem.action,
            status: "skipped_after_completion",
            targetText: rem.target,
            earlyCompletionDiagnostics: earlyCompletion,
            semanticRole: rem.semanticRole,
            relationContext: rem.relationContext,
            error: "Action skipped because early completion validated final assertions."
          });
        } else {
          steps.push({
            index: rem.index,
            action: rem.action,
            status: "skipped_after_completion",
            targetText: rem.target,
            error: "Skipped due to early completion validation passing."
          });
        }
      }
      break;
    }

    if (needsEarlyCompletionCheck && earlyCompletion.pendingAssertions.length > 0) {
      console.log(`[discovery:case] Early completion not satisfied at step ${actionTarget.index}. Pending: [${earlyCompletion.pendingAssertions.map(a => `"${a}"`).join(", ")}]. Satisfied: [${earlyCompletion.satisfiedAssertions.map(a => `"${a}"`).join(", ")}].`);
    }

    const aiDecision = shouldInvokeAiAssistedDiscovery({
      resolution,
      confidenceThreshold: aiConfig.confidenceThreshold,
      enabled: aiConfig.enabled
    });

    if (!aiDecision.shouldInvoke && resolution.status === "resolved" && resolution.confidence >= aiConfig.confidenceThreshold) {
      console.log(`[discovery:case] AI-assisted discovery skipped because deterministic confidence is sufficient.`);
    }

    if (aiDecision.shouldInvoke && aiDecision.reason) {
      console.log(`[discovery:case] AI-assisted discovery enabled. Trying AI fallback...`);
      const aiOutcome = await runAiAssistedDiscovery(
        {
          currentGoal: scenario.title,
          currentStep: actionTarget.action,
          target: actionTarget.target,
          snapshot: currentSnapshot,
          resolution,
          previousSteps: steps,
          allowedActions: ["click", "stop", "wait"],
          constraints: getAiConstraints(),
          triggerReason: aiDecision.reason,
          attempt: 1
        },
        {
          explorer: aiExplorer,
          config: aiConfig,
          executeProposal: async (proposal, element) => {
            if (proposal.action !== "click") {
              return {
                success: false,
                reason: `Framework only allows click proposals during case discovery. Received "${proposal.action}".`
              };
            }

            if (!element) {
              return { success: false, reason: "Snapshot candidate was not available for framework execution." };
            }

            const beforeSnapshot = currentSnapshot;
            const beforeState = await capturePageState(page);
            const resolvedElement = await resolveSnapshotElementLocator(page, {
              element,
              target: proposal.target,
              candidateText: element.text ?? element.label ?? element.name ?? element.placeholder ?? proposal.target,
              type: element.type,
              tagName: element.tagName,
              confidence: proposal.confidence,
              matchReason: proposal.reason
            });

            if (!resolvedElement.locator) {
              return {
                success: false,
                reason: `Framework could not resolve a DOM locator from the snapshot candidate. Attempted locators: ${resolvedElement.attemptedLocators.join(" | ")}`
              };
            }

            try {
              await clickResolvedTarget(resolvedElement.locator, false);
            } catch {
              try {
                await clickResolvedTarget(resolvedElement.locator, true);
              } catch (error) {
                return {
                  success: false,
                  reason: `Framework click failed: ${error instanceof Error ? error.message : String(error)}`
                };
              }
            }

            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            const afterState = await capturePageState(page);
            const transitionDetected = hasPageTransition(beforeState, afterState, proposal.target);
            const afterSnapshot = await scanCurrentPage(page);
            const evidencePath = path.join(evidenceDir, `step-${actionTarget.index}-ai-assisted.json`);

            await writeFile(
              evidencePath,
              JSON.stringify(
                {
                  triggerReason: aiDecision.reason,
                  proposal,
                  locatorStrategy: resolvedElement.locatorStrategy,
                  beforeSnapshot,
                  afterSnapshot,
                  transitionDetected,
                  beforeState,
                  afterState
                },
                null,
                2
              ),
              "utf-8"
            );

            return {
              success: transitionDetected,
              transitionDetected,
              evidencePath,
              beforeSnapshot,
              afterSnapshot,
              reason: transitionDetected ? undefined : "AI proposal executed but no transition or assertable change was detected."
            };
          }
        }
      );

      if (aiOutcome.status === "executed") {
        currentSnapshot = aiOutcome.execution.afterSnapshot ?? currentSnapshot;
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        allDiscoveredObjects.push(...scan.objects);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          evidencePath: aiOutcome.execution.evidencePath ?? path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiAssisted: true,
          aiProposal: aiOutcome.proposal,
          aiReason: aiDecision.reason,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext
        });

        planSteps.push({
          index: planSteps.length + 1,
          action: "click",
          description: `${actionTarget.action} [ai-assisted]`,
          target: { strategy: "text", value: actionTarget.target, exact: false }
        });

        continue;
      }

      if (aiOutcome.status === "ai_candidate_rejected" || aiOutcome.status === "needs_approval") {
        if (aiOutcome.reason && aiOutcome.reason.includes("did not return a proposal")) {
          console.log(`[discovery:case] AI explorer did not return a proposal.`);
        } else {
          console.log(`[discovery:case] AI explorer returned invalid proposal: ${aiOutcome.reason}`);
        }

        const originalReason = resolution.status === "not_found" ? "target_not_found" : resolution.status === "ambiguous" ? "ambiguous_target" : resolution.status;
        console.log(`[discovery:case] Keeping original failure reason: ${originalReason}.`);

        (resolution as any).aiDiagnostics = {
          attempted: true,
          result: aiOutcome.reason && aiOutcome.reason.includes("did not return a proposal") ? "no_proposal" : "invalid_proposal",
          proposal: aiOutcome.proposal
        };

        if (resolution.status === "resolved" && resolution.locator) {
          console.log(`[discovery:case] AI failed but deterministic locator exists. Using deterministic resolution.`);
          (resolution as any)._aiFailedDeterministicAvailable = true;
        }
      }
    }

    if (!(resolution as any)._aiFailedDeterministicAvailable) {
      if (resolution.status === "not_found") {
        if (actionTarget.isOptional) {
          console.log(`[discovery:case] Optional target not found, skipping: ${actionTarget.target}`);
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "skipped",
            targetText: actionTarget.target,
            error: `Optional target "${actionTarget.target}" not found on current page. ${resolution.candidates?.length ?? 0} candidates evaluated.`
          });
          continue;
        }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const diagnosis = (resolution as any)._diagnosis;
        let errorMsg = `Target "${actionTarget.target}" not found on current page. ${resolution.candidates?.length ?? 0} candidates evaluated.`;
        if (diagnosis && Array.isArray(diagnosis) && diagnosis.length > 0) {
          errorMsg += " Diagnosis: " + JSON.stringify(diagnosis);
        }

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          resolutionDiagnosis: diagnosis,
          aiDiagnostics: (resolution as any).aiDiagnostics,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext,
          earlyCompletionDiagnostics: earlyCompletion
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "ambiguous") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const ambiguousReason = actionTarget.associatedEntity
          ? `Ambiguous target: ${resolution.matchReason} (${resolution.candidates?.length ?? 0} matches). Target has associated entity "${actionTarget.associatedEntity}" that could disambiguate context.`
          : `Ambiguous target: ${resolution.matchReason} (${resolution.candidates?.length ?? 0} matches).`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: ambiguousReason,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiDiagnostics: (resolution as any).aiDiagnostics,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext,
          earlyCompletionDiagnostics: earlyCompletion
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = actionTarget.associatedEntity ? "needs_associated_target_resolution" : "ambiguous_target";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "locator_resolution_failed") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "locator_resolution_failed",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Semantic target matched, but DOM locator resolution failed. Attempted locators: ${(resolution.attemptedLocators ?? []).join(" | ")}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          resolutionDiagnosis: (resolution as typeof resolution & { _diagnosis?: unknown[] })._diagnosis,
          attemptedLocators: resolution.attemptedLocators,
          candidateId: resolution.candidateId,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext,
          earlyCompletionDiagnostics: earlyCompletion,
          candidateText: resolution.candidateText,
          aiDiagnostics: (resolution as any).aiDiagnostics
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "locator_resolution_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (!resolution.locator) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Target resolved but no locator found in DOM. Match reason: ${resolution.matchReason}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiDiagnostics: (resolution as any).aiDiagnostics
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "locator_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
    }

    if (resolution.status !== "resolved" || !resolution.locator) {
      continue;
    }

    console.log(`[discovery:case] Clicking target: ${actionTarget.target} (strategy: ${resolution.locatorStrategy}, confidence: ${resolution.confidence.toFixed(2)})`);

    const beforeState = await capturePageState(page);

    try {
      await clickResolvedTarget(resolution.locator, false);
    } catch {
      try {
        console.log(`[discovery:case] Retrying with force click...`);
        await clickResolvedTarget(resolution.locator, true);
      } catch (err) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Click failed: ${err instanceof Error ? err.message : String(err)}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiDiagnostics: (resolution as any).aiDiagnostics
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "click_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
    }

    await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
    console.log("[discovery:case] Waiting after click...");

    const afterState = await capturePageState(page);
    const transitionDetected = hasPageTransition(beforeState, afterState, actionTarget.target);

    console.log(`[discovery:case] Transition detected: ${transitionDetected ? "yes" : "no"}`);

    if (!transitionDetected) {
      console.log(`[discovery:case] Retrying with force click...`);
      try {
        await clickResolvedTarget(resolution.locator, true);
        await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });

        const afterRetryState = await capturePageState(page);
        const retryTransition = hasPageTransition(beforeState, afterRetryState, actionTarget.target);

        console.log(`[discovery:case] Transition after force click: ${retryTransition ? "yes" : "no"}`);

        if (!retryTransition) {
          console.log("[discovery:case] Click did not change page state.");

          const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = scan.snapshot;

          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "click_no_transition",
            targetText: actionTarget.target,
            snapshotUrl: scan.url,
            snapshotTitle: scan.title,
            elementsFound: scan.elementsCount,
            error: "Click completed but no page transition or DOM change was detected.",
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
            aiDiagnostics: (resolution as any).aiDiagnostics
          } as any);

          await writeFile(
            path.join(evidenceDir, `step-${actionTarget.index}-before.json`),
            JSON.stringify({ state: beforeState }, null, 2),
            "utf-8"
          );
          await writeFile(
            path.join(evidenceDir, `step-${actionTarget.index}-after.json`),
            JSON.stringify({ state: afterRetryState }, null, 2),
            "utf-8"
          );

          failedAtStep = actionTarget.index;
          failedTarget = actionTarget.target;
          failedReason = "click_no_transition";

          await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
          await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          ).candidatePlan ?? {}, null, 2), "utf-8");

          return buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          );
        }
      } catch {
        console.log("[discovery:case] Force click failed.");
      }
    }

    const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
    currentSnapshot = scan.snapshot;
    allDiscoveredObjects.push(...scan.objects);

    steps.push({
      index: actionTarget.index,
      action: actionTarget.action,
      status: "found",
      targetText: actionTarget.target,
      snapshotUrl: scan.url,
      snapshotTitle: scan.title,
      elementsFound: scan.elementsCount,
      evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
      semanticRole: actionTarget.semanticRole,
      relationContext: actionTarget.relationContext
    });

    planSteps.push({
      index: planSteps.length + 1,
      action: "click",
      description: actionTarget.action,
      target: { strategy: "text", value: actionTarget.target, exact: false }
    });
  }

  const foundSteps = steps.filter((s) => s.status === "found" || s.status === "satisfied_by_children" || (s.status === "skipped_after_completion" && earlyCompletionSatisfied)).length;
  const totalSteps = steps.filter((s) => s.status !== "skipped").length;
  const allFound = (foundSteps === totalSteps && totalSteps > 0 && !failedReason) || earlyCompletionSatisfied;
  const someFound = foundSteps > 0 || earlyCompletionSatisfied;

  const status: CaseDiscoveryResult["status"] = failedReason === "needs_approval"
    ? "needs_approval"
    : failedReason === "needs_assertion_resolution"
      ? "needs_assertion_resolution"
      : failedReason === "needs_setup_resolution"
        ? "needs_setup_resolution"
        : failedReason === "needs_associated_target_resolution"
          ? "needs_associated_target_resolution"
          : failedReason === "associated_entity_not_found"
            ? "needs_associated_target_resolution"
            : failedReason === "associated_action_not_found"
              ? "needs_associated_target_resolution"
              : allFound
                ? "discovered_passed"
                : someFound
                  ? "discovered_partial"
                  : "exploration_failed";

  const candidatePlan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: allFound ? "validated" : "needs_discovery",
    scenario: {
      source: "testrail",
      externalId: scenario.externalId,
      caseId: scenario.caseId,
      title: scenario.title
    },
    requiredData: [],
    steps: planSteps,
    notes: [
      ...(allFound
        ? ["Discovery completed successfully. All targets and concrete assertions passed."]
        : [`Discovery partial: ${foundSteps}/${totalSteps} navigations/assertions satisfied.`])
    ],
    createdAt: new Date().toISOString()
  };

  await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
  await writeFile(pendingPlansPath, JSON.stringify(candidatePlan, null, 2), "utf-8");

  return {
    version: "1.0",
    caseId: scenario.caseId,
    caseTitle: scenario.title,
    discoveredAt: new Date().toISOString(),
    status,
    steps,
    discoveredObjects: allDiscoveredObjects,
    candidatePlan,
    pendingObjectsPath,
    pendingPlansPath,
    evidenceDir,
    failedAtStep,
    failedTarget,
    failedReason
  };
}

export function printCaseDiscoverySummary(result: CaseDiscoveryResult): void {
  console.log("");
  console.log("=== Case Discovery Results ===");
  console.log(`Case: C${result.caseId} - ${result.caseTitle}`);
  console.log(`Status: ${result.status}`);
  console.log(`Discovered at: ${result.discoveredAt}`);
  console.log("");

  console.log("Steps:");
  for (const step of result.steps) {
    const icon = step.status === "found" ? "✓" : step.status === "not_found" ? "✗" : step.status === "click_no_transition" ? "⚠" : "-";
    console.log(`  ${icon} Step ${step.index}: ${step.action}`);
    if (step.targetText) {
      console.log(`    Target: ${step.targetText}`);
    }
    if (step.error) {
      console.log(`    Error: ${step.error}`);
    }
    if (step.attemptedLocators && step.attemptedLocators.length > 0) {
      console.log(`    Attempted locators: ${step.attemptedLocators.join(" | ")}`);
    }
    if (step.evidencePath) {
      console.log(`    Evidence: ${step.evidencePath}`);
    }
  }

  console.log("");
  console.log(`Discovered objects: ${result.discoveredObjects.length}`);
  if (result.discoveredObjects.length > 0) {
    const byType: Record<string, number> = {};
    for (const obj of result.discoveredObjects) {
      byType[obj.type] = (byType[obj.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(byType)) {
      console.log(`  ${type}: ${count}`);
    }
  }

  console.log("");
  console.log(`Pending objects: ${result.pendingObjectsPath ?? "N/A"}`);
  console.log(`Pending plans: ${result.pendingPlansPath ?? "N/A"}`);
  console.log(`Evidence dir: ${result.evidenceDir ?? "N/A"}`);

  if (result.candidatePlan) {
    console.log("");
    console.log(`Candidate plan steps: ${result.candidatePlan.steps.length}`);
    console.log(`Candidate plan status: ${result.candidatePlan.status}`);
  }

  if (result.failedAtStep) {
    console.log("");
    console.log(`Failed at step: ${result.failedAtStep}`);
    console.log(`Failed target: ${result.failedTarget ?? "unknown"}`);
    if (result.failedReason) {
      console.log(`Failed reason: ${result.failedReason}`);
    }
  }
}
