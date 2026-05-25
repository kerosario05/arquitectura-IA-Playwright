import fs from "node:fs/promises";
import path from "node:path";
import { config as envConfig } from "../config/env";
import { validateExecutionPlan } from "../plans/execution-plan-validator";
import type { ExecutionPlan, ExecutionPlanStep } from "../types/execution-plan.types";
import type { FullConfig } from "../types/env.types";
import type { PromotedAutomationIndexEntry, PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";
import {
  buildAutomationId,
  determineAutomationStatus
} from "./automation-naming";
import {
  loadAutomationIndex,
  saveAutomationIndex,
  upsertAutomationIndexEntry
} from "./automation-index";
import { generateSpecFromPlan, generateSpecFromPlanWithPolicy } from "./spec-generator";
import {
  deriveAppProfile,
  serializeRuntimeConfigForPromotion,
  savePromotedAppConfig,
  buildAppAutomationPaths,
  ensureAppStructure,
  validateAuthFlowDependencies,
  type AppProfile
} from "./app-profile";
import {
  INTENT_CLASS_OWNERSHIP,
  INTENT_PREFERRED_OWNER,
  SCREEN_TYPE_CLASS_MAP,
  METHOD_INTENT_NAME_MAP,
  METHOD_INTENT_PARAMS,
  type SemanticScreenType,
  type SemanticMethodIntent
} from "../types/pom-ownership";
import {
  loadPageObjectRegistry,
  savePageObjectRegistry,
  ensurePageObjectRegistry,
  registerPageObjectCandidate,
  registerMethodCandidate,
  findCandidatePageObjectByScreenSignature
} from "./page-object-registry";
import { ensureFlowRegistry, registerFlowCandidate, saveFlowRegistry } from "./flow-registry";
import type { PageObjectEntry, PageObjectRegistry } from "../types/page-object.types";
import {
  shouldRunAutoPom,
  runAutoPomPipeline,
  type AutoPomDiagnostics
} from "./auto-pom";
import { buildDataContext } from "../data/data-context";
import { buildPromotedDataManifest, savePromotedDataManifestSync } from "../data/promoted-data";
import { validatePromotedSpecRuntimeContract } from "./runtime/promoted-runtime-contract";

interface PromoteInput {
  plan: ExecutionPlan;
  sourcePlanPath?: string;
  lastExecutionResultPath?: string;
  outputRoot?: string;
  source?: "agent_handoff" | "manual" | "rule_based" | "discovery";
  overwrite?: boolean;
  appProfile?: string;
  appProfileObject?: AppProfile;
  appName?: string;
  baseUrl?: string;
  fullConfig?: FullConfig;
  promotionPolicy?: PromotionPolicy;
  inlineDebugMode?: boolean;
  verifySpec?: boolean;
  specVerificationTimeoutMs?: number;
  requirePomRuntime?: boolean;
}

function assertPromotable(status: string, allowDraft: boolean): void {
  if (status === "needs_data" || status === "needs_discovery" || status === "unsupported") {
    throw new Error(
      `Plan status '${status}' is not eligible for promotion. Only 'validated' plans can be promoted.`
    );
  }
  if (status === "draft" && !allowDraft) {
    throw new Error(
      `Plan status is 'draft'. Use --allow-draft to promote draft plans or resolve required data first.`
    );
  }
}

async function ensureDirectories(paths: {
  caseDir?: string;
  caseEvidenceDir?: string;
  caseRunsDir?: string;
  plansDir: string;
  specsDir: string;
}): Promise<void> {
  if (paths.caseDir) await fs.mkdir(paths.caseDir, { recursive: true });
  if (paths.caseEvidenceDir) await fs.mkdir(paths.caseEvidenceDir, { recursive: true });
  if (paths.caseRunsDir) await fs.mkdir(paths.caseRunsDir, { recursive: true });
  await fs.mkdir(paths.plansDir, { recursive: true });
  await fs.mkdir(paths.specsDir, { recursive: true });
}

async function verifyPromotedSpec(
  specPath: string,
  timeoutMs: number = 90000
): Promise<{
  status: "passed" | "failed" | "skipped";
  error?: string;
  tracePath?: string;
  screenshotPath?: string;
}> {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const specPathNormalized = specPath.replace(/\\/g, "/");
    const cmd = `npx playwright test "${specPathNormalized}" --config=playwright.config.ts --timeout=${timeoutMs}`;
    console.log(`[promote-plan] Verifying promoted spec: ${cmd}`);

    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs + 30000, cwd: process.cwd() });

    if (stderr && !stderr.includes("passed")) {
      console.warn(`[promote-plan] Spec verification warnings: ${stderr}`);
    }

    console.log(`[promote-plan] Spec verification passed`);
    return { status: "passed" };
  } catch (error: any) {
    const errorMsg = error.message || error.stderr || String(error);
    console.error(`[promote-plan] Spec verification failed: ${errorMsg}`);

    const traceMatch = errorMsg.match(/(.*trace\.zip)/);
    const screenshotMatch = errorMsg.match(/(.*test-failed.*\.png)/);

    return {
      status: "failed",
      error: errorMsg,
      tracePath: traceMatch ? traceMatch[1] : undefined,
      screenshotPath: screenshotMatch ? screenshotMatch[1] : undefined
    };
  }
}

