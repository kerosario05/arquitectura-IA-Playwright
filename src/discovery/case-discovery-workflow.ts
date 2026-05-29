import path from "node:path";
import { writeFile, readdir, readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import { createAIExplorer } from "../ai/ai-explorer";
import { config as envConfig, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { normalizeTestRailCases } from "../testrail/testrail-normalizer";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { runCaseDiscovery } from "./case-discovery";
import { evaluatePromotionGate } from "../automations/promotion-gate";
import { promoteExecutionPlan } from "../automations/promote-plan";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";
import type { PromotionPolicy } from "../types/automation-promotion.types";
import { executeExecutionPlan } from "../runner/execution-plan-executor";
import { buildDataContext } from "../data/data-context";
import { resolveAgentAutoRepairConfig, runAgentAutoRepairAttempt } from "../agent";
import { runSegmentedRouteRecovery } from "../agent/segment-route-recovery";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { FullConfig } from "../types/env.types";
import type { CaseDiscoveryResult, RuntimeEvidenceTrace, PendingAssertionForensics, AutoRepairDecisionDiagnostics, BatchCaseRootCause, DiscoveryStepResult } from "../types/discovery.types";
import type { AppProfile, SectionProfile } from "../automations/app-profile";
import { resolveSectionProfile } from "../automations/app-profile";
import type { TestScenario } from "../types/testrail.types";

export type CaseDiscoveryWorkflowOptions = {
  caseId?: number;
  scenario?: TestScenario;
  headed: boolean;
  outputDir?: string;
  autoPromote: boolean;
  promotionDryRun: boolean;
  promotionStrict: boolean;
  requirePromotionApproval: boolean;
  pageObjectMode?: boolean;
  inlineDebugSpec?: boolean;
  allowPageObjectCandidates?: boolean;
  overwrite?: boolean;
  config?: FullConfig;
  testRailClient?: TestRailClient;
  autoRepair?: boolean;
  repairTimeoutMs?: number;
  showAgentLog?: boolean;
  continueOnAgentTimeout?: boolean;
  compactAgentPrompt?: boolean;
  agentPromptBudgetSeconds?: number;
  agentMaxCandidates?: number;
  agentMaxProposedActions?: number;
  agentMaxAttempts?: number;
  autoPom?: boolean;
  autoPomThreshold?: number;
  noAutoPomValidation?: boolean;
  verifyPromotedSpec?: boolean;
  promotedSpecTimeoutMs?: number;
  appProfile?: AppProfile;
  sectionProfile?: SectionProfile;
  requirePomRuntime?: boolean;
};

export type CaseDiscoveryWorkflowResult = {
  caseResult: CaseDiscoveryResult;
  promoted: boolean;
  promotionStatus: string;
  automationId?: string;
  appSlug?: string;
  specPath?: string;
  specVerificationStatus?: string;
  outputDir: string;
  evidenceDir: string;
  durationMs: number;
};

function getDefaultOutputDir(id: number | string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = typeof id === "number" ? `case-${id}` : `story-${id}`;
  return path.resolve(`./.artifacts/discovery/${label}/${stamp}`);
}

function inferAssertionTypeFromText(assertionText: string): "field" | "action" | "form" | "cart" | "confirmation" | "list" | "detail" | "unknown" {
  const normalized = assertionText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").trim();

  if (/\b(field|campo|input|checkbox|select|dropdown|username|password|email|phone|name|address|city|country|card number|credit card)\b/.test(normalized)) {
    return "field";
  }
  if (/\b(button|click|tap|press|submit|send|continue|next|back|cancel|ok|accept|close)\b/.test(normalized)) {
    return "action";
  }
  if (/\b(form|formulario|form field|compound field|multiple fields)\b/.test(normalized)) {
    return "form";
  }
  if (/\b(cart|carrito|shopping cart|checkout|subtotal|total|cart total)\b/.test(normalized)) {
    return "cart";
  }
  if (/\b(confirm|confirmation|success|thank you|completed|finalized|order confirmed|purchase successful)\b/.test(normalized)) {
    return "confirmation";
  }
  if (/\b(list|listing|catalog|catalogo|productos|items|cards|tabla|table|grid)\b/.test(normalized)) {
    return "list";
  }
  if (/\b(detail|detalle|description|descripcion|product detail|informacion de|producto)\b/.test(normalized)) {
    return "detail";
  }
  return "unknown";
}

function normalizeForensics(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRuntimeEvidenceTrace(caseResult: CaseDiscoveryResult): RuntimeEvidenceTrace {
  const clickActions = caseResult.steps
    .filter((s) => s.status === "found" && (s.action === "click" || s.action === "select"))
    .map((s) => ({
      stepIndex: s.index,
      target: s.targetText ?? s.action,
      normalizedTarget: normalizeForensics(s.targetText ?? s.action),
      actionType: s.action,
      ownerContext: (s.assertionDiagnostics as any)?.assertionContextDiagnostics?.currentContext,
      locatorStrategy: s.locatorStrategy,
      success: true,
      transitionDetected: s.status !== "click_no_transition",
      postClickUiChange: (s.assertionDiagnostics as any)?.postClickUiChangeReason,
      beforeContext: (s.assertionDiagnostics as any)?.assertionContextDiagnostics?.previousContext,
      afterContext: (s.assertionDiagnostics as any)?.assertionContextDiagnostics?.currentContext
    }));
  const fillActions = caseResult.steps
    .filter((s) => s.status === "found" && s.action === "fill")
    .map((s) => ({
      stepIndex: s.index,
      field: s.targetText ?? "",
      normalizedField: normalizeForensics(s.targetText ?? ""),
      valueKey: (s.assertionDiagnostics as any)?.valueKey,
      source: (s.assertionDiagnostics as any)?.valueSource,
      locatorStrategy: s.locatorStrategy,
      success: true,
      activeContainerType: (s.assertionDiagnostics as any)?.activeContainer?.type
    }));
  const formEvidence = caseResult.steps
    .filter((s) => s.action === "click" && /place order|submit|purchase|form|modal|dialog/i.test(s.targetText ?? ""))
    .map((s) => ({
      openedAtStep: s.index,
      fieldsDetected: caseResult.steps.filter((x) => x.action === "fill" && x.index >= s.index).map((x) => x.targetText ?? ""),
      normalizedFields: caseResult.steps.filter((x) => x.action === "fill" && x.index >= s.index).map((x) => normalizeForensics(x.targetText ?? "")),
      submitAction: caseResult.steps.find((x) => x.index > s.index && x.status === "found" && /submit|purchase|confirm|enviar|pagar/i.test(x.targetText ?? ""))?.targetText,
      closedAtStep: caseResult.steps.find((x) => x.index > s.index && x.status === "found" && /close|cerrar|ok|aceptar/i.test(x.targetText ?? ""))?.index
    }));
  const confirmationEvidence = [{
    successDetectedAtStep: caseResult.steps.find((s) => s.status === "found" && /thank you|success|confirmacion|confirmation/i.test((s.targetText ?? "") + " " + (s.error ?? "")))?.index,
    successText: caseResult.steps.find((s) => /thank you|success|confirmacion|confirmation/i.test((s.targetText ?? "") + " " + (s.error ?? "")))?.targetText,
    summaryFieldsDetected: caseResult.steps
      .map((s) => s.targetText ?? "")
      .filter((t) => /amount|card number|name|date|total|summary/i.test(t)),
    closeActionExecuted: caseResult.steps.find((s) => s.status === "found" && /close|cerrar|ok|aceptar|continue|continuar/i.test(s.targetText ?? ""))?.targetText,
    closedAtStep: caseResult.steps.find((s) => s.status === "found" && /close|cerrar|ok|aceptar|continue|continuar/i.test(s.targetText ?? ""))?.index,
    postCloseNavigationSignals: caseResult.steps
      .map((s) => s.targetText ?? "")
      .filter((t) => /home|menu|catalog|list|cart/i.test(t))
  }];
  const toContextType = (step: DiscoveryStepResult): RuntimeEvidenceTrace["structuralEvidence"][number]["contextType"] | undefined => {
    const contextDiag = (step.assertionDiagnostics as any)?.assertionContextDiagnostics;
    const current = normalizeForensics(String(contextDiag?.currentContext ?? ""));
    if (/filtered|search/.test(current)) return "filtered_list";
    if (/catalog/.test(current)) return "catalog";
    if (/list/.test(current)) return "list";
    if (/detail/.test(current)) return "detail";
    if (/cart|checkout|summary/.test(current)) return "cart";
    if (/form|modal|dialog/.test(current)) return "form";
    if (/confirm|success/.test(current)) return "confirmation";
    const signals = step.structuralSignals ?? [];
    if (signals.some((s) => /catalog|list|items_visible|cards_visible/.test(s))) return "list";
    if (signals.some((s) => /detail|product_detail/.test(s))) return "detail";
    if (signals.some((s) => /cart|summary/.test(s))) return "cart";
    if (signals.some((s) => /form|modal/.test(s))) return "form";
    if (signals.some((s) => /confirm|success/.test(s))) return "confirmation";
    return undefined;
  };
  const toEvidenceType = (step: DiscoveryStepResult): RuntimeEvidenceTrace["structuralEvidence"][number]["evidenceType"] | undefined => {
    const signals = step.structuralSignals ?? [];
    const text = normalizeForensics(`${step.targetText ?? ""} ${step.matchedText ?? ""} ${step.error ?? ""}`);
    if (signals.some((s) => /list|catalog|cards|items/.test(s)) || /\b(list|catalog|cards|items|productos)\b/.test(text)) return "items_visible";
    if (signals.some((s) => /detail|product_detail/.test(s)) || /\b(detail|detalle|descripcion|description|price|precio)\b/.test(text)) return "item_detail_visible";
    if (signals.some((s) => /form|modal|dialog/.test(s)) || /\b(form|modal|dialog)\b/.test(text)) return "form_visible";
    if (signals.some((s) => /summary|cart|total/.test(s)) || /\b(summary|resumen|total|cart|carrito)\b/.test(text)) return "summary_visible";
    if (signals.some((s) => /success|confirmation/.test(s)) || /\b(thank you|success|confirmacion|confirmation)\b/.test(text)) return "success_message_visible";
    return undefined;
  };
  const structuralEvidence = caseResult.steps
    .map((step) => {
      const contextType = toContextType(step);
      const evidenceType = toEvidenceType(step);
      if (!contextType || !evidenceType) return undefined;
      const signals = step.structuralSignals ?? [];
      const sample = [step.matchedText, step.targetText, step.error].filter(Boolean).join(" | ");
      return {
        stepIndex: step.index,
        contextType,
        evidenceType,
        signals,
        normalizedSignals: signals.map(normalizeForensics),
        snapshotTextSample: sample || undefined,
        confidence: Math.max(0.5, Math.min(1, step.confidence ?? 0.75))
      };
    })
    .filter(Boolean) as RuntimeEvidenceTrace["structuralEvidence"];

  const feedbackEvidence = caseResult.steps
    .map((step) => {
      const message = step.matchedText ?? step.targetText ?? "";
      if (!message) return undefined;
      const normalizedMessage = normalizeForensics(message);
      const looksLikeFeedback = /\b(product added|added|agregado|success|exito|confirmacion|confirmation|thank you|guardado)\b/.test(normalizedMessage);
      if (!looksLikeFeedback) return undefined;
      const source: RuntimeEvidenceTrace["feedbackEvidence"][number]["source"] =
        /\b(alert)\b/.test(normalizedMessage) ? "alert"
          : /\b(toast)\b/.test(normalizedMessage) ? "toast"
            : /\b(banner)\b/.test(normalizedMessage) ? "banner"
              : /\b(dialog|modal|confirmacion|confirmation)\b/.test(normalizedMessage) ? "dialog"
                : "text";
      return {
        stepIndex: step.index,
        message,
        normalizedMessage,
        source,
        confidence: Math.max(0.5, Math.min(1, step.confidence ?? 0.75))
      };
    })
    .filter(Boolean) as RuntimeEvidenceTrace["feedbackEvidence"];

  return { clickActions, fillActions, formEvidence, confirmationEvidence, structuralEvidence, feedbackEvidence };
}

function buildForensicsRecommendation(step: DiscoveryStepResult): string | undefined {
  const diag = (step.assertionDiagnostics ?? {}) as Record<string, unknown>;
  const contextDiag = (diag.assertionContextDiagnostics as any);

  if (contextDiag?.decision === "deferred_until_context") {
    return `Add navigation step to reach ${contextDiag.requiredContext ?? "required context"} before this assertion`;
  }
  if (step.structuralSignals?.includes("precondition_unresolved")) {
    return "Add setup step to establish required precondition";
  }
  if (step.assertionStatus === "skipped_semantic_descriptor") {
    return "Consider making this assertion explicit with concrete observable text";
  }
  if (step.closestCandidates && step.closestCandidates.length > 0) {
    return `Try matching against: ${step.closestCandidates.slice(0, 2).map(c => c.text).join(", ")}`;
  }
  return undefined;
}

function inferRootCauseFromLocalDiagnostics(localPending: {
  localDiagnostics: string[];
  pendingAssertions: string[];
  partialReason?: string;
}): BatchCaseRootCause {
  if (localPending.localDiagnostics.includes("deferred_until_context")) {
    return "context_not_reached";
  }
  if (localPending.localDiagnostics.includes("precondition_unresolved")) {
    return "precondition_unresolved";
  }
  if (localPending.partialReason === "pending_local_assertions") {
    return "assertion_consumption_gap";
  }
  if (localPending.localDiagnostics.some(d => d.includes("structural"))) {
    return "structural_evidence_missing";
  }
  return "assertion_not_resolved";
}

function reconcileDiscoveryStatusAfterLocalClosure(
  caseResult: CaseDiscoveryResult,
  localPending: ReturnType<typeof collectLocalPendingAssertionDiagnostics>
): CaseDiscoveryResult {
  const previousStatus = caseResult.status;
  const latestEarlyCompletion = [...caseResult.steps]
    .reverse()
    .map((s) => s.earlyCompletionDiagnostics)
    .find((d) => d && d.checked);
  const beforePendingAssertionCount = localPending.localClosureDiagnostics?.beforePending.length
    ?? localPending.pendingAssertions.length;
  const afterPendingAssertionCount = localPending.localClosureDiagnostics?.afterPending.length
    ?? localPending.pendingAssertions.length;
  const canTreatEarlyCompletionAsStale =
    localPending.shouldSkipAutoRepair
    && afterPendingAssertionCount === 0
    && (caseResult.failedReason === "pending_local_assertions" || caseResult.failedReason === "needs_assertion_resolution" || !caseResult.failedReason);
  const pendingActionsCount = canTreatEarlyCompletionAsStale
    ? 0
    : (latestEarlyCompletion?.skippedRemainingActions ?? 0);
  const functionalRequiredCount = canTreatEarlyCompletionAsStale
    ? 0
    : (latestEarlyCompletion?.blockingAssertions?.length ?? 0);
  const unresolvedPreconditions = caseResult.steps.filter((s) => s.status === "precondition_unresolved");
  const unresolvedPreconditionsCount = unresolvedPreconditions.length;
  const blockingStatuses = new Set([
    "not_found",
    "ambiguous_target",
    "locator_resolution_failed",
    "fill_target_not_editable",
    "fill_target_not_visible",
    "fill_resolution_failed",
    "fill_resolution_invalid",
    "needs_assertion_resolution",
    "needs_setup_resolution",
    "needs_associated_target_resolution",
    "ai_candidate_rejected",
    "needs_approval"
  ]);
  const consumedAssertions = new Set(
    (localPending.localClosureDiagnostics?.consumed ?? []).map((a) => a.trim().toLowerCase())
  );
  const blockingFailures = caseResult.steps.filter((s) => {
    if (!blockingStatuses.has(s.status)) return false;
    // Reconciliation rule: if local closure already consumed all pending assertions,
    // stale needs_assertion_resolution markers should not remain blocking.
    if (afterPendingAssertionCount === 0 && (s.status === "needs_assertion_resolution" || s.status === "not_found")) {
      const assertionKey = (s.targetText ?? s.action).trim().toLowerCase();
      if (consumedAssertions.size === 0) return false;
      return !consumedAssertions.has(assertionKey);
    }
    return true;
  });
  const blockingFailuresCount = blockingFailures.length;
  const hasBlockingFailedReason = Boolean(caseResult.failedReason && ![
    "pending_local_assertions",
    "needs_assertion_resolution"
  ].includes(caseResult.failedReason));
  const noBlockers =
    afterPendingAssertionCount === 0
    && pendingActionsCount === 0
    && functionalRequiredCount === 0
    && unresolvedPreconditionsCount === 0
    && blockingFailuresCount === 0
    && !hasBlockingFailedReason;

  if (noBlockers) {
    const reconciledConsumedAssertions = new Set(
      (localPending.localClosureDiagnostics?.consumed ?? []).map((a) => a.trim().toLowerCase())
    );
    const reconciledSteps = caseResult.steps.map((step) => {
      if (!(step.status === "needs_assertion_resolution" || step.status === "not_found")) return step;
      const key = (step.targetText ?? step.action).trim().toLowerCase();
      if (!reconciledConsumedAssertions.has(key)) return step;
      return {
        ...step,
        status: "satisfied_by_previous_assertion" as const,
        assertionStatus: "satisfied_by_previous_assertion",
        error: undefined,
        structuralSignals: Array.from(new Set([...(step.structuralSignals ?? []), "satisfied_by_structural_evidence"]))
      } as DiscoveryStepResult;
    });
    const reconciledPlan = caseResult.candidatePlan
      ? { ...caseResult.candidatePlan, status: "validated" as const }
      : caseResult.candidatePlan;
    return {
      ...caseResult,
      status: caseResult.status === "repaired_passed" ? caseResult.status : "discovered_passed",
      failedReason: undefined,
      failedTarget: undefined,
      failedAtStep: undefined,
      candidatePlan: reconciledPlan,
      steps: reconciledSteps,
      finalStatusReconciliation: {
        attempted: true,
        previousStatus,
        newStatus: caseResult.status === "repaired_passed" ? "repaired_passed" : "discovered_passed",
        reason: "local_closure_consumed_all_blockers",
        beforePendingAssertionCount,
        afterPendingAssertionCount,
        pendingActionsCount,
        blockingFailuresCount,
        unresolvedPreconditionsCount,
        promotionEligible: true
      }
    };
  }

  const blockers: string[] = [
    ...(afterPendingAssertionCount > 0 ? [`pending_assertions:${afterPendingAssertionCount}`] : []),
    ...(pendingActionsCount > 0 ? [`pending_actions:${pendingActionsCount}`] : []),
    ...(functionalRequiredCount > 0 ? [`functional_required:${functionalRequiredCount}`] : []),
    ...(blockingFailuresCount > 0 ? [`blocking_steps:${blockingFailuresCount}`] : []),
    ...(unresolvedPreconditionsCount > 0 ? [`unresolved_preconditions:${unresolvedPreconditionsCount}`] : []),
    ...(hasBlockingFailedReason && caseResult.failedReason ? [`failed_reason:${caseResult.failedReason}`] : [])
  ];
  return {
    ...caseResult,
    finalStatusReconciliation: {
      attempted: true,
      previousStatus,
      newStatus: caseResult.status,
      reason: "blocking_failures_remain",
      beforePendingAssertionCount,
      afterPendingAssertionCount,
      pendingActionsCount,
      blockingFailuresCount,
      unresolvedPreconditionsCount,
      promotionEligible: false,
      blockers
    }
  };
}

async function loadLatestSnapshot(dir: string): Promise<{ snapshot?: PageSnapshot; snapshotPath?: string }> {
  try {
    const files = await readdir(dir);
    const candidates = files
      .filter((f) => f.endsWith("-snapshot.json"))
      .sort((a, b) => a.localeCompare(b));
    const last = candidates[candidates.length - 1];
    if (!last) return {};
    const snapshotPath = path.join(dir, last);
    return { snapshotPath, snapshot: JSON.parse(await readFile(snapshotPath, "utf-8")) as PageSnapshot };
  } catch {
    return {};
  }
}

function collectLocalPendingAssertionDiagnostics(caseResult: CaseDiscoveryResult, runtimeEvidenceTrace?: RuntimeEvidenceTrace): {
  shouldSkipAutoRepair: boolean;
  partialReason?: "pending_local_assertions" | "pending_context_deferred_assertions" | "pending_synthetic_expected";
  pendingAssertions: string[];
  localDiagnostics: string[];
  localClosureDiagnostics?: {
    attempted: boolean;
    beforePending: string[];
    afterPending: string[];
    consumed: string[];
    autoRepairSkippedReason?: string;
  };
  pendingForensics?: PendingAssertionForensics[];
} {
  const isAssertionLikeStep = (step: DiscoveryStepResult): boolean => {
    const actionText = (step.action ?? "").toLowerCase();
    if (step.assertionStatus || step.assertionClassification) return true;
    if (["asserttext", "assertvisible", "assertexists"].includes(actionText.replace(/\s+/g, ""))) return true;
    return /\b(validar|verificar|assert|visible|mostrar|muestra|show|confirmacion|confirmation|detalle|resumen|formulario|catalogo|catalog|carrito|cart)\b/i.test(step.action ?? "");
  };
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/["'`]/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const tokenSet = (value: string): Set<string> =>
    new Set(
      normalize(value)
        .split(" ")
        .filter((t) => t.length > 1 && !["de", "la", "el", "y", "the", "of", "to", "en", "for", "and"].includes(t))
    );
  const coversByTokens = (needle: string, haystack: string): boolean => {
    const n = tokenSet(needle);
    const h = tokenSet(haystack);
    if (n.size === 0 || h.size === 0) return false;
    let matched = 0;
    for (const token of n) {
      if (h.has(token)) matched += 1;
    }
    return matched / n.size >= 0.6;
  };

  const LOCAL_CONSUMABLE_REASONS = new Set([
    "satisfied_by_fill_action",
    "satisfied_by_action_executed",
    "satisfied_by_compound_assertion",
    "satisfied_by_form_field_presence",
    "satisfied_by_structural_evidence",
    "structurally_satisfied",
    "deferred_until_context",
    "assertion_context_not_reached",
    "filtered_list_structurally_satisfied",
    "confirmation_closed_structurally_satisfied",
    "weak_signal_not_blocking",
    "precondition_unresolved",
    "satisfied_by_previous_assertion",
    "optional_confirmation_detail_missing",
    "satisfied_by_cart_structure",
    "satisfied_by_summary_structure",
    "satisfied_by_post_confirmation_navigation",
    "satisfied_by_confirmation_closed"
  ]);
  const structuralEvidence = runtimeEvidenceTrace?.structuralEvidence ?? [];
  const feedbackEvidence = runtimeEvidenceTrace?.feedbackEvidence ?? [];

  const hasStructuralEvidenceFor = (assertionText: string, inferredType: PendingAssertionForensics["inferredType"]): boolean => {
    const normalized = normalize(assertionText);
    return structuralEvidence.some((e) => {
      const sample = normalize(e.snapshotTextSample ?? "");
      const signals = e.normalizedSignals.join(" ");
      const textMatch = coversByTokens(normalized, sample) || coversByTokens(sample, normalized);
      if (inferredType === "list") return e.evidenceType === "items_visible" || /catalog|list|cards|items|productos/.test(normalized);
      if (inferredType === "detail") return e.evidenceType === "item_detail_visible" || /detalle|detail|producto|price|precio|descripcion/.test(normalized);
      if (inferredType === "cart") return e.evidenceType === "summary_visible";
      if (inferredType === "form") return e.evidenceType === "form_visible";
      if (inferredType === "confirmation") return e.evidenceType === "success_message_visible";
      return textMatch || signals.includes(normalize(inferredType));
    });
  };
  const hasContextEvidence = (
    assertionText: string,
    contextType: RuntimeEvidenceTrace["structuralEvidence"][number]["contextType"]
  ): boolean => {
    const normalized = normalize(assertionText);
    return structuralEvidence.some((e) => {
      if (e.contextType !== contextType) return false;
      const sample = normalize(e.snapshotTextSample ?? "");
      return coversByTokens(normalized, sample) || coversByTokens(sample, normalized) || e.normalizedSignals.some((s) => coversByTokens(normalized, s));
    });
  };
  const wasActionExecutedForAssertion = (assertionText: string): boolean => {
    const normalized = normalize(assertionText);
    return executedSuccessfulActions.some((executed) => {
      const e = normalize(executed);
      if (coversByTokens(normalized, e) || coversByTokens(e, normalized)) return true;
      // Generic feedback closure: if assertion expects an "added/success" message
      // and the corresponding primary action was executed successfully.
      if (/\b(added|agregado|success|exito|confirmado|confirmed)\b/.test(normalized)) {
        if (/\b(add to cart|agregar|purchase|buy|place order|submit|confirm)\b/.test(e)) {
          return true;
        }
      }
      // Generic action-assertion closure for already executed primary actions
      if (/\b(add to cart|place order|purchase|ok|cerrar|close|aceptar|finalizar|continuar|submit)\b/.test(normalized)) {
        return /\b(add to cart|place order|purchase|ok|cerrar|close|aceptar|finalizar|continuar|submit|click)\b/.test(e);
      }
      return false;
    });
  };
  const hasFeedbackEvidenceFor = (assertionText: string): boolean => {
    const normalized = normalize(assertionText)
      .replace(/\b(mensaje|message|confirmacion|confirmation|correctamente|correcto|visible)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return feedbackEvidence.some((f) => {
      const candidate = normalize(f.message)
        .replace(/\b(mensaje|message|confirmacion|confirmation|correctamente|correcto|visible)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return candidate.includes(normalized) || normalized.includes(candidate) || coversByTokens(normalized, candidate) || coversByTokens(candidate, normalized);
    });
  };
  const consumedByLocalEvidence = (assertionText: string): boolean => {
    const inferredType = inferAssertionTypeFromText(assertionText);
    const normalized = normalize(assertionText);
    if (wasActionExecutedForAssertion(assertionText)) return true;
    if (hasFeedbackEvidenceFor(assertionText)) return true;
    if (hasStructuralEvidenceFor(assertionText, inferredType)) return true;
    // Cart/summary residual assertions
    if (/\b(carrito|cart|resumen|summary|producto|item|fila|precio|total|subtotal)\b/.test(normalized)) {
      if (hasContextEvidence(assertionText, "cart")) return true;
    }
    // Form/modal visibility-only assertions (before fill)
    if (/\b(formulario|form|modal|dialog|campo|required|requerido|visible)\b/.test(normalized)) {
      if (hasContextEvidence(assertionText, "form")) return true;
    }
    // Post-confirmation closure/navigation assertions
    if (/\b(confirmacion|confirmation|cerrad|close|ok|aceptar|finalizar|continuar|home|menu|cart|navegacion)\b/.test(normalized)) {
      if (hasContextEvidence(assertionText, "confirmation")) return true;
    }
    return false;
  };

  const pendingSteps = caseResult.steps.filter((step) =>
    step.status === "needs_assertion_resolution"
    || (step.status === "not_found" && isAssertionLikeStep(step))
  );
  const pendingFromSteps = pendingSteps.map((step) => step.targetText ?? step.action).filter(Boolean);
  const pendingFromEarlyCompletion = caseResult.steps
    .map((step) => step.earlyCompletionDiagnostics?.pendingAssertions ?? [])
    .filter((items) => items.length > 0)
    .at(-1) ?? [];
  const pendingAssertions = Array.from(new Set([...pendingFromSteps, ...pendingFromEarlyCompletion])).filter(Boolean);
  const executedSuccessfulActions = caseResult.steps
    .filter((step) => step.status === "found" || step.status === "satisfied_by_previous_assertion" || step.status === "satisfied_by_children")
    .map((step) => `${step.action} ${step.targetText ?? ""}`.trim());

  const buildForensics = (step: DiscoveryStepResult): PendingAssertionForensics | undefined => {
    if (!(step.status === "needs_assertion_resolution" || (step.status === "not_found" && isAssertionLikeStep(step)))) return undefined;
    const diag = (step.assertionDiagnostics ?? {}) as Record<string, unknown>;
    const consumptionDiag = (diag.assertionConsumptionDiagnostics as any);
    const contextDiag = (diag.assertionContextDiagnostics as any);
    const assertionText = step.targetText ?? step.action;
    const normalizedAssertion = normalize(assertionText);
    const inferredType = inferAssertionTypeFromText(assertionText);
    const requiredContext = contextDiag?.requiredContext ?? "unknown";
    const currentContext = contextDiag?.currentContext ?? "unknown";
    const matchingExecuted = executedSuccessfulActions.find((executed) => coversByTokens(assertionText, executed));
    const matchingFill = caseResult.steps.find((s) => s.action === "fill" && s.status === "found" && coversByTokens(assertionText, `${s.action} ${s.targetText ?? ""}`));
    const expectedConsumption: PendingAssertionForensics["expectedConsumption"] = [];
    if (inferredType === "field") expectedConsumption.push("satisfied_by_fill_action");
    if (inferredType === "action") expectedConsumption.push("satisfied_by_action_executed");
    if (inferredType === "form") expectedConsumption.push("satisfied_by_form_field_presence");
    if (["list", "detail", "cart", "confirmation"].includes(inferredType)) expectedConsumption.push("satisfied_by_structural_evidence");
    if (/\b(product added|agregado|success|exito|confirmation|confirmacion|thank you|guardado)\b/.test(normalizedAssertion)) expectedConsumption.push("satisfied_by_feedback_message");
    if (inferredType === "confirmation") expectedConsumption.push("satisfied_by_confirmation_closed");
    const structuralMatch = hasStructuralEvidenceFor(assertionText, inferredType);
    const feedbackMatch = hasFeedbackEvidenceFor(assertionText);
    const evidenceAvailable = Boolean(matchingExecuted || matchingFill || consumptionDiag?.evidence || structuralMatch || feedbackMatch);
    let notConsumedReason: PendingAssertionForensics["notConsumedReason"] = "concrete_evidence_missing";
    if (requiredContext !== "unknown" && requiredContext !== currentContext && contextDiag?.decision === "deferred_until_context") notConsumedReason = "wrong_context";
    else if ((structuralMatch || feedbackMatch || evidenceAvailable) && !consumptionDiag?.decision) notConsumedReason = "evidence_not_passed_to_resolver";
    else if (inferredType === "field" && /"|,|\by\b|\band\b/.test(assertionText) && !matchingFill) notConsumedReason = "compound_field_not_split";
    else if (!evidenceAvailable && expectedConsumption.length > 0) notConsumedReason = "missing_history";
    else if (!feedbackMatch && step.closestCandidates && step.closestCandidates.length > 0 && step.closestCandidates[0].score < 0.5) notConsumedReason = "normalization_mismatch";
    else if (step.assertionClassification === "ambiguous_assertion") notConsumedReason = "ambiguous_assertion";

    return {
      assertion: assertionText,
      normalizedAssertion,
      inferredType,
      requiredContext,
      currentContext,
      expectedConsumption,
      evidenceAvailable,
      matchedEvidence: {
        executedAction: matchingExecuted ? { action: matchingExecuted } : undefined,
        fillAction: matchingFill ? { stepIndex: matchingFill.index, field: matchingFill.targetText } : undefined,
        activeContainer: contextDiag?.activeContainer ?? undefined,
        successConfirmation: /thank you|success|confirm/i.test(assertionText) ? { expected: true } : undefined,
        closeAction: /close|cerrar|ok|aceptar/i.test(assertionText) ? { expected: true } : undefined,
        latestSnapshotSignals: step.structuralSignals ?? [],
        structuralEvidence: structuralMatch ? structuralEvidence.filter((e) => e.contextType === (inferredType === "list" ? "list" : inferredType === "detail" ? "detail" : e.contextType)).slice(0, 2) : undefined,
        feedbackEvidence: feedbackMatch ? feedbackEvidence.slice(0, 2) : undefined
      },
      notConsumedReason,
      autoRepairAllowed: (consumptionDiag?.autoRepairAllowed ?? false) && !(structuralMatch || feedbackMatch),
      classification: step.assertionClassification,
      status: step.assertionStatus
    };
  };

  const pendingForensics = pendingSteps
    .filter((step) => !consumedByLocalEvidence(step.targetText ?? step.action))
    .map(buildForensics)
    .filter(Boolean) as PendingAssertionForensics[];

  if (pendingAssertions.length === 0) {
    return {
      shouldSkipAutoRepair: false,
      pendingAssertions: [],
      localDiagnostics: [],
      localClosureDiagnostics: {
        attempted: true,
        beforePending: [],
        afterPending: [],
        consumed: []
      },
      pendingForensics: []
    };
  }
  const localDiagnostics: string[] = [];
  let deferredCount = 0;
  let weakSyntheticCount = 0;
  let localOnlyCount = 0;

  for (const step of pendingSteps) {
    const diag = (step.assertionDiagnostics ?? {}) as Record<string, unknown>;
    const decision = (diag.assertionContextDiagnostics as any)?.decision as string | undefined;
    const reason = typeof step.error === "string" ? step.error : "";
    const structuralSignals = step.structuralSignals ?? [];

    if (decision === "deferred_until_context") {
      deferredCount += 1;
      localDiagnostics.push("deferred_until_context");
      continue;
    }
    if (decision === "structurally_satisfied") {
      localDiagnostics.push("structurally_satisfied");
      continue;
    }
    if (step.assertionStatus === "skipped_semantic_descriptor" || /expected-only semantic descriptor|weak semantic descriptor/i.test(reason)) {
      weakSyntheticCount += 1;
      localDiagnostics.push("weak_signal_not_blocking");
      continue;
    }
    const pendingText = step.targetText ?? step.action;
    const matchedByAction = executedSuccessfulActions.some((executed) => coversByTokens(pendingText, executed));
    if (matchedByAction) {
      localDiagnostics.push("satisfied_by_action_executed");
      localOnlyCount += 1;
      continue;
    }
    for (const signal of structuralSignals) {
      if (LOCAL_CONSUMABLE_REASONS.has(signal)) {
        localDiagnostics.push(signal);
      }
    }
  }

  for (const pending of pendingFromEarlyCompletion) {
    const matchedByAction = executedSuccessfulActions.some((executed) => coversByTokens(pending, executed));
    if (matchedByAction) {
      localDiagnostics.push("satisfied_by_action_executed");
      localOnlyCount += 1;
      continue;
    }
    const normalizedPending = normalize(pending);
    if (
      /\b(country|city|credit card|month|year|name|amount|card number|date)\b/.test(normalizedPending)
      && executedSuccessfulActions.some((executed) => /\bfill\b|\bcompletar\b|\bingresar\b|\bescribir\b/.test(normalize(executed)))
    ) {
      localDiagnostics.push("satisfied_by_fill_action");
      localOnlyCount += 1;
      continue;
    }
    if (
      /\b(add to cart|place order|purchase|thank you|confirmacion|confirmation|cerrar|close|home|cart)\b/.test(normalizedPending)
      && executedSuccessfulActions.some((executed) => coversByTokens(pending, executed) || /\bclick\b|\bselect\b/.test(normalize(executed)))
    ) {
      localDiagnostics.push("satisfied_by_structural_evidence");
      localOnlyCount += 1;
      continue;
    }
    if (consumedByLocalEvidence(pending)) {
      const normalizedPending = normalize(pending);
      if (/\b(confirmacion|confirmation|cerrad|close|ok|aceptar|finalizar|continuar|home|menu|cart|navegacion)\b/.test(normalizedPending)) {
        localDiagnostics.push("satisfied_by_post_confirmation_navigation");
      } else if (/\b(carrito|cart|resumen|summary|producto|item|fila|precio|total|subtotal)\b/.test(normalizedPending)) {
        localDiagnostics.push("satisfied_by_cart_structure");
      } else if (/\b(formulario|form|modal|dialog|campo|required|requerido|visible)\b/.test(normalizedPending)) {
        localDiagnostics.push("satisfied_by_form_field_presence");
      } else {
        localDiagnostics.push("satisfied_by_structural_evidence");
      }
      localOnlyCount += 1;
      continue;
    }
  }

  const uniqueDiagnostics = Array.from(new Set(localDiagnostics));
  const consumedAssertions: string[] = [];
  const allLocalBySteps = pendingSteps.length > 0 && pendingSteps.every((step) => {
    const diag = (step.assertionDiagnostics ?? {}) as Record<string, unknown>;
    const decision = (diag.assertionContextDiagnostics as any)?.decision as string | undefined;
    const consumptionDecision = (diag.assertionConsumptionDiagnostics as any)?.decision as string | undefined;
    if (consumptionDecision && LOCAL_CONSUMABLE_REASONS.has(consumptionDecision)) {
      consumedAssertions.push(step.targetText ?? step.action);
      return true;
    }
    if ((step.structuralSignals ?? []).some((signal) => LOCAL_CONSUMABLE_REASONS.has(signal))) {
      consumedAssertions.push(step.targetText ?? step.action);
      return true;
    }
    const pendingText = step.targetText ?? step.action;
    const matchedByAction = executedSuccessfulActions.some((executed) => coversByTokens(pendingText, executed));
    if (matchedByAction) {
      consumedAssertions.push(step.targetText ?? step.action);
      return true;
    }
    if (consumedByLocalEvidence(pendingText)) {
      consumedAssertions.push(step.targetText ?? step.action);
      return true;
    }
    if (decision === "deferred_until_context" || decision === "structurally_satisfied") return true;
    const reason = typeof step.error === "string" ? step.error : "";
    return /weak semantic descriptor|expected-only semantic descriptor/i.test(reason);
  });
  const allLocalByEarlyCompletion = pendingFromEarlyCompletion.length > 0
    && pendingFromEarlyCompletion.every((pending) => {
      const normalizedPending = normalize(pending);
      return executedSuccessfulActions.some((executed) => coversByTokens(pending, executed))
        || /\b(country|city|credit card|month|year|name|amount|card number|date)\b/.test(normalizedPending)
        || /\b(add to cart|place order|purchase|thank you|confirmacion|confirmation|cerrar|close|home|cart)\b/.test(normalizedPending)
        || consumedByLocalEvidence(pending);
    });
  const allLocal = allLocalBySteps || allLocalByEarlyCompletion || (localOnlyCount > 0 && localOnlyCount >= pendingAssertions.length);

  const unresolvedPendingAssertions = pendingAssertions.filter((pending) => !consumedByLocalEvidence(pending));
  if (!allLocal) {
    return {
      shouldSkipAutoRepair: false,
      pendingAssertions: unresolvedPendingAssertions,
      localDiagnostics: uniqueDiagnostics,
      localClosureDiagnostics: {
        attempted: true,
        beforePending: pendingAssertions,
        afterPending: unresolvedPendingAssertions,
        consumed: consumedAssertions
      },
      pendingForensics
    };
  }

  const partialReason: "pending_local_assertions" | "pending_context_deferred_assertions" | "pending_synthetic_expected" =
    deferredCount === pendingSteps.length
      ? "pending_context_deferred_assertions"
      : weakSyntheticCount === pendingSteps.length
        ? "pending_synthetic_expected"
        : "pending_local_assertions";

  return {
    shouldSkipAutoRepair: true,
    partialReason,
    pendingAssertions: unresolvedPendingAssertions,
    localDiagnostics: uniqueDiagnostics,
    pendingForensics,
    localClosureDiagnostics: {
      attempted: true,
      beforePending: pendingAssertions,
      afterPending: unresolvedPendingAssertions,
      consumed: pendingAssertions.filter((pending) => consumedByLocalEvidence(pending)),
      autoRepairSkippedReason: "local_diagnostic_sufficient"
    }
  };
}

export function printCaseDiscoverySummary(result: CaseDiscoveryResult, workflowResult?: CaseDiscoveryWorkflowResult): void {
  console.log("");
  console.log("=== Case Discovery Results ===");
  console.log(`Case: C${result.caseId} - ${result.caseTitle}`);
  console.log(`Status: ${result.status}`);
  console.log(`Discovered at: ${result.discoveredAt}`);
  if (workflowResult) {
    console.log(`Duration: ${workflowResult.durationMs}ms`);
    console.log(`Promoted: ${workflowResult.promoted ? "yes" : "no"}`);
    console.log(`Promotion status: ${workflowResult.promotionStatus}`);
  }
  console.log("");

  console.log("Steps:");
  for (const step of result.steps) {
    let icon = "-";
    if (step.status === "found") icon = "✓";
    else if (step.status === "not_found") icon = "✗";
    else if (step.status === "click_no_transition") icon = "⚠";
    else if (step.status === "optional_confirmation_detail_missing") icon = "⚠";
    else if (step.status === "satisfied_by_previous_assertion") icon = "✓";
    else if (step.status === "precondition_unresolved") icon = "⚠";
    else if (step.status === "skipped_semantic_descriptor") icon = "○";
    else if (step.status === "satisfied_by_children") icon = "✓";

    console.log(`  ${icon} Step ${step.index}: ${step.action}`);
    if (step.targetText) {
      console.log(`    Target: ${step.targetText}`);
    }
    if (step.error) {
      // Don't show error for optional/precondition statuses unless it's truly a warning
      if (step.status === "optional_confirmation_detail_missing" || step.status === "precondition_unresolved") {
        console.log(`    Note: ${step.error}`);
      } else {
        console.log(`    Error: ${step.error}`);
      }
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

  if (workflowResult) {
    console.log("");
    console.log("--- Promotion ---");
    console.log(`Status: ${workflowResult.promotionStatus}`);
    if (workflowResult.promoted) {
      console.log(`Automation: ${workflowResult.automationId}`);
      console.log(`Spec: ${workflowResult.specPath}`);
    }
    if (workflowResult.specPath) {
      console.log(`Spec path: ${workflowResult.specPath}`);
    }
  }

  if (result.status === "discovered_passed" && result.candidatePlan?.status === "validated" && workflowResult && !workflowResult.promoted) {
    console.log("");
    console.log(`[discovery:case] To promote manually:`);
    console.log(`[discovery:case] npm.cmd run plans:promote -- --from ${workflowResult.outputDir}`);
  }

  if (workflowResult && !workflowResult.promoted && workflowResult.promotionStatus === "promotion_failed") {
    console.log("[discovery:case] Promotion gate blocked.");
  }
}

export async function runCaseDiscoveryWorkflow(
  options: CaseDiscoveryWorkflowOptions
): Promise<CaseDiscoveryWorkflowResult> {
  const startTime = Date.now();
  const activeConfig = options.config ?? envConfig;
  const outputId = options.scenario?.externalId ?? options.caseId ?? "unknown";
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : getDefaultOutputDir(outputId);
  const evidenceDir = path.join(outputDir, "evidence");
  const pendingObjectsPath = path.join(outputDir, "discovered-objects.pending.json");
  const pendingPlansPath = path.join(outputDir, "discovered-plans.pending.json");
  if (options.appProfile) {
    console.log(`[discovery:case] Using app profile: appSlug=${options.appProfile.appSlug} source=${options.appProfile.source}`);
  }

  let scenario: TestScenario;
  let client: TestRailClient;
  
  if (options.scenario) {
    scenario = options.scenario;
    if (!options.testRailClient) {
      const testRailRuntimeConfig = requireTestRailConfig(activeConfig);
      client = new TestRailClient(testRailRuntimeConfig);
    } else {
      client = options.testRailClient;
    }
  } else {
    if (!options.caseId) {
      throw new Error("Either scenario or caseId must be provided.");
    }
    if (options.testRailClient) {
      client = options.testRailClient;
    } else {
      const testRailRuntimeConfig = requireTestRailConfig(activeConfig);
      client = new TestRailClient(testRailRuntimeConfig);
    }
    const rawCase = await client.getCase(options.caseId);
    const scenarios = normalizeTestRailCases([rawCase]);
    if (scenarios.length === 0) {
      throw new Error(`No scenario could be generated for case C${options.caseId}.`);
    }
    scenario = scenarios[0];
  }

  // Resolve sectionProfile from TestRail case
  let sectionProfile: SectionProfile | undefined;
  if (options.caseId) {
    const rawCase = await client.getCase(options.caseId);
    if (rawCase.section_id) {
      const sectionInfo = await client.getSection(rawCase.section_id);
      const sectionResult = await resolveSectionProfile({
        testCaseSectionId: rawCase.section_id,
        testCaseSectionName: sectionInfo?.name
      });
      sectionProfile = sectionResult.sectionProfile;
      console.log(`[section-profile] source=${sectionProfile.source} sectionId=${sectionProfile.sectionId} sectionName="${sectionProfile.sectionName}" sectionSlug=${sectionProfile.sectionSlug}`);
    } else {
      console.log(`[section-profile] No section_id found for case C${options.caseId}, using default-section`);
    }
  }
  
  if (sectionProfile) {
    scenario.sectionId = sectionProfile.sectionId as number | undefined;
    scenario.sectionName = sectionProfile.sectionName;
  }

  const browserType = { chromium, firefox, webkit }[activeConfig.execution.browser];
  const headless = !options.headed;

  let browser;
  let caseResult: CaseDiscoveryResult;
  let promoted = false;
  let automationId: string | undefined;
  let appSlug: string | undefined;
  let specPath: string | undefined;
  let promotionStatus = "not_promoted";
  try {
    browser = await browserType.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(activeConfig.execution.defaultTimeoutMs);

    const loginStrategy = getLoginStrategy(activeConfig.app.loginMode);

    const aiExplorerProvider = activeConfig.integrations.ai?.agentProvider === "none"
      ? "custom"
      : (activeConfig.integrations.ai?.agentProvider ?? "custom");

    // Debug logging for routeCompletion config propagation
    console.log(`[env-debug] raw AI_ROUTE_COMPLETION_ENABLED=${process.env.AI_ROUTE_COMPLETION_ENABLED}`);
    console.log(`[env-debug] loaded routeCompletion.enabled=${activeConfig.integrations.ai?.routeCompletion?.enabled}`);
    console.log(`[env-debug] appProfile appSlug=${options.appProfile?.appSlug ?? "undefined"}`);

    caseResult = await runCaseDiscovery({
      page,
      scenario,
      evidenceDir,
      pendingObjectsPath,
      pendingPlansPath,
      appBaseUrl: activeConfig.app.baseUrl,
      appSlug: options.appProfile?.appSlug,
      testData: activeConfig.app.testData,
      loginAction: async () => {
        await loginStrategy.execute(page, activeConfig);
      },
      aiAssistedDiscovery: {
        explorer: createAIExplorer({
          provider: aiExplorerProvider
        }),
        config: {
          enabled: activeConfig.integrations.ai?.discoveryEnabled ?? false,
          confidenceThreshold: activeConfig.integrations.ai?.discoveryConfidenceThreshold ?? 0.85,
          requireApprovalThreshold: activeConfig.integrations.ai?.discoveryRequireApprovalThreshold ?? 0.7,
          maxAttempts: activeConfig.integrations.ai?.discoveryMaxAttempts ?? 3,
          routeCompletion: activeConfig.integrations.ai?.routeCompletion,
          routeProfileLearning: activeConfig.integrations.ai?.routeProfileLearning
        }
      },
      env: {
        APP_TEST_DATA_JSON: activeConfig.app.rawTestData,
        APP_TEST_DATA_ALIASES_JSON: activeConfig.app.testDataAliases,
        Identity_Provider: process.env.Identity_Provider,
        OTP_SECRET: process.env.OTP_SECRET,
        APP_USERNAME: activeConfig.app.username,
        APP_PASSWORD: activeConfig.app.password,
        APP_EXTRA_LOGIN_FIELDS_JSON: activeConfig.app.extraLoginFields,
        MISSING_INPUT_BEHAVIOR: activeConfig.app.missingInputBehavior,
        AUTO_GENERATE_TEST_DATA: activeConfig.app.autoGenerateTestData,
        AUTO_GENERATE_SENSITIVE_DATA: activeConfig.app.autoGenerateSensitiveData,
        APP_TEST_DATA_PROFILE: activeConfig.app.testDataProfile,
        AUTO_SELECT_SAFE_DEFAULTS: activeConfig.app.autoSelectSafeDefaults,
        AUTO_ACCEPT_SAFE_CHECKBOXES: activeConfig.app.autoAcceptSafeCheckboxes
      },
      missingInputBehavior: activeConfig.app.missingInputBehavior,
      loginMode: activeConfig.app.loginMode
    });

    const agentCfg = resolveAgentAutoRepairConfig(activeConfig);

    if (options.autoRepair === true) {
      agentCfg.enabled = true;
    }
    if (options.repairTimeoutMs !== undefined) {
      agentCfg.timeoutMs = options.repairTimeoutMs;
    }
    if (options.agentMaxAttempts !== undefined) {
      agentCfg.maxAttempts = options.agentMaxAttempts;
    }
    if (options.compactAgentPrompt) {
      agentCfg.compactPrompt = true;
      agentCfg.promptMode = "compact-route-recovery";
    }
    console.log(`[discovery:workflow] Auto-repair enabled: ${agentCfg.enabled}`);
    console.log(`[discovery:workflow] Repair timeout: ${agentCfg.timeoutMs}ms`);
    console.log(`[discovery:workflow] Max attempts: ${agentCfg.maxAttempts}`);

    const RECOVERABLE_REASONS = new Set([
      "target_not_found",
      "ambiguous_target",
      "locator_resolution_failed",
      "needs_discovery",
      "needs_associated_target_resolution",
      "needs_assertion_resolution",
      "semantic_target_not_found",
      "click_no_transition",
      "assertion_not_found"
    ]);

    const LOCAL_DIAGNOSTIC_REASONS = new Set([
      "fill_target_not_found",
      "fill_target_not_editable",
      "fill_target_not_visible",
      "fill_target_not_enabled",
      "fill_resolution_invalid",
      "fill_resolution_failed",
      "editable_candidates_without_constructable_locator",
      "missing_test_data",
      "missing_sensitive_test_data",
      "unsupported_data_type",
      "unknown_sensitive_data_type",
      "precondition_unresolved",
      "satisfied_by_previous_assertion",
      "optional_confirmation_detail_missing",
      "catalog_assertion_structural",
      "product_detail_structural",
      "cart_precondition_unresolved",
      "cart_assertion_structural",
      "optional_catalog_update_assertion",
      "category_filter_structural_match",
      "product_detail_missing_optional",
      "cart_setup_missing"
      , "weak_signal_not_blocking"
      , "structurally_satisfied"
      , "detail_descriptor_skipped"
      , "synthetic_expected_skipped"
      , "assertion_context_not_reached"
      , "deferred_until_context"
    ]);

    let localPending: ReturnType<typeof collectLocalPendingAssertionDiagnostics> = {
      shouldSkipAutoRepair: false,
      pendingAssertions: [],
      localDiagnostics: []
    };
    let diagnosticsBuildError: string | undefined;
    let runtimeEvidenceTrace: RuntimeEvidenceTrace = {
      clickActions: [],
      fillActions: [],
      formEvidence: [],
      confirmationEvidence: [],
      structuralEvidence: [],
      feedbackEvidence: []
    };
    try {
      runtimeEvidenceTrace = buildRuntimeEvidenceTrace(caseResult);
      localPending = collectLocalPendingAssertionDiagnostics(caseResult, runtimeEvidenceTrace);
    } catch (error) {
      diagnosticsBuildError = error instanceof Error ? error.message : String(error);
      console.log(`[discovery:workflow] Warning: failed to build local diagnostics/forensics: ${diagnosticsBuildError}`);
    }
    caseResult = {
      ...caseResult,
      runtimeEvidenceTrace,
      partialDiagnostics: caseResult.partialDiagnostics ?? (localPending.pendingForensics && localPending.pendingForensics.length > 0
        ? {
          partialReason: "pending_local_assertions",
          pendingAssertions: localPending.pendingAssertions,
          localDiagnostics: localPending.localDiagnostics,
          autoRepairSkippedReason: "local_diagnostic_sufficient",
          pendingForensics: localPending.pendingForensics,
          diagnosticsBuildError
        }
        : diagnosticsBuildError
          ? {
            partialReason: "pending_local_assertions",
            pendingAssertions: [],
            localDiagnostics: [],
            autoRepairSkippedReason: "local_diagnostic_sufficient",
            diagnosticsBuildError
          }
          : undefined)
    };
    if (localPending.shouldSkipAutoRepair) {
      console.log(`[discovery:workflow] Auto-repair skipped: reason="local_diagnostic_sufficient"`);

      const autoRepairDecisionDiagnostics: AutoRepairDecisionDiagnostics = {
        attempted: true,
        skipped: true,
        skipReason: "local_diagnostic_sufficient",
        evaluatedPendingAssertions: localPending.pendingAssertions,
        localClosureAttempted: true,
        localClosureConsumed: localPending.localClosureDiagnostics?.consumed ?? [],
        localClosureRemaining: localPending.pendingAssertions,
        ambiguousRemaining: [],
        localDiagnostics: localPending.localDiagnostics,
        pendingAssertions: localPending.pendingAssertions,
        consumedAssertions: localPending.localClosureDiagnostics?.consumed ?? [],
        autoRepairAllowed: false,
        autoRepairReason: "none",
        autoRepairSkippedReason: "local_diagnostic_sufficient",
        decision: "skip",
        explanation: `Auto-repair skipped because all pending assertions have local diagnostics that explain them. Pending: ${localPending.pendingAssertions.length}, Local diagnostics: ${localPending.localDiagnostics.join(", ")}`
      };

      caseResult = {
        ...caseResult,
        status: caseResult.status === "discovered_passed" ? caseResult.status : "discovered_partial",
        failedReason: caseResult.failedReason === "needs_assertion_resolution" ? "pending_local_assertions" : caseResult.failedReason,
        autoRepairDecisionDiagnostics,
        rootCauseCategory: inferRootCauseFromLocalDiagnostics(localPending)
      };
      (caseResult as any).partialDiagnostics = {
        partialReason: localPending.partialReason,
        pendingAssertions: localPending.pendingAssertions,
        localDiagnostics: localPending.localDiagnostics,
        pendingForensics: localPending.pendingForensics,
        autoRepairSkippedReason: "local_diagnostic_sufficient",
        runtimeClosureDiagnostics: {
          attempted: true,
          phase: "checkout_confirmation_closure",
          consumedAssertions: (localPending.localClosureDiagnostics?.consumed ?? []).map((a) => ({
            assertion: a,
            decision: "consumed_by_local_diagnostic",
            evidence: "local_closure"
          })),
          remainingAssertions: localPending.pendingAssertions,
          autoRepairAllowed: false,
          autoRepairSkippedReason: "local_diagnostic_sufficient",
          notConsumedReasons: (localPending.pendingForensics ?? []).map((f) => f.notConsumedReason)
        },
        localClosureDiagnostics: localPending.localClosureDiagnostics ?? {
          attempted: true,
          beforePending: localPending.pendingAssertions,
          afterPending: localPending.pendingAssertions,
          consumed: [],
          autoRepairSkippedReason: "local_diagnostic_sufficient"
        }
      };
    }

    const shouldAttemptRepair =
      agentCfg.enabled
      && !options.promotionDryRun
      && caseResult.status !== "discovered_passed"
      && caseResult.status !== "repaired_passed"
      && !localPending.shouldSkipAutoRepair
      && Boolean(caseResult.failedReason && RECOVERABLE_REASONS.has(caseResult.failedReason))
      && Boolean(caseResult.candidatePlan)
      && Boolean((await loadLatestSnapshot(evidenceDir)).snapshot);

    if (caseResult.failedReason && LOCAL_DIAGNOSTIC_REASONS.has(caseResult.failedReason)) {
      console.log(`[discovery:workflow] Auto-repair skipped: reason="${caseResult.failedReason}" (local diagnostic sufficient)`);
    }

    if (agentCfg.enabled && caseResult.status === "discovered_passed") {
      // AI discovery skipped, deterministic confidence sufficient
    }

    if (shouldAttemptRepair) {
      const { snapshot, snapshotPath } = await loadLatestSnapshot(evidenceDir);
      const dataContext = buildDataContext(activeConfig);

      const autoRepairStartDiagnostics: AutoRepairDecisionDiagnostics = {
        attempted: true,
        skipped: false,
        evaluatedPendingAssertions: localPending.pendingAssertions,
        localClosureAttempted: true,
        localClosureConsumed: localPending.localClosureDiagnostics?.consumed ?? [],
        localClosureRemaining: localPending.pendingAssertions,
        ambiguousRemaining: localPending.pendingAssertions,
        localDiagnostics: [],
        pendingAssertions: [],
        consumedAssertions: [],
        autoRepairAllowed: true,
        autoRepairReason: caseResult.failedReason ?? "assertion_not_resolved",
        autoRepairSkippedReason: null,
        decision: "attempt",
        explanation: `Auto-repair initiated for failure: ${caseResult.failedReason} at step ${caseResult.failedAtStep}`
      };
      caseResult = { ...caseResult, autoRepairDecisionDiagnostics: autoRepairStartDiagnostics };

      let repaired = false;
      for (let attempt = 1; attempt <= agentCfg.maxAttempts; attempt += 1) {
        console.log(`[discovery:workflow] Auto-repair attempt ${attempt}/${agentCfg.maxAttempts}`);
        const attemptResult = await runAgentAutoRepairAttempt({
          fullConfig: activeConfig,
          outputDir,
          attemptNumber: attempt,
          kind: "plan_repair",
          repairTimeoutMs: agentCfg.timeoutMs,
          failureSummary: `${caseResult.failedReason ?? "unknown"} at step ${caseResult.failedAtStep ?? "?"} target "${caseResult.failedTarget ?? ""}"`,
          scenario,
          currentPlan: caseResult.candidatePlan,
          snapshot,
          evidenceDir,
          snapshotPath,
          candidatePlanPath: pendingPlansPath,
          pendingObjectsPath,
          pendingPlansPath,
          failedReason: caseResult.failedReason,
          failedTarget: caseResult.failedTarget,
          failedAtStep: caseResult.failedAtStep,
          showAgentLog: options.showAgentLog ?? false,
          compactPrompt: options.compactAgentPrompt,
          promptBudgetSeconds: options.agentPromptBudgetSeconds,
          maxCandidates: options.agentMaxCandidates,
          maxProposedActions: options.agentMaxProposedActions,
          maxAttemptsOverride: options.agentMaxAttempts
        });

        if (!attemptResult.success) {
          console.log(`[discovery:workflow] Attempt ${attempt} failed: ${attemptResult.reason}`);
          if (attemptResult.status === "unavailable") {
            caseResult = {
              ...caseResult,
              status: "needs_agent",
              failedReason: attemptResult.reason,
              autoRepairDecisionDiagnostics: {
                ...(caseResult.autoRepairDecisionDiagnostics!),
                skipReason: "agent_unavailable",
                explanation: `Agent unavailable: ${attemptResult.reason}`
              }
            };
            break;
          }
          if (attempt < agentCfg.maxAttempts) {
            console.log(`[discovery:workflow] Starting attempt ${attempt + 1}/${agentCfg.maxAttempts} because retry policy allows it.`);
          }

          if (attemptResult.status === "timeout" && options.continueOnAgentTimeout) {
            caseResult = {
              ...caseResult,
              status: "needs_agent",
              failedReason: "auto_repair_timeout",
              autoRepairDecisionDiagnostics: {
                ...(caseResult.autoRepairDecisionDiagnostics!),
                skipReason: "timeout",
                explanation: `Agent timeout after ${agentCfg.timeoutMs}ms`
              }
            };
            break;
          }
          if (attemptResult.status === "no_proposal") {
            caseResult = {
              ...caseResult,
              status: "needs_agent",
              autoRepairDecisionDiagnostics: {
                ...(caseResult.autoRepairDecisionDiagnostics!),
                skipReason: "agent_no_proposal",
                explanation: "Agent could not propose a repair solution"
              }
            };
            break;
          }

          if (attempt === agentCfg.maxAttempts) {
            caseResult = {
              ...caseResult,
              status: "auto_repair_exhausted",
              autoRepairDecisionDiagnostics: {
                ...(caseResult.autoRepairDecisionDiagnostics!),
                skipReason: "non_recoverable_failure",
                explanation: `Auto-repair exhausted after ${agentCfg.maxAttempts} attempts`
              }
            };
          }
          continue;
        }

        // Run segmented route recovery: execute plan, wait for transition,
        // re-interpret failed target against new snapshot, iterate up to maxSegments.
        const segmentResult = await runSegmentedRouteRecovery({
          page,
          outputDir,
          evidenceDir,
          fullConfig: activeConfig,
          scenario,
          currentPlan: caseResult.candidatePlan!,
          pendingSteps: [],
          failedReason: caseResult.failedReason ?? "unknown",
          failedTarget: caseResult.failedTarget ?? "",
          failedAtStep: caseResult.failedAtStep ?? 1,
          snapshot: snapshot!,
          snapshotPath: snapshotPath ?? "",
          maxSegments: 3,
          showAgentLog: options.showAgentLog ?? false,
          compactPrompt: options.compactAgentPrompt ?? false,
          promptBudgetSeconds: options.agentPromptBudgetSeconds,
          maxCandidates: options.agentMaxCandidates,
          maxProposedActions: options.agentMaxProposedActions,
          agentCfg
        });

        if (segmentResult.success) {
          // Mark the failed step as recovered with segment metadata
          const failedStepIdx = caseResult.failedAtStep;
          const lastSegment = segmentResult.segments[segmentResult.segments.length - 1];
          const updatedSteps = caseResult.steps.map((step) => {
            if (step.index === failedStepIdx && step.status === "not_found") {
              return {
                ...step,
                originalStatus: step.status,
                status: "found" as const,
                recoveryStatus: "recovered" as const,
                recoveredBy: "segmented_route_recovery" as const,
                recoveryMetadata: lastSegment ? {
                  selectedCandidateId: lastSegment.candidateId ?? "",
                  selectedCandidateText: lastSegment.candidateText,
                  semanticRelation: undefined,
                  score: undefined,
                  segmentIndex: lastSegment.segmentIndex,
                  transitionDetected: lastSegment.executionStatus === "passed",
                  executedAction: lastSegment.action ?? "click",
                  rationale: `Recovered via segmented route recovery: ${lastSegment.candidateText ?? lastSegment.candidateId}`
                } : undefined
              };
            }
            return step;
          });

          // Add the executed recovery step to the candidate plan
          const recoveredPlan = segmentResult.candidatePlan ?? attemptResult.repairedPlan;
          const finalPlan = lastSegment && lastSegment.candidateId ? {
            ...recoveredPlan,
            notes: [
              ...(recoveredPlan.notes ?? []),
              `Route recovery segment ${lastSegment.segmentIndex}: clicked "${lastSegment.candidateText ?? lastSegment.candidateId}" via ${lastSegment.recoveryDecision}`
            ]
          } : recoveredPlan;

          caseResult = {
            ...caseResult,
            status: "repaired_passed" as const,
            candidatePlan: finalPlan,
            steps: updatedSteps,
            failedReason: undefined,
            failedTarget: undefined,
            failedAtStep: undefined
          };
          repaired = true;
          break;
        }

        if (attempt === agentCfg.maxAttempts) {
          caseResult = { ...caseResult, status: "auto_repair_exhausted" };
          // Preserve original failure info when segments exhausted
          if (segmentResult.segments.length > 0) {
            caseResult.failedReason = segmentResult.failedReason;
          }
        }
      }
    }

    caseResult = reconcileDiscoveryStatusAfterLocalClosure(caseResult, localPending);

    const promotionPolicy: PromotionPolicy = {
      ...DEFAULT_PROMOTION_POLICY,
      specMode: options.inlineDebugSpec ? "inline-debug" : (options.pageObjectMode !== false ? "page-object" : "inline-debug"),
      allowCandidateGeneration: options.allowPageObjectCandidates !== false,
      autoPom: options.autoPom === true,
      autoApproveConfidenceThreshold: options.autoPomThreshold ?? DEFAULT_PROMOTION_POLICY.autoApproveConfidenceThreshold,
      autoRunPomValidation: options.noAutoPomValidation !== true
    };

    console.log(`[discovery:workflow] Overwrite enabled: ${options.overwrite === true}`);

    const promotionResultPath = path.join(outputDir, "promotion-result.json");
    const gate = evaluatePromotionGate({
      discoveryResult: caseResult,
      candidatePlan: caseResult.candidatePlan,
      strict: options.promotionStrict,
      requireApproval: options.requirePromotionApproval,
      promotionPolicy
    });

    console.log(`[discovery:workflow] Promotion gate: allowed=${gate.allowed}, status=${gate.status}`);
    if (gate.reasons.length > 0) {
      console.log(`[discovery:workflow] Promotion gate reasons:`);
      for (const reason of gate.reasons) {
        console.log(`  - ${reason}`);
      }
    }
    if (gate.warnings.length > 0) {
      console.log(`[discovery:workflow] Promotion gate warnings:`);
      for (const warning of gate.warnings) {
        console.log(`  - ${warning}`);
      }
    }

    const promotionReport: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      autoPromoteRequested: options.autoPromote,
      gateAllowed: gate.allowed,
      gateStatus: gate.status,
      reasons: gate.reasons,
      warnings: gate.warnings,
      promoted: false
    };

    if (!options.autoPromote) {
      promotionStatus = "not_promoted";
    } else if (options.promotionDryRun) {
      if (gate.allowed) {
        promotionStatus = "dry_run_passed";
      } else {
        promotionStatus = "dry_run_blocked";
      }
    } else if (!gate.allowed) {
      promotionStatus = gate.status === "not_applicable" ? "not_applicable" : "promotion_failed";
    } else if (caseResult.candidatePlan) {
      const promotedEntry = await promoteExecutionPlan(
        {
          plan: caseResult.candidatePlan,
          sourcePlanPath: pendingPlansPath,
          source: "discovery",
          overwrite: options.overwrite === true,
          fullConfig: activeConfig,
          promotionPolicy,
          inlineDebugMode: options.inlineDebugSpec ?? false,
          verifySpec: options.verifyPromotedSpec ?? false,
          specVerificationTimeoutMs: options.promotedSpecTimeoutMs,
          appProfileObject: options.appProfile,
          sectionSlug: sectionProfile?.sectionSlug,
          sectionId: sectionProfile?.sectionId,
          sectionName: sectionProfile?.sectionName,
          requirePomRuntime: options.requirePomRuntime === true
        },
        false,
        {
          discoveryDir: outputDir
        }
      );
      promoted = true;
      if (promotedEntry.pomStatus === "needs_page_object" || promotedEntry.pomStatus === "needs_page_method" || promotedEntry.pomStatus === "blocked_missing_pom") {
        promotionStatus = promotedEntry.pomStatus;
      } else if (promotedEntry.pomStatus === "inline_debug_only") {
        promotionStatus = "inline_debug_only";
      } else if (promotedEntry.specVerificationStatus === "failed") {
        promotionStatus = "spec_failed";
      } else if (promotedEntry.status === "spec_failed" || promotedEntry.status === "promoted_but_verification_failed") {
        promotionStatus = "spec_failed";
      } else {
        promotionStatus = "promoted";
      }
      automationId = promotedEntry.id;
      appSlug = promotedEntry.appSlug;
      specPath = promotedEntry.specPath;
      promotionReport.promoted = true;
      promotionReport.automationId = promotedEntry.id;
      promotionReport.appSlug = promotedEntry.appSlug;
      promotionReport.specPath = promotedEntry.specPath;
      promotionReport.planPath = promotedEntry.planPath;
      promotionReport.caseFolder = promotedEntry.id;
      promotionReport.pomStatus = promotedEntry.pomStatus;
      promotionReport.inlineDebugMode = promotedEntry.inlineDebugMode;
    } else {
      promotionStatus = "promotion_failed";
    }

    await writeFile(promotionResultPath, JSON.stringify(promotionReport, null, 2), "utf-8");
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return {
    caseResult,
    promoted,
    promotionStatus,
    automationId,
    appSlug,
    specPath,
    outputDir,
    evidenceDir,
    durationMs: Date.now() - startTime
  };
}
