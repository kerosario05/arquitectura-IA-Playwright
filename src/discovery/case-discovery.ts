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
  resolveFillTarget,
  type ActiveContainerContext
} from "./target-resolver";
import { isSelectionLikeTarget as isSelectionLikeTargetNew, shouldBlockSemanticFallback, getSelectionConfidenceThreshold, verifyPostClickSemanticMatch, buildSelectionCandidatesFromSnapshot } from "./selection-resolution";
import { resolveLoginForm, type LoginFormResolution } from "./login-resolver";
import { runAiAssistedDiscovery, type AiAssistedDiscoveryConfig } from "./ai-assisted-discovery";
import { runAiRepairOrchestrator } from "../ai/repair/ai-repair-orchestrator";
import { buildAiRepairCaseSummary, formatAiRepairConsoleOutput, type StepWithAiRepair } from "../ai/repair/ai-repair-summary-builder";
import { writeJsonSafe } from "../utils/json-utils";
import { detectPostClickUiChange, type PostClickUiChangeResult } from "./post-click-ui-change-detector";
import {
  buildConcreteAssertionsFromExpected,
  resolveAssertionTargets,
  type AssertionTargetInput,
  type ExpectedResultConsumption
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
import type { ExecutionPlan, ExecutionPlanStep, RequiredDataRef, LocatorStrategy } from "../types/execution-plan.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { TestDataMap, TestDataValue, MissingInputBehavior, ExpectedResultMode } from "../types/env.types";
import { config as envConfig } from "../config/env";
import { detectAuthGate, type AuthGateDetection } from "./auth-gate-detector";
import { resolveAuthInputs, validateRequiredInputs, logAuthResolution, type AuthInputResolverConfig } from "./auth-input-resolver";
import { loadRouteProfile } from "../automations/app-profile";
import { resolveMissingIntermediateStep, type MissingIntermediateStepResolution, type DiscoveryCandidate, type DiscoverySnapshot } from "./missing-intermediate-step-resolver";
import { observeRouteTransition, observeRouteCompletionSuccess, saveRouteProfileSuggestions, type RouteProfileSuggestion, type RouteProfileLearningConfig } from "./route-profile-learning";
import {
  createAuthGateState,
  shouldSkipStepAsAuthConsumed,
  markFunctionalStepAfterAuth,
  type AuthGateState
} from "./auth-step-classifier";
import { waitForStablePageState, type PageStabilityOptions } from "./page-stability-detector";
import { parseProductConditionTarget, matchesProductCondition, type ProductCondition } from "./product-condition-parser";
import { detectTransientScreen } from "./transient-screen-detector";
import { evaluateEarlyCompletionPolicy, type EarlyCompletionPolicyResult } from "./early-completion-policy";
import { detectSelectionSuccess, isSelectionLikeTarget, isSubmitLikeTarget, promoteToClickableAncestor, type SelectionDiagnostics } from "./selection-state-detector";
import { resolveDataKey, formatDataKeyForLog, type DataKeyResolution } from "../data/data-key-resolver";
import { type AutoGenerateConfig } from "../data/auto-test-data-generator";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Infer product type from candidate text for generic ordinal descriptions
 * Avoids hardcoding dynamic product names with masked numbers
 */
function inferProductType(candidateText: string): string {
  const normalized = normalizeText(candidateText);
  
  if (/dep.A?sito|plazo/i.test(normalized)) return "depósito";
  if (/pr.A?stamo|cr.A?dito|prestamo/i.test(normalized)) return "préstamo";
  if (/cuenta|ahorro|corriente/i.test(normalized)) return "cuenta";
  if (/tarjeta|card|cr.A?dito|debito/i.test(normalized)) return "tarjeta";
  if (/inversion|inversión|fondo/i.test(normalized)) return "inversión";
  if (/seguro|policy/i.test(normalized)) return "seguro";
  if (/transferencia|transfer/i.test(normalized)) return "transferencia";
  if (/pago|payment/i.test(normalized)) return "pago";
  
  return "producto";
}

/**
 * Check if a failed assertion was recovered by later success
 * Returns the step index where recovery happened, or undefined if not recovered
 * 
 * Recovery scenarios:
 * 1. Same target succeeds later (exact match recovery)
 * 2. Any action succeeds later, indicating page navigation completed (navigation recovery)
 */
function findAssertionRecoveryByLaterSuccess(
  failedAssertionTarget: string,
  steps: DiscoveryStepResult[],
  currentIndex: number
): number | undefined {
  const normalizedTarget = normalizeText(failedAssertionTarget);
  
  console.log(`[assertion-recovery] checking failed assertion target="${failedAssertionTarget}" normalized="${normalizedTarget}" from index=${currentIndex}`);
  
  // Look for successful actions/assertions on the same target after the failure
  for (let i = currentIndex; i < steps.length; i++) {
    const step = steps[i];
    const stepTarget = normalizeText(step.targetText || "");
    
    console.log(`[assertion-recovery] checking discovery step ${i}: target="${step.targetText}" normalized="${stepTarget}" status="${step.status}"`);
    
    // Check if this step successfully used the same target
    // Consider as success: found, passed, recovered, repaired, satisfied_by_*
    const isSuccessStatus = [
      "found",
      "satisfied_by_children",
      "satisfied_by_previous_assertion",
      "skipped_after_completion"
    ].includes(step.status);
    
    if (stepTarget === normalizedTarget && isSuccessStatus) {
      console.log(`[assertion-recovery] found later success step=${i} target="${step.targetText}" type=action status=${step.status}`);
      return i;
    }
    
    // Check if this is an assertion that passed on the same target
    if (stepTarget === normalizedTarget && step.assertionStatus === "passed") {
      console.log(`[assertion-recovery] found later success step=${i} target="${step.targetText}" type=assertion assertionStatus=passed`);
      return i;
    }
    
    // Check if this step was recovered/repaired (indicates the target was eventually used successfully)
    if (stepTarget === normalizedTarget && (step.recoveryStatus === "recovered" || step.recoveryStatus === "repaired")) {
      console.log(`[assertion-recovery] found later success step=${i} target="${step.targetText}" recoveryStatus=${step.recoveryStatus}`);
      return i;
    }
  }
  
  // NAVIGATION RECOVERY: If any action succeeds after the failed assertion,
  // it indicates the page was functional and navigation completed.
  // The assertion failure was likely due to page transitioning before assertion completed.
  for (let i = currentIndex; i < steps.length; i++) {
    const step = steps[i];
    const isSuccessStatus = [
      "found",
      "satisfied_by_children",
      "satisfied_by_previous_assertion",
      "skipped_after_completion"
    ].includes(step.status);
    
    if (isSuccessStatus) {
      console.log(`[assertion-recovery] found navigation recovery step=${i} target="${step.targetText}" status=${step.status} (different target indicates successful navigation)`);
      return i;
    }
  }
  
  console.log(`[assertion-recovery] no later success found for target="${failedAssertionTarget}"`);
  return undefined;
}

/**
 * Get unresolved blocking failures - ignores steps that were recovered or marked as non-blocking
 */
function getUnresolvedBlockingFailures(steps: DiscoveryStepResult[]): DiscoveryStepResult[] {
  return steps.filter((s) => {
    // Skip if recovered
    if (s.recoveryStatus === "recovered" || s.recoveryStatus === "repaired") {
      return false;
    }
    
    // Skip if marked as non-blocking by recovery metadata
    const recoveryMeta = (s as any).recoveryMetadata;
    if (recoveryMeta?.blocking === false) {
      return false;
    }
    
    // Skip if recoveredBy is set to a known recovery mechanism
    if (s.recoveredBy && ["auth_flow", "page_stability", "later_success", "retry_after_navigation", "contextual_intermediate_already_satisfied"].includes(s.recoveredBy)) {
      return false;
    }
    
    // Include only actual blocking failures
    return (s.status === "not_found" || s.status === "needs_assertion_resolution") && s.assertionClassification;
  });
}

/**
 * Mark failed assertions as recovered if they were resolved by AuthGate, PageStability, or later success
 */
function recoverTransientAssertionFailures(
  steps: DiscoveryStepResult[],
  authGateCompletedAtStep?: number,
  pageStabilizedAtStep?: number
): void {
  const failedAssertions = steps.filter(
    (s) => (s.status === "not_found" || s.status === "needs_assertion_resolution") &&
           s.assertionClassification &&
           !s.recoveryStatus
  );
  
  console.log(`[assertion-recovery] checking ${failedAssertions.length} failed assertion(s) for recovery`);
  
  for (const failedStep of failedAssertions) {
    const target = failedStep.targetText;
    if (!target) continue;
    
    console.log(`[assertion-recovery] checking failed assertion step=${failedStep.index} target="${target}"`);
    
    // Check if recovered by AuthGate
    if (authGateCompletedAtStep !== undefined && authGateCompletedAtStep > failedStep.index) {
      const recoveryIndex = findAssertionRecoveryByLaterSuccess(target, steps, authGateCompletedAtStep);
      if (recoveryIndex !== undefined) {
        failedStep.recoveryStatus = "recovered";
        failedStep.recoveredBy = "auth_flow";
        failedStep.recoveryMetadata = {
          ...failedStep.recoveryMetadata,
          originalFailureReason: failedStep.error,
          recoveredAfterStep: recoveryIndex,
          recoveredBecause: "auth_gate_completed",
          blocking: false
        };
        console.log(`[assertion-recovery] recovered step=${failedStep.index} target="${target}" recoveredBy=auth_flow blocking=false`);
        continue;
      }
    }
    
    // Check if recovered by page stability
    if (pageStabilizedAtStep !== undefined && pageStabilizedAtStep > failedStep.index) {
      const recoveryIndex = findAssertionRecoveryByLaterSuccess(target, steps, pageStabilizedAtStep);
      if (recoveryIndex !== undefined) {
        failedStep.recoveryStatus = "recovered";
        failedStep.recoveredBy = "page_stability";
        failedStep.recoveryMetadata = {
          ...failedStep.recoveryMetadata,
          originalFailureReason: failedStep.error,
          recoveredAfterStep: recoveryIndex,
          recoveredBecause: "page_stabilized",
          blocking: false
        };
        console.log(`[assertion-recovery] recovered step=${failedStep.index} target="${target}" recoveredBy=page_stability blocking=false`);
        continue;
      }
    }
    
    // Check if recovered by later success (without AuthGate)
    // Start searching from the step immediately after the failed assertion
    const recoveryIndex = findAssertionRecoveryByLaterSuccess(target, steps, failedStep.index + 1);
    if (recoveryIndex !== undefined) {
      failedStep.recoveryStatus = "recovered";
      failedStep.recoveredBy = "later_success";
      failedStep.recoveryMetadata = {
        ...failedStep.recoveryMetadata,
        originalFailureReason: failedStep.error,
        recoveredAfterStep: recoveryIndex,
        recoveredBecause: "target_used_successfully_later",
        blocking: false
      };
      console.log(`[assertion-recovery] recovered step=${failedStep.index} target="${target}" recoveredBy=later_success blocking=false`);
    }
  }
}

function envTrue(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.trim().toLowerCase() === "true";
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
  expectedResultConsumption?: ExpectedResultConsumption[];
  nonExecutableCriteria?: string[];
} {
  const actionTargets: ActionTargetItem[] = [];
  const assertionTargets: AssertionTargetInput[] = [];
  const skippedActions: { index: number; action: string }[] = [];
  const setupIntents: ParsedStepIntent[] = [];
  const orderedSteps: ExecutableStep[] = [];
  let expectedResultConsumption: ExpectedResultConsumption[] | undefined;
  let nonExecutableCriteria: string[] | undefined;

  // Get expected result mode from config (default: context)
  const expectedResultMode: ExpectedResultMode = envConfig.integrations.ai?.expectedResultMode ?? "context";

  console.log(`[expected-result-parser] mode=${expectedResultMode}`);

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

        // select_first_visible_item: use context/category as target, mark semantic role
        if (intent.type === "select_first_visible_item") {
          targetText = intent.context || "first visible item";
          associatedEntity = intent.associatedEntity;
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
          type: intent.isOptional ? "optional_action" : (intent.type === "action_fill" ? "action_fill" : intent.type === "action_select" || intent.type === "select_first_visible_item" ? "action_select" : "action_click"),
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

  // Process expected results based on mode
  if (scenario.steps.length > 0) {
    const lastStep = scenario.steps[scenario.steps.length - 1];
    if (lastStep.expected) {
      const expectedTargets = extractAssertionTargets(lastStep.expected);
      
      if (expectedResultMode === "context") {
        // Mode: context - store as non-blocking metadata only
        expectedResultConsumption = expectedTargets.map(text => ({
          originalText: text,
          classification: "non_executable_criteria" as const,
          reason: "mode=context: expected result stored as non-blocking context"
        }));
        nonExecutableCriteria = expectedTargets;
        console.log(`[expected-result-parser] expected results stored as non-blocking context. items=${expectedTargets.length}`);
        console.log(`[discovery:case] Expected result assertions disabled by mode=context`);
      } else if (expectedResultMode === "smart") {
        // Mode: smart - convert only observable assertions, rest as non-executable
        const existingConcreteAssertions = assertionTargets
          .filter((a) => a.source === "action")
          .map((a) => a.target);
        const buildResult = buildConcreteAssertionsFromExpected(expectedTargets, existingConcreteAssertions);
        expectedResultConsumption = buildResult.expectedResultConsumption;
        nonExecutableCriteria = buildResult.nonExecutableCriteria;
        
        for (const target of buildResult.assertions) {
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
        console.log(`[expected-result-parser] mode=smart: converted ${buildResult.assertions.length} observable assertions, ${nonExecutableCriteria.length} non-executable`);
      } else {
        // Mode: assertions - legacy behavior, convert all to assertions
        const existingConcreteAssertions = assertionTargets
          .filter((a) => a.source === "action")
          .map((a) => a.target);
        const buildResult = buildConcreteAssertionsFromExpected(expectedTargets, existingConcreteAssertions);
        expectedResultConsumption = buildResult.expectedResultConsumption;
        nonExecutableCriteria = buildResult.nonExecutableCriteria;
        
        for (const target of buildResult.assertions) {
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
        console.log(`[expected-result-parser] mode=assertions: converted ${buildResult.assertions.length} assertions from expected results`);
      }
      
      // Non-executable criteria are tracked in metadata but don't block execution
      // They are logged for diagnostics but not added as assertion targets
      if (nonExecutableCriteria && nonExecutableCriteria.length > 0) {
        console.log(`[discovery:case] Non-executable expected criteria (${nonExecutableCriteria.length}): ${nonExecutableCriteria.map(c => `"${c}"`).join(", ")}`);
      }
      if (expectedResultConsumption && expectedResultConsumption.some(c => c.classification === "covered_by_concrete_assertions")) {
        console.log(`[discovery:case] Expected result covered by concrete assertions from steps`);
      }
    }
  }

  return {
    actionTargets,
    assertionTargets,
    skippedActions,
    setupIntents,
    orderedSteps,
    expectedResultConsumption,
    nonExecutableCriteria
  };
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
  deferredAssertions: string[];
  blockingAssertions: string[];
  skippedAssertions: string[];
  weakSignals: string[];
  skippedReason?: string;
  skippedRemainingActions: number;
} {
  const GENERIC_DESCRIPTOR_PATTERNS = [
    /informacion principal del producto visible/i,
    /informacion del producto visible/i,
    /detalle visible/i,
    /detalle de producto visible/i,
    /detalle de [a-z0-9 ]+ visible/i,
    /vista de detalle visible/i,
    /datos principales visibles/i
  ];

  function isGenericDescriptorText(text: string): boolean {
    const normalized = normalizeText(text);
    return GENERIC_DESCRIPTOR_PATTERNS.some((p) => p.test(normalized));
  }

  function isDetailDescriptorText(text: string): boolean {
    const normalized = normalizeText(text);
    return /detalle|detail|resumen|informacion/.test(normalized);
  }

  function hasConcreteSubject(text: string): boolean {
    const normalized = normalizeText(text)
      .replace(/informacion|principal|producto|visible|detalle|vista|de|del|la|el|los|las|detail|summary/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized.split(" ").filter(Boolean).length >= 1;
  }

  function detailSubjectAppearsInSnapshot(text: string): boolean {
    const normalized = normalizeText(text)
      .replace(/detalle|detail|visible|vista|de|del|la|el|los|las/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const subjectTokens = normalized.split(" ").filter(Boolean).filter((t) => t.length > 2 && t !== "producto" && t !== "product");
    if (subjectTokens.length === 0) return false;
    const visibleBlob = normalizeText(`${snapshot.title} ${snapshot.elements.map((el) => `${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`).join(" ")}`);
    const normalizedMatch = subjectTokens.every((t) => visibleBlob.includes(t));
    if (normalizedMatch) return true;

    const rawSubjectTokens = text
      .toLowerCase()
      .replace(/detalle|detail|visible|vista|de|del|la|el|los|las/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .filter((t) => t.length > 2 && t !== "producto" && t !== "product");
    const rawVisibleBlob = `${snapshot.title} ${snapshot.elements.map((el) => `${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`).join(" ")}`.toLowerCase();
    return rawSubjectTokens.length > 0 && rawSubjectTokens.every((t) => rawVisibleBlob.includes(t));
  }

  function inferRequiredContextFromAssertion(text: string): "catalog" | "filtered_list" | "detail" | "cart" | "form" | "confirmation" | "unknown" {
    const normalized = normalizeText(text);
    if (/\bcarrito\b|\bcart\b|\bcheckout\b|\bsubtotal\b|\btotal\b/.test(normalized)) return "cart";
    if (/\bmodal\b|\bdialog\b|\bform\b|\bformulario\b|\bcampo\b|\bfield\b/.test(normalized)) return "form";
    if (/\bconfirm\w*\b|\bsuccess\b|\bexito\b|\bfinaliz\w*\b|\bcompletad\w*\b/.test(normalized)) return "confirmation";
    if (/\bdetalle\b|\bdetail\b|\bdescripcion\b|\bdescription\b|\bimagen\b|\bimage\b|\bprecio\b|\bprice\b/.test(normalized)) return "detail";
    if (/\bfiltro\b|\bfilter\b|\bcategoria\b|\bcategory\b|\bbusqueda\b|\bsearch\b|\bresultad\w*\b/.test(normalized)) return "filtered_list";
    if (/\blistado\b|\bcatalog\w*\b|\bproductos?\b|\bitems?\b|\bcards?\b/.test(normalized)) return "catalog";
    return "unknown";
  }

  function inferCurrentContextFromSnapshot(): "catalog" | "filtered_list" | "detail" | "cart" | "form" | "confirmation" | "unknown" {
    const visibleTexts = snapshot.elements
      .map((el) => normalizeText(`${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`))
      .filter(Boolean);
    const hasCards = snapshot.elements.some((el) => (el.type ?? "").toLowerCase() === "card");
    const hasRows = snapshot.elements.some((el) => ["tr", "li"].includes((el.tagName ?? "").toLowerCase()) || (el.role ?? "").toLowerCase() === "row");
    const hasDialog = snapshot.summary.dialogs > 0 || snapshot.elements.some((el) => ["dialog", "modal"].includes((el.type ?? "").toLowerCase()));
    const hasInputs = snapshot.summary.inputs > 0 || snapshot.elements.some((el) => ["input", "select", "textarea"].includes((el.type ?? "").toLowerCase()));
    const hasHeading = snapshot.elements.some((el) => ["heading", "h1", "h2", "h3"].includes((el.type ?? "").toLowerCase()) || ["h1", "h2", "h3"].includes((el.tagName ?? "").toLowerCase()));
    const hasImage = snapshot.elements.some((el) => (el.tagName ?? "").toLowerCase() === "img" || (el.role ?? "").toLowerCase() === "img");
    const hasMoney = snapshot.elements.some((el) => /(?:USD?\$|EUR|RD\$|\$)\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR|RD\$)/i.test(`${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`));
    const hasAddToCart = visibleTexts.some((t) => /\badd to cart\b|\bagregar al carrito\b/.test(t));
    const hasCartPageSignal = hasRows || visibleTexts.some((t) => /\bcheckout\b|\bsubtotal\b|\btotal\b|\bshopping cart\b|\bcarrito de compras\b/.test(t));
    const hasSuccessSignal = visibleTexts.some((t) => /\bsuccess\b|\bconfirm\w*\b|\bgracias\b|\bcompletad\w*\b|\bfinalizad\w*\b/.test(t));

    if (hasSuccessSignal) return "confirmation";
    if ((hasDialog && hasInputs) || (hasInputs && snapshot.summary.buttons > 0)) return "form";
    if (hasCartPageSignal) return "cart";
    if (hasAddToCart || (hasHeading && (hasImage || hasMoney))) return "detail";
    if (hasCards || hasRows) return "catalog";
    return "unknown";
  }

  function remainingActionsCanReachContext(requiredContext: string): boolean {
    const blob = remainingActionTargets.map((a) => normalizeText(`${a.action} ${a.target}`)).join(" ");
    if (!blob) return false;
    if (requiredContext === "cart") return /\bcart\b|\bcarrito\b|\bcheckout\b/.test(blob);
    if (requiredContext === "form") return /\babrir\b.*\bform\b|\bopen\b.*\bform\b|\bmodal\b|\bdialog\b|\blogin\b|\bregistr\w*\b/.test(blob);
    if (requiredContext === "confirmation") return /\bsubmit\b|\benviar\b|\bconfirm\w*\b|\bfinaliz\w*\b|\bcompr\w*\b|\bpag\w*\b/.test(blob);
    if (requiredContext === "detail") return /\bview\b|\bdetalle\b|\bdetail\b|\bselect\b|\bseleccionar\b|\bclick\b.*\b(item|producto|card)\b/.test(blob);
    if (requiredContext === "filtered_list") return /\bfiltro\b|\bfilter\b|\bcategoria\b|\bcategory\b|\bbusqueda\b|\bsearch\b/.test(blob);
    return false;
  }

  if (assertionTargets.length === 0) {
    return { checked: false, satisfied: false, satisfiedAssertions: [], pendingAssertions: [], deferredAssertions: [], blockingAssertions: [], skippedAssertions: [], weakSignals: [], skippedRemainingActions: 0 };
  }

  const resolutionResults = resolveAssertionTargets(snapshot, assertionTargets);
  
  const satisfiedAssertions: string[] = [];
  const pendingAssertions: string[] = [];
  const deferredAssertions: string[] = [];
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

    const isExpectedDescriptor =
      isExpectedSource &&
      (res.classification === "semantic_descriptor" ||
        res.classification === "composite_assertion" ||
        res.classification === "expected_only" ||
        res.classification === "ambiguous_assertion");
    const isDetailDescriptor = isDetailDescriptorText(res.assertionText);
    const isGenericDescriptor = isGenericDescriptorText(res.assertionText);
    const detailWithConcreteSubject = isDetailDescriptor && hasConcreteSubject(res.assertionText);
    const hasConcreteDetailEvidence = (res.matchedTokens?.length ?? 0) > 0 || Boolean(res.matchedText);
    const detailEvidenceSatisfied = hasConcreteDetailEvidence || detailSubjectAppearsInSnapshot(res.assertionText);
    const keepAsSatisfiedDetail =
      detailWithConcreteSubject &&
      detailEvidenceSatisfied &&
      (
        // Expected detail descriptors with concrete subject become structurally satisfied
        // once equivalent detail evidence is present, even if parser classified them weak.
        (isExpectedSource && (isExpectedDescriptor || res.classification === "structural_assertion")) ||
        (!isExpectedSource && isDetailDescriptor && res.status === "passed")
      );

    // Optional/precondition statuses are skippable
    const isOptionalStatus = 
      res.status === "optional_confirmation_detail_missing" ||
      res.status === "satisfied_by_previous_assertion" ||
      res.status === "precondition_unresolved";

    const isSkippable = (res.status === "skipped_semantic_descriptor") || isWeakDescriptor || isOptionalStatus;
    const contextDecision = (res.assertionDiagnostics as any)?.assertionContextDiagnostics?.decision;
    const inferredRequiredContext = inferRequiredContextFromAssertion(res.assertionText);
    const inferredCurrentContext = inferCurrentContextFromSnapshot();
    const inferredDeferredContext =
      inferredRequiredContext !== "unknown" &&
      inferredCurrentContext !== inferredRequiredContext &&
      remainingActionsCanReachContext(inferredRequiredContext);
    const isDeferredContext = res.reason === "assertion_context_not_reached" || contextDecision === "deferred_until_context" || inferredDeferredContext;
    const isStructurallySatisfied = res.reason === "structurally_satisfied" || contextDecision === "structurally_satisfied";

    const isMandatory = !isSkippable && (
      res.classification === "literal_observable" ||
      res.classification === "structural_assertion" ||
      res.classification === "composite_assertion" ||
      res.classification === "semantic_descriptor"
    );
    const isPreconditionUnresolved = res.status === "precondition_unresolved";
    const shouldTreatPreconditionAsPending =
      isPreconditionUnresolved &&
      !isWeakDescriptor &&
      inferredRequiredContext !== "unknown" &&
      inferredCurrentContext !== inferredRequiredContext &&
      remainingActionTargets.length === 0;

    if (isStructurallySatisfied || keepAsSatisfiedDetail) {
      satisfiedAssertions.push(res.assertionText);
    } else if (shouldTreatPreconditionAsPending) {
      pendingAssertions.push(res.assertionText);
    } else if (isDeferredContext) {
      if (remainingActionTargets.length > 0) {
        deferredAssertions.push(res.assertionText);
      } else if (isMandatory) {
        pendingAssertions.push(res.assertionText);
      } else {
        skippedAssertions.push(res.assertionText);
      }
    } else if ((isExpectedDescriptor || isGenericDescriptor) && !keepAsSatisfiedDetail) {
      skippedAssertions.push(res.assertionText);
      weakSignals.push(res.assertionText);
    } else if (res.status === "passed" || res.status === "satisfied_by_children" || isOptionalStatus) {
      satisfiedAssertions.push(res.assertionText);
    } else if (isSkippable) {
      skippedAssertions.push(res.assertionText);
      if ((res as any).isWeakSignal || isExpectedDescriptor) {
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
    deferredAssertions,
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
  appSlug?: string;
  testData?: TestDataMap;
  loginAction?: () => Promise<void>;
  loginMode?: "password" | "no_login" | "manual";
  aiAssistedDiscovery?: {
    explorer?: AIExplorer;
    config?: Partial<AiAssistedDiscoveryConfig>;
  };
  env?: Record<string, unknown>;
  missingInputBehavior?: MissingInputBehavior;
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

async function tryAuthGateRecovery(
  page: Page,
  snapshot: PageSnapshot,
  options: CaseDiscoveryOptions
): Promise<{ recovered: boolean; error?: string; diagnostics?: any; authGateState?: AuthGateState }> {
  const { env, missingInputBehavior = "fail", loginMode } = options;

  if (loginMode === "no_login") {
    console.log(`[auth-gate] Skipped because APP_LOGIN_MODE=no_login`);
    return { recovered: false };
  }

  if (!env) {
    return { recovered: false, error: "No env data provided for auth resolution" };
  }

  const detection = detectAuthGate(snapshot);

  if (!detection.detected) {
    return { recovered: false };
  }

  console.log(`[auth-gate] Detected auth gate: ${detection.gateType} at stage: ${detection.stage} (confidence: ${detection.confidence})`);
  console.log(`[auth-gate] Evidence: ${detection.evidence.join(", ")}`);
  console.log(`[auth-gate] Required inputs: ${detection.requiredInputs.join(", ")}`);
  console.log(`[auth-gate] Virtual keyboard: ${detection.hasVirtualKeyboard}, Native input: ${detection.hasNativeInput}`);

  const resolverConfig: AuthInputResolverConfig = {
    env,
    missingInputBehavior,
    alias: "defaultClient"
  };

  const resolution = resolveAuthInputs(resolverConfig);
  logAuthResolution(resolution);

  const validation = validateRequiredInputs(resolution, detection.requiredInputs, missingInputBehavior);

  if (!validation.valid) {
    console.log(`[auth-gate] Auth input resolution failed: ${validation.errors.join("; ")}`);
    return { recovered: false, error: validation.errors.join("; ") };
  }

  const inputMethod = detection.hasVirtualKeyboard ? "virtual_keyboard" : "native_input";
  const maskedInputs: Record<string, string> = {};
  if (resolution.data.identificationNumber) {
    maskedInputs.identificationNumber = maskValue(resolution.data.identificationNumber);
  }
  if (resolution.data.otp) {
    maskedInputs.otp = "******";
  }

  const inputSource = resolution.sources.identificationNumber || resolution.sources.otp || "unknown";

  console.log(`[auth-gate] Attempting to resolve auth flow...`);

  try {
    const { AuthFlow } = await import("../../automations/apps/default/flows/auth.flow");

    const globalThisWithTestData = globalThis as typeof globalThis & {
      __authFlowTestData?: Record<string, unknown>;
    };

    const testDataJson = env.APP_TEST_DATA_JSON;
    const hasTestDataClients = testDataJson && typeof testDataJson === "object" && (testDataJson as any).clients && Object.keys((testDataJson as any).clients).length > 0;

    if (hasTestDataClients) {
      globalThisWithTestData.__authFlowTestData = testDataJson as Record<string, unknown>;
    } else {
      globalThisWithTestData.__authFlowTestData = {
        clients: {
          defaultClient: {
            identificationType: resolution.data.identificationType || "cedula",
            identificationNumber: resolution.data.identificationNumber || "",
            otp: resolution.data.otp || "",
            expectedPhoneLast4: resolution.data.expectedPhoneLast4
          }
        },
        defaults: { client: "defaultClient" }
      };
    }

    const authFlow = new AuthFlow(page);
    const result = await authFlow.ensureAuthenticated({
      alias: "defaultClient",
      landing: "transactions_menu"
    });

    if (result.success) {
      console.log(`[auth-gate] Auth flow completed successfully. Stages: ${result.stagesCompleted.join(", ")}`);
      const authGateState = createAuthGateState(
        "transacciones y servicio",
        0,
        result.stagesCompleted
      );
      return {
        recovered: true,
        diagnostics: {
          detected: true,
          stage: detection.stage,
          requiredInputs: detection.requiredInputs,
          inputSource,
          completedBy: "AuthFlowRunner",
          inputMethod,
          maskedInputs
        },
        authGateState
      };
    } else {
      console.log(`[auth-gate] Auth flow failed: ${result.error}`);
      return { recovered: false, error: result.error };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`[auth-gate] Auth flow failed: ${errorMsg}`);
    return { recovered: false, error: errorMsg };
  }
}

function maskValue(value: string | undefined, visibleChars = 4): string {
  if (!value) return "";
  if (value.length <= visibleChars) return "****";
  return "*".repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

export async function runCaseDiscovery(options: CaseDiscoveryOptions): Promise<CaseDiscoveryResult> {
  const { page, scenario, evidenceDir, pendingObjectsPath, pendingPlansPath, appBaseUrl, testData, loginAction } = options;
  const aiConfig: AiAssistedDiscoveryConfig = {
    ...DEFAULT_AI_ASSISTED_DISCOVERY_CONFIG,
    ...options.aiAssistedDiscovery?.config
  };
  const aiExplorer = options.aiAssistedDiscovery?.explorer ?? createAIExplorer();
  
  // Load route profile for ordinal selection and route completion
  const appSlug = options.appSlug ?? "default";
  const routeProfile = options.aiAssistedDiscovery?.config?.routeCompletion?.useAppProfile !== false ? loadRouteProfile(appSlug) : undefined;
  if (routeProfile) {
    console.log(`[discovery:case] routeProfile loaded appSlug=${appSlug} domainTerms=${routeProfile.domainTerms?.length ?? 0} routes=${routeProfile.routes?.length ?? 0}`);
  }

  const steps: DiscoveryStepResult[] = [];
  const allDiscoveredObjects: DiscoveredObject[] = [];
  const planSteps: ExecutionPlanStep[] = [];
  const executedStepIndices = new Set<number>();
  const executedActionOrders = new Set<number>();
  const skippedActionOrders = new Set<number>();
  const routeProfileSuggestions: RouteProfileSuggestion[] = [];
  const routeProfileLearningConfig: RouteProfileLearningConfig = (options as any)?.aiAssistedDiscovery?.config?.routeProfileLearning ?? {
    enabled: false,
    autoApproveThreshold: 0.90,
    autoApply: false,
    minOccurrences: 1,
    blockSensitive: true
  };
  
  console.log(`[route-learning] config enabled=${routeProfileLearningConfig.enabled} autoApply=${routeProfileLearningConfig.autoApply} threshold=${routeProfileLearningConfig.autoApproveThreshold}`);
  
  let failedAtStep: number | undefined;
  let failedTarget: string | undefined;
  let failedReason: string | undefined;
  let earlyCompletionSatisfied = false;
  let authGateState: AuthGateState | undefined;
  let authGateCompletedAfterStepIndex: number | undefined; // Track step index after which AuthFlow completed
  let activeContainer: ActiveContainerContext | undefined;
  const resolvedDataKeys = new Set<string>();

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
  const actionOrderIndexByTarget = new WeakMap<ActionTargetItem, number>();
  parsed.actionTargets.forEach((target, order) => {
    actionOrderIndexByTarget.set(target, order);
  });
  console.log(`[discovery:case] Parsed action targets: ${parsed.actionTargets.map((t) => t.target).join(", ")}`);
  console.log(`[discovery:case] Parsed assertion targets: ${parsed.assertionTargets.map((t) => t.target).join(", ")}`);
  console.log(`[discovery:case] Action targets details: ${parsed.actionTargets.map((t) => `${t.target}(valueSource=${t.valueSource ?? 'none'},valueKey=${t.valueKey ?? 'none'})`).join(", ")}`);
  console.log(`[discovery:case] Setup intents: ${parsed.setupIntents.map((si) => `${si.type}(valueKey=${si.valueKey ?? 'none'},valueKeys=${si.valueKeys?.join(",") ?? 'none'})`).join(", ")}`);

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
  const evaluateAndApplyEarlyCompletionAfterAction = (
    currentIndex: number,
    currentTarget: string,
    currentActionOrder?: number
  ): boolean => {
    const remainingActionTargets = typeof currentActionOrder === "number"
      ? parsed.actionTargets.filter((a) => {
          const order = actionOrderIndexByTarget.get(a);
          return typeof order === "number" && order > currentActionOrder;
        })
      : parsed.actionTargets.filter(a => a.index > currentIndex);
    const policyPendingActions = remainingActionTargets.map((a) => ({
      ...a,
      index: (() => {
        const order = actionOrderIndexByTarget.get(a);
        return typeof order === "number" ? order : a.index;
      })()
    }));
    const earlyCompletion = evaluateEarlyCompletion(currentSnapshot, parsed.assertionTargets, remainingActionTargets);
    const earlyCompletionPolicy = evaluateEarlyCompletionPolicy({
      pendingActions: policyPendingActions,
      executedStepIndices: executedActionOrders,
      authGateState,
      skippedSteps: Array.from(skippedActionOrders).map((order) => ({
        targetText: "",
        status: "skipped" as const,
        recoveredBy: "auth_flow",
        index: order
      })),
      satisfiedAssertions: earlyCompletion.satisfiedAssertions,
      pendingAssertions: earlyCompletion.pendingAssertions
    });

    const policyDiag = earlyCompletionPolicy.diagnostics;
    console.log(
      `[discovery:case] Early completion evaluation: currentTarget="${currentTarget}", currentIndex=${currentIndex}, executedStepIndices=[${Array.from(executedStepIndices).sort((a, b) => a - b).join(", ")}], pendingActions=[${remainingActionTargets.map(a => `${a.index}:${a.target}`).join(" | ")}], authConsumed=[${policyDiag.classifications.authConsumed.map(t => `"${t}"`).join(", ")}], optional=[${policyDiag.classifications.optional.map(t => `"${t}"`).join(", ")}], duplicateAlreadyExecuted=[${policyDiag.classifications.duplicateAlreadyExecuted.map(t => `"${t}"`).join(", ")}], functionalRequired=[${policyDiag.classifications.functionalRequired.map(t => `"${t}"`).join(", ")}].`
    );

    if (earlyCompletion.satisfied && earlyCompletionPolicy.allowed) {
      earlyCompletionSatisfied = true;
      console.log(`[discovery:case] Early completion allowed: ${earlyCompletionPolicy.reason}. Skipping remaining actions.`);
      for (const rem of remainingActionTargets) {
        steps.push({
          index: rem.index,
          action: rem.action,
          status: "skipped_after_completion",
          targetText: rem.target,
          error: "Skipped due to early completion validation passing.",
          earlyCompletionPolicyDiagnostics: policyDiag
        } as any);
      }
      return true;
    }

    if (earlyCompletion.satisfied && !earlyCompletionPolicy.allowed) {
      console.log(
        `[discovery:case] Early completion blocked: ${earlyCompletionPolicy.reason}. Pending functional actions: ${earlyCompletionPolicy.pendingFunctionalTargets.join(", ")}`
      );
    }

    if (!earlyCompletion.satisfied && earlyCompletion.pendingAssertions.length > 0) {
      console.log(
        `[discovery:case] Early completion not satisfied at step ${currentIndex}. Pending: [${earlyCompletion.pendingAssertions.map(a => `"${a}"`).join(", ")}]. Satisfied: [${earlyCompletion.satisfiedAssertions.map(a => `"${a}"`).join(", ")}].`
      );
    }

    return false;
  };

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
        target: { strategy: "login_resolver" as any, value: loginForm.userField.matchedText, exact: false },
        valueKey: key1
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
        target: { strategy: "login_resolver" as any, value: "password", exact: false },
        valueKey: key2
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
    console.log(`[discovery:case] authGateState after setupIntents: ${authGateState ? 'set' : 'not set'}`);
  }

  for (const orderedItem of orderedItems) {
    const currentActionOrder = orderedItem.type === "action" && orderedItem.actionTarget
      ? actionOrderIndexByTarget.get(orderedItem.actionTarget)
      : undefined;

    if (!authGateState) {
      const proactiveAuthCheck = await tryAuthGateRecovery(page, currentSnapshot, options);
      if (proactiveAuthCheck.recovered) {
        console.log(`[discovery:case] Proactive auth gate recovery completed before step: ${orderedItem.type}`);
        authGateState = proactiveAuthCheck.authGateState;
        // Track when AuthGate was completed for later AuthFlow insertion
        if (authGateState && authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
          // AuthFlow completed before this step - will be inserted after the previous executed step
          const lastExecutedStepIndex = executedStepIndices.size > 0 
            ? Math.max(...Array.from(executedStepIndices))
            : 0;
          authGateCompletedAfterStepIndex = lastExecutedStepIndex;
        console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex} (proactive)`);
        
        // The AuthFlow was triggered proactively before executing the current step (orderedItem)
        // The step that triggered AuthGate is the PREVIOUS step (the one that was just executed)
        // Set insertion index to be AFTER the previous step
        if (orderedItem.type === "action" && orderedItem.actionTarget) {
          // The previous step is the one that triggered AuthGate
          // Use the actionTarget index - 1 to insert after the previous step
          authGateCompletedAfterStepIndex = orderedItem.actionTarget.index - 1;
          console.log(`[discovery:case] Updated AuthGate insertion index to ${authGateCompletedAfterStepIndex} (after previous step, current=${orderedItem.actionTarget.index}: ${orderedItem.actionTarget.target})`);
        } else {
          // For other types, use orderedItem index - 1
          authGateCompletedAfterStepIndex = orderedItem.index - 1;
          console.log(`[discovery:case] Updated AuthGate insertion index to ${authGateCompletedAfterStepIndex} (orderedItem.index - 1)`);
        }
      }
        console.log(`[discovery:case] Waiting for stable page after AuthFlow...`);
        const stabilityResult = await waitForStablePageState(page, {
          timeoutMs: 20000,
          pollMs: 500,
          stableForMs: 1000,
          expectedLandingHints: [
            "transacciones y servicios",
            "transacciones y services",
            "selecciona la operación",
            "selecciona la operacion",
            "generar cartas"
          ]
        });
        console.log(`[discovery:case] Page stability: waited=${stabilityResult.waited}, reason=${stabilityResult.reason}, duration=${stabilityResult.durationMs}ms, url=${stabilityResult.finalUrl}`);
        const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        allDiscoveredObjects.push(...scan.objects);
      }
    }

    const currentActionTarget = orderedItem.actionTarget;
    
    // Check if this step should be skipped because AuthFlow already handled it
    // Skip if we're on operations menu and the step is the landing target
    if (authGateState && orderedItem.type === "action" && orderedItem.actionTarget) {
      const targetText = orderedItem.actionTarget.target.toLowerCase();
      const landingHints = ["transacciones y servicios", "transacciones y services", "operaciones", "operations menu"];
      const isLandingTarget = landingHints.some(hint => targetText.includes(hint));
      const isOnOperationsMenu = /operations-menu|operaciones|transacciones.*servicios/i.test(currentSnapshot.url);
      
      console.log(`[discovery:case] Skip check: type=${orderedItem.type}, target=${targetText}, isLanding=${isLandingTarget}, isOnMenu=${isOnOperationsMenu}, url=${currentSnapshot.url}`);
      
      if (isLandingTarget && isOnOperationsMenu) {
        console.log(`[discovery:case] Skipping step ${orderedItem.actionTarget.index} (${targetText}) - already on landing page after AuthFlow (url=${currentSnapshot.url})`);
        steps.push({
          index: orderedItem.actionTarget.index,
          action: orderedItem.actionTarget.action,
          status: "skipped",
          targetText: orderedItem.actionTarget.target,
          error: "Step consumed by AuthFlow navigation",
          recoveryStatus: "recovered",
          recoveredBy: "auth_flow"
        } as any);
        if (typeof currentActionOrder === "number") {
          skippedActionOrders.add(currentActionOrder);
        }
        // Skip adding to planSteps - AuthFlow already handled this navigation
        continue;
      }
    }

    if (currentActionTarget && authGateState && shouldSkipStepAsAuthConsumed(currentActionTarget.target, authGateState)) {
      console.log(`[discovery:case] Skipping auth-consumed step: ${currentActionTarget.target}`);
      authGateState.skippedAuthSteps.push({
        target: currentActionTarget.target,
        reason: "consumed_by_auth_flow"
      });
      steps.push({
        index: currentActionTarget.index,
        action: currentActionTarget.action,
        status: "skipped",
        targetText: currentActionTarget.target,
        error: `Step consumed by AuthFlow authentication.`,
        recoveryStatus: "recovered",
        recoveredBy: "auth_flow",
        authGateDiagnostics: {
          detected: true,
          detectedBeforeStep: currentActionTarget.target,
          stage: authGateState.stagesCompleted[0],
          requiredInputs: authGateState.consumedAuthTargets,
          completedBy: "AuthFlowRunner",
          maskedInputs: {}
        }
      } as any);
      if (typeof currentActionOrder === "number") {
        skippedActionOrders.add(currentActionOrder);
      }
      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: `AuthFlow handled: ${currentActionTarget.target}`,
        target: { strategy: "text", value: currentActionTarget.target, exact: false }
      });
      continue;
    }

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

      // Wait for page stability before evaluating assertion after transition
      const lastActionStep = steps.filter(s => 
        s.status === "found" || s.status === "satisfied_by_children" || s.status === "click_no_transition"
      ).pop();
      const isAfterTransition = lastActionStep && lastActionStep.recoveryMetadata?.transitionDetected === true;
      
      let stabilityDiagnostics: Record<string, unknown> | undefined;
      let snapshotForAssertion = currentSnapshot;
      
      if (isAfterTransition) {
        console.log(`[discovery:case] Waiting for stable page before assertion target="${es.target}"`);
        const stabilityStart = Date.now();
        
        try {
          const stabilityResult = await waitForStablePageState(page, {
            timeoutMs: 10000,
            pollMs: 500,
            stableForMs: 800
          });
          
          stabilityDiagnostics = {
            waited: true,
            reason: stabilityResult.finalStable ? "stabilized" : "timeout",
            durationMs: Date.now() - stabilityStart,
            finalUrl: stabilityResult.finalUrl,
            finalStable: stabilityResult.finalStable,
            transientDetections: stabilityResult.transientDetections?.length ?? 0
          };
          
          console.log(`[discovery:case] Assertion page stability: waited=true reason="${stabilityDiagnostics.reason}" durationMs=${stabilityDiagnostics.durationMs}`);
          
          // Refresh snapshot after stability
          snapshotForAssertion = await scanCurrentPage(page);
          console.log(`[discovery:case] Assertion snapshot refreshed target="${es.target}" visibleButtons=${snapshotForAssertion.elements.filter(e => e.role === "button" && e.visible).length} visibleHeadings=${snapshotForAssertion.elements.filter(e => e.type === "heading" && e.visible).length}`);
        } catch (stabilityError) {
          console.warn(`[discovery:case] Stability wait failed: ${stabilityError instanceof Error ? stabilityError.message : stabilityError}`);
          stabilityDiagnostics = {
            waited: true,
            reason: "error",
            error: stabilityError instanceof Error ? stabilityError.message : String(stabilityError),
            durationMs: Date.now() - stabilityStart
          };
        }
      }

      // Assertion retry mechanism
      const ASSERTION_RETRY_COUNT = 3;
      const ASSERTION_RETRY_INTERVAL_MS = 500;
      let resolutionResults: ReturnType<typeof resolveAssertionTargets> | undefined;
      let retryCount = 0;
      let lastFailureReason: string | undefined;
      
      while (retryCount < ASSERTION_RETRY_COUNT) {
        const assertionTargetInputs: AssertionTargetInput[] = [{
          index: es.stepIndex,
          action: es.originalText,
          target: es.target ?? "",
          source: "action"
        }];

        const executedActionsForAssertions = steps
          .filter((step) =>
            step.status === "found" ||
            step.status === "satisfied_by_children" ||
            step.status === "satisfied_by_previous_assertion"
          )
          .map((step) => ({
            action: step.action,
            target: step.targetText ?? "",
            status: "found" as const
          }));

        resolutionResults = resolveAssertionTargets(snapshotForAssertion, assertionTargetInputs, {
          executedActions: executedActionsForAssertions
        });
        
        // Check if any assertion passed
        const anyPassed = resolutionResults.some(r => r.status === "passed" || r.status === "satisfied_by_children" || r.status === "satisfied_by_previous_assertion");
        
        if (anyPassed) {
          break; // Success, no need to retry
        }
        
        // Track failure for diagnostics
        const failedAssertions = resolutionResults.filter(r => r.status === "failed" || r.status === "needs_assertion_resolution");
        if (failedAssertions.length > 0) {
          lastFailureReason = failedAssertions[0].reason;
        }
        
        // Retry if not last attempt and assertion failed
        if (retryCount < ASSERTION_RETRY_COUNT - 1 && !anyPassed) {
          console.log(`[discovery:case] Assertion retry ${retryCount + 1}/${ASSERTION_RETRY_COUNT} target="${es.target}" reason="${lastFailureReason}"`);
          await new Promise(resolve => setTimeout(resolve, ASSERTION_RETRY_INTERVAL_MS));
          
          // Refresh snapshot for retry
          try {
            snapshotForAssertion = await scanCurrentPage(page);
          } catch (scanError) {
            console.warn(`[discovery:case] Snapshot refresh failed: ${scanError instanceof Error ? scanError.message : scanError}`);
          }
          
          retryCount++;
        } else {
          break;
        }
      }
      
      // resolutionResults should always be defined after the loop
      if (!resolutionResults) {
        console.error(`[discovery:case] Assertion resolution failed to produce results target="${es.target}"`);
        resolutionResults = [];
      }
      
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
                  : assertionResult.status === "optional_confirmation_detail_missing"
                    ? "optional_confirmation_detail_missing"
                    : assertionResult.status === "satisfied_by_previous_assertion"
                      ? "satisfied_by_previous_assertion"
                      : assertionResult.status === "precondition_unresolved"
                        ? "precondition_unresolved"
                        : "not_found";

        // Determine error message based on status
        let errorMessage: string | undefined = undefined;
        if (assertionResult.status === "failed" || assertionResult.status === "needs_assertion_resolution") {
          errorMessage = assertionResult.reason;
        } else if (assertionResult.status === "optional_confirmation_detail_missing") {
          errorMessage = `Optional confirmation detail: ${assertionResult.reason}`;
        } else if (assertionResult.status === "precondition_unresolved") {
          errorMessage = `Precondition not met: ${assertionResult.reason}`;
        }

        // Build comprehensive diagnostics for assertion
        const assertionDiag: Record<string, unknown> = {
          ...assertionResult.assertionDiagnostics
        };
        
        // Add stability diagnostics
        if (stabilityDiagnostics) {
          assertionDiag.stability = stabilityDiagnostics;
        }
        
        // Add retry diagnostics
        if (retryCount > 0 || lastFailureReason) {
          assertionDiag.retry = {
            count: retryCount,
            maxAttempts: ASSERTION_RETRY_COUNT,
            lastFailureReason: lastFailureReason
          };
        }
        
        // Add back/return alias diagnostics if present
        if (assertionResult.matchReason?.includes("alias") || assertionResult.originalTarget) {
          assertionDiag.backReturnAlias = {
            originalTarget: assertionResult.originalTarget || es.target,
            matchedTarget: assertionResult.matchedTarget,
            matchReason: assertionResult.matchReason,
            aliasResolverUsed: true
          };
        }

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
          error: errorMessage,
          closestCandidates: assertionResult.closestCandidates,
          visibleTexts: assertionResult.visibleTexts,
          descriptorTypes: assertionResult.descriptorTypes,
          subject: assertionResult.subject,
          matchedTokens: assertionResult.matchedTokens,
          structuralSignals: assertionResult.structuralSignals,
          childAssertionsUsed: assertionResult.childAssertionsUsed,
          assertionDiagnostics: assertionDiag
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

          // AI Repair for assertions: attempt assertion_resolution after local resolvers fail
          if (assertionResult.status === "needs_assertion_resolution" && envTrue("AI_REPAIR_ENABLED", false) && envTrue("AI_REPAIR_USE_CONTEXT_PACK", true)) {
            const aiAssertionStartTime = Date.now();
            console.log(`[ai-repair:assertion] enabled provider=${process.env.AI_PROVIDER ?? "unknown"} model=${process.env.AI_MODEL ?? "unknown"}`);
            console.log(`[ai-repair:assertion] failure=assertion_not_satisfied target="${assertionResult.assertionText}"`);

            // Build evidence candidates from assertion resolution result
            const evidenceCandidates = [
              ...(assertionResult.visibleTexts?.map((t: string, i: number) => ({
                evidenceId: `ev-text-${i}`,
                type: "text_visible" as const,
                text: t,
                visible: true,
                source: "runtimeEvidenceTrace" as const,
                confidence: 0.8,
                sensitive: false
              })) ?? []),
              ...(assertionResult.closestCandidates?.map((c: any, i: number) => ({
                evidenceId: `ev-candidate-${i}`,
                type: "structural" as const,
                text: c.text ?? c.name ?? c.label,
                visible: c.visible ?? true,
                source: "structuralEvidence" as const,
                confidence: c.confidence ?? 0.7,
                sensitive: false
              })) ?? [])
            ];

            console.log(`[ai-repair:assertion] context evidenceCandidates=${evidenceCandidates.length}`);

            const aiAssertionRepair = await runAiRepairOrchestrator({
              appSlug: String((options.env as any)?.APP_SLUG ?? "default"),
              failure: "assertion_not_satisfied",
              failureType: "assertion_not_satisfied",
              currentStep: es.originalText,
              currentUrl: page.url(),
              snapshotSummary: {
                title: currentSnapshot.title,
                url: currentSnapshot.url,
                summary: currentSnapshot.summary
              },
              candidates: currentSnapshot.elements.map((el) => ({
                candidateId: el.id,
                role: el.role,
                name: el.name,
                text: el.text,
                visible: Boolean(el.visible),
                enabled: undefined,
                clickable: Boolean(el.visible && (el.type === "button" || el.type === "link" || el.role === "button" || el.role === "link")),
                editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
                sensitive: false
              })),
              runtimeEvidenceTrace: { matchedText: assertionResult.matchedText, confidence: assertionResult.confidence },
              structuralEvidence: assertionResult.structuralSignals,
              feedbackEvidence: steps.slice(-5).map((s) => ({ index: s.index, status: s.status, targetText: s.targetText })),
              pendingAssertions: [assertionResult.assertionText],
              previousActions: steps.filter((s) => s.targetText).map((s) => `${s.action}: ${s.targetText}`),
              previousFills: planSteps.filter((s) => s.action === "fill").map((s) => `${s.description ?? "fill"}:${(s as any).valueKey ?? ""}`),
              constraints: [
                "must_use_existing_evidence_id",
                "no_invented_text",
                "no_selector_invention",
                "no_sensitive_evidence"
              ],
              assertionTarget: assertionResult.assertionText,
              assertionText: assertionResult.assertionText,
              evidenceCandidates,
              currentScreen: {
                url: currentSnapshot.url,
                title: currentSnapshot.title,
                visibleTextSummary: assertionResult.visibleTexts,
                visibleDialogs: [],
                visibleForms: []
              }
            });
            const aiAssertionDuration = Date.now() - aiAssertionStartTime;

            console.log(`[ai-repair:assertion] decision=status ${aiAssertionRepair.status}`);
            console.log(`[ai-repair:assertion] validated=${aiAssertionRepair.status === "repaired_plan" || aiAssertionRepair.status === "no_safe_action" || aiAssertionRepair.status === "needs_more_context"}`);

            // Build comprehensive diagnostics for artifact
            const aiAssertionDiagnostics = {
              enabled: true,
              providerName: aiAssertionRepair.diagnostics.provider ?? "unknown",
              model: process.env.AI_MODEL ?? "unknown",
              failureType: "assertion_not_satisfied",
              assertionTarget: assertionResult.assertionText,
              contextPackSummary: {
                evidenceCandidateCount: evidenceCandidates.length,
                hasSecrets: false,
                maxContextChars: 30000
              },
              decisionStatus: aiAssertionRepair.status,
              validationStatus: aiAssertionRepair.status === "invalid_response" ? "invalid" : aiAssertionRepair.status === "provider_error" ? "error" : "valid",
              selectedEvidenceId: aiAssertionRepair.decision?.evidenceId ?? null,
              evidenceType: aiAssertionRepair.diagnostics.evidenceType ?? null,
              assertionStatus: aiAssertionRepair.decision?.assertionStatus ?? null,
              blockedReason: aiAssertionRepair.diagnostics.errorCode ?? null,
              durationMs: aiAssertionDuration
            };

            (assertionResult as any).aiRepairDiagnostics = aiAssertionDiagnostics;

            // If AI found existing evidence that satisfies assertion, mark as satisfied
            if (aiAssertionRepair.status === "repaired_plan" && aiAssertionRepair.decision?.evidenceId && aiAssertionRepair.decision.assertionStatus === "satisfied_by_existing_evidence") {
              console.log(`[ai-repair:assertion] assertion satisfied by existing evidence: ${aiAssertionRepair.decision.evidenceId}`);
              // Update step status to reflect AI resolution
              steps[steps.length - 1].status = "found";
              steps[steps.length - 1].recoveryStatus = "recovered";
              (steps[steps.length - 1] as any).recoveredBy = "ai_repair";
              (steps[steps.length - 1] as any).aiAssertionDiagnostics = aiAssertionDiagnostics;
              // Clear the failedAtStep marker since assertion was resolved
              if (failedAtStep === es.stepIndex) {
                failedAtStep = undefined;
                failedTarget = undefined;
                failedReason = undefined;
              }
            } else {
              console.log(`[ai-repair:assertion] no safe action or needs more context for assertion`);
              (steps[steps.length - 1] as any).aiAssertionDiagnostics = aiAssertionDiagnostics;
            }
          }
        }
      }
      continue;
    }

    if (orderedItem.type === "nav_segment") {
      const nav = orderedItem.navTarget!;
      if (authGateState && shouldSkipStepAsAuthConsumed(nav.target, authGateState)) {
        console.log(`[discovery:case] Skipping auth-consumed nav segment: ${nav.target}`);
        authGateState.skippedAuthSteps.push({
          target: nav.target,
          reason: "consumed_by_auth_flow"
        });
        steps.push({
          index: orderedItem.index,
          action: nav.action,
          status: "skipped",
          targetText: nav.target,
          error: `Nav segment consumed by AuthFlow authentication.`,
          recoveryStatus: "recovered",
          recoveredBy: "auth_flow",
          authGateDiagnostics: {
            detected: true,
            detectedBeforeStep: nav.target,
            stage: authGateState.stagesCompleted[0],
            requiredInputs: authGateState.consumedAuthTargets,
            completedBy: "AuthFlowRunner",
            maskedInputs: {}
          }
        } as any);
        planSteps.push({
          index: planSteps.length + 1,
          action: "click",
          description: `AuthFlow handled: ${nav.target}`,
          target: { strategy: "text", value: nav.target, exact: false }
        });
        continue;
      }
      console.log(`[discovery:case] Resolving nav segment: ${nav.target}`);
      const navStability = await waitForStablePageState(page, { timeoutMs: 10000, pollMs: 500, stableForMs: 800 });
      if (navStability.waited) {
        console.log(`[discovery:case] Page stability wait before nav: reason=${navStability.reason}, duration=${navStability.durationMs}ms`);
        const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
        currentSnapshot = scan.snapshot;
      }
      const resolution = await resolveActionTarget(page, currentSnapshot, nav.target, { routeProfile });
      if (resolution.status !== "resolved" || !resolution.locator) {
        console.log(`[discovery:case] Nav segment not found: ${nav.target}`);

        const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const authRecovery = await tryAuthGateRecovery(page, currentSnapshot, options);
        if (authRecovery.recovered) {
          console.log(`[discovery:case] Auth gate recovery successful, retrying nav segment...`);
          if (authRecovery.authGateState) {
            authGateState = authRecovery.authGateState;
            // Track when AuthGate was completed for later AuthFlow insertion
            if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
              // AuthFlow completed before this step - will be inserted after the previous executed step
              const lastExecutedStepIndex = executedStepIndices.size > 0 
                ? Math.max(...Array.from(executedStepIndices))
                : 0;
              authGateCompletedAfterStepIndex = lastExecutedStepIndex;
              console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
            }
          }
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const retryScan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
          currentSnapshot = retryScan.snapshot;
          allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, nav.target, { routeProfile });
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            await clickResolvedTarget(retryResolution.locator, false);
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            const postClickScan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            if (authGateState?.completed) {
              markFunctionalStepAfterAuth(nav.target, authGateState);
            }

            executedStepIndices.add(orderedItem.index);

            steps.push({
              index: orderedItem.index,
              action: nav.action,
              status: "found",
              targetText: nav.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
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
        }

        steps.push({
          index: orderedItem.index,
          action: nav.action,
          status: "not_found",
          targetText: nav.target,
          error: authRecovery.error
            ? `Nav segment target "${nav.target}" not found. Auth gate recovery attempted but failed: ${authRecovery.error}`
            : `Nav segment target "${nav.target}" not found`
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

      if (authGateState?.completed) {
        markFunctionalStepAfterAuth(nav.target, authGateState);
      }

      executedStepIndices.add(orderedItem.index);

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
      
      // Build auto-generate config from env/config
      const env = options.env ?? {};
      const missingInputBehavior = options.missingInputBehavior ?? "fail";
      const autoGenerateTestData = env.AUTO_GENERATE_TEST_DATA === true || env.AUTO_GENERATE_TEST_DATA === "true";
      const autoGenerateSensitiveData = env.AUTO_GENERATE_SENSITIVE_DATA === true || env.AUTO_GENERATE_SENSITIVE_DATA === "true";
      const testDataProfile = (env.APP_TEST_DATA_PROFILE as "demo" | "qa" | "staging" | "production_like") || "qa";
      const autoGenerateConfig: AutoGenerateConfig = {
        enabled: autoGenerateTestData,
        generateSensitiveData: autoGenerateSensitiveData,
        profile: testDataProfile
      };
      
      console.log(`[data-resolver] config: missingInputBehavior=${missingInputBehavior}, autoGenerateTestData=${autoGenerateTestData}, profile=${testDataProfile}, autoGenerateSensitiveData=${autoGenerateSensitiveData}`);
      console.log(`[data-resolver] resolving key="${actionTarget.valueKey}" field="${actionTarget.target}"`);
      
      const testDataMap = testData ?? {};
      const testDataAliases = (env.APP_TEST_DATA_ALIASES_JSON as Record<string, string[]>) ?? {};
      const envVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === "string") {
          envVars[k] = v;
        }
      }
      
      const dataResolution = resolveDataKey(actionTarget.valueKey, {
        testData: testDataMap,
        testDataAliases,
        env: envVars,
        missingInputBehavior,
        autoGenerateConfig,
        field: actionTarget.target,
        context: scenario.title
      });
      
      console.log(formatDataKeyForLog(dataResolution));
      
      if (dataResolution.status === "missing" || dataResolution.status === "missing_sensitive") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        
        const errorMsg = dataResolution.status === "missing_sensitive"
          ? `Missing sensitive test data value for key "${actionTarget.valueKey}". Set APP_TEST_DATA_JSON.${actionTarget.valueKey} or enable AUTO_GENERATE_SENSITIVE_DATA for test data.`
          : `Missing test data value for key "${actionTarget.valueKey}". Set APP_TEST_DATA_JSON.${actionTarget.valueKey} or APP_${actionTarget.valueKey.toUpperCase()}`;
        
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
        failedReason = dataResolution.status === "missing_sensitive" ? "missing_sensitive_test_data" : "missing_test_data";
        
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
      
      if (dataResolution.status === "skipped") {
        console.log(`[discovery:case] Skipping fill due to missingInputBehavior=skip: ${actionTarget.valueKey}`);
        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "skipped",
          targetText: actionTarget.target,
          error: dataResolution.error
        });
        continue;
      }
      
      // Track resolved data keys
      if (actionTarget.valueKey) {
        resolvedDataKeys.add(actionTarget.valueKey);
      }
      
      const fillValue = dataResolution.value!;

      const fillStability = await waitForStablePageState(page, { timeoutMs: 10000, pollMs: 500, stableForMs: 800 });
      if (fillStability.waited) {
        console.log(`[discovery:case] Page stability wait before fill: reason=${fillStability.reason}, duration=${fillStability.durationMs}ms`);
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
      }

      const resolution = await resolveFillTarget(page, currentSnapshot, actionTarget.target, activeContainer);

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

        const authRecovery = await tryAuthGateRecovery(page, currentSnapshot, options);
        if (authRecovery.recovered) {
          console.log(`[discovery:case] Auth gate recovery successful, retrying fill target...`);
          if (authRecovery.authGateState) {
            authGateState = authRecovery.authGateState;
            // Track when AuthGate was completed for later AuthFlow insertion
            if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
              const lastExecutedStepIndex = executedStepIndices.size > 0 
                ? Math.max(...Array.from(executedStepIndices))
                : 0;
              authGateCompletedAfterStepIndex = lastExecutedStepIndex;
              console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
            }
          }
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = retryScan.snapshot;
          allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveFillTarget(page, currentSnapshot, actionTarget.target, activeContainer);
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            console.log(`[discovery:case] Filling target after auth recovery: ${actionTarget.target}`);
            try {
              await retryResolution.locator.fill(fillValue);
            } catch (err) {
              const errorMsg = `Fill failed after auth recovery: ${err instanceof Error ? err.message : String(err)}`;
              steps.push({
                index: actionTarget.index,
                action: actionTarget.action,
                status: "not_found",
                targetText: actionTarget.target,
                snapshotUrl: retryScan.url,
                snapshotTitle: retryScan.title,
                elementsFound: retryScan.elementsCount,
                error: errorMsg,
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

            const postFillScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postFillScan.snapshot;
            allDiscoveredObjects.push(...postFillScan.objects);

            if (authGateState?.completed) {
              markFunctionalStepAfterAuth(actionTarget.target, authGateState);
            }

            executedStepIndices.add(actionTarget.index);

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postFillScan.url,
              snapshotTitle: postFillScan.title,
              elementsFound: postFillScan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext
            });

            planSteps.push({
              index: planSteps.length + 1,
              action: "fill",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false },
              valueKey: actionTarget.valueKey
            });
            continue;
          }
        }

        const editableCandidatesCount = (resolution as any).editableCandidatesCount ?? 0;
        const errorMsg = `Fill target "${actionTarget.target}" not found on current page. ${editableCandidatesCount} editable candidates evaluated.`;

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

      if (resolution.status === "not_editable" || resolution.status === "fill_target_not_editable") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const nonEditable = (resolution as any).nonEditableMatch;
        const errorMsg = nonEditable
          ? `Fill target "${actionTarget.target}" matched non-editable element <${nonEditable.tag}>: "${nonEditable.text}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`
          : `Fill target "${actionTarget.target}" matched non-editable element. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

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
          attemptedLocators: (resolution as any).attemptedLocators,
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

      if (resolution.status === "not_visible") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill target "${actionTarget.target}" is not visible on current page. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_visible",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_visible";

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

      if (resolution.status !== "resolved") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill resolution failed: status="${resolution.status}" reason="${resolution.matchReason}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        console.log(`[discovery:case] Fill resolution failed: ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_failed",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_failed";

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

        const errorMsg = `Fill resolution invalid: status="resolved" but locator is missing. This is a contract violation.`;

        console.log(`[discovery:case] ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_invalid",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators,
          locatorStrategy: resolution.locatorStrategy
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_invalid";

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
        await resolution.locator.fill(fillValue);
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

      if (authGateState?.completed) {
        markFunctionalStepAfterAuth(actionTarget.target, authGateState);
      }

      executedStepIndices.add(actionTarget.index);

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
        target: { strategy: "text", value: actionTarget.target, exact: false },
        valueKey: actionTarget.valueKey
      });

      continue;
    }

    if (actionTarget.valueSource === "literal" && actionTarget.value) {
      console.log(`[discovery:case] Resolving fill target: ${actionTarget.target}`);
      console.log(`[discovery:case] Using literal value: ${actionTarget.value}`);

      const fillStability2 = await waitForStablePageState(page, { timeoutMs: 10000, pollMs: 500, stableForMs: 800 });
      if (fillStability2.waited) {
        console.log(`[discovery:case] Page stability wait before fill: reason=${fillStability2.reason}, duration=${fillStability2.durationMs}ms`);
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
      }

      const resolution = await resolveFillTarget(page, currentSnapshot, actionTarget.target, activeContainer);

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

        const errorMsg = `Fill target "${actionTarget.target}" not found on current page. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

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

      if (resolution.status === "not_editable" || resolution.status === "fill_target_not_editable") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const nonEditable = (resolution as any).nonEditableMatch;
        const errorMsg = nonEditable
          ? `Fill target "${actionTarget.target}" matched non-editable element <${nonEditable.tag}>: "${nonEditable.text}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`
          : `Fill target "${actionTarget.target}" matched non-editable element. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

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
          attemptedLocators: (resolution as any).attemptedLocators,
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

      if (resolution.status === "not_visible") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill target "${actionTarget.target}" is not visible on current page. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_visible",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_visible";

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

      if (resolution.status !== "resolved") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill resolution failed: status="${resolution.status}" reason="${resolution.matchReason}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        console.log(`[discovery:case] Fill resolution failed: ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_failed",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_failed";

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

        const errorMsg = `Fill resolution invalid: status="resolved" but locator is missing. This is a contract violation.`;

        console.log(`[discovery:case] ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_invalid",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators,
          locatorStrategy: resolution.locatorStrategy
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_invalid";

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
        await resolution.locator.fill(actionTarget.value);
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

      if (authGateState?.completed) {
        markFunctionalStepAfterAuth(actionTarget.target, authGateState);
      }

      executedStepIndices.add(actionTarget.index);

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

    const stabilityResult = await waitForStablePageState(page, {
      timeoutMs: 10000,
      pollMs: 500,
      stableForMs: 800
    });
    if (stabilityResult.waited) {
      console.log(`[discovery:case] Page stability wait: reason=${stabilityResult.reason}, duration=${stabilityResult.durationMs}ms`);
      const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = scan.snapshot;
    }

    // Build route history from previous found steps
    const routeHistory = steps
      .filter(s => s.status === "found" && s.targetText)
      .map(s => s.targetText!);
    
    // Get next target for contextual resolution
    const nextTarget = parsed.actionTargets.find(a => a.index > actionTarget.index)?.target;
    
    // Get previous target from relation context or route history
    const previousTarget = actionTarget.relationContext || routeHistory[routeHistory.length - 1];

    const resolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
      semanticRole: actionTarget.semanticRole,
      relationContext: actionTarget.relationContext,
      activeContainer,
      routeProfile,
      actionText: actionTarget.action,
      nextTarget,
      previousTarget,
      routeHistory
    });

    let finalLocator = resolution.locator;
    let promotedToAncestor = false;

    if (resolution.locator && isSelectionLikeTarget(actionTarget.target, { action: actionTarget.action, actionType: actionTarget.actionType, snapshot: currentSnapshot })) {
      console.log(`[discovery:case] Selection-like target detected: action=${actionTarget.action} target="${actionTarget.target}"`);
      const promotion = await promoteToClickableAncestor(resolution.locator);
      if (promotion.promoted) {
        console.log(`[discovery:case] Promoted locator to clickable ancestor: ${promotion.fromTag} -> ${promotion.toTag}`);
        finalLocator = promotion.locator;
        promotedToAncestor = true;
      } else {
        console.log(`[discovery:case] No clickable ancestor found for selection-like target: ${actionTarget.target}`);
      }
    }

    if (resolution.status === "resolved" && resolution.confidence >= aiConfig.confidenceThreshold && finalLocator) {
      console.log(`[discovery:case] Deterministic target resolved: ${actionTarget.target} (confidence: ${resolution.confidence.toFixed(2)})`);
    }
    
    // Handle contextual intermediate already satisfied - skip click and continue
    if (resolution.locatorStrategy === "contextual_intermediate_already_satisfied") {
      console.log(`[discovery:case] Contextual intermediate already satisfied: ${actionTarget.target}. Continuing without click.`);
      console.log(`[discovery:case] Evidence: ${resolution.alreadySatisfiedEvidence?.candidateText} (${resolution.alreadySatisfiedEvidence?.candidateType})`);
      
      // Mark step as found/recovered without executing click
      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "found",
        targetText: actionTarget.target,
        snapshotUrl: currentSnapshot.url,
        snapshotTitle: currentSnapshot.title,
        elementsFound: currentSnapshot.elements.length,
        locatorStrategy: "contextual_intermediate_already_satisfied",
        candidateText: resolution.alreadySatisfiedEvidence?.candidateText,
        recoveredBy: "contextual_intermediate_already_satisfied",
        recoveryMetadata: {
          rationale: `Intermediate variant "${actionTarget.target}" already visible in list. Next step is ordinal selection.`,
          alreadySatisfiedEvidence: resolution.alreadySatisfiedEvidence
        },
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
      });
      
      // Continue to next step without clicking
      continue;
    }

    const needsEarlyCompletionCheck =
      resolution.status === "not_found" ||
      resolution.status === "ambiguous" ||
      resolution.status === "locator_resolution_failed" ||
      resolution.confidence < aiConfig.confidenceThreshold;

    const earlyCompletion = evaluateEarlyCompletion(currentSnapshot, parsed.assertionTargets, parsed.actionTargets.filter(a => a.index > actionTarget.index));
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
        action: "fill",
        description: actionTarget.action,
        target: { strategy: "text", value: actionTarget.target, exact: false },
        valueKey: actionTarget.valueKey
      });

        if (authGateState?.completed) {
          markFunctionalStepAfterAuth(actionTarget.target, authGateState);
        }
        executedStepIndices.add(actionTarget.index);
        if (typeof currentActionOrder === "number") {
          executedActionOrders.add(currentActionOrder);
        }
        if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
          break;
        }

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

        // Check if we should block low-confidence semantic fallback for selection-like targets
        const isSelectionLike = isSelectionLikeTargetNew(actionTarget.target);
        const selectionThreshold = getSelectionConfidenceThreshold();
        const shouldBlockFallback = isSelectionLike && 
          resolution.confidence < selectionThreshold && 
          resolution.locatorStrategy?.includes("semantic");

        if (resolution.status === "resolved" && resolution.locator && !shouldBlockFallback) {
          console.log(`[discovery:case] AI failed but deterministic locator exists. Using deterministic resolution.`);
          (resolution as any)._aiFailedDeterministicAvailable = true;
        } else if (shouldBlockFallback) {
          console.log(`[discovery:case] Low-confidence semantic selection blocked: target="${actionTarget.target}" confidence=${resolution.confidence.toFixed(2)} threshold=${selectionThreshold}`);
          console.log(`[discovery:case] Will invoke AI selection_resolution or fail safely instead of using low-confidence semantic match.`);
          // Block the fallback by clearing the locator and marking as blocked
          (resolution as any)._selectionFallbackBlocked = true;
          (resolution as any)._aiFailedDeterministicAvailable = false;
          // Clear the locator to prevent click execution
          resolution.locator = undefined;
          resolution.status = "ambiguous" as any;
          // Also clear finalLocator to prevent click at line 3318
          finalLocator = undefined;
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

        const authRecovery = await tryAuthGateRecovery(page, currentSnapshot, options);
        if (authRecovery.recovered) {
          console.log(`[discovery:case] Auth gate recovery successful, retrying click target...`);
          if (authRecovery.authGateState) {
            authGateState = authRecovery.authGateState;
            // Track when AuthGate was completed for later AuthFlow insertion
            if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
              const lastExecutedStepIndex = executedStepIndices.size > 0 
                ? Math.max(...Array.from(executedStepIndices))
                : 0;
              authGateCompletedAfterStepIndex = lastExecutedStepIndex;
              console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
            }
          }
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = retryScan.snapshot;
          allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, { routeProfile, actionText: actionTarget.action });
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            await clickResolvedTarget(retryResolution.locator, false);
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            if (authGateState?.completed) {
              markFunctionalStepAfterAuth(actionTarget.target, authGateState);
            }

            executedStepIndices.add(actionTarget.index);
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
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
            if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
              break;
            }
            continue;
          }
        }

        const diagnosis = (resolution as any)._diagnosis;
        let errorMsg = `Target "${actionTarget.target}" not found on current page. ${resolution.candidates?.length ?? 0} candidates evaluated.`;
        if (diagnosis && Array.isArray(diagnosis) && diagnosis.length > 0) {
          errorMsg += " Diagnosis: " + JSON.stringify(diagnosis);
        }
        if (authRecovery.error) {
          errorMsg += ` Auth gate recovery attempted but failed: ${authRecovery.error}`;
        }

        // AI repair orchestration (phase 1): target_not_found only, after all local resolvers fail.
        if (envTrue("AI_REPAIR_ENABLED", false) && envTrue("AI_REPAIR_USE_CONTEXT_PACK", true)) {
          const aiCandidates = currentSnapshot.elements.map((el) => ({
            candidateId: el.id,
            role: el.role,
            name: el.name,
            text: el.text,
            visible: Boolean(el.visible),
            enabled: undefined,
            clickable: Boolean(el.visible && (el.type === "button" || el.type === "link" || el.role === "button" || el.role === "link")),
            editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
            semanticRelation: undefined,
            score: resolution.candidates.find((c) => c.elementId === el.id)?.matchScore,
            sensitive: false
          }));

          // Build enhanced AI Repair diagnostics for artifact persistence
          const aiRepairStartTime = Date.now();
          console.log(`[ai-repair] enabled provider=${process.env.AI_PROVIDER ?? "unknown"} model=${process.env.AI_MODEL ?? "unknown"}`);
          console.log(`[ai-repair] failure=target_not_found target="${actionTarget.target}"`);
          console.log(`[ai-repair] context candidates=${aiCandidates.length}`);

          const aiRepair = await runAiRepairOrchestrator({
            appSlug: String((options.env as any)?.APP_SLUG ?? "default"),
            failure: "target_not_found",
            currentStep: actionTarget.action,
            currentUrl: page.url(),
            snapshotSummary: {
              title: currentSnapshot.title,
              url: currentSnapshot.url,
              summary: currentSnapshot.summary
            },
            candidates: aiCandidates,
            runtimeEvidenceTrace: { attemptedLocators: resolution.attemptedLocators, matchReason: resolution.matchReason },
            structuralEvidence: diagnosis,
            feedbackEvidence: steps.slice(-5).map((s) => ({ index: s.index, status: s.status, targetText: s.targetText })),
            pendingAssertions: parsed.assertionTargets.map((a) => a.target),
            previousActions: steps.filter((s) => s.targetText).map((s) => `${s.action}: ${s.targetText}`),
            previousFills: planSteps.filter((s) => s.action === "fill").map((s) => `${s.description ?? "fill"}:${(s as any).valueKey ?? ""}`),
            constraints: [
              "forbid_action:fill",
              "forbid_action:select",
              "must_return_existing_candidate_id",
              "no_selector_invention"
            ]
          });
          const aiRepairDuration = Date.now() - aiRepairStartTime;

          console.log(`[ai-repair] decision=status ${aiRepair.status}`);
          console.log(`[ai-repair] validated=${aiRepair.status === "repaired_plan" || aiRepair.status === "no_safe_action" || aiRepair.status === "needs_more_context"}`);

          // Build comprehensive diagnostics for artifact
          const aiRepairDiagnostics = {
            enabled: true,
            providerName: aiRepair.diagnostics.provider ?? "unknown",
            model: process.env.AI_MODEL ?? "unknown",
            failureType: "target_not_found",
            target: actionTarget.target,
            contextPackSummary: {
              candidateCount: aiCandidates.length,
              hasSecrets: false, // Context pack redacts secrets internally
              maxContextChars: 30000
            },
            decisionStatus: aiRepair.status,
            validationStatus: aiRepair.status === "invalid_response" ? "invalid" : aiRepair.status === "provider_error" ? "error" : "valid",
            selectedCandidateId: aiRepair.decision?.candidateId ?? null,
            blockedReason: aiRepair.diagnostics.errorCode ?? null,
            durationMs: aiRepairDuration
          };

          (resolution as any).aiRepairDiagnostics = aiRepairDiagnostics;

          if (aiRepair.status === "repaired_plan" && aiRepair.decision?.candidateId) {
            const selected = currentSnapshot.elements.find((el) => el.id === aiRepair.decision!.candidateId);
            if (selected) {
              const resolvedFromAi = await resolveSnapshotElementLocator(page, {
                element: selected,
                target: actionTarget.target,
                candidateText: selected.text ?? selected.label ?? selected.name ?? selected.placeholder ?? actionTarget.target,
                type: selected.type,
                tagName: selected.tagName,
                confidence: aiRepair.decision.confidence ?? 0.5,
                matchReason: `ai_repair:${aiRepair.decision.repairType ?? "target_resolution"}`
              });
              if (resolvedFromAi.locator) {
                await clickResolvedTarget(resolvedFromAi.locator, false).catch(async () => {
                  await clickResolvedTarget(resolvedFromAi.locator!, true);
                });
                await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                currentSnapshot = aiRecoveredScan.snapshot;
                allDiscoveredObjects.push(...aiRecoveredScan.objects);

                steps.push({
                  index: actionTarget.index,
                  action: actionTarget.action,
                  status: "found",
                  targetText: actionTarget.target,
                  snapshotUrl: aiRecoveredScan.url,
                  snapshotTitle: aiRecoveredScan.title,
                  elementsFound: aiRecoveredScan.elementsCount,
                  evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
                  aiAssisted: true,
                  aiReason: "ai_repair_orchestrator",
                  semanticRole: actionTarget.semanticRole,
                  relationContext: actionTarget.relationContext
                });

                planSteps.push({
                  index: planSteps.length + 1,
                  action: "click",
                  description: actionTarget.action,
                  target: { strategy: "text", value: actionTarget.target, exact: false }
                });

                executedStepIndices.add(actionTarget.index);
                if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
                  break;
                }
                continue;
              }
            }
          }
        }

        // Route completion: attempt to insert missing intermediate step before declaring failure
        const appSlug = options.appSlug ?? "default";
        const routeCompletionConfig = (options as any)?.aiAssistedDiscovery?.config?.routeCompletion;
        const rcRouteProfile = routeCompletionConfig?.useAppProfile !== false ? loadRouteProfile(appSlug) : undefined;
        
        console.log(`[route-completion] app context appSlug=${appSlug} source=${options.appSlug ? "workflow" : "default-fallback"}`);
        
        const routeCompletionAttempted = routeCompletionConfig?.enabled === true;
        let routeCompletionResolution: MissingIntermediateStepResolution | undefined;
        let routeCompletionDiagnostics: any = undefined;

        if (routeCompletionAttempted) {
          console.log(`[route-completion] attempted step=${actionTarget.index} failure=target_not_found`);
          console.log(`[route-completion] routeProfile loaded=${Boolean(rcRouteProfile)} appSlug=${appSlug}`);
          
          const currentRouteHistory = steps
            .filter((s) => (s as any).status === "passed" && s.targetText)
            .map((s) => s.targetText!);
          
          const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
          console.log(`[route-completion] routeHistory=[${currentRouteHistory.join(", ")}] lastSuccessfulTarget=${lastSuccessfulTarget ?? "none"}`);
          
          const aiCandidates: DiscoveryCandidate[] = currentSnapshot.elements.map((el) => ({
            candidateId: el.id,
            role: el.role,
            name: el.name,
            text: el.text,
            visible: Boolean(el.visible),
            enabled: undefined,
            clickable: Boolean(el.visible && (el.type === "button" || el.type === "link" || el.role === "button" || el.role === "link")),
            editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
            sensitive: false
          }));

          const snapshot: DiscoverySnapshot = {
            url: currentSnapshot.url,
            title: currentSnapshot.title,
            visibleHeadings: [],
            visibleNavItems: [],
            visibleActions: [],
            visibleTextSummary: []
          };

          const insertedStepsSoFar = (steps as any).insertedSteps?.length ?? 0;

          routeCompletionResolution = resolveMissingIntermediateStep({
            appSlug,
            routeProfile: rcRouteProfile,
            currentRouteHistory,
            currentStepText: actionTarget.action,
            currentTarget: actionTarget.target,
            failureType: "target_not_found",
            snapshot,
            candidates: aiCandidates,
            insertedStepsSoFar,
            config: {
              enabled: routeCompletionConfig?.enabled ?? false,
              minConfidence: routeCompletionConfig?.minConfidence ?? 0.75,
              maxInsertedSteps: routeCompletionConfig?.maxInsertedSteps ?? 1,
              useAppProfile: routeCompletionConfig?.useAppProfile ?? true,
              allowGeneric: routeCompletionConfig?.allowGeneric ?? true
            }
          });

          console.log(`[route-completion] appSlug=${appSlug} routeProfileUsed=${Boolean(rcRouteProfile)}`);

          if (routeCompletionResolution.status === "repaired_plan" && routeCompletionResolution.candidateId) {
            const selectedCandidate = aiCandidates.find((c) => c.candidateId === routeCompletionResolution!.candidateId);
            console.log(`[route-completion] selected candidate="${selectedCandidate?.name ?? selectedCandidate?.text}" source=${routeCompletionResolution.source} confidence=${routeCompletionResolution.confidence}`);

            const selectedElement = currentSnapshot.elements.find((el) => el.id === routeCompletionResolution!.candidateId);
            
            if (selectedElement) {
              const resolvedInserted = await resolveSnapshotElementLocator(page, {
                element: selectedElement,
                target: routeCompletionResolution.insertedStepText ?? actionTarget.target,
                candidateText: selectedElement.text ?? selectedElement.label ?? selectedElement.name ?? routeCompletionResolution.insertedStepText!,
                type: selectedElement.type,
                tagName: selectedElement.tagName,
                confidence: routeCompletionResolution.confidence ?? 0.75,
                matchReason: "route_completion_intermediate_step"
              });

              if (resolvedInserted.locator) {
                try {
                  await clickResolvedTarget(resolvedInserted.locator, false);
                  await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                  console.log(`[route-completion] inserted step executed`);

                  const insertedStepResult = {
                    originalStepIndex: actionTarget.index,
                    insertedBeforeStepIndex: actionTarget.index,
                    reason: "missing_intermediate_step",
                    target: routeCompletionResolution.insertedStepText,
                    candidateId: routeCompletionResolution.candidateId,
                    confidence: routeCompletionResolution.confidence,
                    source: routeCompletionResolution.source,
                    executed: true,
                    retrySucceeded: false
                  };

                  if (!(steps as any).insertedSteps) {
                    (steps as any).insertedSteps = [];
                  }
                  (steps as any).insertedSteps.push(insertedStepResult);

                  // Add inserted step to execution plan as a functional step
                  // This preserves the ordinal selection for spec generation
                  const insertedStepIndex = routeCompletionResolution.insertedStepText || actionTarget.target;
                  const isOrdinalSelection = /primer|primera|first|visible|listado/i.test(insertedStepIndex);
                  
                  // Use generic ordinal description if candidate contains dynamic data (masked numbers, etc.)
                  const insertedStepTextSafe = routeCompletionResolution.insertedStepText || "producto";
                  const hasDynamicData = /\*\*\*\s*\d|\d{4}\s*\*\*\*|^\d{3,}/.test(insertedStepTextSafe);
                  const genericOrdinalTarget = hasDynamicData 
                    ? `el primer ${inferProductType(insertedStepTextSafe)} visible del listado`
                    : insertedStepTextSafe;
                  
                  planSteps.push({
                    index: planSteps.length + 1,
                    action: "click",
                    description: genericOrdinalTarget,
                    target: {
                      strategy: "text" as LocatorStrategy,
                      value: genericOrdinalTarget,
                      exact: false,
                      metadata: {
                        originalTarget: actionTarget.target,
                        resolvedTargetName: routeCompletionResolution.insertedStepText,
                        resolvedCandidateId: routeCompletionResolution.candidateId,
                        aiAssisted: false,
                        repairType: "route_completion"
                      }
                    },
                    locatorStrategy: "ordinal_selection",
                    recoveryMetadata: {
                      recoveredBy: "route_completion",
                      ordinalSelectionDiagnostics: {
                        selectionPatternDetected: true,
                        ordinal: "first",
                        selectedCandidateText: routeCompletionResolution.insertedStepText,
                        selectedCandidateId: routeCompletionResolution.candidateId
                      },
                      selectedCandidateId: routeCompletionResolution.candidateId,
                      selectedCandidateText: routeCompletionResolution.insertedStepText,
                      transitionDetected: true,
                      executedAction: "click"
                    }
                  });

                  console.log(`[route-completion] retrying original step`);

                  const rescanAfterInsert = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                  currentSnapshot = rescanAfterInsert.snapshot;

                  const resolvedRetry = await resolveActionTarget(
                    page,
                    currentSnapshot,
                    actionTarget.target,
                    {
                      semanticRole: actionTarget.semanticRole,
                      relationContext: actionTarget.relationContext,
                      activeContainer,
                      routeProfile,
                      actionText: actionTarget.action
                    }
                  );

                  if (resolvedRetry.status === "resolved" && resolvedRetry.locator) {
                    try {
                      await clickResolvedTarget(resolvedRetry.locator, false);
                      await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                      console.log(`[route-completion] retry succeeded`);

                      insertedStepResult.retrySucceeded = true;

                      const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                      currentSnapshot = aiRecoveredScan.snapshot;
                      allDiscoveredObjects.push(...aiRecoveredScan.objects);

                      steps.push({
                        index: actionTarget.index,
                        action: actionTarget.action,
                        status: "passed" as any,
                        targetText: actionTarget.target,
                        snapshotUrl: currentSnapshot.url,
                        snapshotTitle: currentSnapshot.title,
                        elementsFound: currentSnapshot.elements.length,
                        recoveredBy: "route_completion" as any,
                        recoveryStatus: "recovered",
                        routeCompletionDiagnostics: {
                          attempted: true,
                          enabled: routeCompletionConfig?.enabled ?? false,
                          appSlug,
                          routeProfileUsed: Boolean(routeProfile),
                          source: routeCompletionResolution.source,
                          selectedCandidateId: routeCompletionResolution.candidateId,
                          selectedCandidateText: routeCompletionResolution.insertedStepText,
                          retrySucceeded: true
                        }
                      });

                      executedStepIndices.add(actionTarget.index);
                      if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                      
                      // Route profile learning: observe successful route completion
                      if (routeProfileLearningConfig.enabled && routeCompletionResolution?.insertedStepText) {
                        const currentRouteHistory = steps
                          .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
                          .filter((s) => s.index !== actionTarget.index) // Exclude current step
                          .map((s) => s.targetText!)
                          .filter(Boolean);
                        const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
                        
                        const learningResult = observeRouteCompletionSuccess(
                          {
                            target: routeCompletionResolution.insertedStepText,
                            candidateId: routeCompletionResolution.candidateId,
                            source: routeCompletionResolution.source
                          },
                          lastSuccessfulTarget || "entry",
                          options.appSlug ?? "default",
                          routeProfileLearningConfig
                        );
                        
                        if (learningResult.suggestion) {
                          routeProfileSuggestions.push(learningResult.suggestion);
                          console.log(`[route-learning] observed route completion from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}" relation=${learningResult.suggestion.relation}`);
                        }
                      }
                      
                      if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
                        break;
                      }
                      continue;
                    } catch (retryErr) {
                      console.log(`[route-completion] retry failed`);
                      insertedStepResult.retrySucceeded = false;
                    }
                  } else {
                    console.log(`[route-completion] retry resolution failed status=${resolvedRetry.status}`);
                    insertedStepResult.retrySucceeded = false;
                  }
                } catch (insertErr) {
                  console.log(`[route-completion] inserted step execution failed`);
                }
              }
            }
          } else {
            console.log(`[route-completion] blocked: ${routeCompletionResolution.blockedReason ?? "no_safe_action"}`);
          }

          routeCompletionDiagnostics = {
            attempted: true,
            enabled: routeCompletionConfig?.enabled ?? false,
            appSlug,
            routeProfileUsed: Boolean(routeProfile),
            source: routeCompletionResolution?.source,
            selectedCandidateId: routeCompletionResolution?.candidateId,
            selectedCandidateText: routeCompletionResolution?.insertedStepText,
            blockedReason: routeCompletionResolution?.blockedReason,
            retrySucceeded: routeCompletionResolution?.status === "repaired_plan" ? (steps as any).insertedSteps?.[(steps as any).insertedSteps.length - 1]?.retrySucceeded : undefined
          };
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
          aiRepairDiagnostics: (resolution as any).aiRepairDiagnostics,
          routeCompletionDiagnostics: routeCompletionDiagnostics,
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

        // AI Repair for selection: attempt selection_resolution after local resolvers fail due to ambiguity
        if (envTrue("AI_REPAIR_ENABLED", false) && envTrue("AI_REPAIR_USE_CONTEXT_PACK", true)) {
          const aiSelectionStartTime = Date.now();
          console.log(`[ai-repair:selection] enabled provider=${process.env.AI_PROVIDER ?? "unknown"} model=${process.env.AI_MODEL ?? "unknown"}`);
          console.log(`[ai-repair:selection] failure=ambiguous_selection target="${actionTarget.target}"`);

          // Build enriched selection candidates from snapshot with full card context
          // This harvests all visible product cards, not just resolution matches
          const selectionCandidates = buildSelectionCandidatesFromSnapshot(
            currentSnapshot,
            actionTarget.target,
            resolution.candidates
          );

          console.log(`[ai-repair:selection] context selectionCandidates=${selectionCandidates.length} (harvested from snapshot)`);
          if (selectionCandidates.length > 0) {
            console.log(`[ai-repair:selection] top candidates: ${selectionCandidates.slice(0, 3).map(c => `"${c.name}"`).join(", ")}`);
          }

          const aiSelectionRepair = await runAiRepairOrchestrator({
            appSlug: String((options.env as any)?.APP_SLUG ?? "default"),
            failure: "ambiguous_selection",
            failureType: "ambiguous_selection",
            currentStep: actionTarget.action,
            currentUrl: page.url(),
            snapshotSummary: {
              title: currentSnapshot.title,
              url: currentSnapshot.url,
              summary: currentSnapshot.summary
            },
            candidates: selectionCandidates,
            runtimeEvidenceTrace: { attemptedLocators: resolution.attemptedLocators, matchReason: resolution.matchReason },
            structuralEvidence: [],
            feedbackEvidence: steps.slice(-5).map((s) => ({ index: s.index, status: s.status, targetText: s.targetText })),
            pendingAssertions: parsed.assertionTargets.map((a) => a.target),
            previousActions: steps.filter((s) => s.targetText).map((s) => `${s.action}: ${s.targetText}`),
            previousFills: planSteps.filter((s) => s.action === "fill").map((s) => `${s.description ?? "fill"}:${(s as any).valueKey ?? ""}`),
            constraints: [
              "forbid_action:fill",
              "must_return_existing_candidate_id",
              "no_selector_invention",
              "no_sensitive_selection"
            ],
            selectionTarget: actionTarget.target,
            selectionIntent: actionTarget.action,
            selectionCandidates,
            currentScreen: {
              url: currentSnapshot.url,
              title: currentSnapshot.title,
              visibleHeadings: [],
              visibleLists: [],
              visibleDialogs: []
            }
          });
          const aiSelectionDuration = Date.now() - aiSelectionStartTime;

          console.log(`[ai-repair:selection] decision=status ${aiSelectionRepair.status}`);
          console.log(`[ai-repair:selection] validated=${aiSelectionRepair.status === "repaired_plan" || aiSelectionRepair.status === "no_safe_action" || aiSelectionRepair.status === "needs_more_context"}`);

          // Build comprehensive diagnostics for artifact
          const aiSelectionDiagnostics = {
            enabled: true,
            providerName: String(aiSelectionRepair.diagnostics.provider ?? "unknown"),
            model: process.env.AI_MODEL ?? "unknown",
            failureType: "ambiguous_selection",
            repairType: "selection_resolution" as const,  // NEW: Include repairType for metrics
            selectionTarget: actionTarget.target,
            contextPackSummary: {
              selectionCandidateCount: selectionCandidates.length,
              hasSecrets: false,
              maxContextChars: 30000
            },
            decisionStatus: aiSelectionRepair.status,
            validationStatus: aiSelectionRepair.status === "invalid_response" ? "invalid" : aiSelectionRepair.status === "provider_error" ? "error" : "valid",
            selectedCandidateId: aiSelectionRepair.decision?.candidateId ?? null,
            selectionStatus: aiSelectionRepair.decision?.selectionStatus ?? null,
            blockedReason: (aiSelectionRepair.diagnostics.errorCode as string) ?? null,
            durationMs: aiSelectionDuration
          };

          (resolution as any).aiSelectionRepairDiagnostics = aiSelectionDiagnostics;

          // If AI selected a valid candidate, execute the selection
          if (aiSelectionRepair.status === "repaired_plan" && aiSelectionRepair.decision?.candidateId) {
            const selected = currentSnapshot.elements.find((el) => el.id === aiSelectionRepair.decision!.candidateId);
            if (selected) {
              const resolvedFromAi = await resolveSnapshotElementLocator(page, {
                element: selected,
                target: actionTarget.target,
                candidateText: selected.text ?? selected.label ?? selected.name ?? actionTarget.target,
                type: selected.type,
                tagName: selected.tagName,
                confidence: aiSelectionRepair.decision.confidence ?? 0.5,
                matchReason: `ai_repair:selection_resolution`
              });
              if (resolvedFromAi.locator) {
                await clickResolvedTarget(resolvedFromAi.locator, false).catch(async () => {
                  await clickResolvedTarget(resolvedFromAi.locator!, true);
                });
                await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                currentSnapshot = aiRecoveredScan.snapshot;
                allDiscoveredObjects.push(...aiRecoveredScan.objects);

                // Resolved target name from AI selection
                const resolvedTargetName = selected.name ?? selected.label ?? selected.text ?? actionTarget.target;
                const resolvedCandidateId = aiSelectionRepair.decision.candidateId;

                steps.push({
                  index: actionTarget.index,
                  action: actionTarget.action,
                  status: "found",
                  targetText: actionTarget.target,
                  resolvedTargetName,  // NEW: Resolved target from AI
                  resolvedCandidateId,  // NEW: Candidate ID selected by AI
                  resolvedLocator: resolvedFromAi.locator.toString(),  // NEW: Actual locator
                  resolvedRole: selected.role ?? selected.type ?? "unknown",  // NEW: Element role
                  snapshotUrl: aiRecoveredScan.url,
                  snapshotTitle: aiRecoveredScan.title,
                  elementsFound: aiRecoveredScan.elementsCount,
                  evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
                  aiAssisted: true,
                  aiReason: "ai_selection_resolution",
                  aiRepairType: "selection_resolution" as const,
                  aiDecisionStatus: "repaired_plan" as const,
                  aiValidationStatus: "valid" as const,
                  aiSelectionRepairDiagnostics: aiSelectionDiagnostics,  // NEW: Include diagnostics for metrics
                  semanticRole: actionTarget.semanticRole,
                  relationContext: actionTarget.relationContext
                });

                planSteps.push({
                  index: planSteps.length + 1,
                  action: "click",
                  description: actionTarget.action,
                  target: { 
                    strategy: "text" as const, 
                    value: resolvedTargetName,  // NEW: Use resolved target name, not original
                    exact: false,
                    // NEW: Metadata for AI-assisted resolution
                    metadata: {
                      originalTarget: actionTarget.target,
                      resolvedTargetName,
                      resolvedCandidateId,
                      aiAssisted: true,
                      aiReason: "ai_selection_resolution",
                      repairType: "selection_resolution",
                      decisionStatus: "repaired_plan",
                      validationStatus: "valid"
                    }
                  }
                });

                executedStepIndices.add(actionTarget.index);
                if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
                  break;
                }
                continue;
              }
            }
          }

          // AI returned no_safe_action or invalid response - fail without click
          if (aiSelectionRepair.status === "no_safe_action") {
            console.log(`[discovery:case] Selection unresolved safely; no click executed.`);
          }
        }

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
          aiSelectionRepairDiagnostics: (resolution as any).aiSelectionRepairDiagnostics,
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
          error: `Semantic target matched, but DOM locator resolution failed. Attempted locators: ${((resolution as any).attemptedLocators ?? []).join(" | ")}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          resolutionDiagnosis: (resolution as typeof resolution & { _diagnosis?: unknown[] })._diagnosis,
          attemptedLocators: (resolution as any).attemptedLocators,
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

    if (resolution.status !== "resolved" || !finalLocator) {
      continue;
    }

    // Pre-click guard: evaluate route completion for weak deterministic resolutions
    const selectionThreshold = getSelectionConfidenceThreshold();
    const isSelectionLikeForPreClick = isSelectionLikeTargetNew(actionTarget.target);
    const isWeakResolution = resolution.confidence < selectionThreshold && isSelectionLikeForPreClick;
    
    let preClickRouteCompletionAttempted = false;
    let preClickRouteCompletionResolution: MissingIntermediateStepResolution | undefined;
    let preClickRouteCompletionDiagnostics: any = undefined;
    let routeCompletionPreventedWeakClick = false;

    if (isWeakResolution) {
      console.log(`[route-completion] pre-click guard evaluating step=${actionTarget.index} target="${actionTarget.target}" confidence=${resolution.confidence.toFixed(2)} strategy=${resolution.locatorStrategy}`);
      
      const appSlug = options.appSlug ?? "default";
      const routeCompletionConfig = (options as any)?.aiAssistedDiscovery?.config?.routeCompletion;
      
      console.log(`[route-completion] app context appSlug=${appSlug} source=${options.appSlug ? "workflow" : "default-fallback"}`);
      console.log(`[route-completion] config enabled=${routeCompletionConfig?.enabled ?? false} minConfidence=${routeCompletionConfig?.minConfidence ?? 0.75} maxInsertedSteps=${routeCompletionConfig?.maxInsertedSteps ?? 1}`);
      
      if (routeCompletionConfig?.enabled !== true) {
        console.log(`[route-completion] skipped: routeCompletion not enabled in config`);
      } else {
        const rcRouteProfile = routeCompletionConfig?.useAppProfile !== false ? loadRouteProfile(appSlug) : undefined;
        
        if (!rcRouteProfile) {
          console.log(`[route-completion] routeProfile missing appSlug=${appSlug} source=loadRouteProfile returned undefined`);
        } else {
          console.log(`[route-completion] routeProfile loaded appSlug=${appSlug} routes=${rcRouteProfile.routes?.length ?? 0}`);
        }
        
        const currentRouteHistory = steps
          .filter((s) => (s as any).status === "passed" && s.targetText)
          .map((s) => s.targetText!);
        
        console.log(`[route-completion] routeHistory=[${currentRouteHistory.join(", ")}] lastSuccessfulTarget=${currentRouteHistory[currentRouteHistory.length - 1] ?? "none"}`);
        
        const aiCandidates: DiscoveryCandidate[] = currentSnapshot.elements.map((el) => ({
          candidateId: el.id,
          role: el.role,
          name: el.name,
          text: el.text,
          visible: Boolean(el.visible),
          enabled: undefined,
          clickable: Boolean(el.visible && (el.type === "button" || el.type === "link" || el.role === "button" || el.role === "link")),
          editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
          sensitive: false
        }));

        // Log candidates summary
        const clickableCandidates = aiCandidates.filter((c) => c.visible && c.clickable);
        const visibleClickableLabels = clickableCandidates.slice(0, 10).map((c) => c.name ?? c.text ?? "unknown");
        const submitLikeCount = clickableCandidates.filter((c) => {
          const text = (c.name ?? c.text ?? "").toLowerCase();
          return /(continuar|confirmar|enviar|solicitar|finalizar)/i.test(text);
        }).length;
        const sensitiveCount = aiCandidates.filter((c) => c.sensitive).length;
        
        console.log(`[route-completion] candidates summary total=${aiCandidates.length} clickable=${clickableCandidates.length} visibleClickable=[${visibleClickableLabels.join(",")}] submitLikeBlocked=${submitLikeCount} sensitiveBlocked=${sensitiveCount}`);

        const snapshot: DiscoverySnapshot = {
          url: currentSnapshot.url,
          title: currentSnapshot.title,
          visibleHeadings: [],
          visibleNavItems: [],
          visibleActions: [],
          visibleTextSummary: []
        };

        const insertedStepsSoFar = (steps as any).insertedSteps?.length ?? 0;

        console.log(`[route-completion] calling resolver failureType=weak_deterministic_resolution insertedStepsSoFar=${insertedStepsSoFar}`);

        preClickRouteCompletionResolution = resolveMissingIntermediateStep({
          appSlug,
          routeProfile: rcRouteProfile,
          currentRouteHistory,
          lastSuccessfulTarget: currentRouteHistory[currentRouteHistory.length - 1],
          currentStepText: actionTarget.action,
          currentTarget: actionTarget.target,
          failureType: "weak_deterministic_resolution",
          snapshot,
          candidates: aiCandidates,
          insertedStepsSoFar,
          config: {
            enabled: routeCompletionConfig?.enabled ?? false,
            minConfidence: routeCompletionConfig?.minConfidence ?? 0.75,
            maxInsertedSteps: routeCompletionConfig?.maxInsertedSteps ?? 1,
            useAppProfile: routeCompletionConfig?.useAppProfile ?? true,
            allowGeneric: routeCompletionConfig?.allowGeneric ?? true
          },
          deterministicResolutionConfidence: resolution.confidence,
          deterministicResolutionStrategy: resolution.locatorStrategy
        });

        preClickRouteCompletionAttempted = true;
        console.log(`[route-completion] attempted step=${actionTarget.index} failure=weak_deterministic_resolution appSlug=${appSlug} routeProfileLoaded=${Boolean(routeProfile)} candidates=${aiCandidates.length}`);
        console.log(`[route-completion] resolver returned status=${preClickRouteCompletionResolution.status} source=${preClickRouteCompletionResolution.source}`);

        if (preClickRouteCompletionResolution.status === "repaired_plan" && preClickRouteCompletionResolution.candidateId) {
          const selectedCandidate = aiCandidates.find((c) => c.candidateId === preClickRouteCompletionResolution!.candidateId);
          console.log(`[route-completion] selected candidate="${selectedCandidate?.name ?? selectedCandidate?.text}" source=${preClickRouteCompletionResolution.source} confidence=${preClickRouteCompletionResolution.confidence}`);

          const selectedElement = currentSnapshot.elements.find((el) => el.id === preClickRouteCompletionResolution!.candidateId);
          
          if (selectedElement) {
            const resolvedInserted = await resolveSnapshotElementLocator(page, {
              element: selectedElement,
              target: preClickRouteCompletionResolution.insertedStepText ?? actionTarget.target,
              candidateText: selectedElement.text ?? selectedElement.label ?? selectedElement.name ?? preClickRouteCompletionResolution.insertedStepText!,
              type: selectedElement.type,
              tagName: selectedElement.tagName,
              confidence: preClickRouteCompletionResolution.confidence ?? 0.75,
              matchReason: "route_completion_intermediate_step"
            });

            if (resolvedInserted.locator) {
              try {
                await clickResolvedTarget(resolvedInserted.locator, false);
                await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                console.log(`[route-completion] inserted step executed`);

                const insertedStepResult = {
                  originalStepIndex: actionTarget.index,
                  insertedBeforeStepIndex: actionTarget.index,
                  reason: "missing_intermediate_step",
                  target: preClickRouteCompletionResolution.insertedStepText,
                  candidateId: preClickRouteCompletionResolution.candidateId,
                  confidence: preClickRouteCompletionResolution.confidence,
                  source: preClickRouteCompletionResolution.source,
                  executed: true,
                  retrySucceeded: false
                };

                if (!(steps as any).insertedSteps) {
                  (steps as any).insertedSteps = [];
                }
                (steps as any).insertedSteps.push(insertedStepResult);

                // Add inserted step to execution plan as a functional step
                const insertedStepText = preClickRouteCompletionResolution.insertedStepText || actionTarget.target;
                const isOrdinalSelection = /primer|primera|first|visible|listado/i.test(insertedStepText);
                
                // Use generic ordinal description if candidate contains dynamic data
                const insertedStepTextSafe = preClickRouteCompletionResolution.insertedStepText || "producto";
                const hasDynamicData = /\*\*\*\s*\d|\d{4}\s*\*\*\*|^\d{3,}/.test(insertedStepTextSafe);
                const genericOrdinalTarget = hasDynamicData 
                  ? `el primer ${inferProductType(insertedStepTextSafe)} visible del listado`
                  : insertedStepTextSafe;
                
                planSteps.push({
                  index: planSteps.length + 1,
                  action: "click",
                  description: genericOrdinalTarget,
                  target: {
                    strategy: "text" as LocatorStrategy,
                    value: genericOrdinalTarget,
                    exact: false,
                    metadata: {
                      originalTarget: actionTarget.target,
                      resolvedTargetName: preClickRouteCompletionResolution.insertedStepText,
                      resolvedCandidateId: preClickRouteCompletionResolution.candidateId,
                      aiAssisted: false,
                      repairType: "route_completion"
                    }
                  },
                  locatorStrategy: "ordinal_selection",
                  recoveryMetadata: {
                    recoveredBy: "route_completion",
                    ordinalSelectionDiagnostics: {
                      selectionPatternDetected: true,
                      ordinal: "first",
                      selectedCandidateText: preClickRouteCompletionResolution.insertedStepText,
                      selectedCandidateId: preClickRouteCompletionResolution.candidateId
                    },
                    selectedCandidateId: preClickRouteCompletionResolution.candidateId,
                    selectedCandidateText: preClickRouteCompletionResolution.insertedStepText,
                    transitionDetected: true,
                    executedAction: "click"
                  }
                });

                console.log(`[route-completion] retrying original step`);

                const rescanAfterInsert = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                currentSnapshot = rescanAfterInsert.snapshot;

                  const resolvedRetry = await resolveActionTarget(
                    page,
                    currentSnapshot,
                    actionTarget.target,
                    {
                      semanticRole: actionTarget.semanticRole,
                      relationContext: actionTarget.relationContext,
                      activeContainer,
                      routeProfile,
                      actionText: actionTarget.action
                    }
                  );

                if (resolvedRetry.status === "resolved" && resolvedRetry.locator) {
                  try {
                    await clickResolvedTarget(resolvedRetry.locator, false);
                    await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                    console.log(`[route-completion] retry succeeded`);

                    insertedStepResult.retrySucceeded = true;
                    routeCompletionPreventedWeakClick = true;

                    const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                    currentSnapshot = aiRecoveredScan.snapshot;
                    allDiscoveredObjects.push(...aiRecoveredScan.objects);

                    steps.push({
                      index: actionTarget.index,
                      action: actionTarget.action,
                      status: "found" as any,
                      targetText: actionTarget.target,
                      snapshotUrl: currentSnapshot.url,
                      snapshotTitle: currentSnapshot.title,
                      elementsFound: currentSnapshot.elements.length,
                      recoveredBy: "route_completion" as any,
                      recoveryStatus: "recovered",
                      routeCompletionDiagnostics: {
                        attempted: true,
                        enabled: routeCompletionConfig?.enabled ?? false,
                        appSlug,
                        routeProfileUsed: Boolean(routeProfile),
                        trigger: "pre_click_weak_resolution",
                        source: preClickRouteCompletionResolution.source,
                        selectedCandidateId: preClickRouteCompletionResolution.candidateId,
                        selectedCandidateText: preClickRouteCompletionResolution.insertedStepText,
                        deterministicResolutionConfidence: resolution.confidence,
                        deterministicResolutionStrategy: resolution.locatorStrategy,
                        retrySucceeded: true
                      }
                    });

                    executedStepIndices.add(actionTarget.index);
                    if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                    
                    // Route profile learning: observe successful route completion (pre-click weak resolution)
                    if (routeProfileLearningConfig.enabled && preClickRouteCompletionResolution?.insertedStepText) {
                      const currentRouteHistory = steps
                        .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
                        .filter((s) => s.index !== actionTarget.index) // Exclude current step
                        .map((s) => s.targetText!)
                        .filter(Boolean);
                      const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
                      
                      const learningResult = observeRouteCompletionSuccess(
                        {
                          target: preClickRouteCompletionResolution.insertedStepText,
                          candidateId: preClickRouteCompletionResolution.candidateId,
                          source: preClickRouteCompletionResolution.source
                        },
                        lastSuccessfulTarget || "entry",
                        options.appSlug ?? "default",
                        routeProfileLearningConfig
                      );
                      
                      if (learningResult.suggestion) {
                        routeProfileSuggestions.push(learningResult.suggestion);
                        console.log(`[route-learning] observed pre-click route completion from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}" relation=${learningResult.suggestion.relation}`);
                      }
                    }
                    
                    if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
                      break;
                    }
                    continue;
                  } catch (retryErr) {
                    console.log(`[route-completion] retry failed`);
                    insertedStepResult.retrySucceeded = false;
                  }
                } else {
                  console.log(`[route-completion] retry resolution failed status=${resolvedRetry.status}`);
                  insertedStepResult.retrySucceeded = false;
                }
              } catch (insertErr) {
                console.log(`[route-completion] inserted step execution failed`);
              }
            }
          } else {
            console.log(`[route-completion] blocked: ${preClickRouteCompletionResolution.blockedReason ?? "no_safe_action"} reason="${preClickRouteCompletionResolution.reason}"`);
          }
        } else {
          console.log(`[route-completion] no_safe_action returned reason="${preClickRouteCompletionResolution.reason}"`);
        }

        preClickRouteCompletionDiagnostics = {
          attempted: true,
          enabled: routeCompletionConfig?.enabled ?? false,
          appSlug,
          routeProfileUsed: Boolean(routeProfile),
          trigger: "pre_click_weak_resolution",
          source: preClickRouteCompletionResolution?.source,
          selectedCandidateId: preClickRouteCompletionResolution?.candidateId,
          selectedCandidateText: preClickRouteCompletionResolution?.insertedStepText,
          blockedReason: preClickRouteCompletionResolution?.blockedReason,
          deterministicResolutionConfidence: resolution.confidence,
          deterministicResolutionStrategy: resolution.locatorStrategy
        };
      }
    }

    // Skip click if route completion already succeeded
    if (routeCompletionPreventedWeakClick) {
      continue;
    }

    console.log(`[discovery:case] Clicking target: ${actionTarget.target} (strategy: ${resolution.locatorStrategy}, confidence: ${resolution.confidence.toFixed(2)})`);

    const beforeState = await capturePageState(page);

    try {
      await clickResolvedTarget(finalLocator, false);
    } catch {
      try {
        console.log(`[discovery:case] Retrying with force click...`);
        await clickResolvedTarget(finalLocator, true);
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

    // Check if this was an ordinal selection - skip instructive token verification
    const wasOrdinalSelection = resolution.locatorStrategy === "ordinal_selection" || 
                                (resolution as any).ordinalSelectionDiagnostics?.selectionPatternDetected === true;
    
    if (wasOrdinalSelection) {
      console.log(`[discovery:case] Ordinal selection detected - skipping instructive token verification`);
      console.log(`[discovery:case] Ordinal: ${(resolution as any).ordinalSelectionDiagnostics?.ordinal ?? "unknown"}`);
      console.log(`[discovery:case] Domain term: ${(resolution as any).ordinalSelectionDiagnostics?.domainTerm ?? "none"}`);
      console.log(`[discovery:case] Selected candidate: ${(resolution as any).ordinalSelectionDiagnostics?.selectedCandidateText ?? "unknown"}`);
    }

    // Post-click semantic verification for selection-like targets
    // SKIP for ordinal_selection since tokens like "primera", "visible", "listado" are instructions, not UI text
    const isSelectionLike = isSelectionLikeTargetNew(actionTarget.target);
    
    const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
    currentSnapshot = postClickScan.snapshot;
    
    if (isSelectionLike && wasOrdinalSelection) {
      // For ordinal_selection, skip instructive token verification
      console.log(`[discovery:case] Ordinal selection post-click verification skipped (instructive tokens)`);
      console.log(`[discovery:case] postClickSemanticVerificationSkipped=true skipReason="ordinal_selection_instruction_tokens"`);
    } else if (isSelectionLike) {
      // Normal selection-like: perform semantic verification
      console.log(`[discovery:case] Performing post-click semantic verification for selection-like target: ${actionTarget.target}`);
      
      // Extract visible texts from elements
      const visibleTexts = postClickScan.snapshot.elements
        .filter(e => e.visible && e.text)
        .map(e => e.text!)
        .slice(0, 50);
      
      const semanticMatch = verifyPostClickSemanticMatch(
        actionTarget.target,
        visibleTexts,
        postClickScan.title
      );
      
      if (!semanticMatch.matches) {
        console.log(`[discovery:case] Post-click semantic MISMATCH detected!`);
        console.log(`[discovery:case] Target: ${actionTarget.target}`);
        console.log(`[discovery:case] Missing tokens: ${semanticMatch.missingTokens.join(", ")}`);
        const mismatchReason = semanticMatch.mismatchReason || "post_click_semantic_mismatch";
        console.log(`[discovery:case] Reason: ${mismatchReason}`);
        
        // Post-click route completion recovery: attempt to insert missing intermediate step
        const appSlug = options.appSlug ?? "default";
        const routeCompletionConfig = (options as any)?.aiAssistedDiscovery?.config?.routeCompletion;
        const postRcRouteProfile = routeCompletionConfig?.useAppProfile !== false ? loadRouteProfile(appSlug) : undefined;
        
        let postClickRouteCompletionAttempted = false;
        let postClickRouteCompletionResolution: MissingIntermediateStepResolution | undefined;
        let postClickRouteCompletionSucceeded = false;
        
        console.log(`[route-completion] post-click app context appSlug=${appSlug} source=${options.appSlug ? "workflow" : "default-fallback"}`);
        console.log(`[route-completion] post-click config enabled=${routeCompletionConfig?.enabled ?? false}`);
        
        if (routeCompletionConfig?.enabled !== true) {
          console.log(`[route-completion] post-click skipped: routeCompletion not enabled in config`);
        } else {
          if (!postRcRouteProfile) {
            console.log(`[route-completion] post-click routeProfile missing appSlug=${appSlug}`);
          } else {
            console.log(`[route-completion] post-click routeProfile loaded appSlug=${appSlug} routes=${postRcRouteProfile.routes?.length ?? 0}`);
          }
          
          const currentRouteHistory = steps
            .filter((s) => (s as any).status === "passed" && s.targetText)
            .map((s) => s.targetText!);
          
          console.log(`[route-completion] post-click routeHistory=[${currentRouteHistory.join(", ")}] lastSuccessfulTarget=${currentRouteHistory[currentRouteHistory.length - 1] ?? "none"}`);
          
          const aiCandidates: DiscoveryCandidate[] = postClickScan.snapshot.elements.map((el) => ({
            candidateId: el.id,
            role: el.role,
            name: el.name,
            text: el.text,
            visible: Boolean(el.visible),
            enabled: undefined,
            clickable: Boolean(el.visible && (el.type === "button" || el.type === "link" || el.role === "button" || el.role === "link")),
            editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
            sensitive: false
          }));

          const clickableCandidates = aiCandidates.filter((c) => c.visible && c.clickable);
          const visibleClickableLabels = clickableCandidates.slice(0, 10).map((c) => c.name ?? c.text ?? "unknown");
          
          console.log(`[route-completion] post-click candidates summary total=${aiCandidates.length} clickable=${clickableCandidates.length} visibleClickable=[${visibleClickableLabels.join(",")}]`);

          const snapshot: DiscoverySnapshot = {
            url: postClickScan.snapshot.url,
            title: postClickScan.snapshot.title,
            visibleHeadings: [],
            visibleNavItems: [],
            visibleActions: [],
            visibleTextSummary: []
          };

          const insertedStepsSoFar = (steps as any).insertedSteps?.length ?? 0;

          console.log(`[route-completion] post-click calling resolver failureType=semantic_mismatch`);

          postClickRouteCompletionResolution = resolveMissingIntermediateStep({
            appSlug,
            routeProfile: postRcRouteProfile,
            currentRouteHistory,
            lastSuccessfulTarget: currentRouteHistory[currentRouteHistory.length - 1],
            currentStepText: actionTarget.action,
            currentTarget: actionTarget.target,
            failureType: "semantic_mismatch",
            snapshot,
            candidates: aiCandidates,
            insertedStepsSoFar,
            config: {
              enabled: routeCompletionConfig?.enabled ?? false,
              minConfidence: routeCompletionConfig?.minConfidence ?? 0.75,
              maxInsertedSteps: routeCompletionConfig?.maxInsertedSteps ?? 1,
              useAppProfile: routeCompletionConfig?.useAppProfile ?? true,
              allowGeneric: routeCompletionConfig?.allowGeneric ?? true
            }
          });

          postClickRouteCompletionAttempted = true;
          console.log(`[route-completion] attempted step=${actionTarget.index} failure=semantic_mismatch appSlug=${appSlug} routeProfileLoaded=${Boolean(routeProfile)} candidates=${aiCandidates.length}`);
          console.log(`[route-completion] resolver returned status=${postClickRouteCompletionResolution.status} source=${postClickRouteCompletionResolution.source}`);

          if (postClickRouteCompletionResolution.status === "repaired_plan" && postClickRouteCompletionResolution.candidateId) {
            const selectedCandidate = aiCandidates.find((c) => c.candidateId === postClickRouteCompletionResolution!.candidateId);
            console.log(`[route-completion] selected candidate="${selectedCandidate?.name ?? selectedCandidate?.text}" source=${postClickRouteCompletionResolution.source} confidence=${postClickRouteCompletionResolution.confidence}`);

            const selectedElement = postClickScan.snapshot.elements.find((el) => el.id === postClickRouteCompletionResolution!.candidateId);
            
            if (selectedElement) {
              const resolvedInserted = await resolveSnapshotElementLocator(page, {
                element: selectedElement,
                target: postClickRouteCompletionResolution.insertedStepText ?? actionTarget.target,
                candidateText: selectedElement.text ?? selectedElement.label ?? selectedElement.name ?? postClickRouteCompletionResolution.insertedStepText!,
                type: selectedElement.type,
                tagName: selectedElement.tagName,
                confidence: postClickRouteCompletionResolution.confidence ?? 0.75,
                matchReason: "route_completion_intermediate_step"
              });

              if (resolvedInserted.locator) {
                try {
                  await clickResolvedTarget(resolvedInserted.locator, false);
                  await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                  console.log(`[route-completion] inserted step executed`);

                  const insertedStepResult = {
                    originalStepIndex: actionTarget.index,
                    insertedBeforeStepIndex: actionTarget.index,
                    reason: "missing_intermediate_step",
                    target: postClickRouteCompletionResolution.insertedStepText,
                    candidateId: postClickRouteCompletionResolution.candidateId,
                    confidence: postClickRouteCompletionResolution.confidence,
                    source: postClickRouteCompletionResolution.source,
                    executed: true,
                    retrySucceeded: false
                  };

                  if (!(steps as any).insertedSteps) {
                    (steps as any).insertedSteps = [];
                  }
                  (steps as any).insertedSteps.push(insertedStepResult);

                  // Add inserted step to execution plan as a functional step
                  const insertedStepText = postClickRouteCompletionResolution.insertedStepText || actionTarget.target;
                  const isOrdinalSelection = /primer|primera|first|visible|listado/i.test(insertedStepText);
                  
                  // Use generic ordinal description if candidate contains dynamic data
                  const insertedStepTextSafe = postClickRouteCompletionResolution.insertedStepText || "producto";
                  const hasDynamicData = /\*\*\*\s*\d|\d{4}\s*\*\*\*|^\d{3,}/.test(insertedStepTextSafe);
                  const genericOrdinalTarget = hasDynamicData 
                    ? `el primer ${inferProductType(insertedStepTextSafe)} visible del listado`
                    : insertedStepTextSafe;
                  
                  planSteps.push({
                    index: planSteps.length + 1,
                    action: "click",
                    description: genericOrdinalTarget,
                    target: {
                      strategy: "text" as LocatorStrategy,
                      value: genericOrdinalTarget,
                      exact: false,
                      metadata: {
                        originalTarget: actionTarget.target,
                        resolvedTargetName: postClickRouteCompletionResolution.insertedStepText,
                        resolvedCandidateId: postClickRouteCompletionResolution.candidateId,
                        aiAssisted: false,
                        repairType: "route_completion"
                      }
                    },
                    locatorStrategy: "ordinal_selection",
                    recoveryMetadata: {
                      recoveredBy: "route_completion",
                      ordinalSelectionDiagnostics: {
                        selectionPatternDetected: true,
                        ordinal: "first",
                        selectedCandidateText: postClickRouteCompletionResolution.insertedStepText,
                        selectedCandidateId: postClickRouteCompletionResolution.candidateId
                      },
                      selectedCandidateId: postClickRouteCompletionResolution.candidateId,
                      selectedCandidateText: postClickRouteCompletionResolution.insertedStepText,
                      transitionDetected: true,
                      executedAction: "click"
                    }
                  });

                  console.log(`[route-completion] retrying original step`);

                  const rescanAfterInsert = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                  currentSnapshot = rescanAfterInsert.snapshot;

                  const resolvedRetry = await resolveActionTarget(
                    page,
                    currentSnapshot,
                    actionTarget.target,
                    {
                      semanticRole: actionTarget.semanticRole,
                      relationContext: actionTarget.relationContext,
                      activeContainer,
                      routeProfile,
                      actionText: actionTarget.action
                    }
                  );

                  if (resolvedRetry.status === "resolved" && resolvedRetry.locator) {
                    try {
                      await clickResolvedTarget(resolvedRetry.locator, false);
                      await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                      
                      // Verify semantic match again after retry
                      const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                      const retryVisibleTexts = retryScan.snapshot.elements
                        .filter(e => e.visible && e.text)
                        .map(e => e.text!)
                        .slice(0, 50);
                      
                      const retrySemanticMatch = verifyPostClickSemanticMatch(
                        actionTarget.target,
                        retryVisibleTexts,
                        retryScan.title
                      );

                      if (retrySemanticMatch.matches) {
                        console.log(`[route-completion] retry succeeded`);
                        insertedStepResult.retrySucceeded = true;
                        postClickRouteCompletionSucceeded = true;

                        currentSnapshot = retryScan.snapshot;
                        allDiscoveredObjects.push(...retryScan.objects);

                        // Route profile learning: observe successful post-click route completion
                        if (routeProfileLearningConfig.enabled && postClickRouteCompletionResolution?.insertedStepText) {
                          const currentRouteHistory = steps
                            .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
                            .filter((s) => s.index !== actionTarget.index) // Exclude current step
                            .map((s) => s.targetText!)
                            .filter(Boolean);
                          const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
                          
                          const learningResult = observeRouteCompletionSuccess(
                            {
                              target: postClickRouteCompletionResolution.insertedStepText,
                              candidateId: postClickRouteCompletionResolution.candidateId,
                              source: postClickRouteCompletionResolution.source
                            },
                            lastSuccessfulTarget || "entry",
                            options.appSlug ?? "default",
                            routeProfileLearningConfig
                          );
                          
                          if (learningResult.suggestion) {
                            routeProfileSuggestions.push(learningResult.suggestion);
                            console.log(`[route-learning] observed post-click route completion from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}"`);
                          }
                        }

                        steps.push({
                          index: actionTarget.index,
                          action: actionTarget.action,
                          status: "found" as any,
                          targetText: actionTarget.target,
                          snapshotUrl: currentSnapshot.url,
                          snapshotTitle: currentSnapshot.title,
                          elementsFound: currentSnapshot.elements.length,
                          recoveredBy: "route_completion" as any,
                          recoveryStatus: "recovered",
                          routeCompletionDiagnostics: {
                            attempted: true,
                            enabled: routeCompletionConfig?.enabled ?? false,
                            appSlug,
                            routeProfileUsed: Boolean(routeProfile),
                            trigger: "post_click_semantic_mismatch",
                            source: postClickRouteCompletionResolution.source,
                            selectedCandidateId: postClickRouteCompletionResolution.candidateId,
                            selectedCandidateText: postClickRouteCompletionResolution.insertedStepText,
                            retrySucceeded: true
                          }
                        });

                        executedStepIndices.add(actionTarget.index);
                        if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                        if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
                          break;
                        }
                        continue;
                      } else {
                        console.log(`[route-completion] retry failed semantic verification`);
                        insertedStepResult.retrySucceeded = false;
                      }
                    } catch (retryErr) {
                      console.log(`[route-completion] retry failed`);
                      insertedStepResult.retrySucceeded = false;
                    }
                  } else {
                    console.log(`[route-completion] retry resolution failed status=${resolvedRetry.status}`);
                    insertedStepResult.retrySucceeded = false;
                  }
                } catch (insertErr) {
                  console.log(`[route-completion] inserted step execution failed`);
                }
              }
            }
          } else {
            console.log(`[route-completion] post-click blocked: ${postClickRouteCompletionResolution.blockedReason ?? "no_safe_action"} reason="${postClickRouteCompletionResolution.reason}"`);
          }
        }

        // If route completion didn't recover, proceed with original failure
        if (!postClickRouteCompletionSucceeded) {
          // Mark as failure with semantic mismatch
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "not_found",
            targetText: actionTarget.target,
            snapshotUrl: postClickScan.url,
            snapshotTitle: postClickScan.title,
            elementsFound: postClickScan.elementsCount,
            error: `Semantic mismatch after click: ${mismatchReason}`,
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
            semanticMismatchDiagnostics: {
              target: actionTarget.target,
              matchedTokens: semanticMatch.matchedTokens,
              missingTokens: semanticMatch.missingTokens,
              reason: mismatchReason
            },
            routeCompletionDiagnostics: postClickRouteCompletionAttempted ? {
              attempted: true,
              enabled: routeCompletionConfig?.enabled ?? false,
              appSlug,
              routeProfileUsed: Boolean(routeProfile),
              trigger: "post_click_semantic_mismatch",
              source: postClickRouteCompletionResolution?.source,
              selectedCandidateId: postClickRouteCompletionResolution?.candidateId,
              selectedCandidateText: postClickRouteCompletionResolution?.insertedStepText,
              blockedReason: postClickRouteCompletionResolution?.blockedReason,
              retrySucceeded: false
            } : undefined
          } as any);
          
          failedAtStep = actionTarget.index;
          failedTarget = actionTarget.target;
          failedReason = "semantic_mismatch";
          
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
      
      console.log(`[discovery:case] Post-click semantic verification PASSED. Matched tokens: ${semanticMatch.matchedTokens.join(", ")}`);
    }

    const afterState = await capturePageState(page);
    const transitionDetected = hasPageTransition(beforeState, afterState, actionTarget.target);

    console.log(`[discovery:case] Transition detected: ${transitionDetected ? "yes" : "no"}`);

    if (!transitionDetected) {
      console.log(`[discovery:case] Retrying with force click...`);
      try {
        await clickResolvedTarget(finalLocator, true);
        await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });

        const afterRetryState = await capturePageState(page);
        const retryTransition = hasPageTransition(beforeState, afterRetryState, actionTarget.target);

        console.log(`[discovery:case] Transition after force click: ${retryTransition ? "yes" : "no"}`);

        if (!retryTransition) {
          console.log("[discovery:case] Click did not change page state.");

          // Try JavaScript-native click as last resort before selection evaluation
          try {
            console.log("[discovery:case] Trying JavaScript-native click...");
            await finalLocator.evaluate((el) => {
              if (el instanceof HTMLElement) {
                el.click();
              }
            });
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });

            const afterJsClickState = await capturePageState(page);
            const jsClickTransition = hasPageTransition(beforeState, afterJsClickState, actionTarget.target);
            console.log(`[discovery:case] Transition after JS click: ${jsClickTransition ? "yes" : "no"}`);

            if (jsClickTransition) {
              console.log("[discovery:case] JavaScript click succeeded with transition.");
              const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
              currentSnapshot = postClickScan.snapshot;
              allDiscoveredObjects.push(...postClickScan.objects);

              steps.push({
                index: actionTarget.index,
                action: actionTarget.action,
                status: "found",
                targetText: actionTarget.target,
                snapshotUrl: postClickScan.url,
                snapshotTitle: postClickScan.title,
                elementsFound: postClickScan.elementsCount,
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
              if (typeof currentActionOrder === "number") {
                executedActionOrders.add(currentActionOrder);
              }
              if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
                break;
              }
              continue;
            }
          } catch (jsClickErr) {
            console.log(`[discovery:case] JavaScript click failed: ${jsClickErr instanceof Error ? jsClickErr.message : String(jsClickErr)}`);
          }

          // Post-click UI change detector: check for modal/dialog/form opened without page transition
          const afterStateForUiCheck = await capturePageState(page);
          const afterSnapshotForUiCheck = await scanCurrentPage(page);
          const nextActionTargets = parsed.actionTargets.filter(a => a.index > actionTarget.index).slice(0, 5).map(a => a.target);
          
          const postClickUiResult = await detectPostClickUiChange({
            page,
            target: actionTarget.target,
            actionText: actionTarget.action,
            beforeSnapshot: currentSnapshot,
            afterSnapshot: afterSnapshotForUiCheck,
            nextTargets: nextActionTargets,
            expectedAssertions: parsed.assertionTargets.filter(a => a.index >= actionTarget.index).map(a => a.target)
          });

          console.log(`[discovery:case] Post-click UI change evaluation: target="${actionTarget.target}", success=${postClickUiResult.success}, reason=${postClickUiResult.reason || "none"}, evidence=[${postClickUiResult.evidence.slice(0, 3).join(", ")}]`);

          if (postClickUiResult.success) {
            console.log(`[discovery:case] Post-click UI change accepted without transition: target="${actionTarget.target}"`);
            
            const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            if (postClickUiResult.reason && ["modal_opened", "dialog_opened", "form_opened", "panel_opened", "overlay_opened"].includes(postClickUiResult.reason)) {
              const containerElement = postClickScan.snapshot.elements.find(el => {
                const role = el.role?.toLowerCase() || "";
                const tag = el.tagName?.toLowerCase() || "";
                const className = (el as any).className || "";
                return role === "dialog" || role === "alertdialog" || tag === "dialog" || 
                  (el as any).ariaModal === "true" ||
                  ["modal", "dialog", "popup", "overlay", "drawer", "panel", "form"].some(ind => className.toLowerCase().includes(ind));
              });
              
              const containerReason = postClickUiResult.reason as "modal_opened" | "dialog_opened" | "form_opened" | "panel_opened" | "overlay_opened";
              const containerType = containerReason === "modal_opened" ? "modal" :
                                    containerReason === "dialog_opened" ? "dialog" :
                                    containerReason === "form_opened" ? "form" :
                                    containerReason === "panel_opened" ? "panel" : "drawer";
              
              let containerLocator: any = undefined;
              if (containerElement) {
                if (containerElement.domId) {
                  containerLocator = page.locator(`#${containerElement.domId}`);
                } else if (containerElement.className) {
                  const firstClass = containerElement.className.split(/\s+/)[0];
                  if (firstClass) {
                    containerLocator = page.locator(`.${firstClass}`).first();
                  }
                }
                if (!containerLocator && containerElement.tagName) {
                  containerLocator = page.locator(containerElement.tagName).first();
                }
              }
              
              activeContainer = {
                type: containerType,
                reason: containerReason,
                containerElement,
                containerLocator: containerLocator || undefined,
                detectedAt: new Date().toISOString()
              };
              
              console.log(`[discovery:case] Active container set: type="${activeContainer.type}" reason="${activeContainer.reason}"${activeContainer.containerLocator ? ' with locator' : ' (metadata only)'}`);
            }

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext,
              postClickDiagnostics: postClickUiResult
            } as any);

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }
            executedStepIndices.add(actionTarget.index);
            if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
              break;
            }
            continue;
          }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const stabilityRetry = await waitForStablePageState(page, { timeoutMs: 15000, pollMs: 500, stableForMs: 1000 });
        if (stabilityRetry.waited && stabilityRetry.finalStable) {
          console.log(`[discovery:case] Stability retry after wait: reason=${stabilityRetry.reason}, duration=${stabilityRetry.durationMs}ms`);
          const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = retryScan.snapshot;
          allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
            semanticRole: actionTarget.semanticRole,
            relationContext: actionTarget.relationContext,
            activeContainer,
            routeProfile,
            actionText: actionTarget.action
          });
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            console.log(`[discovery:case] Target found after stability retry: ${actionTarget.target}`);
            await clickResolvedTarget(retryResolution.locator, false);
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            const afterState = await capturePageState(page);
            const transitionDetected = hasPageTransition(beforeState, afterState, actionTarget.target);

            const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
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
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }
            if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
              break;
            }
            continue;
          }
        }

        const authRecovery = await tryAuthGateRecovery(page, currentSnapshot, options);
          if (authRecovery.recovered) {
            console.log(`[discovery:case] Auth gate recovery after click_no_transition successful, retrying...`);
            if (authRecovery.authGateState) {
              authGateState = authRecovery.authGateState;
              // Track when AuthGate was completed for later AuthFlow insertion
              if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
                const lastExecutedStepIndex = executedStepIndices.size > 0 
                  ? Math.max(...Array.from(executedStepIndices))
                  : 0;
                authGateCompletedAfterStepIndex = lastExecutedStepIndex;
                console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
              }
            }
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = retryScan.snapshot;
            allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
            semanticRole: actionTarget.semanticRole,
            relationContext: actionTarget.relationContext,
            activeContainer,
            routeProfile,
            actionText: actionTarget.action
          });
            if (retryResolution.status === "resolved" && retryResolution.locator) {
              await clickResolvedTarget(retryResolution.locator, false);
              await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
              const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
              currentSnapshot = postClickScan.snapshot;
              allDiscoveredObjects.push(...postClickScan.objects);

              steps.push({
                index: actionTarget.index,
                action: actionTarget.action,
                status: "found",
                targetText: actionTarget.target,
                snapshotUrl: postClickScan.url,
                snapshotTitle: postClickScan.title,
                elementsFound: postClickScan.elementsCount,
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
              if (typeof currentActionOrder === "number") {
                executedActionOrders.add(currentActionOrder);
              }
              if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
                break;
              }
              continue;
            }
          }

          const selectionDiagnostics = await detectSelectionSuccess({
            page,
            snapshot: currentSnapshot,
            target: actionTarget.target,
            locator: finalLocator,
            beforeSnapshot: beforeState as any,
            afterSnapshot: afterState as any,
            nextTarget: parsed.actionTargets.find(a => a.index > actionTarget.index)?.target,
            action: actionTarget.action,
            actionType: actionTarget.actionType
          });

          if (promotedToAncestor) {
            selectionDiagnostics.promotedToClickableAncestor = true;
          }

          console.log(`[discovery:case] Selection evaluation after no-transition: target="${actionTarget.target}", selectionLike=${selectionDiagnostics.selectionLike}, success=${selectionDiagnostics.success}, reason=${selectionDiagnostics.reason}, evidence=[${selectionDiagnostics.evidence.join(", ")}]`);

          if (selectionDiagnostics.selectionLike && selectionDiagnostics.success) {
            console.log(`[discovery:case] Selection click accepted without transition: ${actionTarget.target}. Reason: ${selectionDiagnostics.reason}. Evidence: [${selectionDiagnostics.evidence.join(", ")}]`);

            executedStepIndices.add(actionTarget.index);
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }

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
              relationContext: actionTarget.relationContext,
              selectionDiagnostics
            } as any);

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            continue;
          }

          if (selectionDiagnostics.selectionLike && !isSubmitLikeTarget(actionTarget.target, actionTarget.action)) {
            console.log(`[discovery:case] Selection-like target accepted without clear transition: ${actionTarget.target}. Continuing to next step.`);

            executedStepIndices.add(actionTarget.index);
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }

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
              relationContext: actionTarget.relationContext,
              selectionDiagnostics: { ...selectionDiagnostics, noTransitionAccepted: true }
            } as any);

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            continue;
          }

          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "click_no_transition",
            targetText: actionTarget.target,
            snapshotUrl: scan.url,
            snapshotTitle: scan.title,
            elementsFound: scan.elementsCount,
            error: authRecovery.error
              ? `Click completed but no page transition. Auth gate recovery attempted but failed: ${authRecovery.error}`
              : "Click completed but no page transition or DOM change was detected.",
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
            aiDiagnostics: (resolution as any).aiDiagnostics,
            selectionDiagnostics: selectionDiagnostics.selectionLike ? selectionDiagnostics : undefined
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

    // Route profile learning: observe successful transitions
    if (transitionDetected && routeProfileLearningConfig.enabled) {
      const currentRouteHistory = steps
        .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
        .map((s) => s.targetText!)
        .filter(Boolean);
      const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
      
      const learningResult = observeRouteTransition({
        from: lastSuccessfulTarget || "entry",
        to: actionTarget.target,
        beforeUrl: beforeState.url,
        afterUrl: afterState.url,
        beforeSnapshotPath: path.join(evidenceDir, `step-${actionTarget.index}-before.json`),
        afterSnapshotPath: path.join(evidenceDir, `step-${actionTarget.index}-after.json`),
        candidateId: resolution.candidateId,
        candidateText: resolution.candidateText,
        locatorSummary: resolution.locatorStrategy,
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
      }, options.appSlug ?? "default", routeProfileLearningConfig);
      
      if (learningResult.suggestion) {
        routeProfileSuggestions.push(learningResult.suggestion);
        console.log(`[route-learning] observed transition from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}" confidence=${learningResult.suggestion.confidence.toFixed(2)} status=${learningResult.suggestion.status}`);
      } else if (learningResult.reason) {
        console.log(`[route-learning] skipped: ${learningResult.reason}`);
      }
    }

    // Wait for server-side loading states to complete (e.g., "Generando...")
    if (transitionDetected) {
      try {
        const loadingDone = await page.waitForFunction(() => {
          const bodyText = document.body.textContent || "";
          const loadingPatterns = ["generando", "cargando", "procesando", "loading", "preparando"];
          return !loadingPatterns.some(p => bodyText.toLowerCase().includes(p));
        }, { timeout: 30000 });
        if (loadingDone) {
          console.log("[discovery:case] Loading state completed, re-scanning...");
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const postLoadScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = postLoadScan.snapshot;
          allDiscoveredObjects.push(...postLoadScan.objects);
        }
      } catch {
        console.log("[discovery:case] Loading state wait timed out, continuing with current snapshot.");
      }
    }

    if (authGateState?.completed) {
      markFunctionalStepAfterAuth(actionTarget.target, authGateState);
    }

    executedStepIndices.add(actionTarget.index);
    if (typeof currentActionOrder === "number") {
      executedActionOrders.add(currentActionOrder);
    }

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
      relationContext: actionTarget.relationContext,
      locatorStrategy: resolution.locatorStrategy,
      recoveryMetadata: (resolution.locatorStrategy === "ordinal_selection" || 
                        resolution.locatorStrategy === "contextual_intermediate_already_satisfied"
        ? {
            recoveredBy: resolution.locatorStrategy === "ordinal_selection" ? "ordinal_selection" as const : "contextual_intermediate_already_satisfied" as const,
            rationale: resolution.matchReason,
            ordinalSelectionDiagnostics: (resolution as any).ordinalSelectionDiagnostics ? {
              selectionPatternDetected: (resolution as any).ordinalSelectionDiagnostics.selectionPatternDetected,
              ordinal: (resolution as any).ordinalSelectionDiagnostics.ordinal,
              domainTerm: (resolution as any).ordinalSelectionDiagnostics.domainTerm,
              domainTermSource: (resolution as any).ordinalSelectionDiagnostics.domainTermSource,
              selectedCandidateText: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateText,
              selectedCandidateId: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateId
            } : undefined,
            alreadySatisfiedEvidence: (resolution as any).alreadySatisfiedEvidence,
            selectedCandidateId: resolution.candidateId,
            selectedCandidateText: resolution.candidateText,
            segmentIndex: 0,
            transitionDetected,
            executedAction: actionTarget.action
          }
        : undefined) as any
    });

      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: actionTarget.action,
        target: { 
          strategy: (resolution.locatorStrategy || "text") as LocatorStrategy, 
          value: actionTarget.target, 
          exact: false,
          metadata: resolution.locatorStrategy === "ordinal_selection" ? {
            resolvedTargetName: resolution.candidateText,
            resolvedCandidateId: resolution.candidateId,
            aiAssisted: false,
            repairType: "ordinal_selection",
            decisionStatus: "resolved",
            validationStatus: "passed"
          } : undefined
        },
        locatorStrategy: resolution.locatorStrategy,
        recoveryMetadata: resolution.locatorStrategy === "ordinal_selection" || 
                          resolution.locatorStrategy === "contextual_intermediate_already_satisfied"
          ? {
              recoveredBy: resolution.locatorStrategy === "ordinal_selection" ? "ordinal_selection" : "contextual_intermediate_already_satisfied",
              rationale: resolution.matchReason,
              ordinalSelectionDiagnostics: (resolution as any).ordinalSelectionDiagnostics ? {
                selectionPatternDetected: (resolution as any).ordinalSelectionDiagnostics.selectionPatternDetected,
                ordinal: (resolution as any).ordinalSelectionDiagnostics.ordinal,
                domainTerm: (resolution as any).ordinalSelectionDiagnostics.domainTerm,
                domainTermSource: (resolution as any).ordinalSelectionDiagnostics.domainTermSource,
                selectedCandidateText: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateText,
                selectedCandidateId: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateId
              } : undefined,
              alreadySatisfiedEvidence: (resolution as any).alreadySatisfiedEvidence,
              selectedCandidateId: resolution.candidateId,
              selectedCandidateText: resolution.candidateText,
              segmentIndex: 0,
              transitionDetected,
              executedAction: actionTarget.action
            }
          : undefined
      });

    if (evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder)) {
      break;
    }
  }

  // Recover transient assertion failures BEFORE calculating final status
  // Find when AuthGate was completed (if at all)
  const authGateCompletedAtStep = steps.findIndex(
    (s) => s.recoveredBy === "auth_flow" && s.index > 0
  );
  
  // Recover assertions that failed before AuthGate but were resolved after
  if (authGateCompletedAtStep >= 0 || steps.some(s => s.status === "found" && s.index > 0)) {
    recoverTransientAssertionFailures(
      steps,
      authGateCompletedAtStep >= 0 ? authGateCompletedAtStep : undefined,
      undefined // pageStabilizedAtStep - could be added if needed
    );
  }
  
  // Log recovery results
  const recoveredSteps = steps.filter(s => s.recoveryStatus === "recovered");
  if (recoveredSteps.length > 0) {
    console.log(`[discovery:case] Recovered ${recoveredSteps.length} transient assertion failure(s):`);
    for (const step of recoveredSteps) {
      console.log(`  - step=${step.index} target="${step.targetText}" recoveredBy=${step.recoveredBy} blocking=false`);
    }
  }

  // Calculate status based on UNRESOLVED blocking failures (not historical failures)
  const unresolvedBlockingFailures = getUnresolvedBlockingFailures(steps);
  const foundSteps = steps.filter((s) => s.status === "found" || s.status === "satisfied_by_children" || (s.status === "skipped_after_completion" && earlyCompletionSatisfied)).length;
  const totalSteps = steps.filter((s) => s.status !== "skipped").length;
  const allFound = (foundSteps === totalSteps && totalSteps > 0 && unresolvedBlockingFailures.length === 0) || earlyCompletionSatisfied;
  const someFound = foundSteps > 0 || earlyCompletionSatisfied;
  
  // Clear failedReason if all failures were recovered
  let effectiveFailedReason = failedReason;
  let effectiveFailedAtStep = failedAtStep;
  let effectiveFailedTarget = failedTarget;
  
  if (unresolvedBlockingFailures.length === 0 && failedReason) {
    // All failures were recovered - clear failedReason
    console.log(`[discovery:case] All failures recovered, clearing failedReason='${failedReason}'`);
    effectiveFailedReason = undefined;
    effectiveFailedAtStep = undefined;
    effectiveFailedTarget = undefined;
  } else if (unresolvedBlockingFailures.length > 0) {
    // Still have unresolved failures - use the first one
    const firstUnresolved = unresolvedBlockingFailures[0];
    effectiveFailedReason = firstUnresolved.error || "assertion_not_found";
    effectiveFailedAtStep = firstUnresolved.index;
    effectiveFailedTarget = firstUnresolved.targetText;
    console.log(`[discovery:case] unresolvedBlockingFailures=${unresolvedBlockingFailures.length}, using failedReason='${effectiveFailedReason}'`);
  } else {
    console.log(`[discovery:case] unresolvedBlockingFailures=0 after assertion recovery`);
  }

  const status: CaseDiscoveryResult["status"] = effectiveFailedReason === "needs_approval"
    ? "needs_approval"
    : effectiveFailedReason === "needs_assertion_resolution"
      ? "needs_assertion_resolution"
      : effectiveFailedReason === "needs_setup_resolution"
        ? "needs_setup_resolution"
        : effectiveFailedReason === "needs_associated_target_resolution"
          ? "needs_associated_target_resolution"
          : effectiveFailedReason === "associated_entity_not_found"
            ? "needs_associated_target_resolution"
            : effectiveFailedReason === "associated_action_not_found"
              ? "needs_associated_target_resolution"
              : allFound
                ? "discovered_passed"
                : someFound
                  ? "discovered_partial"
                  : "exploration_failed";
  
  // Log status reconciliation
  if (failedReason && !effectiveFailedReason) {
    console.log(`[discovery:case] status reconciled: discovered_partial -> ${status} (all failures recovered)`);
  }

  // Collect unique valueKeys from planSteps for requiredData
  const requiredDataKeys = new Set<string>();
  for (const step of planSteps) {
    if (step.valueKey) {
      requiredDataKeys.add(step.valueKey);
    }
  }
  const requiredData: RequiredDataRef[] = Array.from(requiredDataKeys).map(key => ({
    key,
    required: true,
    resolved: resolvedDataKeys.has(key),
    source: resolvedDataKeys.has(key) ? "env" : undefined
  }));

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
    requiredData,
    steps: planSteps,
    notes: [
      ...(allFound
        ? ["Discovery completed successfully. All targets and concrete assertions passed."]
        : [`Discovery partial: ${foundSteps}/${totalSteps} navigations/assertions satisfied.`]),
      ...(recoveredSteps.length > 0
        ? [`Recovered ${recoveredSteps.length} transient assertion failure(s) - see step recovery metadata for details.`]
        : [])
    ],
    createdAt: new Date().toISOString(),
    // AuthFlow metadata for spec generation
    metadata: authGateCompletedAfterStepIndex !== undefined
      ? {
          authFlowRequired: true,
          authFlowInsertionAfterStepIndex: authGateCompletedAfterStepIndex,
          authFlowAlias: "defaultClient",
          authFlowLanding: "transactions_menu",
          authGateDetectedDuringDiscovery: true
        }
      : undefined
  };

  await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
  await writeFile(pendingPlansPath, JSON.stringify(candidatePlan, null, 2), "utf-8");

  // Generate AI Repair case-level summary
  // Collect all AI repair diagnostics variants (target_resolution, selection_resolution, route_recovery, assertion_resolution)
  const stepsWithAiRepair: StepWithAiRepair[] = steps.map(s => {
    // Normalize all AI repair diagnostics variants to common format
    const aiRepairDiagnostics = (s as any).aiRepairDiagnostics;
    const aiSelectionRepairDiagnostics = (s as any).aiSelectionRepairDiagnostics;
    const aiRouteRepairDiagnostics = (s as any).aiRouteRepairDiagnostics;
    const aiAssertionRepairDiagnostics = (s as any).aiAssertionRepairDiagnostics;
    
    // Use the first available diagnostics variant
    let diagnostics = aiRepairDiagnostics || aiSelectionRepairDiagnostics || aiRouteRepairDiagnostics || aiAssertionRepairDiagnostics;
    
    // Enrich with selection-specific fields if present
    if (aiSelectionRepairDiagnostics && diagnostics) {
      diagnostics = {
        ...diagnostics,
        selectedCandidateId: aiSelectionRepairDiagnostics.selectedCandidateId ?? diagnostics.selectedCandidateId,
        selectionStatus: aiSelectionRepairDiagnostics.selectionStatus ?? diagnostics.selectionStatus
      };
    }
    
    // Include resolved target info for selection_resolution
    const resolvedTargetName = (s as any).resolvedTargetName;
    const resolvedCandidateId = (s as any).resolvedCandidateId;
    
    if (resolvedTargetName && diagnostics) {
      diagnostics = {
        ...diagnostics,
        target: diagnostics.target ?? (s as any).targetText,
        resolvedTargetName,
        resolvedCandidateId: resolvedCandidateId ?? diagnostics.selectedCandidateId
      };
    }
    
    return {
      index: s.index,
      targetText: s.targetText,
      action: s.action,
      aiRepairDiagnostics: diagnostics
    };
  });
  const aiRepairSummary = buildAiRepairCaseSummary(stepsWithAiRepair, options.env?.APP_SLUG as string | undefined);
  
  // Save AI Repair summary to artifact
  const aiRepairSummaryPath = path.join(evidenceDir, "ai-repair-summary.json");
  await writeJsonSafe(aiRepairSummaryPath, aiRepairSummary);
  
  // Print AI Repair summary to console
  console.log("");
  console.log(formatAiRepairConsoleOutput(aiRepairSummary));

  // Save route profile learning suggestions
  if (routeProfileLearningConfig.enabled) {
    try {
      const suggestionsPath = await saveRouteProfileSuggestions(
        routeProfileSuggestions,
        evidenceDir,
        options.appSlug ?? "default",
        scenario.caseId
      );
      
      if (suggestionsPath) {
        const approved = routeProfileSuggestions.filter((s) => s.status === "auto_approved");
        const pending = routeProfileSuggestions.filter((s) => s.status === "pending");
        
        console.log(`[route-learning] summary: ${approved.length} auto_approved, ${pending.length} pending`);
      }
    } catch (err) {
      console.log(`[route-learning] failed to save suggestions: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remove the duplicate recoverTransientAssertionFailures call - already done above
  // (keeping this as a no-op for safety but it's redundant now)

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
    failedAtStep: effectiveFailedAtStep,
    failedTarget: effectiveFailedTarget,
    failedReason: effectiveFailedReason,
    aiRepairSummary
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
