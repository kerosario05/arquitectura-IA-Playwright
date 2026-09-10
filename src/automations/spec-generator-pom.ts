import path from "node:path";
import type { ExecutionPlan, ExecutionPlanStep, PlanTarget } from "../types/execution-plan.types";
import type { AppAutomationPaths, AppProfile } from "./app-profile";
import type { PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import type { PageObjectEntry, PageObjectMethod, PageObjectRegistry } from "../types/page-object.types";
import { findReusableMethod, findMethodBySemanticIntent } from "./page-object-registry";
import { deriveMethodIntentFromStepWithContext, deriveExpectedOwnerForStep } from "./pom-classification";
import type { SemanticMethodIntent } from "../types/pom-ownership";
import { isContextDependentIntent, getContextProducedByIntent, INTENT_PREFERRED_OWNER, METHOD_INTENT_NAME_MAP } from "../types/pom-ownership";
import { isLikelyAuthGate, buildAuthFlowSpecImport, buildAuthFlowInstantiation, buildAuthFlowCall } from "../discovery/auth-flow-helpers";
import { buildDataKeyVariableMap } from "../data/promoted-data";

export type POMSpecResult = {
  specContent: string;
  pomStatus: POMPromotionStatus;
  usedPageObjects: string[];
  missingPageObjects: string[];
  missingMethods: string[];
  generatedCandidates: number;
  usedAuthFlow: boolean;
  validationErrors: string[];
  inlineFallbackUsed: boolean;
  requiredDataUsed: string[];
};

function getTarget(t: PlanTarget | "APP_BASE_URL" | undefined): PlanTarget | undefined {
  if (!t || t === "APP_BASE_URL") return undefined;
  return t;
}

function getTargetValue(t: PlanTarget | "APP_BASE_URL" | undefined): string {
  if (!t) return "";
  if (t === "APP_BASE_URL") return "APP_BASE_URL";
  
  // For AI-assisted resolution, use resolved target name from metadata
  if (t.metadata?.aiAssisted && t.metadata?.resolvedTargetName) {
    return t.metadata.resolvedTargetName;
  }
  
  return t.name ?? t.value ?? t.role ?? "";
}

function escapeSpecString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build previousSteps array for runtime context recovery
 * Includes safe navigation/selection steps that can be replayed after session reset
 * NOTE: return_to_list is NOT safe to replay - it consumes context (detail page), doesn't produce it
 */
function buildPreviousStepsParam(steps: ExecutionPlanStep[], currentIndex: number, currentStepSemanticIntent?: string): string {
  const SAFE_INTENTS = new Set([
    'start_session', 'open_home', 'open_module', 'open_product_information',
    'select_category', 'select_product', 'select_visible_item_by_ordinal',
    'select_first_visible_item', 'select_first_visible_product', 'select_first_visible_card',
    'navigate'
    // NOTE: return_to_list is NOT safe - it requires being on detail page (consumes context)
  ]);
  
  const UNSAFE_INTENTS = new Set([
    'submit_form', 'confirm_action', 'payment', 'transfer', 'send',
    'accept_terms', 'delete', 'fill_form_field', 'click_primary_action',
    'return_to_list'  // Explicitly unsafe - requires detail page context
  ]);
  
  const previousSteps: string[] = [];
  
  for (let i = 0; i < currentIndex; i++) {
    const step = steps[i];
    let intent = (step as any).semanticIntent;
    
    if (!intent) {
      const stepMetadata = (step as any).actionIntent;
      if (stepMetadata) {
        intent = stepMetadata;
      } else {
        const targetValue = getTargetValue(step.target) || step.description || '';
        const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        if (step.action === 'click') {
          intent = deriveSelectionIntentWithOrdinalSupport(step);
          if (intent === "select_product" || intent === "select_category" || intent === "select_visible_item_by_ordinal") {
            // keep the derived selection intent
          } else if (/iniciar|login|sign in/i.test(normalizedTarget)) {
            intent = 'start_session';
          } else if (/informaci|information/i.test(normalizedTarget)) {
            intent = 'open_product_information';
          } else if (/transacciones|menu|operaciones/i.test(normalizedTarget)) {
            intent = 'open_module';
          } else if (/volver|regresar|back/i.test(normalizedTarget)) {
            intent = 'return_to_list';
          } else {
            intent = 'click';
          }
        } else {
          intent = step.action;
        }
      }
    }
    
    if (SAFE_INTENTS.has(intent) && !UNSAFE_INTENTS.has(intent)) {
      const targetValue = getTargetValue(step.target) || step.description || '';
      const isSensitive = (step as any).sensitive || false;
      previousSteps.push(
        `{ stepIndex: ${step.index}, actionIntent: '${intent}', target: '${escapeSpecString(targetValue)}', sensitive: ${isSensitive} }`
      );
    }
  }
  
  return previousSteps.length > 0 ? `[${previousSteps.join(', ')}]` : '[]';
}

/**
 * Build executable replay callbacks for previous safe steps
 * Generates unique replay functions using step indices to avoid duplicates
 * NOTE: return_to_list is NOT safe to replay - it consumes context (detail page), doesn't produce it
 */
function buildPreviousStepReplaysParam(
  steps: ExecutionPlanStep[],
  currentIndex: number,
  pageObjectRegistry: PageObjectRegistry | null | undefined,
  options?: {
    excludeStepIndices?: number[];
  }
): { replayFunctions: string[]; arrayParam: string } {
  const SAFE_INTENTS = new Set([
    'start_session', 'open_home', 'open_module', 'open_product_information',
    'select_category', 'select_product', 'select_visible_item_by_ordinal',
    'select_first_visible_item', 'select_first_visible_product', 'select_first_visible_card',
    'navigate'
    // NOTE: return_to_list is NOT safe - it requires being on detail page (consumes context)
  ]);
  
  const UNSAFE_INTENTS = new Set([
    'submit_form', 'confirm_action', 'payment', 'transfer', 'send',
    'accept_terms', 'delete', 'fill_form_field', 'click_primary_action',
    'return_to_list'  // Explicitly unsafe - requires detail page context
  ]);
  
  const replayFunctions: string[] = [];
  const replayArrayItems: string[] = [];
  const excludedStepIndices = new Set(options?.excludeStepIndices ?? []);
  
  for (let i = 0; i < currentIndex; i++) {
    const step = steps[i];
    if (excludedStepIndices.has(step.index)) {
      continue;
    }
    let intent = (step as any).semanticIntent;
    
    if (!intent) {
      const locatorStrategy = (step as any).locatorStrategy;
      const ordinalDiag = (step as any).recoveryMetadata?.ordinalSelectionDiagnostics;
      if (locatorStrategy === "ordinal_selection" || ordinalDiag?.selectionPatternDetected === true) {
        intent = "select_visible_item_by_ordinal";
      }
    }

    if (!intent) {
      const targetValue = getTargetValue(step.target) || step.description || '';
      const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      
      if (step.action === 'click') {
        intent = deriveSelectionIntentWithOrdinalSupport(step);
        if (!(intent === "select_product" || intent === "select_category" || intent === "select_visible_item_by_ordinal")) {
          if (/iniciar|login|sign in/i.test(normalizedTarget)) {
            intent = 'start_session';
          } else if (/informaci|information/i.test(normalizedTarget)) {
            intent = 'open_product_information';
          } else if (/transacciones|menu|operaciones/i.test(normalizedTarget)) {
            intent = 'open_module';
          } else if (/volver|regresar|back/i.test(normalizedTarget)) {
            intent = 'return_to_list';
          }
        }
      }
    }
    
    if (!intent || !SAFE_INTENTS.has(intent) || UNSAFE_INTENTS.has(intent)) {
      continue;
    }
    
    const targetValue = getTargetValue(step.target) || step.description || '';
    const isSensitive = (step as any).sensitive || false;
    
    let replayBody: string;
    
    switch (intent) {
      case 'start_session':
        replayBody = `await homePage.start();`;
        break;
      case 'open_home':
        replayBody = `await homePage.open();`;
        break;
      case 'open_module':
        replayBody = `await operationsMenuPage.openModule('${escapeSpecString(targetValue)}');`;
        break;
      case 'open_product_information':
        replayBody = `await productInformationPage.openProductInformation();`;
        break;
      case 'select_category':
        replayBody = `await categoryPage.selectCategory('${escapeSpecString(targetValue)}');`;
        break;
      case 'select_product':
        replayBody = `await productListPage.selectProduct('${escapeSpecString(targetValue)}');`;
        break;
      case 'select_visible_item_by_ordinal':
        {
          const ordinalDiag = (step as any).recoveryMetadata?.ordinalSelectionDiagnostics;
          const ordinal = ordinalDiag?.ordinal || 'first';
          const domainTerm = ordinalDiag?.domainTerm;
          replayBody = domainTerm
            ? `await productListPage.selectVisibleItemByOrdinal('${escapeSpecString(ordinal)}', '${escapeSpecString(domainTerm)}');`
            : `await productListPage.selectVisibleItemByOrdinal('${escapeSpecString(ordinal)}');`;
        }
        break;
      case 'select_first_visible_item':
      case 'select_first_visible_product':
      case 'select_first_visible_card':
        replayBody = `await productListPage.selectFirstVisibleCard();`;
        break;
      case 'return_to_list':
        replayBody = `await productDetailPage.backToList();`;
        break;
      case 'navigate':
        replayBody = `await page.goto('${escapeSpecString(targetValue || '/')}');`;
        break;
      default:
        continue;
    }
    
    // Use step index to make function name unique across entire spec
    const funcName = `replayStep_${step.index}`;
    replayFunctions.push(`const ${funcName} = async () => { ${replayBody} };`);
    replayArrayItems.push(
      `{ stepIndex: ${step.index}, actionIntent: '${intent}', target: '${escapeSpecString(targetValue)}', sensitive: ${isSensitive}, replay: ${funcName} }`
    );
  }
  
  return {
    replayFunctions,
    arrayParam: replayArrayItems.length > 0 ? `[${replayArrayItems.join(', ')}]` : '[]'
  };
}

/**
 * Find last selection step for detail page re-entry
 * Prefers ordinal/visible item selections over category/module selections
 * Excludes module names and category headings that don't represent actual item selections
 */
function findLastSelectionStep(steps: ExecutionPlanStep[], currentIndex: number): { stepIndex: number; target: string } | null {
  const ORDINAL_INTENTS = new Set([
    'select_visible_item_by_ordinal', 'select_first_visible_item',
    'select_first_visible_product', 'select_first_visible_card'
  ]);
  
  const PRODUCT_INTENTS = new Set([
    'select_product'
  ]);
  
  const CATEGORY_INTENTS = new Set([
    'select_category'
  ]);
  
  const MODULE_HEADING_PATTERNS = [
    /dep.A?sitos?\s*(a\s+plazo)?/i,
    /pr.A?stamos?/i,
    /cuentas?/i,
    /tarjetas?/i,
    /inversiones?/i,
    /consulta\s+de\s+/i,
    /transferencias?/i,
    /pago\s+de\s+/i,
    /mis\s+productos/i,
    /^productos$/i,
    /^listado/i,
    /^balance$/i,
    /operaciones\s+y\s+servicios/i,
  ];
  
  const SPECIFIC_ITEM_PATTERNS = [
    /\*\*\*\s*\d{4}/i,
    /\d{4}\s*\*\*\*\s*\d{4}/i,
    /^\d{3,}/,
    /pesos|dominicanos|usd|euros?/i,
    /plazo\s+\d+|d.A?s\s+\d+/i,
    /cr.A?dito|debito|ahorro|corriente/i,
  ];
  
  function isModuleHeading(target: string): boolean {
    const normalized = target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return MODULE_HEADING_PATTERNS.some(p => p.test(normalized));
  }
  
  function isSpecificItem(target: string): boolean {
    const normalized = target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return SPECIFIC_ITEM_PATTERNS.some(p => p.test(normalized));
  }
  
  let lastOrdinalSelection: { stepIndex: number; target: string } | null = null;
  let lastProductSelection: { stepIndex: number; target: string; isSpecific: boolean } | null = null;
  let lastCategorySelection: { stepIndex: number; target: string } | null = null;
  
  for (let i = currentIndex - 1; i >= 0; i--) {
    const step = steps[i];
    let intent = (step as any).semanticIntent;
    const targetValue = getTargetValue(step.target) || step.description || '';
    
    if (!intent) {
      const locatorStrategy = (step as any).locatorStrategy;
      const ordinalDiag = (step as any).recoveryMetadata?.ordinalSelectionDiagnostics;
      if (locatorStrategy === "ordinal_selection" || ordinalDiag?.selectionPatternDetected === true) {
        intent = "select_visible_item_by_ordinal";
      }
    }

    if (!intent) {
      const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      
      if (/pr.A?stamos|cuenta|categoria|category/i.test(normalizedTarget)) {
        intent = 'select_category';
      } else if (/dep.A?sito|producto|product/i.test(normalizedTarget)) {
        intent = 'select_product';
      } else if (/primer|first|visible|listado/i.test(normalizedTarget)) {
        intent = 'select_visible_item_by_ordinal';
      }
    }
    
    if (ORDINAL_INTENTS.has(intent) && !lastOrdinalSelection) {
      lastOrdinalSelection = { stepIndex: step.index, target: targetValue };
    } else if (PRODUCT_INTENTS.has(intent) && !lastProductSelection) {
      const isSpecific = isSpecificItem(targetValue) && !isModuleHeading(targetValue);
      lastProductSelection = { stepIndex: step.index, target: targetValue, isSpecific };
    } else if (CATEGORY_INTENTS.has(intent) && !lastCategorySelection) {
      lastCategorySelection = { stepIndex: step.index, target: targetValue };
    }
  }
  
  if (lastOrdinalSelection) {
    return lastOrdinalSelection;
  }
  
  if (lastProductSelection && lastProductSelection.isSpecific) {
    return { stepIndex: lastProductSelection.stepIndex, target: lastProductSelection.target };
  }
  
  if (lastProductSelection && !isModuleHeading(lastProductSelection.target)) {
    return { stepIndex: lastProductSelection.stepIndex, target: lastProductSelection.target };
  }
  
  if (lastCategorySelection && !isModuleHeading(lastCategorySelection.target)) {
    return lastCategorySelection;
  }
  
  return null;
}

function deriveReplayIntent(step: ExecutionPlanStep): string | undefined {
  let intent = (step as any).semanticIntent;
  if (intent) return intent;

  const locatorStrategy = (step as any).locatorStrategy;
  const ordinalDiag = (step as any).recoveryMetadata?.ordinalSelectionDiagnostics;
  if (locatorStrategy === "ordinal_selection" || ordinalDiag?.selectionPatternDetected === true) {
    return "select_visible_item_by_ordinal";
  }

  const targetValue = getTargetValue(step.target) || step.description || "";
  const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (/pr.A?stamos|cuenta|categoria|category/i.test(normalizedTarget)) {
    return "select_category";
  }
  if (/primer|first|visible/i.test(normalizedTarget)) {
    return "select_visible_item_by_ordinal";
  }
  if (/dep.A?sito|producto|product/i.test(normalizedTarget)) {
    return "select_product";
  }
  return undefined;
}

function buildReplayBodyForStep(step: ExecutionPlanStep): string | undefined {
  const intent = deriveReplayIntent(step);
  const targetValue = getTargetValue(step.target) || step.description || "";

  switch (intent) {
    case "start_session":
      return "await homePage.start();";
    case "open_home":
      return "await homePage.open();";
    case "open_module":
      return `await operationsMenuPage.openModule('${escapeSpecString(targetValue)}');`;
    case "open_product_information":
      return "await productInformationPage.openProductInformation();";
    case "select_category":
      return `await categoryPage.selectCategory('${escapeSpecString(targetValue)}');`;
    case "select_product":
      return `await productListPage.selectProduct('${escapeSpecString(targetValue)}');`;
    case "select_visible_item_by_ordinal": {
      const ordinalDiag = (step as any).recoveryMetadata?.ordinalSelectionDiagnostics;
      const ordinal = ordinalDiag?.ordinal || "first";
      const domainTerm = ordinalDiag?.domainTerm;
      return domainTerm
        ? `await productListPage.selectVisibleItemByOrdinal('${escapeSpecString(ordinal)}', '${escapeSpecString(domainTerm)}');`
        : `await productListPage.selectVisibleItemByOrdinal('${escapeSpecString(ordinal)}');`;
    }
    case "select_first_visible_item":
    case "select_first_visible_product":
    case "select_first_visible_card":
      return "await productListPage.selectFirstVisibleCard();";
    case "return_to_list":
      return "await productDetailPage.backToList();";
    case "navigate":
      return `await page.goto('${escapeSpecString(targetValue || "/")}');`;
    default:
      return undefined;
  }
}

/**
 * Build lastSelectionReplay callback for detail page re-entry
 * Only applies to click_primary_action steps that need detail page context
 */
function buildLastSelectionReplayParam(
  steps: ExecutionPlanStep[],
  currentIndex: number
): string {
  const lastSelection = findLastSelectionStep(steps, currentIndex);
  if (!lastSelection) return 'undefined';
  
  // Find the selection step details
  const selectionStep = steps.find(s => s.index === lastSelection.stepIndex);
  if (!selectionStep) return 'undefined';

  const replayBody = buildReplayBodyForStep(selectionStep);
  if (!replayBody) return "undefined";

  return `async () => { ${replayBody} }`;
}

function buildPortablePathFromSpec(specPath: string, absoluteTargetPath: string): string {
  return path.relative(path.dirname(specPath), absoluteTargetPath).replace(/\\/g, "/");
}

function buildPortablePathFromCwd(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

function inferExpectedEffect(step: ExecutionPlanStep, semanticIntent: SemanticMethodIntent): "none" | "navigation" | "modal_or_form_or_navigation" | "ui_change" {
  if (step.action.startsWith("assert")) return "none";
  if (semanticIntent === "open_login_modal" || semanticIntent === "submit_login" || semanticIntent === "submit_form") {
    return "modal_or_form_or_navigation";
  }
  if (step.action === "click" || step.action === "select") return "ui_change";
  return "none";
}

function buildPageObjectImport(className: string, filePath: string, specPath: string): string {
  const importPath = path.relative(path.dirname(specPath), filePath).replace(/\\/g, "/").replace(/\.ts$/, "");
  return `import { ${className} } from '${importPath}';`;
}

function normalizePageObjectFilePath(filePath: string, _appDir: string): string {
  if (!filePath.includes(".candidate")) return filePath;
  return filePath.replace(/\.candidate\.ts$/, ".ts");
}

function isSelectionLikeStep(step: ExecutionPlanStep): boolean {
  const recoveryMeta = (step as any).recoveryMetadata;
  const selectionDiagnostics = (step as any).selectionDiagnostics;
  const locatorStrategy = (step as any).locatorStrategy;

  if (locatorStrategy === "ordinal_selection" || recoveryMeta?.ordinalSelectionDiagnostics?.selectionPatternDetected === true) {
    return true;
  }

  if (selectionDiagnostics?.selectionLike && selectionDiagnostics?.success) {
    return true;
  }

  if (recoveryMeta?.actionType === "action_select") {
    return true;
  }

  if (recoveryMeta?.semanticRole && ["option", "card", "item", "entity", "product", "recipient", "list_item"].includes(recoveryMeta.semanticRole)) {
    return true;
  }

  if (selectionDiagnostics?.reason === "selection_no_transition_next_action_enabled") {
    return true;
  }

  const targetValue = getTargetValue(step.target);
  const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const selectionKeywords = [
    "seleccionar", "elegir", "marcar", "escoger", "destinatario",
    "opcion", "producto", "cuenta", "tarjeta", "radio", "checkbox",
    "list item", "card", "tipo de carta", "recipient"
  ];
  for (const kw of selectionKeywords) {
    if (normalizedTarget.includes(kw)) return true;
  }

  const selectionScreenHeadings = [
    "seleccione", "selecciona", "a quien va dirigida", "destinatario",
    "opciones", "seleccione un", "selecciona un", "seleccione la",
    "selecciona la", "seleccione el", "selecciona el", "elija", "escoja"
  ];
  const description = (step.description ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const heading of selectionScreenHeadings) {
    if (description.includes(heading)) return true;
  }

  return false;
}

function isSubmitLikeStep(step: ExecutionPlanStep): boolean {
  const targetValue = getTargetValue(step.target);
  const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const submitKeywords = [
    "continuar", "siguiente", "confirmar", "enviar", "generar",
    "pagar", "transferir", "submit", "login", "next", "proceed",
    "send", "pay", "transfer", "solicitar", "finalizar", "aprobar"
  ];
  for (const kw of submitKeywords) {
    if (normalizedTarget.includes(kw)) return true;
  }

  return false;
}

function isModuleNavigationStep(step: ExecutionPlanStep): boolean {
  const targetValue = getTargetValue(step.target);
  const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const action = step.action.toLowerCase();

  if (action === "navigate" || action === "login") return false;
  if (action !== "click" && action !== "select") return false;

  if (isHomeRouteTarget(targetValue)) return false;

  const moduleKeywords = [
    "menu", "modul", "operacion", "categoria", "area funcional",
    "navigation", "module", "category", "functional area", "operation",
    "generar", "consulta", "transfer", "pago", "servicio"
  ];
  for (const kw of moduleKeywords) {
    if (normalizedTarget.includes(kw)) return true;
  }

  return false;
}

function isHomeRouteTarget(target: string): boolean {
  const normalized = target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const homeKeywords = [
    "iniciar", "inicio", "home", "start", "abrir app", "abrir portal",
    "pantalla principal", "setup route", "app_base_url"
  ];
  for (const kw of homeKeywords) {
    if (normalized === kw || normalized.includes(kw)) return true;
  }

  return false;
}

function deriveSelectionIntent(step: ExecutionPlanStep): SemanticMethodIntent {
  const recoveryMeta = (step as any).recoveryMetadata;
  const semanticRole = recoveryMeta?.semanticRole;

  if (semanticRole === "category") return "select_category";
  if (["product", "card", "item", "entity"].includes(semanticRole)) return "select_product";

  const targetValue = getTargetValue(step.target);
  const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const categoryKeywords = [
    "categoria", "category", "filtro", "filter", "tab", "menu", "seccion", "section"
  ];
  for (const kw of categoryKeywords) {
    if (normalizedTarget.includes(kw)) return "select_category";
  }

  const primaryActionKeywords = [
    "add to cart", "agregar al carrito", "comprar", "purchase", "checkout", "continuar", "submit", "enviar", "confirmar"
  ];
  for (const kw of primaryActionKeywords) {
    if (normalizedTarget.includes(kw)) return "click_primary_action";
  }

  if (/\b(primer[ao]?\s+(producto|item|registro|card|tarjeta|fila)|primera?\s+(tarjeta|card|fila)|first\s+visible\s+(item|product|card|row))\b/.test(normalizedTarget)) {
    if (/\b(fila|row)\b/.test(normalizedTarget)) return "select_first_visible_row";
    if (/\b(tarjeta|card)\b/.test(normalizedTarget)) return "select_first_visible_card";
    if (/\b(producto|product)\b/.test(normalizedTarget)) return "select_first_visible_product";
    return "select_first_visible_item";
  }

  const productConditionKeywords = ["cuenta", "tarjeta", "prestamo", "producto", "ahorro", "corriente"];
  for (const kw of productConditionKeywords) {
    if (normalizedTarget.includes(kw)) return "select_product";
  }

  return "select_product";
}

function deriveSelectionIntentWithOrdinalSupport(step: ExecutionPlanStep): SemanticMethodIntent {
  const recoveryMeta = (step as any).recoveryMetadata;
  const ordinalDiag = recoveryMeta?.ordinalSelectionDiagnostics;
  
  if (ordinalDiag?.selectionPatternDetected === true) {
    return "select_visible_item_by_ordinal";
  }
  
  return deriveSelectionIntent(step);
}

function findAuthGateStepIndex(steps: ExecutionPlanStep[]): number {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepDesc = (step.description ?? "").toLowerCase();

    if (stepDesc.startsWith("authflow handled") || stepDesc.includes("step consumed by authflow")) {
      return i;
    }

    const recoveryMeta = (step as any).recoveryMetadata;
    if (recoveryMeta?.recoveredBy === "auth_flow" || recoveryMeta?.recoveredBy === "auth_gate") {
      return i;
    }

    const targetValue = getTargetValue(step.target);
    if (isLikelyAuthGate(targetValue)) {
      return i;
    }
  }
  return -1;
}

/**
 * Validate that context-dependent actions have required context produced by previous steps
 */
function validateContextChain(plan: ExecutionPlan): string[] {
  const errors: string[] = [];
  const producedContexts = new Set<string>();
  
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const semanticIntent = (step as any).semanticIntent as SemanticMethodIntent | undefined;
    const contextMetadata = step.contextMetadata;
    
    if (!semanticIntent) continue;
    
    // Track context produced by this step
    const producedContext = getContextProducedByIntent(semanticIntent);
    if (producedContext) {
      producedContexts.add(producedContext);
    }
    if (contextMetadata?.producesContext) {
      producedContexts.add(contextMetadata.producesContext);
    }
    
    // Check if this step requires context
    if (contextMetadata?.isContextDependent || isContextDependentIntent(semanticIntent)) {
      const requiredContexts = contextMetadata?.requiresContext || [];
      
      // Add default required contexts based on intent
      if (semanticIntent === "select_product" || semanticIntent === "select_first_visible_product") {
        requiredContexts.push("product_list");
      }
      if (semanticIntent === "click_primary_action") {
        requiredContexts.push("authenticated");
      }
      if (semanticIntent === "submit_form") {
        requiredContexts.push("form_visible");
      }
      
      // Check if any required context is satisfied
      const hasRequiredContext = requiredContexts.some(ctx => producedContexts.has(ctx));
      
      if (!hasRequiredContext && requiredContexts.length > 0) {
        const targetValue = getTargetValue(step.target);
        errors.push(
          `Context dependency violation at step ${step.index}: Action '${semanticIntent}' on target '${targetValue}' ` +
          `requires context [${requiredContexts.join(", ")}] but no prior step produces it. ` +
          `Ensure navigation/module/auth steps precede context-dependent actions.`
        );
      }
    }
  }
  
  return errors;
}

