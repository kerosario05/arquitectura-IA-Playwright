import path from "node:path";
import type { ExecutionPlan, ExecutionPlanStep, PlanTarget } from "../types/execution-plan.types";
import type { AppAutomationPaths, AppProfile } from "./app-profile";
import type { PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import type { PageObjectEntry, PageObjectMethod, PageObjectRegistry } from "../types/page-object.types";
import { findReusableMethod, findMethodBySemanticIntent } from "./page-object-registry";
import { deriveMethodIntentFromStep, deriveExpectedOwnerForStep } from "./pom-classification";
import type { SemanticMethodIntent } from "../types/pom-ownership";
import { isLikelyAuthGate, buildAuthFlowSpecImport, buildAuthFlowInstantiation, buildAuthFlowCall } from "../discovery/auth-flow-helpers";

export type POMSpecResult = {
  specContent: string;
  pomStatus: POMPromotionStatus;
  usedPageObjects: string[];
  missingPageObjects: string[];
  missingMethods: string[];
  generatedCandidates: number;
  usedAuthFlow: boolean;
  validationErrors: string[];
};

function getTarget(t: PlanTarget | "APP_BASE_URL" | undefined): PlanTarget | undefined {
  if (!t || t === "APP_BASE_URL") return undefined;
  return t;
}

function getTargetValue(t: PlanTarget | "APP_BASE_URL" | undefined): string {
  if (!t) return "";
  if (t === "APP_BASE_URL") return "APP_BASE_URL";
  return t.name ?? t.value ?? t.role ?? "";
}

function escapeSpecString(value: string): string {
  return value.replace(/'/g, "''");
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

  const productConditionKeywords = ["cuenta", "tarjeta", "prestamo", "producto", "ahorro", "corriente"];
  for (const kw of productConditionKeywords) {
    if (normalizedTarget.includes(kw)) return "select_product";
  }

  return "select_product";
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

export function generatePOMSpecFromPlan(
  plan: ExecutionPlan,
  automationId: string,
  appProfile: AppProfile,
  appPaths: AppAutomationPaths,
  pageObjectRegistry: PageObjectRegistry | undefined,
  policy: PromotionPolicy,
  inlineDebugMode: boolean,
  authFlowOptions?: { alias?: string; landing?: string; testDataJson?: string }
): POMSpecResult {
  const escapedTitle = escapeSpecString(plan.scenario.title);

  const usedPageObjects: string[] = [];
  const missingPageObjects: string[] = [];
  const missingMethods: string[] = [];
  let generatedCandidates = 0;
  let usedAuthFlow = false;

  const importLines: string[] = [];
  const instantiationLines: string[] = [];
  const actionLines: string[] = [];
  const preambleLines: string[] = [];

  const importedClasses = new Set<string>();
  const instantiatedVars = new Map<string, string>();

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

  const authGateStepIndex = authFlowOptions ? findAuthGateStepIndex(plan.steps) : -1;
  const authGateDetected = authGateStepIndex >= 0;

  if (authGateDetected) {
    usedAuthFlow = true;
  }

  const preAuthActionLines: string[] = [];
  const postAuthActionLines: string[] = [];

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

    const isPreAuth = authGateDetected && stepIndex < authGateStepIndex;

    const moduleNav = isModuleNavigationStep(step);
    const submitLike = !moduleNav && isSubmitLikeStep(step);
    const selectionLike = !moduleNav && !submitLike && isSelectionLikeStep(step);

    let semanticIntent: SemanticMethodIntent;

    if (moduleNav) {
      semanticIntent = "open_home";
    } else if (submitLike) {
      semanticIntent = "click_primary_action";
    } else if (selectionLike) {
      const recoveryMeta = (step as any).recoveryMetadata;
      const semanticRole = recoveryMeta?.semanticRole;
      const actionType = recoveryMeta?.actionType;
      const selectionDiagnostics = (step as any).selectionDiagnostics;

      const hasExplicitSelectionDiagnostics =
        selectionDiagnostics?.selectionLike ||
        actionType === "action_select" ||
        ["option", "card", "item", "entity", "product", "recipient", "list_item"].includes(semanticRole) ||
        selectionDiagnostics?.reason === "selection_no_transition_next_action_enabled";

      if (hasExplicitSelectionDiagnostics) {
        semanticIntent = deriveSelectionIntent(step);
      } else {
        semanticIntent = deriveMethodIntentFromStep(step);
      }
    } else {
      semanticIntent = deriveMethodIntentFromStep(step);
    }

    if (moduleNav && isHomeRouteTarget(getTargetValue(step.target))) {
      semanticIntent = "open_home";
    }

    let resolved = pageObjectRegistry
      ? findMethodBySemanticIntent(pageObjectRegistry, semanticIntent, step)
      : undefined;

    let fallbackUsed = false;
    let fallbackInfo: string | undefined;

    if (!resolved && pageObjectRegistry) {
      const targetValue = getTargetValue(step.target);
      const expectedOwner = deriveExpectedOwnerForStep(step);

      if (semanticIntent === "open_home" && expectedOwner === "ProductListPage") {
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
            fallbackInfo = `open_home->selectProduct fallback for "${targetValue}"`;
          }
        }
      }

      if (!resolved && (semanticIntent === "select_product" || semanticIntent === "select_category")) {
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
            fallbackInfo = `select fallback for "${targetValue}"`;
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
      const varName = ensurePageObject(resolved.pageObject.className, resolved.pageObject.filePath);
      const method = resolved.method;
      if (method.parameters.length > 0) {
        const tv = getTargetValue(step.target);
        const args = method.parameters.map((p) => {
          return `'${escapeSpecString(tv || p)}'`;
        }).join(", ");
        actionLine = `await ${varName}.${method.name}(${args});`;
      } else {
        actionLine = `await ${varName}.${method.name}();`;
        const tv = getTargetValue(step.target);
        if (tv) {
          actionLine += ` // [target: ${tv}]`;
        }
      }
      if (method.sensitive) {
        actionLine += ` // [sensitive] ${description}`;
      }
    } else if (policy.allowCandidateGeneration && pageObjectRegistry) {
      const candidateResult = findCandidateMethod(pageObjectRegistry, semanticIntent, description);
      if (candidateResult) {
        const varName = ensurePageObject(candidateResult.pageObject.className, candidateResult.pageObject.filePath);
        const method = candidateResult.method;
        if (method.parameters.length > 0) {
          const tv = getTargetValue(step.target);
          const args = method.parameters.map((p) => {
            return `'${escapeSpecString(tv || p)}'`;
          }).join(", ");
          actionLine = `await ${varName}.${method.name}(${args}); // candidate method`;
        } else {
          actionLine = `await ${varName}.${method.name}(); // candidate method`;
        }
        actionLine += `\n  // [candidate] ${description}`;
        generatedCandidates += 1;
      }
    }

    if (!actionLine && policy.allowInlineFallback && !policy.requirePageObjects) {
      const locator = buildInlineLocator(step);
      actionLine = buildInlineAction(step, locator);
      actionLine += `\n  // [inline] ${description}`;
    }

    if (!actionLine && resolved === undefined) {
      const targetValue = getTargetValue(step.target);
      const expectedOwner = deriveExpectedOwnerForStep(step);
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

      const missingInfo = {
        target: targetValue,
        stepIndex: stepIndex,
        ownerPage: expectedOwner,
        expectedMethod: semanticIntent,
        classification,
        strategy,
        availableMethods,
        reason
      };

      console.log(`[spec-generator-pom] Missing page method: target="${missingInfo.target}" stepIndex=${missingInfo.stepIndex} ownerPage="${missingInfo.ownerPage}" expectedMethod="${missingInfo.expectedMethod}" classification="${missingInfo.classification}" strategy="${missingInfo.strategy}" availableMethods=[${missingInfo.availableMethods.join(", ")}] reason="${missingInfo.reason}"`);

      missingMethods.push(
        `step=${stepIndex} target="${targetValue}" ` +
        `derivedIntent="${semanticIntent}" expectedOwner="${expectedOwner}" ` +
        `availableMethods=[${availableMethods.join(", ")}]`
      );
      if (policy.allowInlineFallback) {
        const locator = buildInlineLocator(step);
        actionLine = buildInlineAction(step, locator);
        actionLine += `\n  // [inline-fallback] ${description}`;
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
    const authImport = buildAuthFlowSpecImport(appProfile.appSlug);
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
    actionLines.push(`  await authFlow.ensureAuthenticated({`);
    actionLines.push(`    alias: '${authFlowOptions.alias || 'defaultClient'}',`);
    actionLines.push(`    landing: '${authFlowOptions.landing || 'transactions_menu'}',`);
    actionLines.push(`  });`);
    if (postAuthActionLines.length > 0) {
      actionLines.push("");
    }
    actionLines.push(...postAuthActionLines);
  } else {
    actionLines.push(...preAuthActionLines);
    actionLines.push(...postAuthActionLines);
  }

  const lines: string[] = [];

  lines.push("import { test } from '@playwright/test';");

  if (importLines.length > 0) {
    lines.push("");
    lines.push(...importLines);
  }

  if (usedAuthFlow) {
    lines.push("import { resolvePromotedSpecAuthDataFromEnv } from '../../flows/auth.flow.helpers';");
  }

  lines.push("");
  const testName = inlineDebugMode
    ? `test('[INLINE DEBUG] ${escapedTitle}', async ({ page }) => {`
    : `test('${escapedTitle}', async ({ page }) => {`;
  lines.push(testName);

  if (instantiationLines.length > 0) {
    lines.push("");
    lines.push(...instantiationLines.map((l) => `  ${l}`));
  }

  if (preambleLines.length > 0) {
    lines.push("");
    lines.push(...preambleLines.map((l) => `  ${l}`));
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

  lines.push("});");

  const specContent = lines.join("\n");
  const validationErrors = [
    ...validateSpecQuality(actionLines, plan, specContent),
    ...validatePreAuthSteps(plan, specContent, usedAuthFlow),
    ...validateSelectionMapping(plan, actionLines),
    ...validateNavigationDegradation(plan, actionLines)
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
    validationErrors
  };
}

function validateSpecQuality(actionLines: string[], plan: ExecutionPlan, specContent: string): string[] {
  const errors: string[] = [];

  const startCallCount = actionLines.filter(l => /\.start\(\)/.test(l)).length;
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
    const hasPrimaryActionOnSelection = actionLines.some(l =>
      l.includes(`clickPrimaryAction`) && l.toLowerCase().includes(targetValue.toLowerCase())
    );

    if (hasPrimaryActionOnSelection && !hasSelectionCall) {
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