function deriveScreenSignatureFromPlan(plan: ExecutionPlan): string {
  const caseId = plan.scenario.caseId ?? plan.scenario.externalId ?? "unknown";
  const titleSlug = plan.scenario.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
  return `screen:c${caseId}-${titleSlug}`;
}

const SCREEN_TYPE_KEYWORDS: Record<string, SemanticScreenType> = {
  "iniciar sesion": "login",
  "iniciar sesión": "login",
  home: "home",
  inicio: "home",
  principal: "home",
  dashboard: "home",
  iniciar: "home",
  start: "home",
  menu: "main_menu",
  navegacion: "main_menu",
  "informacion de productos": "product_information",
  "información de productos": "product_information",
  "product information": "product_information",
  catalogo: "product_list",
  listado: "product_list",
  lista: "product_list",
  list: "product_list",
  "tarjeta de credito": "product_list",
  "tarjeta de crédito": "product_list",
  visa: "product_list",
  prestamo: "product_list",
  producto: "product_list",
  product: "product_list",
  categoria: "category",
  category: "category",
  tarjetas: "category",
  prestamos: "category",
  cuentas: "category",
  creditos: "category",
  detalle: "product_detail",
  detail: "product_detail",
  "detalle de": "product_detail",
  info: "product_detail",
  seleccion: "selection",
  selection: "selection",
  escoger: "selection",
  elegir: "selection",
  formulario: "form",
  form: "form",
  registro: "form",
  register: "form",
  confirmacion: "confirmation",
  confirmation: "confirmation",
  exito: "confirmation",
  success: "confirmation",
  login: "login",
  auth: "login",
  otp: "otp",
  codigo: "otp",
  code: "otp",
  verificacion: "otp",
  verification: "otp"
};

const METHOD_INTENT_KEYWORDS: Record<string, SemanticMethodIntent> = {
  navigate: "open_home",
  "app_base_url": "open_home",
  iniciar: "start_session",
  start: "start_session",
  login: "start_session",
  "informacion de productos": "open_product_information",
  "información de productos": "open_product_information",
  "product information": "open_product_information",
  tarjetas: "select_category",
  prestamos: "select_category",
  cuentas: "select_category",
  categoria: "select_category",
  category: "select_category",
  "tarjeta de credito": "select_product",
  "tarjeta de crédito": "select_product",
  visa: "select_product",
  prestamo: "select_product",
  solicitar: "click_primary_action",
  "solicitar tarjeta": "click_primary_action",
  apply: "click_primary_action",
  request: "click_primary_action",
  detalle: "expect_loaded",
  detail: "expect_loaded",
  validar: "expect_loaded",
  verificar: "expect_loaded",
  comprobar: "expect_loaded",
  expect: "expect_loaded",
  visible: "expect_loaded",
  fill: "fill_form_field",
  escribir: "fill_form_field",
  ingresar: "fill_form_field",
  completar: "fill_form_field",
  producto: "select_product",
  product: "select_product",
  submit: "submit_form",
  enviar: "submit_form",
  confirmar: "confirm_action",
  confirm: "confirm_action",
  pay: "confirm_action",
  pagar: "confirm_action"
};

function normalizeSemanticText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getSemanticStepText(step: ExecutionPlanStep): string {
  const target = step.target && typeof step.target === "object"
    ? `${step.target.value ?? ""} ${step.target.name ?? ""} ${step.target.role ?? ""}`
    : "";
  return normalizeSemanticText(`${target} ${step.description ?? ""} ${step.action}`);
}

function isUsernameSemanticTarget(text: string): boolean {
  return text.includes("username") || text.includes("usuario");
}

function isPasswordSemanticTarget(text: string): boolean {
  return text.includes("password") || text.includes("contrasena");
}

function isLoginSemanticTrigger(text: string): boolean {
  return text.includes("log in") || text.includes("login") || text.includes("iniciar sesion");
}

function hasPriorLoginSemanticEvidence(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): boolean {
  const currentIndex = allSteps.indexOf(step);
  if (currentIndex <= 0) return false;
  return allSteps.slice(0, currentIndex).some((candidate) => {
    const text = getSemanticStepText(candidate);
    return (candidate.action === "fill" || candidate.action.startsWith("assert"))
      && (isUsernameSemanticTarget(text) || isPasswordSemanticTarget(text));
  });
}

function isFirstVisibleSemanticSelection(text: string): boolean {
  return /\b(primer[ao]?\s+(producto|item|registro|card|tarjeta|fila)|primera?\s+(tarjeta|card|fila)|first\s+visible\s+(item|product|card|row))\b/i.test(text);
}

function deriveFirstVisibleSemanticIntent(text: string): SemanticMethodIntent {
  if (/\b(fila|row)\b/i.test(text)) return "select_first_visible_row";
  if (/\b(tarjeta|card)\b/i.test(text)) return "select_first_visible_card";
  if (/\b(producto|product)\b/i.test(text)) return "select_first_visible_product";
  return "select_first_visible_item";
}

