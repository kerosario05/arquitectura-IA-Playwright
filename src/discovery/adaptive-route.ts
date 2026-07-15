import type { Page } from "@playwright/test";

/**
 * Adaptive route discovery: AI-assisted step-by-step exploration
 * when the functional chain is incomplete to reach a target screen.
 * Universal — no hardcoded HUs, apps, routes, or entities.
 */

export type AdaptiveRouteState = {
  targetScreen: string;
  currentChain: string[];
  requiredChain: string[][];
  actionHistory: string[];
  visibleControls: string[];
  forbiddenActions: string[];
  maxSteps: number;
  stepsTaken: number;
  completed: boolean;
  reason: string;
  learnedSteps: string[];
};

export type AiSuggestion = {
  status: "propose_next_step" | "blocked";
  action?: "click" | "fill" | "select" | "wait" | "assert";
  targetLabel?: string;
  targetType?: "button" | "input" | "listitem" | "card" | "link";
  expectedSignal?: string;
  riskLevel?: "low" | "medium" | "high";
  requiresData?: boolean;
  blockedType?: string;
};

const UNSAFE_TARGETS = /confirmar|enviar|finalizar|generar\s+documento|procesar|autorizar/i;
const GLOBAL_CONTROLS = /seleccionar\s+todos?|deseleccionar\s+todos?|todos?\s+los\s+(?:elementos|productos|items)/i;
const MAX_ADAPTIVE_STEPS = 5;

export function initAdaptiveRoute(targetScreen: string, currentChain: string[], requiredChain: string[][]): AdaptiveRouteState {
  return {
    targetScreen,
    currentChain: [...currentChain],
    requiredChain,
    actionHistory: [],
    visibleControls: [],
    forbiddenActions: [],
    maxSteps: MAX_ADAPTIVE_STEPS,
    stepsTaken: 0,
    completed: false,
    reason: "",
    learnedSteps: [],
  };
}

/**
 * Build a compact suggestion prompt for the AI agent.
 */
export function buildAdaptiveSuggestionPrompt(state: AdaptiveRouteState): string {
  const chainStr = state.currentChain.join(" > ");
  const requiredStr = state.requiredChain.map(c => c.join(" > ")).join(" | ");
  const controls = state.visibleControls.slice(0, 15).join(", ");
  const history = state.actionHistory.slice(-5).join("; ");
  return `Pantalla actual: ${controls || "sin controles visibles"}.
Cadena funcional actual: ${chainStr}.
Cadena requerida para ${state.targetScreen}: ${requiredStr}.
Historial reciente: ${history || "ninguno"}.
Pasos restantes: ${state.maxSteps - state.stepsTaken}.
Sugiere SOLO el siguiente paso (click/fill/select/wait/assert) para avanzar hacia ${state.targetScreen}.
Devuelve JSON: {"action":"click","targetLabel":"...","targetType":"button|input|listitem","riskLevel":"low|medium|high"}.`;
}

/**
 * Validate an AI suggestion against safety rules before execution.
 */
export function validateAdaptiveSuggestion(
  suggestion: AiSuggestion,
  state: AdaptiveRouteState,
  pageVisibleTexts: string[],
): { accepted: boolean; reason: string } {
  if (!suggestion.targetLabel) return { accepted: false, reason: "no_target_label" };

  // Reject confirm/submit actions when screen is not confirmable
  if (suggestion.action === "click" && UNSAFE_TARGETS.test(suggestion.targetLabel)) {
    if (!state.currentChain.includes("selection") && !state.currentChain.includes("fill")) {
      return { accepted: false, reason: "unsafe_confirmation_without_prerequisites" };
    }
  }

  // Reject global controls
  if (GLOBAL_CONTROLS.test(suggestion.targetLabel)) {
    return { accepted: false, reason: "global_control_rejected" };
  }

  // Reject if target not found in visible controls or page text
  if (pageVisibleTexts.length > 0) {
    const found = pageVisibleTexts.some(t => t.toLowerCase().includes(suggestion.targetLabel!.toLowerCase()));
    if (!found) return { accepted: false, reason: "target_not_visible" };
  }

  // Reject if repeates last action without progress
  if (state.actionHistory.length >= 2) {
    const lastAction = state.actionHistory[state.actionHistory.length - 1];
    if (lastAction?.includes(suggestion.targetLabel!)) {
      return { accepted: false, reason: "repeated_action_no_progress" };
    }
  }

  // Reject high-risk actions beyond step 3
  if (suggestion.riskLevel === "high" && state.stepsTaken >= 3) {
    return { accepted: false, reason: "high_risk_beyond_limit" };
  }

  return { accepted: true, reason: "valid" };
}

/**
 * Execute the accepted suggestion against the page.
 * Returns the new step action text for the action history.
 */