export function generatePOMSpecFromPlan(
  plan: ExecutionPlan,
  automationId: string,
  appProfile: AppProfile,
  appPaths: AppAutomationPaths,
  pageObjectRegistry: PageObjectRegistry | undefined,
  policy: PromotionPolicy,
  inlineDebugMode: boolean,
  authFlowOptions?: {
    alias?: string;
    landing?: string;
    testDataJson?: string;
    insertionAfterStepIndex?: number;
    contractBinding?: { bindingId: string; coveredScenarioStepIndices: number[] };
  },
  metadata?: { sectionSlug?: string; scenarioId?: string }
): POMSpecResult {
  const escapedTitle = escapeSpecString(plan.scenario.title);

  const usedPageObjects: string[] = [];
  const missingPageObjects: string[] = [];
  const missingMethods: string[] = [];
  let generatedCandidates = 0;
  let usedAuthFlow = false;
  let inlineFallbackUsed = false;

  const importLines: string[] = [];
  const instantiationLines: string[] = [];
  const actionLines: string[] = [];
  const preambleLines: string[] = [];
  const dataHelperLines: string[] = [];
  const requiredDataUsed = new Set<string>();

  const importedClasses = new Set<string>();
  const instantiatedVars = new Map<string, string>();
  const declaredValueVars = new Set<string>();
  const dataVarMap = buildDataKeyVariableMap(
    plan.steps
      .filter((step) => Boolean(step.valueKey))
      .map((step) => String(step.valueKey))
  );
  const usesPromotedRuntime = plan.steps.some((step) => step.action !== "navigate" && step.action !== "login");

  function ensurePageObject(className: string, filePath: string): string {
    const key = className;
    if (!importedClasses.has(key)) {
      importedClasses.add(key);
      const normalizedPath = normalizePageObjectFilePath(filePath, appPaths.appDir);
      importLines.push(buildPageObjectImport(className, normalizedPath, appPaths.specPath ?? ""));
      const varName = className.charAt(0).toLowerCase() + className.slice(1);
      instantiatedVars.set(key, varName);
      instantiationLines.push(`const ${varName} = new ${className}(page);`);
      usedPageObjects.push(className);
    }
    return instantiatedVars.get(key)!;
  }

  function makeDescription(step: ExecutionPlanStep): string {
    const target = getTargetValue(step.target);
    return `${step.action} ${target}`.trim();
  }

  function ensureDataValue(step: ExecutionPlanStep): string {
    if (!step.valueKey) {
      return step.value ? `'${escapeSpecString(step.value)}'` : "''";
    }
    const varName = dataVarMap.get(step.valueKey) ?? "dataValue";
    requiredDataUsed.add(step.valueKey);
    if (!declaredValueVars.has(varName)) {
      declaredValueVars.add(varName);
      const fieldName = getTargetValue(step.target);
      dataHelperLines.push(
        `const ${varName} = requirePromotedData(dataContext, '${escapeSpecString(step.valueKey)}', { fieldName: '${escapeSpecString(fieldName)}', stepIndex: ${step.index} });`
      );
    }
    return varName;
  }

  // Determine AuthFlow insertion point from metadata (preferred) or legacy detection
  const authFlowInsertionAfterIndex = authFlowOptions?.insertionAfterStepIndex ?? -1;
  const authGateStepIndex = authFlowOptions && authFlowInsertionAfterIndex < 0 
    ? findAuthGateStepIndex(plan.steps) 
    : -1;
  // Use metadata index if available, otherwise use legacy detection
  const effectiveAuthInsertionIndex = authFlowInsertionAfterIndex >= 0 
    ? authFlowInsertionAfterIndex 
    : authGateStepIndex;
  const authGateDetected = effectiveAuthInsertionIndex >= 0 || authFlowOptions !== undefined;

  if (authGateDetected) {
    usedAuthFlow = true;
  }

  if (plan.steps.some((step) => step.action === "navigate" && step.target === "APP_BASE_URL")) {
    preambleLines.push("await page.goto('/');");
    preambleLines.push("await page.waitForLoadState('domcontentloaded');");
  }

  const preAuthActionLines: string[] = [];
  const postAuthActionLines: string[] = [];
  
  // First pass: collect all unique replay functions globally
  const allReplayFunctions = new Map<string, string>();
  for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
    const step = plan.steps[stepIndex];
    if (step.action === "navigate" || step.action === "login") continue;
    const stepDesc = (step.description ?? "").toLowerCase();
    if (stepDesc.startsWith("authflow handled") || stepDesc.includes("step consumed by authflow")) continue;
    if ((step as any).recoveryMetadata?.recoveredBy === "auth_flow") continue;
    if ((step as any).recoveryMetadata?.recoveredBy === "contextual_intermediate_already_satisfied") continue;
    
    const replays = buildPreviousStepReplaysParam(plan.steps, stepIndex, pageObjectRegistry);
    for (const func of replays.replayFunctions) {
      const match = func.match(/const (replayStep_\d+)/);
      if (match) {
        const funcName = match[1];
        if (!allReplayFunctions.has(funcName)) {
          allReplayFunctions.set(funcName, func);
        }
      }
    }
  }
  const replayFunctionLines = Array.from(allReplayFunctions.values());

  for (const step of plan.steps) {
    const description = makeDescription(step);
    const stepIndex = plan.steps.indexOf(step);

    if (step.action === "navigate" || step.action === "login") {
      continue;
    }

    const stepDesc = (step.description ?? "").toLowerCase();
    if (stepDesc.startsWith("authflow handled") || stepDesc.includes("step consumed by authflow")) {
      continue;
    }

    const recoveryMeta = (step as any).recoveryMetadata;
    if (recoveryMeta?.recoveredBy === "auth_flow" || recoveryMeta?.recoveredBy === "auth_gate") {
      continue;
    }
    
    // Skip steps that were already satisfied without UI action (contextual_intermediate_already_satisfied)
    if (recoveryMeta?.recoveredBy === "contextual_intermediate_already_satisfied") {
      console.log(`[spec-generator-pom] Skipping already_satisfied step: target="${getTargetValue(step.target)}" (no UI action executed)`);
      continue;
    }

    // Determine if this step is before or after AuthFlow insertion point
    // Steps at index <= effectiveAuthInsertionIndex are pre-auth, steps after are post-auth
    const isPreAuth = effectiveAuthInsertionIndex >= 0 && stepIndex <= effectiveAuthInsertionIndex;

    const moduleNav = isModuleNavigationStep(step);
    const submitLike = !moduleNav && isSubmitLikeStep(step);
    const isActionSelectionStep = step.action === "click" || step.action === "select" || step.action === "check";
    const selectionLike = !moduleNav && !submitLike && isActionSelectionStep && isSelectionLikeStep(step);

    let semanticIntent: SemanticMethodIntent;
    let contextMetadata: ExecutionPlanStep["contextMetadata"] = {};

    if (moduleNav) {
      // Preserve module navigation target instead of compacting to open_home
      const targetValue = getTargetValue(step.target);
      semanticIntent = "open_module";
      contextMetadata = {
        producesContext: `module:${targetValue}`,
        expectedScreen: `module:${targetValue}`,
        screenTransition: "navigation",
        isContextDependent: false
      };
    } else if (submitLike) {
      semanticIntent = "click_primary_action";
      contextMetadata = {
        requiresContext: ["authenticated"],
        isContextDependent: true
      };
    } else if (selectionLike) {
      const recoveryMeta = (step as any).recoveryMetadata;
      const semanticRole = recoveryMeta?.semanticRole;
      const actionType = recoveryMeta?.actionType;
      const selectionDiagnostics = (step as any).selectionDiagnostics;
      const locatorStrategy = (step as any).locatorStrategy;
      const ordinalDiag = recoveryMeta?.ordinalSelectionDiagnostics;

      // Check for ordinal_selection from recovery metadata
      const isOrdinalSelection = locatorStrategy === "ordinal_selection" || 
                                 ordinalDiag?.selectionPatternDetected === true;
      
      if (isOrdinalSelection) {
        semanticIntent = "select_visible_item_by_ordinal";
      } else {
        const hasExplicitSelectionDiagnostics =
          selectionDiagnostics?.selectionLike ||
          actionType === "action_select" ||
          ["option", "card", "item", "entity", "product", "recipient", "list_item"].includes(semanticRole) ||
          selectionDiagnostics?.reason === "selection_no_transition_next_action_enabled";

        if (hasExplicitSelectionDiagnostics) {
          semanticIntent = deriveSelectionIntentWithOrdinalSupport(step);
        } else {
          semanticIntent = deriveMethodIntentFromStepWithContext(step, plan.steps);
        }
      }
      
      // Mark selection actions as context-dependent
      contextMetadata = {
        requiresContext: ["product_list", "category", "module"],
        isContextDependent: true
      };
    } else {
      semanticIntent = deriveMethodIntentFromStepWithContext(step, plan.steps);
    }

    if (moduleNav && isHomeRouteTarget(getTargetValue(step.target))) {
      semanticIntent = "open_home";
      contextMetadata = {
        producesContext: "home",
        expectedScreen: "home",
        screenTransition: "navigation",
        isContextDependent: false
      };
    }

    let resolved = pageObjectRegistry
      ? findMethodBySemanticIntent(pageObjectRegistry, semanticIntent, step)
      : undefined;

    let fallbackUsed = false;
    let fallbackInfo: string | undefined;

    if (!resolved && pageObjectRegistry) {
      const targetValue = getTargetValue(step.target);
      const expectedOwner = deriveExpectedOwnerForStep(step, plan.steps);

      if (!resolved && semanticIntent === "select_product") {
        const productListPO = pageObjectRegistry.pageObjects.find(
          (po) => po.className === "ProductListPage" && po.status === "active"
        ) ?? pageObjectRegistry.pageObjects.find(
          (po) => po.className === "ProductListPage" && po.status === "candidate"
        );
        if (productListPO) {
          const selectMethod = productListPO.methods.find(
            (m) => m.name === "selectProduct" && m.status === "active" && m.available
          ) ?? productListPO.methods.find(
            (m) => m.name === "selectProduct" && m.status === "candidate" && m.available
          );
          if (selectMethod) {
            resolved = { pageObject: productListPO, method: selectMethod };
            fallbackUsed = true;
            fallbackInfo = `select_product fallback for "${targetValue}"`;
          }
        }
      }

      if (!resolved && semanticIntent === "click_primary_action") {
        const detailPO = pageObjectRegistry.pageObjects.find(
          (po) => po.className === "ProductDetailPage" && po.status === "active"
        ) ?? pageObjectRegistry.pageObjects.find(
          (po) => po.className === "ProductDetailPage" && po.status === "candidate"
        );
        if (detailPO) {
          const clickMethod = detailPO.methods.find(
            (m) => m.name === "clickPrimaryAction" && m.status === "active" && m.available
          ) ?? detailPO.methods.find(
            (m) => m.name === "clickPrimaryAction" && m.status === "candidate" && m.available
          );
          if (clickMethod) {
            resolved = { pageObject: detailPO, method: clickMethod };
            fallbackUsed = true;
            fallbackInfo = `click_primary_action fallback for "${targetValue}"`;
          }
        }
      }

      if (!resolved && semanticIntent === "start_session") {
        const homePO = pageObjectRegistry.pageObjects.find(
          (po) => po.className === "HomePage" && po.status === "active"
        ) ?? pageObjectRegistry.pageObjects.find(
          (po) => po.className === "HomePage" && po.status === "candidate"
        );
        if (homePO) {
          const startMethod = homePO.methods.find(
            (m) => m.name === "start" && m.status === "active" && m.available
          ) ?? homePO.methods.find(
            (m) => m.name === "start" && m.status === "candidate" && m.available
          );
          if (startMethod) {
            resolved = { pageObject: homePO, method: startMethod };
            fallbackUsed = true;
            fallbackInfo = `start_session fallback for "${targetValue}"`;
          }
        }
      }
    }

    let actionLine = "";

    if (resolved) {
      const targetValue = getTargetValue(step.target);
      const normalizedTarget = targetValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const isCategoryLikeTarget = /\b(categoria|category|filtro|filter|tab|menu)\b/.test(normalizedTarget);
      const isPrimaryActionLikeTarget = /\b(add to cart|agregar al carrito|comprar|purchase|checkout|continuar|submit|enviar|confirmar)\b/.test(normalizedTarget);
      const isFirstVisibleSelectionTarget = /\b(primer[ao]?\s+(producto|item|registro|card|tarjeta|fila)|primera?\s+(tarjeta|card|fila)|first\s+visible\s+(item|product|card|row)|visible\s+(item|product|card|row))\b/.test(normalizedTarget);
      const isActionStep = step.action === "click" || step.action === "select";

      // Prevent semantic ownership drift: do not use expectLoaded as a click/select surrogate.
      if (isActionStep && resolved.method.intent === "expect_loaded") {
        resolved = undefined;
      }

      // Prevent generic selectProduct misuse for category/filter/button-like targets.
      if (
        resolved
        && resolved.method.name === "selectProduct"
        && (isCategoryLikeTarget || isPrimaryActionLikeTarget || isFirstVisibleSelectionTarget)
      ) {
        resolved = undefined;
      }
    }

    if (resolved) {
      const varName = ensurePageObject(resolved.pageObject.className, resolved.pageObject.filePath);
      const method = resolved.method;
      if (method.parameters.length > 0) {
        const targetValue = getTargetValue(step.target);
        const resolvedValueExpr = step.valueKey || typeof step.value === "string"
          ? ensureDataValue(step)
          : undefined;
        
        // Special handling for select_visible_item_by_ordinal
        if (semanticIntent === "select_visible_item_by_ordinal") {
          const recoveryMeta = (step as any).recoveryMetadata;
          const ordinalDiag = recoveryMeta?.ordinalSelectionDiagnostics;
          const ordinal = ordinalDiag?.ordinal || "first";
          const domainTerm = ordinalDiag?.domainTerm;
          const runtimeTarget = recoveryMeta?.selectedCandidateText
            ? (step.target as any)?.metadata?.originalTarget || step.description || targetValue
            : targetValue;
          
          const args = [`"${ordinal}"`];
          if (domainTerm) {
            args.push(`"${domainTerm}"`);
          }
          const methodCall = `${varName}.${method.name}(${args.join(", ")})`;
          const replays = buildPreviousStepReplaysParam(plan.steps, stepIndex, pageObjectRegistry);
          actionLine = `await promotedRuntime.clickPromotedTarget({ stepIndex: ${step.index}, target: '${escapeSpecString(runtimeTarget)}', actionIntent: '${semanticIntent}', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: ${replays.arrayParam}, action: async () => { await ${methodCall}; } });`;
        } else {
          const args = method.parameters.map((parameter, index) => {
            if ((semanticIntent === "fill_username" || semanticIntent === "fill_password") && index === 0 && resolvedValueExpr) {
              return resolvedValueExpr;
            }
            if (semanticIntent === "submit_login" && method.name === "loginWithCredentials") {
              if (parameter.toLowerCase().includes("user")) return "usuario_valido";
              if (parameter.toLowerCase().includes("pass")) return "contrasena_valida";
            }
            if (resolvedValueExpr && method.parameters.length === 1) {
              return resolvedValueExpr;
            }
            if (resolvedValueExpr && method.parameters.length > 1) {
              const paramName = parameter.toLowerCase();
              const isLastParameter = index === method.parameters.length - 1;
              if (paramName.includes("value") || paramName.includes("text") || paramName.includes("input") || paramName === "v") {
                return resolvedValueExpr;
              }
              if (isLastParameter && step.action === "fill") {
                return resolvedValueExpr;
              }
            }
            return `'${escapeSpecString(targetValue || parameter)}'`;
          }).join(", ");
          const methodCall = `${varName}.${method.name}(${args})`;
          if (step.action === "fill") {
            actionLine = `await promotedRuntime.fillPromotedField({ stepIndex: ${step.index}, field: '${escapeSpecString(targetValue)}', value: String(${resolvedValueExpr ?? "''"}), sensitive: ${String(Boolean(method.sensitive))}, fill: async () => { await ${methodCall}; } });`;
          } else if (step.action.startsWith("assert")) {
            actionLine = `await promotedRuntime.expectPromotedVisible({ stepIndex: ${step.index}, target: '${escapeSpecString(targetValue)}', assertion: async () => { await ${methodCall}; } });`;
          } else if (step.action === "select") {
            actionLine = `await promotedRuntime.selectPromotedItem({ stepIndex: ${step.index}, target: '${escapeSpecString(targetValue)}', actionIntent: '${semanticIntent}', expectedEffect: '${inferExpectedEffect(step, semanticIntent)}', sensitive: ${String(Boolean(method.sensitive))}, action: async () => { await ${methodCall}; } });`;
          } else {
            const lastSelection = findLastSelectionStep(plan.steps, stepIndex);
            const replayExclusions = semanticIntent === "return_to_list" && lastSelection
              ? { excludeStepIndices: [lastSelection.stepIndex] }
              : undefined;
            const replays = buildPreviousStepReplaysParam(plan.steps, stepIndex, pageObjectRegistry, replayExclusions);
            const lastSelectionParam = lastSelection ? `{ stepIndex: ${lastSelection.stepIndex}, selectedTarget: '${escapeSpecString(lastSelection.target)}' }` : 'undefined';
            const expectedOwnerPage = deriveExpectedOwnerForStep(step, plan.steps);
            const lastSelectionReplayParam = (semanticIntent === 'click_primary_action' || semanticIntent === 'return_to_list') && lastSelection 
              ? `lastSelectionReplay: ${buildLastSelectionReplayParam(plan.steps, stepIndex)},` 
              : '';
            actionLine = `await promotedRuntime.clickPromotedTarget({ stepIndex: ${step.index}, target: '${escapeSpecString(targetValue)}', actionIntent: '${semanticIntent}', expectedEffect: '${inferExpectedEffect(step, semanticIntent)}', sensitive: ${String(Boolean(method.sensitive))}, previousStepReplays: ${replays.arrayParam}, lastSelectionStep: ${lastSelectionParam}, ${lastSelectionReplayParam} expectedOwnerPage: '${expectedOwnerPage || ''}', action: async () => { await ${methodCall}; } });`;
          }
        }
      } else {
        const methodCall = `${varName}.${method.name}()`;
        const targetValue = getTargetValue(step.target);
        if (step.action.startsWith("assert")) {
          actionLine = `await promotedRuntime.expectPromotedVisible({ stepIndex: ${step.index}, target: '${escapeSpecString(targetValue)}', assertion: async () => { await ${methodCall}; } });`;
        } else if (step.action === "fill") {
          const resolvedValueExpr = ensureDataValue(step);
          actionLine = `await promotedRuntime.fillPromotedField({ stepIndex: ${step.index}, field: '${escapeSpecString(targetValue)}', value: String(${resolvedValueExpr}), sensitive: ${String(Boolean(method.sensitive))}, fill: async () => { await ${methodCall}; } });`;
        } else if (step.action === "select") {
          actionLine = `await promotedRuntime.selectPromotedItem({ stepIndex: ${step.index}, target: '${escapeSpecString(targetValue)}', actionIntent: '${semanticIntent}', expectedEffect: '${inferExpectedEffect(step, semanticIntent)}', sensitive: ${String(Boolean(method.sensitive))}, action: async () => { await ${methodCall}; } });`;
        } else {
          const lastSelection = findLastSelectionStep(plan.steps, stepIndex);
          const replayExclusions = semanticIntent === "return_to_list" && lastSelection
            ? { excludeStepIndices: [lastSelection.stepIndex] }
            : undefined;
          const replays = buildPreviousStepReplaysParam(plan.steps, stepIndex, pageObjectRegistry, replayExclusions);
          const lastSelectionParam = lastSelection ? `{ stepIndex: ${lastSelection.stepIndex}, selectedTarget: '${escapeSpecString(lastSelection.target)}' }` : 'undefined';
          const expectedOwnerPage = deriveExpectedOwnerForStep(step, plan.steps);
          const lastSelectionReplayParam = (semanticIntent === 'click_primary_action' || semanticIntent === 'return_to_list') && lastSelection 
            ? `lastSelectionReplay: ${buildLastSelectionReplayParam(plan.steps, stepIndex)},` 
            : '';
          actionLine = `await promotedRuntime.clickPromotedTarget({ stepIndex: ${step.index}, target: '${escapeSpecString(targetValue)}', actionIntent: '${semanticIntent}', expectedEffect: '${inferExpectedEffect(step, semanticIntent)}', sensitive: ${String(Boolean(method.sensitive))}, previousStepReplays: ${replays.arrayParam}, lastSelectionStep: ${lastSelectionParam}, ${lastSelectionReplayParam} expectedOwnerPage: '${expectedOwnerPage || ''}', action: async () => { await ${methodCall}; } });`;
        }
        const tv = getTargetValue(step.target);
        if (tv) {
          actionLine += ` // [target: ${tv}]`;
        }
      }
      if (method.sensitive) {
        actionLine += ` // [sensitive] ${description}`;
      }
    } else if (policy.allowCandidateGeneration && pageObjectRegistry) {
      const skipCandidateIntents: SemanticMethodIntent[] = [];
      if (!skipCandidateIntents.includes(semanticIntent)) {
        const candidateResult = findCandidateMethod(pageObjectRegistry, semanticIntent, description);
        if (candidateResult) {
          const varName = ensurePageObject(candidateResult.pageObject.className, candidateResult.pageObject.filePath);
          const method = candidateResult.method;
          if (method.parameters.length > 0) {
            const targetValue = getTargetValue(step.target);
            const resolvedValueExpr = step.valueKey || typeof step.value === "string"
              ? ensureDataValue(step)
              : undefined;
            const args = method.parameters.map((parameter) => {
              if (resolvedValueExpr && method.parameters.length === 1) return resolvedValueExpr;
              return `'${escapeSpecString(targetValue || parameter)}'`;
            }).join(", ");
            const methodCall = `${varName}.${method.name}(${args})`;
            const previousStepsParam = buildPreviousStepsParam(plan.steps, stepIndex);
            const lastSelection = findLastSelectionStep(plan.steps, stepIndex);
            const lastSelectionParam = lastSelection ? `{ stepIndex: ${lastSelection.stepIndex}, selectedTarget: '${escapeSpecString(lastSelection.target)}' }` : 'undefined';
            const expectedOwnerPage = deriveExpectedOwnerForStep(step, plan.steps);
            actionLine = `await promotedRuntime.clickPromotedTarget({ stepIndex: ${step.index}, target: '${escapeSpecString(targetValue)}', actionIntent: '${semanticIntent}', expectedEffect: '${inferExpectedEffect(step, semanticIntent)}', previousSteps: ${previousStepsParam}, lastSelectionStep: ${lastSelectionParam}, expectedOwnerPage: '${expectedOwnerPage || ''}', action: async () => { await ${methodCall}; } }); // candidate method`;
          } else {
            const methodCall = `${varName}.${method.name}()`;
            const previousStepsParam = buildPreviousStepsParam(plan.steps, stepIndex);
            const lastSelection = findLastSelectionStep(plan.steps, stepIndex);
            const lastSelectionParam = lastSelection ? `{ stepIndex: ${lastSelection.stepIndex}, selectedTarget: '${escapeSpecString(lastSelection.target)}' }` : 'undefined';
            const expectedOwnerPage = deriveExpectedOwnerForStep(step, plan.steps);
            actionLine = `await promotedRuntime.clickPromotedTarget({ stepIndex: ${step.index}, target: '${escapeSpecString(getTargetValue(step.target))}', actionIntent: '${semanticIntent}', expectedEffect: '${inferExpectedEffect(step, semanticIntent)}', previousSteps: ${previousStepsParam}, lastSelectionStep: ${lastSelectionParam}, expectedOwnerPage: '${expectedOwnerPage || ''}', action: async () => { await ${methodCall}; } }); // candidate method`;
          }
          actionLine += `\n  // [candidate] ${description}`;
          generatedCandidates += 1;
        }
      }
    }

    if (!actionLine && policy.allowInlineFallback && !policy.requirePageObjects) {
      const locator = buildInlineLocator(step);
      actionLine = buildInlineAction(step, locator);
      actionLine += `\n  // [inline] ${description}`;
      inlineFallbackUsed = true;
    }

    if (!actionLine && resolved === undefined) {
      const targetValue = getTargetValue(step.target);
      const expectedOwner = deriveExpectedOwnerForStep(step, plan.steps);
      const ownerPO = pageObjectRegistry?.pageObjects.find((po) => po.className === expectedOwner);
      const availableMethods = ownerPO
        ? ownerPO.methods.filter((m) => m.status === "active" && m.available).map((m) => m.name)
        : [];

      const recoveryMeta = (step as any).recoveryMetadata;
      const selectionDiagnostics = (step as any).selectionDiagnostics;
      const strategy = recoveryMeta?.strategy || selectionDiagnostics?.strategy || "unknown";
      const classification = moduleNav ? "moduleNav" : submitLike ? "submitLike" : selectionLike ? "selectionLike" : "default";

      let reason = "method_not_registered";
      if (!ownerPO) {
        reason = "owner_page_missing";
      } else if (availableMethods.length > 0) {
        reason = "method_missing";
      }

      // Get expected method name (camelCase) from semantic intent (snake_case)
      const expectedMethodName = METHOD_INTENT_NAME_MAP[semanticIntent] || semanticIntent;

      const missingInfo = {
        target: targetValue,
        stepIndex: stepIndex,
        ownerPage: expectedOwner,
        expectedMethod: expectedMethodName,
        expectedIntent: semanticIntent,
        classification,
        strategy,
        availableMethods,
        reason
      };

      console.log(`[spec-generator-pom] Missing page method: target="${missingInfo.target}" stepIndex=${missingInfo.stepIndex} ownerPage="${missingInfo.ownerPage}" expectedMethod="${missingInfo.expectedMethod}" (intent="${missingInfo.expectedIntent}") classification="${missingInfo.classification}" strategy="${missingInfo.strategy}" availableMethods=[${missingInfo.availableMethods.join(", ")}] reason="${missingInfo.reason}"`);

      missingMethods.push(
        `step=${stepIndex} target="${targetValue}" ` +
        `derivedIntent="${semanticIntent}" expectedOwner="${expectedOwner}" ` +
        `availableMethods=[${availableMethods.join(", ")}]`
      );
      if (policy.allowInlineFallback && !policy.requirePageObjects) {
        const locator = buildInlineLocator(step);
        actionLine = buildInlineAction(step, locator);
        actionLine += `\n  // [inline-fallback] ${description}`;
        inlineFallbackUsed = true;
      }
    }

    if (actionLine) {
      if (isPreAuth) {
        preAuthActionLines.push(actionLine);
      } else {
        postAuthActionLines.push(actionLine);
      }
    }
  }

  if (usedAuthFlow && authFlowOptions) {
    // Calculate AuthFlow import path dynamically based on spec location
    const authFlowAbsolutePath = path.resolve(process.cwd(), "automations/apps", appProfile.appSlug, "flows/auth.flow.ts");
    const authFlowImportPath = buildPortablePathFromSpec(appPaths.specPath ?? "", authFlowAbsolutePath).replace(/\.ts$/, "");
    const authImport = `import { AuthFlow, setAuthFlowTestData } from '${authFlowImportPath}';`;
    
    if (!importLines.includes(authImport)) {
      importLines.push(authImport);
    }

    const authInstantiation = buildAuthFlowInstantiation();
    if (!instantiationLines.includes(authInstantiation)) {
      instantiationLines.push(authInstantiation);
    }

    actionLines.push(...preAuthActionLines);
    if (preAuthActionLines.length > 0) {
      actionLines.push("");
    }
    actionLines.push(`  setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());`);
    actionLines.push(`  const authFlowResult = await authFlow.ensureAuthenticated({`);
    actionLines.push(`    alias: '${authFlowOptions.alias || 'defaultClient'}',`);
    actionLines.push(`    landing: '${authFlowOptions.landing || 'transactions_menu'}',`);
    if (authFlowOptions.contractBinding) {
      actionLines.push(`    contractBinding: ${JSON.stringify(authFlowOptions.contractBinding)},`);
    }
    actionLines.push(`  });`);
    actionLines.push(`  if (!authFlowResult.success) {`);
    actionLines.push(`    throw new Error(\`auth_flow_failed_in_promoted_spec: \${authFlowResult.error || 'unknown_error'}\`);`);
    actionLines.push(`  }`);
    if (postAuthActionLines.length > 0) {
      actionLines.push("");
    }
    actionLines.push(...postAuthActionLines);
  } else {
    actionLines.push(...preAuthActionLines);
    actionLines.push(...postAuthActionLines);
  }

  const lines: string[] = [];
  const promotedManifestPath = escapeSpecString(buildPortablePathFromCwd(path.join(appPaths.caseDir ?? path.dirname(appPaths.specPath ?? ""), "promoted-data.json")));

  const specUsesExpect = [
    ...actionLines,
    ...preambleLines,
    ...dataHelperLines,
    ...importLines,
  ].some((line) => /\bexpect\s*\(/.test(line));
  lines.push(specUsesExpect
    ? "import { test, expect } from '@playwright/test';"
    : "import { test } from '@playwright/test';");
  if (usesPromotedRuntime) {
    const runtimeImportPath = escapeSpecString(buildPortablePathFromSpec(appPaths.specPath ?? "", path.resolve(process.cwd(), "src/automations/runtime/promoted-spec-runtime.ts")));
    lines.push(`import { createPromotedSpecRuntime } from '${runtimeImportPath.replace(/\.ts$/, "")}';`);
  }
  if (requiredDataUsed.size > 0) {
    lines.push("import { resolve } from 'node:path';");
  }

  if (requiredDataUsed.size > 0) {
    const envImportPath = escapeSpecString(buildPortablePathFromSpec(appPaths.specPath ?? "", path.resolve(process.cwd(), "src/config/env.ts")));
    const dataImportPath = escapeSpecString(buildPortablePathFromSpec(appPaths.specPath ?? "", path.resolve(process.cwd(), "src/data/index.ts")));
    const appProfileImportPath = escapeSpecString(buildPortablePathFromSpec(appPaths.specPath ?? "", path.resolve(process.cwd(), "src/automations/app-profile.ts")));
    const promotedDataImportPath = escapeSpecString(buildPortablePathFromSpec(appPaths.specPath ?? "", path.resolve(process.cwd(), "src/data/promoted-data.ts")));
    lines.push(`import { config } from '${envImportPath.replace(/\.ts$/, "")}';`);
    lines.push(`import { buildDataContext } from '${dataImportPath.replace(/\/index\.ts$/, "").replace(/\.ts$/, "")}';`);
    lines.push(`import { loadPromotedAppConfigSync, buildMergedConfig } from '${appProfileImportPath.replace(/\.ts$/, "")}';`);
    lines.push(`import { loadPromotedDataManifestSync, buildPromotedDataContext, requirePromotedData } from '${promotedDataImportPath.replace(/\.ts$/, "")}';`);
  }

  if (importLines.length > 0) {
    lines.push("");
    lines.push(...importLines);
  }

  if (usedAuthFlow) {
    const authFlowHelpersPath = buildPortablePathFromSpec(appPaths.specPath ?? "", path.resolve(process.cwd(), "automations/apps", appProfile.appSlug, "flows", "auth.flow.helpers.ts"));
    lines.push(`import { resolvePromotedSpecAuthDataFromEnv } from '${authFlowHelpersPath.replace(/\.ts$/, "")}';`);
  }

  lines.push("");
  lines.push(`export const PROMOTED_SPEC_STRATEGY = "pom_runtime";`);
  lines.push("");
  const testName = inlineDebugMode
    ? `test('[INLINE DEBUG] ${escapedTitle}', async ({ page }) => {`
    : `test('${escapedTitle}', async ({ page }) => {`;
  lines.push(testName);
  lines.push(`  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));`);
  
  // Emit evidence metadata for this test scenario
  const scenarioId = metadata?.scenarioId ?? plan.scenario.externalId ?? `C${plan.scenario.caseId ?? ""}`;
  const sectionSlug = metadata?.sectionSlug ?? "default-section";
  lines.push(`  // Evidence metadata`);
  lines.push(`  process.env.APP_SLUG = '${escapeSpecString(appProfile.appSlug)}';`);
  lines.push(`  process.env.SECTION_SLUG = '${escapeSpecString(sectionSlug)}';`);
  lines.push(`  process.env.SCENARIO_ID = '${escapeSpecString(scenarioId)}';`);
  lines.push(`  process.env.SCENARIO_TITLE = '${escapedTitle}';`);
  lines.push(``);

  if (requiredDataUsed.size > 0) {
    lines.push("");
    lines.push(`  const __appConfig = loadPromotedAppConfigSync({ appSlug: '${escapeSpecString(appProfile.appSlug)}', configPath: '${escapeSpecString(appPaths.configPath.replace(/\\/g, "/"))}' });`);
    lines.push("  const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;");
    lines.push("  const __baseDataContext = buildDataContext(__runtimeConfig);");
    lines.push(`  const __promotedManifest = loadPromotedDataManifestSync(resolve(process.cwd(), '${promotedManifestPath}'));`);
    lines.push("  const dataContext = buildPromotedDataContext({");
    lines.push("    baseDataContext: __baseDataContext,");
    lines.push("    manifest: __promotedManifest,");
    lines.push("    testDataProfile: __runtimeConfig.app.testDataProfile,");
    lines.push("    autoGenerateTestData: __runtimeConfig.app.autoGenerateTestData,");
    lines.push("    autoGenerateSensitiveData: __runtimeConfig.app.autoGenerateSensitiveData");
    lines.push("  });");
  }

  if (instantiationLines.length > 0) {
    lines.push("");
    lines.push(...instantiationLines.map((l) => `  ${l}`));
  }

  if (usesPromotedRuntime) {
    lines.push("");
    lines.push("  const promotedRuntime = createPromotedSpecRuntime(page);");
  }

  // Wrap action execution in try/finally for evidence finalization
  lines.push(`  try {`);

  if (preambleLines.length > 0) {
    lines.push("");
    lines.push(...preambleLines.map((l) => `  ${l}`));
  }

  if (dataHelperLines.length > 0) {
    lines.push("");
    lines.push(...dataHelperLines.map((l) => `  ${l}`));
  }

  if (missingMethods.length > 0 && policy.requirePageObjects) {
    lines.push(`  // WARNING: Missing page object methods:`);
    for (const mm of missingMethods) {
      lines.push(`  // - ${mm}`);
    }
    lines.push("");
  }

  lines.push("");
  if (actionLines.length > 0) {
    if (replayFunctionLines.length > 0) {
      lines.push(...replayFunctionLines.map((l) => `  ${l}`));
      lines.push("");
    }
    lines.push(...actionLines.map((l) => `  ${l}`));
  } else {
    lines.push("  // No POM-compatible actions mapped");
  }

  if (missingMethods.length > 0) {
    lines.push("  // Fallthrough: execute remaining plan steps via executor");
  }

  let pomStatus: POMPromotionStatus;
  if (inlineDebugMode) {
    pomStatus = "inline_debug_only";
  } else if (!pageObjectRegistry || pageObjectRegistry.pageObjects.length === 0) {
    pomStatus = "needs_page_object";
  } else if (missingMethods.length > 0 && policy.requirePageObjects) {
    pomStatus = "needs_page_method";
  } else if (generatedCandidates > 0) {
    pomStatus = "page_object_candidate_created";
  } else if (usedPageObjects.length > 0) {
    pomStatus = "promoted";
  } else {
    pomStatus = "needs_page_object";
  }

  lines.push(`  } finally {`);
  lines.push(`    await promotedRuntime.finishEvidence();`);
  lines.push(`  }`);
  lines.push("});");

  const specContent = lines.join("\n");
  const validationErrors = [
    ...validateSpecQuality(actionLines, plan, specContent),
    ...validatePreAuthSteps(plan, specContent, usedAuthFlow),
    ...validateSelectionMapping(plan, actionLines),
    ...validateNavigationDegradation(plan, actionLines),
    ...validateContextChain(plan)
  ];

  if (validationErrors.length > 0 && pomStatus === "promoted") {
    pomStatus = "needs_manual_review";
  }

  return {
    specContent,
    pomStatus,
    usedPageObjects,
    missingPageObjects,
    missingMethods,
    generatedCandidates,
    usedAuthFlow,
    validationErrors,
    inlineFallbackUsed,
    requiredDataUsed: Array.from(requiredDataUsed)
  };
}