function classifyScreenType(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): SemanticScreenType {
  const target = step.target && typeof step.target === "object"
    ? (step.target.value ?? step.target.name ?? step.target.role ?? "").toLowerCase()
    : "";
  const action = step.action.toLowerCase();
  const description = (step.description ?? "").toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";

  const combinedText = `${target} ${action} ${description} ${recoveredText} ${semanticRelation}`;

  for (const [keyword, screenType] of Object.entries(SCREEN_TYPE_KEYWORDS)) {
    if (combinedText.includes(keyword)) {
      return screenType;
    }
  }

  if (action === "navigate" || target.includes("base_url") || target.includes("app_base")) {
    return "home";
  }

  if (action === "login" || action === "auth") {
    return "login";
  }

  if (isLoginSemanticTrigger(normalizeSemanticText(combinedText)) || isUsernameSemanticTarget(normalizeSemanticText(combinedText)) || isPasswordSemanticTarget(normalizeSemanticText(combinedText))) {
    return "login";
  }

  if (semanticRelation === "parent_category" || semanticRelation === "category") {
    return "category";
  }

  if (action.startsWith("assert") || action.includes("valid") || action.includes("expect")) {
    return "product_detail";
  }

  if (action === "click" || action === "select") {
    return "product_list";
  }

  if (action === "fill") {
    return "form";
  }

  return "unknown";
}

function classifyMethodIntent(step: ExecutionPlanStep, screenType: SemanticScreenType, allSteps: ExecutionPlanStep[]): SemanticMethodIntent {
  const target = step.target && typeof step.target === "object"
    ? (step.target.value ?? step.target.name ?? step.target.role ?? "").toLowerCase()
    : "";
  const action = step.action.toLowerCase();
  const description = (step.description ?? "").toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";
  const normalizedText = getSemanticStepText(step);

  if (action.startsWith("assert")) {
    if (isUsernameSemanticTarget(normalizedText) || isPasswordSemanticTarget(normalizedText)) return "expect_login_form";
    if (normalizedText.includes("welcome") || normalizedText.includes("logout") || normalizedText.includes("cerrar sesion")) return "expect_logged_in";
    return "expect_loaded";
  }

  if (action === "fill") {
    if (isUsernameSemanticTarget(normalizedText)) return "fill_username";
    if (isPasswordSemanticTarget(normalizedText)) return "fill_password";
    return "fill_form_field";
  }

  if ((action === "click" || action === "select") && isLoginSemanticTrigger(normalizedText)) {
    return hasPriorLoginSemanticEvidence(step, allSteps) ? "submit_login" : "open_login_modal";
  }

  if ((action === "click" || action === "select") && isFirstVisibleSemanticSelection(normalizedText)) {
    return deriveFirstVisibleSemanticIntent(normalizedText);
  }

  const combinedText = normalizeSemanticText(`${target} ${action} ${description} ${recoveredText} ${semanticRelation}`);

  for (const [keyword, intent] of Object.entries(METHOD_INTENT_KEYWORDS)) {
    if (combinedText.includes(keyword)) {
      return intent;
    }
  }

  if (action === "navigate") return "open_home";
  if (action === "login") return "start_session";
  if (action.startsWith("assert")) return "expect_loaded";
  if (action === "click" || action === "select") {
    if (screenType === "login") return hasPriorLoginSemanticEvidence(step, allSteps) ? "submit_login" : "open_login_modal";
    if (screenType === "category") return "select_category";
    if (screenType === "product_list") return "select_product";
    if (screenType === "home") return "click_primary_action";
    return "click_primary_action";
  }

  return "unknown";
}

function deriveSemanticScreenType(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): SemanticScreenType {
  return classifyScreenType(step, allSteps);
}

function deriveSemanticMethodIntent(step: ExecutionPlanStep, screenType: SemanticScreenType): SemanticMethodIntent {
  return classifyMethodIntent(step, screenType, []);
}

function derivePageObjectClassNameFromScreenType(screenType: SemanticScreenType): string {
  return SCREEN_TYPE_CLASS_MAP[screenType] ?? "GenericPage";
}

function deriveMethodNameFromIntent(intent: SemanticMethodIntent): string {
  return METHOD_INTENT_NAME_MAP[intent] ?? "executeAction";
}

function deriveMethodParameters(intent: SemanticMethodIntent): string[] {
  return METHOD_INTENT_PARAMS[intent] ?? [];
}

function deriveScreenSignatureFromScreenType(screenType: SemanticScreenType, appSlug: string): string {
  return `screen:${appSlug}-${screenType}`;
}

