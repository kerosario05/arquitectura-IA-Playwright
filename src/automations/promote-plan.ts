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
  type AppProfile
} from "./app-profile";
import { loadPageObjectRegistry, ensurePageObjectRegistry, registerPageObjectCandidate, registerMethodCandidate, savePageObjectRegistry, findCandidatePageObjectByScreenSignature } from "./page-object-registry";
import { ensureFlowRegistry, registerFlowCandidate, saveFlowRegistry } from "./flow-registry";
import type { PageObjectEntry, PageObjectRegistry } from "../types/page-object.types";

interface PromoteInput {
  plan: ExecutionPlan;
  sourcePlanPath?: string;
  lastExecutionResultPath?: string;
  outputRoot?: string;
  source?: "agent_handoff" | "manual" | "rule_based" | "discovery";
  overwrite?: boolean;
  appProfile?: string;
  appName?: string;
  baseUrl?: string;
  fullConfig?: FullConfig;
  promotionPolicy?: PromotionPolicy;
  inlineDebugMode?: boolean;
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

type SemanticScreenType =
  | "home"
  | "main_menu"
  | "product_information"
  | "category"
  | "product_list"
  | "product_detail"
  | "selection"
  | "form"
  | "confirmation"
  | "login"
  | "otp"
  | "unknown";

type SemanticMethodIntent =
  | "open_home"
  | "start_session"
  | "open_product_information"
  | "select_category"
  | "select_product"
  | "click_primary_action"
  | "expect_loaded"
  | "fill_form_field"
  | "submit_form"
  | "confirm_action"
  | "unknown";

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

function classifyMethodIntent(step: ExecutionPlanStep, screenType: SemanticScreenType): SemanticMethodIntent {
  const target = step.target && typeof step.target === "object"
    ? (step.target.value ?? step.target.name ?? step.target.role ?? "").toLowerCase()
    : "";
  const action = step.action.toLowerCase();
  const description = (step.description ?? "").toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";

  const combinedText = `${target} ${action} ${description} ${recoveredText} ${semanticRelation}`;

  for (const [keyword, intent] of Object.entries(METHOD_INTENT_KEYWORDS)) {
    if (combinedText.includes(keyword)) {
      return intent;
    }
  }

  if (action === "navigate") return "open_home";
  if (action === "login") return "start_session";
  if (action.startsWith("assert")) return "expect_loaded";
  if (action === "fill") return "fill_form_field";
  if (action === "click" || action === "select") {
    if (screenType === "category") return "select_category";
    if (screenType === "product_list") return "select_product";
    if (screenType === "home") return "click_primary_action";
    return "click_primary_action";
  }

  return "unknown";
}

const SCREEN_TYPE_CLASS_MAP: Record<SemanticScreenType, string> = {
  home: "HomePage",
  main_menu: "MainMenuPage",
  product_information: "ProductInformationPage",
  category: "CategoryPage",
  product_list: "ProductListPage",
  product_detail: "ProductDetailPage",
  selection: "SelectionPage",
  form: "FormPage",
  confirmation: "ConfirmationPage",
  login: "LoginPage",
  otp: "OtpPage",
  unknown: "GenericPage"
};

const METHOD_INTENT_NAME_MAP: Record<SemanticMethodIntent, string> = {
  open_home: "open",
  start_session: "start",
  open_product_information: "openProductInformation",
  select_category: "selectCategory",
  select_product: "selectProduct",
  click_primary_action: "clickPrimaryAction",
  expect_loaded: "expectLoaded",
  fill_form_field: "fillField",
  submit_form: "submit",
  confirm_action: "confirm",
  unknown: "executeAction"
};

const METHOD_INTENT_PARAMS: Record<SemanticMethodIntent, string[]> = {
  open_home: [],
  start_session: [],
  open_product_information: [],
  select_category: ["categoryName"],
  select_product: ["productName"],
  click_primary_action: ["actionName"],
  expect_loaded: [],
  fill_form_field: ["fieldName", "value"],
  submit_form: [],
  confirm_action: [],
  unknown: []
};

function deriveSemanticScreenType(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): SemanticScreenType {
  return classifyScreenType(step, allSteps);
}

function deriveSemanticMethodIntent(step: ExecutionPlanStep, screenType: SemanticScreenType): SemanticMethodIntent {
  return classifyMethodIntent(step, screenType);
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

  const screenTypeMap = new Map<SemanticScreenType, ExecutionPlanStep[]>();
  for (const step of nonNavigationSteps) {
    const screenType = deriveSemanticScreenType(step, plan.steps);
    const existing = screenTypeMap.get(screenType) ?? [];
    existing.push(step);
    screenTypeMap.set(screenType, existing);
  }

  for (const [screenType, steps] of screenTypeMap.entries()) {
    if (screenType === "login" || screenType === "otp") continue;

    const className = derivePageObjectClassNameFromScreenType(screenType);
    const screenSignature = deriveScreenSignatureFromScreenType(screenType, appProfile.appSlug);

    const existingPO = registry.pageObjects.find((po) => po.screenSignature === screenSignature);

    const actionOnlySteps = steps.filter((s) => !s.action.startsWith("assert"));
    const assertionSteps = steps.filter((s) => s.action.startsWith("assert"));

    const methodCandidates = actionOnlySteps.map((s) => {
      const intent = deriveSemanticMethodIntent(s, screenType);
      return {
        name: deriveMethodNameFromIntent(intent),
        intent,
        parameters: deriveMethodParameters(intent)
      };
    });

    if (assertionSteps.length > 0 && screenType !== "product_detail") {
      const detailIntent: SemanticMethodIntent = "expect_loaded";
      methodCandidates.push({
        name: deriveMethodNameFromIntent(detailIntent),
        intent: detailIntent,
        parameters: deriveMethodParameters(detailIntent)
      });
    }

    if (!existingPO && methodCandidates.length > 0) {
      const regResult = registerPageObjectCandidate(registry, {
        name: className.replace("Page", ""),
        className,
        screenSignature,
        confidence: 0.5,
        sourcePlanId,
        methods: methodCandidates.map((m) => ({ name: m.name, intent: m.intent, parameters: m.parameters }))
      });

      if (regResult.created) {
        candidatesRegistered += 1;
      }
    }

    const poEntry = existingPO ?? registry.pageObjects.find((po) => po.screenSignature === screenSignature);
    if (poEntry) {
      for (const step of actionOnlySteps) {
        const intent = deriveSemanticMethodIntent(step, screenType);
        const recoveryMeta = (step as any).recoveryMetadata;

        registerMethodCandidate(registry, poEntry.id, {
          name: deriveMethodNameFromIntent(intent),
          intent,
          parameters: deriveMethodParameters(intent),
          sensitive: step.action === "fill" && step.valueKey !== undefined,
          confidence: recoveryMeta?.score ?? 0.5,
          sourceActionId: `${sourcePlanId}-step-${step.index}`
        });
      }

      for (const step of assertionSteps) {
        const detailIntent: SemanticMethodIntent = "expect_loaded";
        registerMethodCandidate(registry, poEntry.id, {
          name: deriveMethodNameFromIntent(detailIntent),
          intent: detailIntent,
          parameters: deriveMethodParameters(detailIntent),
          confidence: 0.5,
          sourceActionId: `${sourcePlanId}-step-${step.index}`
        });
      }
    }
  }

  const flowSteps = plan.steps.map((s) => {
    const screenType = deriveSemanticScreenType(s, plan.steps);
    const intent = deriveSemanticMethodIntent(s, screenType);
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
    for (const missingMethod of specResultMissingMethods) {
      const colonIdx = missingMethod.indexOf(":");
      const intent = colonIdx > 0 ? missingMethod.substring(0, colonIdx).trim() : missingMethod.trim();

      const candidatePO = registry.pageObjects.find((po) => po.status === "candidate");
      if (candidatePO) {
        registerMethodCandidate(registry, candidatePO.id, {
          name: `${intent}Method`,
          intent,
          confidence: 0.5,
          sourceActionId: `${sourcePlanId}-missing-${intent}`
        });
      } else if (registry.pageObjects.length > 0) {
        const firstPO = registry.pageObjects[0];
        registerMethodCandidate(registry, firstPO.id, {
          name: `${intent}Method`,
          intent,
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
  const appProfile = deriveAppProfile({
    appProfile: input.appProfile ?? runtimeConfig?.app.appProfile,
    appName: input.appName ?? runtimeConfig?.app.name,
    baseUrl: input.baseUrl ?? runtimeConfig?.app.baseUrl
  });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, input.outputRoot);
  if (!appPaths.planPath || !appPaths.specPath) {
    throw new Error("Unable to resolve promoted automation paths.");
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

  // Generate spec — POM-aware when policy provided
  const promotionPolicy = input.promotionPolicy;
  const inlineDebugMode = input.inlineDebugMode ?? false;
  let pomStatus: POMPromotionStatus | undefined;
  let pomDiagnostics: { missingPageObjects: string[]; missingMethods: string[]; generatedCandidates: number } | undefined;

  if (promotionPolicy && promotionPolicy.specMode === "page-object") {
    const registry = await loadPageObjectRegistry(appProfile, input.outputRoot).catch(() => undefined);
    const specResult = await generateSpecFromPlanWithPolicy({
      plan,
      automationId,
      appProfile,
      appPaths,
      promotionPolicy,
      inlineDebugMode,
      pageObjectRegistry: registry
    });
    await fs.writeFile(appPaths.specPath, specResult.specContent, "utf-8");
    pomStatus = specResult.pomStatus;

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
      missingPageObjects: specResult.missingPageObjects,
      missingMethods: specResult.missingMethods,
      generatedCandidates: specResult.generatedCandidates
    };
  } else {
    const specContent = generateSpecFromPlan(plan, automationId, appProfile, appPaths);
    await fs.writeFile(appPaths.specPath, specContent, "utf-8");
    pomStatus = inlineDebugMode ? "inline_debug_only" : undefined;
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
    metadata: pomDiagnostics || wasOverwritten ? {
      ...metadata,
      ...(pomDiagnostics ? { pomDiagnostics } : {}),
      ...(wasOverwritten ? {
        overwritten: true,
        previousAutomationPath,
        previousStatus
      } : {})
    } : metadata
  };

  const updatedAppIndex = upsertAutomationIndexEntry(appIndex, appIndexEntry);
  await saveAutomationIndex(updatedAppIndex, appIndexPath);

  if (appPaths.caseAutomationPath) {
    await fs.writeFile(appPaths.caseAutomationPath, JSON.stringify(appIndexEntry, null, 2), "utf-8");
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