function validateSpecQuality(actionLines: string[], plan: ExecutionPlan, specContent: string): string[] {
  const errors: string[] = [];

  // Count homePage.start() calls in main action lines (exclude replay function definitions)
  // Replay functions are defined as: const replayStepN = async () => { await homePage.start(); };
  let startCallCount = 0;
  for (const line of actionLines) {
    // Skip replay function definition lines
    if (/const replayStep\d+\s*=/.test(line)) {
      continue;
    }
    // Count only main action lines that call .start()
    if (/\.start\(\)/.test(line)) {
      startCallCount++;
    }
  }
  
  if (startCallCount >= 3) {
    errors.push(`Suspicious duplicate homePage.start() calls: ${startCallCount}. Spec may be degraded.`);
  }

  const commonNavWords = new Set(["continuar", "siguiente", "next", "volver", "back", "cancelar", "cancel"]);
  for (const step of plan.steps) {
    const stepDesc = (step.description ?? "").toLowerCase();
    if (stepDesc.startsWith("authflow handled") || stepDesc.includes("step consumed by authflow")) {
      const targetValue = getTargetValue(step.target);
      if (!targetValue || commonNavWords.has(targetValue.toLowerCase())) continue;
      if (actionLines.some(l => l.toLowerCase().includes(targetValue.toLowerCase()))) {
        errors.push(`Auth-consumed step "${targetValue}" appears as manual action in spec.`);
      }
    }
  }

  return errors;
}