async function registerPOMCandidatesForBlockedPromotion(
  plan: ExecutionPlan,
  automationId: string,
  appProfile: AppProfile,
  outputRoot: string | undefined,
  pomStatus: POMPromotionStatus | undefined,
  specResultMissingMethods: string[]
): Promise<{ pomCandidatesRegistered: number }> {
  if (pomStatus !== "needs_page_object" && pomStatus !== "needs_page_method") {
    return { pomCandidatesRegistered: 0 };
  }

  const registry = await ensurePageObjectRegistry(appProfile, outputRoot);
  const flowReg = await ensureFlowRegistry(appProfile, outputRoot);

  let candidatesRegistered = 0;
  const sourcePlanId = automationId;

  const nonNavigationSteps = plan.steps.filter((s) =>
    s.action !== "navigate" && s.action !== "login"
  );

  type RoutedMethod = {
    name: string;
    intent: string;
    parameters: string[];
    sensitive: boolean;
    confidence: number;
    sourceActionId: string;
    ownerClassName: string;
    screenSignature: string;
  };

  const routedMethods: RoutedMethod[] = [];

  for (const step of nonNavigationSteps) {
    const screenType = deriveSemanticScreenType(step, plan.steps);
    const intent = classifyMethodIntent(step, screenType, plan.steps);
    const recoveryMeta = (step as any).recoveryMetadata;

    const ownerClassName = INTENT_PREFERRED_OWNER[intent] ?? SCREEN_TYPE_CLASS_MAP[screenType] ?? "GenericPage";
    const screenSignature = `screen:${appProfile.appSlug}-${screenType}`;

    routedMethods.push({
      name: deriveMethodNameFromIntent(intent),
      intent,
      parameters: deriveMethodParameters(intent),
      sensitive: step.action === "fill" && step.valueKey !== undefined,
      confidence: recoveryMeta?.score ?? 0.5,
      sourceActionId: `${sourcePlanId}-step-${step.index}`,
      ownerClassName,
      screenSignature
    });
  }

  for (const step of nonNavigationSteps) {
    if (step.action.startsWith("assert")) {
      const screenType = deriveSemanticScreenType(step, plan.steps);
      const detailScreenType: SemanticScreenType = screenType === "product_detail" ? screenType : "product_detail";
      const intent: SemanticMethodIntent = "expect_loaded";
      const recoveryMeta = (step as any).recoveryMetadata;

      const ownerClassName = INTENT_PREFERRED_OWNER[intent] ?? SCREEN_TYPE_CLASS_MAP[detailScreenType] ?? "ProductDetailPage";
      const screenSignature = `screen:${appProfile.appSlug}-${detailScreenType}`;

      routedMethods.push({
        name: deriveMethodNameFromIntent(intent),
        intent,
        parameters: deriveMethodParameters(intent),
        sensitive: false,
        confidence: recoveryMeta?.score ?? 0.5,
        sourceActionId: `${sourcePlanId}-step-${step.index}`,
        ownerClassName,
        screenSignature
      });
    }
  }

  const methodsByOwner = new Map<string, RoutedMethod[]>();
  for (const method of routedMethods) {
    const existing = methodsByOwner.get(method.ownerClassName) ?? [];
    existing.push(method);
    methodsByOwner.set(method.ownerClassName, existing);
  }

  for (const [ownerClassName, methods] of methodsByOwner.entries()) {
    if (ownerClassName === "OtpPage") continue;

    const primaryScreenType = Object.entries(SCREEN_TYPE_CLASS_MAP).find(
      ([, cls]) => cls === ownerClassName
    )?.[0] as SemanticScreenType | undefined;

    const screenSignature = primaryScreenType
      ? `screen:${appProfile.appSlug}-${primaryScreenType}`
      : `screen:${appProfile.appSlug}-${ownerClassName.toLowerCase().replace(/page$/, "")}`;

    let existingPO = registry.pageObjects.find((po) => po.className === ownerClassName);

    if (!existingPO) {
      existingPO = registry.pageObjects.find((po) => po.screenSignature === screenSignature);
    }

    const uniqueMethods = new Map<string, RoutedMethod>();
    for (const m of methods) {
      if (!uniqueMethods.has(m.intent)) {
        uniqueMethods.set(m.intent, m);
      }
    }

    if (!existingPO && uniqueMethods.size > 0) {
      const regResult = registerPageObjectCandidate(registry, {
        name: ownerClassName.replace("Page", ""),
        className: ownerClassName,
        screenSignature,
        confidence: 0.5,
        sourcePlanId,
        methods: Array.from(uniqueMethods.values()).map((m) => ({
          name: m.name,
          intent: m.intent,
          parameters: m.parameters
        }))
      });

      if (regResult.created) {
        candidatesRegistered += 1;
      }

      existingPO = registry.pageObjects.find((po) => po.className === ownerClassName);
    }

    if (existingPO) {
      for (const m of uniqueMethods.values()) {
        registerMethodCandidate(registry, existingPO.id, {
          name: m.name,
          intent: m.intent,
          parameters: m.parameters,
          sensitive: m.sensitive,
          confidence: m.confidence,
          sourceActionId: m.sourceActionId
        });
      }
    }
  }

  const flowSteps = plan.steps.map((s) => {
    const screenType = deriveSemanticScreenType(s, plan.steps);
    const intent = classifyMethodIntent(s, screenType, plan.steps);
    const methodName = deriveMethodNameFromIntent(intent);
    const className = derivePageObjectClassNameFromScreenType(screenType);

    return {
      action: s.action,
      target: s.target && typeof s.target === "object" ? (s.target.value ?? "") : "",
      pageObjectId: className,
      methodName
    };
  });

  const flowName = plan.scenario.title.substring(0, 50);
  await registerFlowCandidate(flowReg, {
    name: flowName,
    steps: flowSteps,
    requiredDataKeys: plan.requiredData.filter((d) => d.required).map((d) => d.key),
    confidence: 0.5
  });

  if (pomStatus === "needs_page_method" && specResultMissingMethods.length > 0) {
    const skipIntents: string[] = [];
    
    for (const missingMethod of specResultMissingMethods) {
      const derivedIntentMatch = missingMethod.match(/derivedIntent="([^"]+)"/);
      const intent = derivedIntentMatch ? derivedIntentMatch[1] : missingMethod.trim();
      
      // Skip login-related intents
      if (skipIntents.includes(intent)) continue;

      const expectedOwnerMatch = missingMethod.match(/expectedOwner="([^"]+)"/);
      const ownerClassName = expectedOwnerMatch ? expectedOwnerMatch[1] : (INTENT_PREFERRED_OWNER[intent] ?? "GenericPage");

      let ownerPO = registry.pageObjects.find((po) => po.className === ownerClassName);

      if (!ownerPO) {
        ownerPO = registry.pageObjects.find((po) => po.className === "ProductListPage" && po.status === "active");
      }

      if (!ownerPO && registry.pageObjects.length > 0) {
        ownerPO = registry.pageObjects.find((po) => po.status === "candidate") ?? registry.pageObjects[0];
      }

      if (ownerPO) {
        const methodName = deriveMethodNameFromIntent(intent as SemanticMethodIntent);
        registerMethodCandidate(registry, ownerPO.id, {
          name: methodName,
          intent,
          parameters: deriveMethodParameters(intent as SemanticMethodIntent),
          confidence: 0.5,
          sourceActionId: `${sourcePlanId}-missing-${intent}`
        });
      }
    }
  }

  await savePageObjectRegistry(registry, appProfile, outputRoot);
  await saveFlowRegistry(flowReg, appProfile, outputRoot);

  return { pomCandidatesRegistered: candidatesRegistered };
}