export async function executeAdaptiveSuggestion(
  page: Page,
  suggestion: AiSuggestion,
): Promise<{ success: boolean; actionText: string; error?: string }> {
  try {
    if (!suggestion.targetLabel) return { success: false, actionText: "", error: "no target" };

    const locator = page.getByRole(suggestion.targetType as any, { name: suggestion.targetLabel }).first();

    switch (suggestion.action) {
      case "click": {
        await locator.click();
        return { success: true, actionText: `Clic en "${suggestion.targetLabel}".` };
      }
      case "fill": {
        await locator.fill("");
        return { success: true, actionText: `Completar el campo ${suggestion.targetLabel}.` };
      }
      case "select": {
        await locator.click();
        return { success: true, actionText: `Seleccionar "${suggestion.targetLabel}".` };
      }
      case "wait": {
        await page.waitForTimeout(2000);
        return { success: true, actionText: `Esperar carga de pantalla.` };
      }
      default:
        return { success: false, actionText: "", error: "unknown_action" };
    }
  } catch (err) {
    return { success: false, actionText: "", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run adaptive route discovery loop: deterministic first, then AI if available.
 * Returns the final state with result.
 */
export async function runAdaptiveRouteDiscovery(
  page: Page,
  initialState: AdaptiveRouteState,
  snapshotTexts: string[],
  aiProvider?: { completeJson: (opts: any) => Promise<{ parsedJson: any }> },
): Promise<AdaptiveRouteState & { result: "reached" | "blocked" | "controlled_data" }> {
  const state = { ...initialState };
  const deterministicTargets = ["Continuar", "Siguiente", "Seleccionar", "Aceptar"];

  while (state.stepsTaken < state.maxSteps) {
    state.stepsTaken++;

    // 1. Select contextual deterministic targets based on missing chain step
    const missingType = state.currentChain.length > 0 ?
      (state.currentChain[state.currentChain.length - 1] === "navigation" ? "selection" :
       state.currentChain[state.currentChain.length - 1] === "selection" ? "submit" : null) : "selection";

    const contextTargets = missingType === "selection" ? [] : // no generic "Seleccionar"
      missingType === "submit" ? ["Continuar", "Siguiente"] :
      missingType === "fill" ? [] :
      ["Continuar"];

    let suggestion: AiSuggestion | null = null;

    // 1a. Try contextual deterministic targets
    for (const ct of contextTargets) {
      if (snapshotTexts.some(t => t.toLowerCase().includes(ct.toLowerCase())) &&
          !state.forbiddenActions.includes(ct)) {
        suggestion = { status: "propose_next_step", action: "click", targetLabel: ct, targetType: "button", riskLevel: "low" };
        console.log(`[adaptive-route] suggestionSource=deterministic target="${ct}" missingType=${missingType}`);
        break;
      }
    }

    // 2. If no deterministic match and AI provider available, ask AI
    if (!suggestion && aiProvider) {
      try {
        const prompt = buildAdaptiveSuggestionPrompt(state);
        const response = await aiProvider.completeJson({ messages: [{ role: "user", content: prompt }], temperature: 0.3, requireJson: true });
        suggestion = response.parsedJson as AiSuggestion;
        console.log(`[adaptive-route] suggestionSource=ai action=${suggestion?.action} target="${suggestion?.targetLabel}" risk=${suggestion?.riskLevel}`);
      } catch { /* AI unavailable */ }
    }

    if (!suggestion || suggestion.status === "blocked") {
      state.reason = suggestion?.blockedType ?? "no_safe_action";
      return { ...state, result: "blocked" };
    }

    // 3. Validate suggestion
    const validation = validateAdaptiveSuggestion(suggestion, state, snapshotTexts);
    if (!validation.accepted) {
      console.log(`[adaptive-route] rejected reason=${validation.reason} target="${suggestion.targetLabel}"`);
      state.forbiddenActions.push(suggestion.targetLabel!);
      continue; // try next iteration
    }

    // 4. Execute
    const result = await executeAdaptiveSuggestion(page, suggestion);
    if (!result.success) {
      console.log(`[adaptive-route] failed action="${result.actionText}" error="${result.error}"`);
      state.forbiddenActions.push(suggestion.targetLabel!);
      continue;
    }

    console.log(`[adaptive-route] accepted action="${result.actionText}" step=${state.stepsTaken}`);
    state.actionHistory.push(result.actionText);
    state.learnedSteps.push(result.actionText);

    // 5. Wait for stability and check if target reached
    await page.waitForTimeout(500);
    // Re-classify step type (simplified)
    const stepType = result.actionText.includes("Seleccionar") ? "selection" :
      result.actionText.includes("Continuar") || result.actionText.includes("Confirmar") || result.actionText.includes("Enviar") ? "submit" :
      result.actionText.includes("Completar") ? "fill" : "navigation";

    if (chainNowReachesTarget(state, stepType)) {
      state.completed = true;
      state.reason = "target_screen_reached";
      return { ...state, result: "reached" };
    }
  }

  state.reason = "max_steps_exceeded";
  return { ...state, result: "blocked" };
}

export function chainNowReachesTarget(state: AdaptiveRouteState, newStepType: string): boolean {
  if (newStepType !== "unknown" && (state.currentChain.length === 0 || state.currentChain[state.currentChain.length - 1] !== newStepType)) {
    state.currentChain.push(newStepType);
  }
  return state.requiredChain.some(pattern => {
    let pi = 0;
    for (const t of state.currentChain) { if (pi < pattern.length && t === pattern[pi]) pi++; }
    return pi === pattern.length;
  });
}