function validatePreAuthSteps(plan: ExecutionPlan, specContent: string, usedAuthFlow: boolean): string[] {
  const errors: string[] = [];

  if (!usedAuthFlow) return errors;

  let authGateIdx = -1;
  for (const step of plan.steps) {
    const stepDesc = (step.description ?? "").toLowerCase();
    if (stepDesc.startsWith("authflow handled") || stepDesc.includes("step consumed by authflow")) {
      authGateIdx = plan.steps.indexOf(step);
      break;
    }
  }

  if (authGateIdx < 0) return errors;

  const preAuthFunctionalSteps: string[] = [];
  for (let i = 0; i < authGateIdx; i++) {
    const step = plan.steps[i];
    if (step.action === "navigate" || step.action === "login") continue;
    const stepDesc = (step.description ?? "").toLowerCase();
    if (stepDesc.startsWith("authflow handled") || stepDesc.includes("step consumed by authflow")) continue;
    const targetValue = getTargetValue(step.target);
    if (targetValue) {
      preAuthFunctionalSteps.push(targetValue);
    }
  }

  for (const target of preAuthFunctionalSteps) {
    if (!specContent.toLowerCase().includes(target.toLowerCase())) {
      errors.push(`Pre-auth functional step "${target}" is missing from spec.`);
    }
  }

  return errors;
}