export async function promoteExecutionPlan(
  input: PromoteInput,
  allowDraft = false,
  metadata?: PromotedAutomationIndexEntry["metadata"]
): Promise<PromotedAutomationIndexEntry> {
  const plan = input.plan;

  const validation = validateExecutionPlan(plan);

  if (!validation.valid) {
    const errors = validation.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid execution plan: ${errors || "unknown validation errors"}`);
  }

  const status = plan.status;

  if (status !== "validated") {
    assertPromotable(status, allowDraft);
  }

  const automationId = buildAutomationId({
    externalId: plan.scenario.externalId,
    caseId: plan.scenario.caseId,
    title: plan.scenario.title
  });

  const runtimeConfig = input.fullConfig;

  let appProfile: AppProfile;
  if (input.appProfileObject) {
    appProfile = input.appProfileObject;
  } else {
    appProfile = deriveAppProfile({
      appProfile: input.appProfile ?? runtimeConfig?.app.appProfile,
      appName: input.appName ?? runtimeConfig?.app.name,
      baseUrl: input.baseUrl ?? runtimeConfig?.app.baseUrl
    });
  }
  console.log(`[promote] Using appSlug=${appProfile.appSlug}`);

  const appPaths = buildAppAutomationPaths(appProfile, automationId, input.outputRoot);

  const planHasAuthConsumedSteps = plan.steps.some(s => {
    const desc = (s.description ?? "").toLowerCase();
    return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
  });

  await ensureAppStructure(appPaths.appDir);
  if (!appPaths.planPath || !appPaths.specPath) {
    throw new Error("Unable to resolve promoted automation paths.");
  }

  if (planHasAuthConsumedSteps) {
    const authValidation = validateAuthFlowDependencies(appPaths.appDir);
    if (!authValidation.valid) {
      throw new Error(
        `AuthFlow is required but dependencies are missing: ${authValidation.missing.join(", ")}. ` +
        `Run ensureAppStructure or copy framework files from default app.`
      );
    }
  }

  try {
    await fs.access(appPaths.planPath);
    if (!input.overwrite) {
      throw new Error(
        `Automation '${automationId}' already exists at '${appPaths.planPath}'. Use --overwrite to replace.`
      );
    }
  } catch (err) {
    if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
      throw err;
    }
  }

  let wasOverwritten = false;
  let previousAutomationPath: string | undefined;
  let previousStatus: string | undefined;

  if (input.overwrite) {
    try {
      await fs.access(appPaths.planPath);
      wasOverwritten = true;
      previousAutomationPath = appPaths.planPath;

      const appDirPathsForLoad = buildAppAutomationPaths(appProfile, undefined, input.outputRoot);
      try {
        const existingAppIndex = await loadAutomationIndex(appDirPathsForLoad.indexPath);
        const existingEntry = existingAppIndex.automations.find((a) => a.id === automationId);
        if (existingEntry) {
          previousStatus = existingEntry.status;
        }
      } catch {
        // Index may not exist or be unreadable, continue without previous status
      }
    } catch {
      // Automation does not exist, nothing to overwrite
    }
  }

  await ensureDirectories(appPaths);

  const planContent = JSON.stringify(plan, null, 2);
  await fs.writeFile(appPaths.planPath, planContent, "utf-8");
  if (appPaths.caseConfigPath) {
    await fs.writeFile(
      appPaths.caseConfigPath,
      JSON.stringify({
        id: automationId,
        externalId: plan.scenario.externalId,
        caseId: plan.scenario.caseId,
        title: plan.scenario.title,
        source: input.source ?? "manual",
        appSlug: appProfile.appSlug,
        appConfigPath: appPaths.configPath,
        createdAt: new Date().toISOString()
      }, null, 2),
      "utf-8"
    );
  }

  if (appPaths.caseDir) {
    const runtimeForData = input.fullConfig ?? envConfig;
    const dataContext = buildDataContext(runtimeForData);
    const promotedDataManifest = buildPromotedDataManifest(plan, dataContext);
    savePromotedDataManifestSync(path.join(appPaths.caseDir, "promoted-data.json"), promotedDataManifest);
  }

  // Generate spec — POM-aware when policy provided
  const promotionPolicy = input.promotionPolicy;
  const inlineDebugMode = input.inlineDebugMode ?? false;
  let pomStatus: POMPromotionStatus | undefined;
  let strategyDiagnostics: {
    requestedStrategy: "pom" | "inline" | "auto";
    autoPomEnabled: boolean;
    selectedStrategy: "pom" | "inline";
    reason: string;
    blockers: string[];
    availablePageObjects: string[];
    requiredPageMethods: string[];
    missingPageMethods: string[];
    autoPomAttempted: boolean;
    autoPomCreatedMethods: string[];
    fallbackUsed: boolean;
    requirePomRuntime: boolean;
  } | undefined;
  let pomDiagnostics: {
    status?: "needs_page_object" | "promoted";
    inlineFallbackUsed?: boolean;
    reason?: string;
    requiredDataUsed?: string[];
    generatedPageObjects?: string[];
    generatedMethods?: string[];
    missingPageObjects: string[];
    missingMethods: string[];
    generatedCandidates: number;
    autoPom?: AutoPomDiagnostics;
  } | undefined;

  if (promotionPolicy && promotionPolicy.specMode === "page-object") {
    const registry = await loadPageObjectRegistry(appProfile, input.outputRoot).catch(() => undefined);

    // Detect if plan has auth-consumed steps to enable AuthFlow in spec generation
    const hasAuthConsumedSteps = plan.steps.some(s => {
      const desc = (s.description ?? "").toLowerCase();
      return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
    });
    const authFlowOptions = hasAuthConsumedSteps ? {
      alias: "defaultClient",
      landing: "transactions_menu"
    } : undefined;

    const specResult = await generateSpecFromPlanWithPolicy({
      plan,
      automationId,
      appProfile,
      appPaths,
      promotionPolicy,
      inlineDebugMode,
      pageObjectRegistry: registry,
      authFlowOptions
    });
    await fs.writeFile(appPaths.specPath, specResult.specContent, "utf-8");
    pomStatus = specResult.pomStatus;

    const requirePomRuntime = input.requirePomRuntime === true || process.env.PROMOTION_REQUIRE_POM_RUNTIME === "true";
    const selectedStrategy = specResult.selectedStrategy;
    const blockers = [
      ...(specResult.missingPageObjects ?? []).map((m) => `missing_page_object:${m}`),
      ...(specResult.missingMethods ?? []).map((m) => `missing_method:${m}`),
      ...(specResult.validationErrors ?? []).map((e) => `validation_error:${e}`),
      ...(specResult.fallbackReason ? [specResult.fallbackReason] : [])
    ];
    strategyDiagnostics = {
      requestedStrategy: promotionPolicy?.autoPom ? "auto" : "pom",
      autoPomEnabled: promotionPolicy?.autoPom === true,
      selectedStrategy,
      reason: selectedStrategy === "pom" ? (pomStatus ?? "promoted") : (specResult.fallbackReason ?? "inline_fallback"),
      blockers,
      availablePageObjects: registry?.pageObjects?.map((po) => po.className) ?? [],
      requiredPageMethods: [],
      missingPageMethods: specResult.missingMethods ?? [],
      autoPomAttempted: false,
      autoPomCreatedMethods: [],
      fallbackUsed: specResult.fallbackUsed,
      requirePomRuntime
    };

    if (requirePomRuntime) {
      const hasRuntime = specResult.specContent.includes("createPromotedSpecRuntime(") && specResult.specContent.includes(`PROMOTED_SPEC_STRATEGY = "pom_runtime"`);
      if (selectedStrategy !== "pom" || !hasRuntime) {
        throw new Error(
          `POM_RUNTIME_REQUIRED_BUT_UNAVAILABLE: blockers=${blockers.join(" | ") || "unknown"}`
        );
      }
    }

    // Fail promotion if spec validation found critical issues
    if (specResult.validationErrors && specResult.validationErrors.length > 0) {
      for (const err of specResult.validationErrors) {
        console.error(`[promote-plan] Spec validation error: ${err}`);
      }
      throw new Error(
        `Spec validation failed: ${specResult.validationErrors.join("; ")}. ` +
        "Promotion blocked to prevent degraded spec from being promoted."
      );
    }

    // Register POM candidates if any were generated
    if (specResult.generatedCandidates > 0 && registry) {
      const { savePageObjectRegistry } = await import("./page-object-registry");
      await savePageObjectRegistry(registry, appProfile, input.outputRoot);
    }

    // Register POM candidates when promotion is blocked by missing page objects/methods
    const pomCandidateResult = await registerPOMCandidatesForBlockedPromotion(
      plan,
      automationId,
      appProfile,
      input.outputRoot,
      specResult.pomStatus,
      specResult.missingMethods
    );

    if (pomCandidateResult.pomCandidatesRegistered > 0) {
      console.log(`[promote-plan] Registered ${pomCandidateResult.pomCandidatesRegistered} POM candidate(s) for blocked promotion`);
    }

    pomDiagnostics = {
      status: specResult.pomStatus === "promoted" ? "promoted" : "needs_page_object",
      inlineFallbackUsed: specResult.inlineFallbackUsed ?? false,
      reason: specResult.pomStatus ?? "unknown",
      requiredDataUsed: specResult.requiredDataUsed ?? [],
      generatedPageObjects: [],
      generatedMethods: [],
      missingPageObjects: specResult.missingPageObjects,
      missingMethods: specResult.missingMethods,
      generatedCandidates: specResult.generatedCandidates
    };

    // --- Auto-POM Pipeline ---
    if (shouldRunAutoPom(specResult.pomStatus, promotionPolicy)) {
      console.log(`[promote-plan] Auto-POM triggered for status: ${specResult.pomStatus}`);
      const autoPomResult = await runAutoPomPipeline({
        plan,
        automationId,
        appProfile,
        appPaths,
        outputRoot: input.outputRoot,
        promotionPolicy,
        inlineDebugMode: input.inlineDebugMode ?? false,
        initialPomStatus: specResult.pomStatus,
        initialMissingMethods: specResult.missingMethods
      });

      pomStatus = autoPomResult.pomStatus;

      if (autoPomResult.diagnostics.finalPomStatus === "promoted") {
        await fs.writeFile(appPaths.specPath, autoPomResult.specContent, "utf-8");
        console.log(`[promote-plan] Auto-POM succeeded, spec regenerated and promoted.`);
      } else {
        await fs.writeFile(appPaths.specPath, autoPomResult.specContent, "utf-8");
        console.log(`[promote-plan] Auto-POM completed but promotion still blocked: ${autoPomResult.diagnostics.finalPomStatus}`);
      }

      pomDiagnostics = {
        ...pomDiagnostics,
        status: autoPomResult.diagnostics.finalPomStatus === "promoted" ? "promoted" : "needs_page_object",
        reason: autoPomResult.diagnostics.finalPomStatus,
        generatedPageObjects: autoPomResult.diagnostics.autoApprovedPageObjects,
        generatedMethods: autoPomResult.diagnostics.autoApprovedMethods,
        missingPageObjects: autoPomResult.diagnostics.finalPomStatus === "promoted" ? [] : (pomDiagnostics?.missingPageObjects ?? []),
        missingMethods: autoPomResult.diagnostics.finalPomStatus === "promoted" ? [] : (pomDiagnostics?.missingMethods ?? []),
        autoPom: autoPomResult.diagnostics
      };
      if (strategyDiagnostics) {
        strategyDiagnostics.autoPomAttempted = true;
        strategyDiagnostics.autoPomCreatedMethods = autoPomResult.diagnostics.autoApprovedMethods ?? [];
        strategyDiagnostics.selectedStrategy = autoPomResult.diagnostics.finalPomStatus === "promoted" ? "pom" : strategyDiagnostics.selectedStrategy;
        strategyDiagnostics.reason = autoPomResult.diagnostics.finalPomStatus;
        strategyDiagnostics.fallbackUsed = strategyDiagnostics.selectedStrategy !== "pom";
      }
    }
  } else {
    const specContent = generateSpecFromPlan(plan, automationId, appProfile, appPaths);
    await fs.writeFile(appPaths.specPath, specContent, "utf-8");
    pomStatus = inlineDebugMode ? "inline_debug_only" : undefined;
    strategyDiagnostics = {
      requestedStrategy: "inline",
      autoPomEnabled: false,
      selectedStrategy: "inline",
      reason: "inline_mode_requested",
      blockers: [],
      availablePageObjects: [],
      requiredPageMethods: [],
      missingPageMethods: [],
      autoPomAttempted: false,
      autoPomCreatedMethods: [],
      fallbackUsed: false,
      requirePomRuntime: input.requirePomRuntime === true || process.env.PROMOTION_REQUIRE_POM_RUNTIME === "true"
    };
  }

  if (appPaths.caseDir && strategyDiagnostics) {
    await fs.writeFile(path.join(appPaths.caseDir, "promotion-diagnostics.json"), JSON.stringify(strategyDiagnostics, null, 2), "utf-8");
  }

  const requirePomRuntimeContract = input.requirePomRuntime === true || process.env.PROMOTION_REQUIRE_POM_RUNTIME === "true";
  if (requirePomRuntimeContract && appPaths.specPath) {
    const diagnosticsPath = appPaths.caseDir ? path.join(appPaths.caseDir, "promotion-diagnostics.json") : undefined;
    const contractResult = await validatePromotedSpecRuntimeContract(appPaths.specPath, diagnosticsPath);
    if (!contractResult.valid) {
      throw new Error(
        `PROMOTED_SPEC_RUNTIME_CONTRACT_INVALID: ${contractResult.errors.join(" | ")}`
      );
    }
  }

  const appConfig = serializeRuntimeConfigForPromotion(input.fullConfig ?? envConfig);
  appConfig.appProfile = {
    ...appConfig.appProfile,
    appSlug: appProfile.appSlug,
    name: appProfile.name ?? appConfig.appProfile.name,
    baseUrl: appProfile.baseUrl ?? appConfig.appProfile.baseUrl,
    baseUrlHash: appProfile.baseUrlHash ?? appConfig.appProfile.baseUrlHash,
    updatedAt: new Date().toISOString()
  };
  await savePromotedAppConfig(appConfig, input.outputRoot);

  const appDirPaths = buildAppAutomationPaths(appProfile, undefined, input.outputRoot);
  const appIndexPath = appDirPaths.indexPath;
  const appIndex = await loadAutomationIndex(appIndexPath);
  const source: "agent_handoff" | "manual" | "rule_based" | "discovery" =
    input.source ?? "manual";
  const rawAutomationStatus = determineAutomationStatus(plan.status, source);

  // Override status if POM requires a non-active status
  const automationStatus = pomStatus === "inline_debug_only"
    ? "inline_debug_only"
    : pomStatus === "needs_page_object" || pomStatus === "needs_page_method"
      ? "blocked_missing_pom"
      : pomStatus === "needs_manual_review"
        ? "blocked_missing_pom"
        : rawAutomationStatus;

  const now = new Date().toISOString();

  const appIndexEntry: PromotedAutomationIndexEntry = {
    id: automationId,
    externalId: plan.scenario.externalId,
    caseId: plan.scenario.caseId,
    title: plan.scenario.title,
    planPath: appPaths.planPath,
    specPath: appPaths.specPath,
    appSlug: appProfile.appSlug,
    appConfigPath: appDirPaths.configPath,
    status: automationStatus,
    source,
    appProfile: appProfile.appSlug,
    baseUrlHash: appProfile.baseUrlHash,
    createdAt: now,
    updatedAt: now,
    lastPromotedFrom: input.sourcePlanPath,
    lastExecutionResultPath: input.lastExecutionResultPath,
    pomStatus,
    inlineDebugMode,
    specVerificationStatus: "not_run",
    metadata: pomDiagnostics || wasOverwritten ? {
      ...metadata,
      ...(pomDiagnostics ? { pomDiagnostics } : {}),
      ...(strategyDiagnostics ? { promotionStrategyDiagnostics: strategyDiagnostics } : {}),
      ...(wasOverwritten ? {
        overwritten: true,
        previousAutomationPath,
        previousStatus
      } : {})
    } : metadata
  };

  // --- Verify promoted spec if requested ---
  if (input.verifySpec && appPaths.specPath && automationStatus === "active") {
    console.log(`[promote-plan] Running spec verification for ${appPaths.specPath}`);
    const verificationResult = await verifyPromotedSpec(
      appPaths.specPath,
      input.specVerificationTimeoutMs ?? 90000
    );

    appIndexEntry.specVerificationStatus = verificationResult.status;

    if (verificationResult.status === "failed") {
      console.error(`[promote-plan] Spec verification FAILED. Promotion marked as spec_failed.`);
      appIndexEntry.status = "spec_failed";
      appIndexEntry.metadata = {
        ...appIndexEntry.metadata,
        specVerification: {
          status: "failed",
          error: verificationResult.error,
          tracePath: verificationResult.tracePath,
          screenshotPath: verificationResult.screenshotPath
        }
      };
    } else if (verificationResult.status === "passed") {
      console.log(`[promote-plan] Spec verification PASSED`);
      appIndexEntry.metadata = {
        ...appIndexEntry.metadata,
        specVerification: {
          status: "passed"
        }
      };
    }
  }

  const updatedAppIndex = upsertAutomationIndexEntry(appIndex, appIndexEntry);
  await saveAutomationIndex(updatedAppIndex, appIndexPath);

  if (appPaths.caseAutomationPath) {
    await fs.writeFile(appPaths.caseAutomationPath, JSON.stringify(appIndexEntry, null, 2), "utf-8");
  }
  if (appPaths.caseDir && strategyDiagnostics) {
    await fs.writeFile(path.join(appPaths.caseDir, "promotion-diagnostics.json"), JSON.stringify(strategyDiagnostics, null, 2), "utf-8");
  }

  // --- Update global index too ---
  const globalIndexPath =
    input.outputRoot !== undefined
      ? path.join(input.outputRoot, "automations/index.json")
      : undefined;

  const globalIndex = await loadAutomationIndex(globalIndexPath);
  const updatedGlobalIndex = upsertAutomationIndexEntry(globalIndex, appIndexEntry);
  await saveAutomationIndex(updatedGlobalIndex, globalIndexPath);

  return appIndexEntry;
}