function validateSelectionMapping(plan: ExecutionPlan, actionLines: string[]): string[] {
  const errors: string[] = [];

  for (const step of plan.steps) {
    if (!isSelectionLikeStep(step)) continue;
    if (isSubmitLikeStep(step)) continue;

    const stepDesc = (step.description ?? "").toLowerCase();
    if (stepDesc.startsWith("authflow handled") || stepDesc.includes("step consumed by authflow")) continue;

    const targetValue = getTargetValue(step.target);
    if (!targetValue) continue;

    const hasSelectionCall = actionLines.some(l =>
      /\.select(Option|Item|Card|Entity|Product|Recipient|ByCondition)\(/.test(l)
    );
    
    const hasSelectIntentInPromotedTarget = actionLines.some(l =>
      l.includes(`clickPromotedTarget`) && 
      /actionIntent:\s*'(select_category|select_product|select_visible_item_by_ordinal|select_first_visible_item|select_first_visible_product|select_first_visible_card)'/.test(l)
    );
    
    const hasPrimaryActionOnSelection = actionLines.some(l =>
      l.includes(`clickPrimaryAction`) && l.toLowerCase().includes(targetValue.toLowerCase())
    );

    if (hasPrimaryActionOnSelection && !hasSelectionCall && !hasSelectIntentInPromotedTarget) {
      errors.push(`Selection-like step "${targetValue}" is mapped to clickPrimaryAction instead of a select method.`);
    }
  }

  return errors;
}

function validateNavigationDegradation(plan: ExecutionPlan, actionLines: string[]): string[] {
  const errors: string[] = [];

  for (const step of plan.steps) {
    if (step.action === "navigate" || step.action === "login") continue;
    if (!isModuleNavigationStep(step)) continue;

    const targetValue = getTargetValue(step.target);
    if (!targetValue || isHomeRouteTarget(targetValue)) continue;

    const degradedToOpenHome = actionLines.some(l =>
      /\.open\(\)/.test(l) && !l.includes("// [target:")
    );

    if (degradedToOpenHome) {
      errors.push(`Module navigation step "${targetValue}" degraded to open_home without target context.`);
    }
  }

  return errors;
}

function findCandidateMethod(
  registry: PageObjectRegistry,
  intent: SemanticMethodIntent,
  _description: string
): { pageObject: PageObjectEntry; method: PageObjectMethod } | undefined {
  for (const po of registry.pageObjects) {
    const candidateMethod = po.methods.find(
      (m) => m.intent === intent && m.available === false && m.status === "candidate"
    );
    if (candidateMethod) {
      return { pageObject: po, method: candidateMethod };
    }
  }
  return undefined;
}

function buildInlineLocator(step: ExecutionPlanStep): string {
  const t = getTarget(step.target);
  if (!t) return "page.locator('unknown')";
  const value = escapeSpecString(t.value ?? "");
  const name = escapeSpecString(t.name ?? "");
  if (t.strategy === "role") return `page.getByRole('${value}', { name: '${name}' })`;
  if (t.strategy === "text") return `page.getByText('${value}')`;
  if (t.strategy === "label") return `page.getByLabel('${value}')`;
  if (t.strategy === "placeholder") return `page.getByPlaceholder('${value}')`;
  if (t.strategy === "testId") return `page.getByTestId('${value}')`;
  return `page.locator('${value}')`;
}

function buildInlineAction(step: ExecutionPlanStep, locator: string): string {
  const value = escapeSpecString(step.value ?? "");
  if (step.action === "click") return `await ${locator}.click();`;
  if (step.action === "fill") return `await ${locator}.fill('${value}');`;
  if (step.action === "check") return `await ${locator}.check();`;
  if (step.action === "select") return `await ${locator}.selectOption('${value}');`;
  if (step.action.startsWith("assert")) return `await expect(${locator}).toBeVisible();`;
  return `await ${locator}.click();`;
}
