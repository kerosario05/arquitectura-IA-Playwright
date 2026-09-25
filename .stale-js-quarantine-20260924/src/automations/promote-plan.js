"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializePromotionContext = materializePromotionContext;
exports.persistFreshPlanForExistingSpecReuse = persistFreshPlanForExistingSpecReuse;
exports.tryPromoteExistingSpecBeforeGeneration = tryPromoteExistingSpecBeforeGeneration;
exports.promoteExecutionPlan = promoteExecutionPlan;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const env_1 = require("../config/env");
const execution_plan_validator_1 = require("../plans/execution-plan-validator");
const automation_naming_1 = require("./automation-naming");
const automation_index_1 = require("./automation-index");
const spec_generator_1 = require("./spec-generator");
const app_profile_1 = require("./app-profile");
const pom_ownership_1 = require("../types/pom-ownership");
const page_object_registry_1 = require("./page-object-registry");
const flow_registry_1 = require("./flow-registry");
const auto_pom_1 = require("./auto-pom");
const data_context_1 = require("../data/data-context");
const promoted_data_1 = require("../data/promoted-data");
const promoted_runtime_contract_1 = require("./runtime/promoted-runtime-contract");
const spec_generation_hybrid_1 = require("./spec-generation-hybrid");
const spec_execution_contract_1 = require("./spec-execution-contract");
const persisted_spec_revalidation_1 = require("./persisted-spec-revalidation");
const existing_spec_revalidation_1 = require("./existing-spec-revalidation");
const automation_reuse_1 = require("./automation-reuse");
async function materializePromotionContext(input) {
    const automationId = (0, automation_naming_1.buildAutomationId)({ externalId: input.plan.scenario.externalId, caseId: input.plan.scenario.caseId, title: input.plan.scenario.title });
    const paths = (0, app_profile_1.buildAppAutomationPaths)(input.appProfile, automationId, input.outputRoot, input.sectionSlug);
    await promises_1.default.mkdir(node_path_1.default.dirname(paths.planPath), { recursive: true });
    const executionContract = (0, spec_execution_contract_1.buildSpecExecutionContract)(input.plan, input.sourceScenario, { appSlug: input.appProfile.appSlug, sectionSlug: input.sectionSlug });
    const persistedPlan = { ...input.plan, sourceScenario: input.sourceScenario, executionContract };
    await writeFileAtomicWithRetry(paths.planPath, JSON.stringify(persistedPlan, null, 2));
    console.log(`[promotion-context-materialization] caseId=${input.plan.scenario.caseId ?? input.plan.scenario.externalId} sourceScenario=true executionContract=true stoppedBeforeGeneration=true`);
    return { planPath: paths.planPath, sourceScenario: input.sourceScenario, executionContract };
}
const PROMOTION_IO_RETRIES = 3;
const PROMOTION_IO_RETRY_DELAY_MS = 50;
function isTransientFsError(error) {
    const code = error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "EMFILE" || code === "ENFILE";
}
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function writeFileAtomicWithRetry(filePath, content) {
    const dir = node_path_1.default.dirname(filePath);
    await promises_1.default.mkdir(dir, { recursive: true });
    for (let attempt = 0; attempt <= PROMOTION_IO_RETRIES; attempt += 1) {
        const tempPath = node_path_1.default.join(dir, `${node_path_1.default.basename(filePath)}.${process.pid}.${Date.now()}.${attempt}.tmp`);
        try {
            await promises_1.default.writeFile(tempPath, content, "utf-8");
            await promises_1.default.rename(tempPath, filePath).catch(async (error) => {
                if (isTransientFsError(error) || (error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
                    await promises_1.default.rm(filePath, { force: true }).catch(() => undefined);
                    await promises_1.default.rename(tempPath, filePath);
                    return;
                }
                throw error;
            });
            return;
        }
        catch (error) {
            await promises_1.default.rm(tempPath, { force: true }).catch(() => undefined);
            if (isTransientFsError(error) && attempt < PROMOTION_IO_RETRIES) {
                await delay(PROMOTION_IO_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            throw error;
        }
    }
}
async function persistFreshPlanForExistingSpecReuse(input) {
    const persistedPlan = {
        ...input.plan,
        sourceScenario: input.sourceScenario,
        executionContract: input.executionContract,
    };
    await writeFileAtomicWithRetry(input.planPath, JSON.stringify(persistedPlan, null, 2));
}
async function readExistingSpecInfo(specPath) {
    try {
        const [content, stat] = await Promise.all([
            promises_1.default.readFile(specPath, "utf-8"),
            promises_1.default.stat(specPath)
        ]);
        const hash = (0, node_crypto_1.createHash)("sha256").update(content, "utf-8").digest("hex");
        return {
            existed: true,
            hash,
            lastModifiedAt: stat.mtime.toISOString()
        };
    }
    catch {
        return {
            existed: false,
            hash: null,
            lastModifiedAt: null
        };
    }
}
/** Admit a matching physical spec before any deterministic/AI generation occurs. */
async function tryPromoteExistingSpecBeforeGeneration(input) {
    if (!input.sourceScenario || !input.executionContract || !input.semanticContext) {
        return { handled: false, promoted: false, reason: "current_context_missing" };
    }
    let context;
    const dependencies = input.dependencies ?? {};
    try {
        context = await (dependencies.loadContext ?? persisted_spec_revalidation_1.loadExistingSpecRevalidationContext)({
            caseDir: input.caseDir,
            appSlug: input.appSlug,
            sectionSlug: input.sectionSlug,
            caseId: input.caseId,
        });
    }
    catch {
        return { handled: false, promoted: false, reason: "existing_spec_missing" };
    }
    const eligible = (dependencies.isEligible ?? persisted_spec_revalidation_1.isEligibleForDeterministicRevalidation)({
        previousSpecExisted: true,
        specText: context.specText,
        specPath: context.specPath,
        sourceScenario: input.sourceScenario,
        executionContract: input.executionContract,
        identityValidated: context.identityValidated,
        semanticContext: input.semanticContext,
    });
    if (!eligible)
        return { handled: false, promoted: false, reason: "existing_spec_not_eligible" };
    const result = await (dependencies.revalidate ?? existing_spec_revalidation_1.revalidateExistingSpecDeterministically)({
        specText: context.specText,
        specPath: context.specPath,
        sourceScenario: input.sourceScenario,
        executionContract: input.executionContract,
        semanticContext: input.semanticContext,
    });
    if (result.status !== "passed" || !result.allRequiredGatesPassed) {
        return { handled: false, promoted: false, reason: "deterministic_revalidation_failed" };
    }
    const persisted = await (dependencies.persist ?? persisted_spec_revalidation_1.persistSuccessfulExistingSpecRevalidation)({
        caseDir: input.caseDir,
        appSlug: input.appSlug,
        sectionSlug: input.sectionSlug,
        caseId: input.caseId,
        identityValidated: context.identityValidated,
        specText: context.specText,
        result,
    });
    if (!persisted.persisted)
        return { handled: false, promoted: false, reason: persisted.reason ?? "revalidation_persistence_failed" };
    const persistFreshPlan = async () => {
        if (!input.freshPlan || !input.planPath)
            return;
        await (dependencies.persistFreshPlan ?? persistFreshPlanForExistingSpecReuse)({
            planPath: input.planPath,
            plan: input.freshPlan,
            sourceScenario: input.sourceScenario,
            executionContract: input.executionContract,
        });
    };
    const loadAutomation = dependencies.loadAutomation ?? (async (caseDir) => JSON.parse(await promises_1.default.readFile(node_path_1.default.join(caseDir, "automation.json"), "utf8")));
    let automation;
    try {
        automation = await loadAutomation(input.caseDir);
    }
    catch {
        return { handled: false, promoted: false, reason: "promotion_authority_missing" };
    }
    const physical = {
        specPath: context.specPath,
        specExists: true,
        specText: context.specText,
        appSlug: input.appSlug,
        sectionSlug: input.sectionSlug ?? "",
        caseId: input.caseId ?? Number.NaN,
    };
    const authority = (dependencies.validateAuthority ?? automation_reuse_1.validatePromotedArtifactForReuse)(automation, physical);
    if (automation.status === "active") {
        if (!authority.valid)
            return { handled: false, promoted: false, reason: `active_authority_${authority.reason ?? "invalid"}` };
        await persistFreshPlan();
        return { handled: true, promoted: true, reason: "existing_active_revalidated" };
    }
    const promoted = await (dependencies.promote ?? persisted_spec_revalidation_1.promoteExistingVerifiedSpec)({
        caseDir: input.caseDir,
        appSlug: input.appSlug,
        sectionSlug: input.sectionSlug ?? "default-section",
        caseId: input.caseId ?? Number.NaN,
        specPath: context.specPath,
    });
    if (!promoted.promotionSucceeded)
        return { handled: false, promoted: false, reason: promoted.reason ?? "existing_promotion_failed" };
    await persistFreshPlan();
    return { handled: true, promoted: true };
}
function assertPromotable(status, allowDraft) {
    if (status === "needs_data" || status === "needs_discovery" || status === "unsupported") {
        throw new Error(`Plan status '${status}' is not eligible for promotion. Only 'validated' plans can be promoted.`);
    }
    if (status === "draft" && !allowDraft) {
        throw new Error(`Plan status is 'draft'. Use --allow-draft to promote draft plans or resolve required data first.`);
    }
}
function ensurePromotedSpecNavigation(specContent, plan) {
    const hasNavigationStep = plan.steps.some((step) => step.action === "navigate");
    if (!hasNavigationStep || /\.goto\s*\(/.test(specContent))
        return specContent;
    const navigation = [
        "    const baseUrl = process.env.APP_BASE_URL;",
        "    if (!baseUrl) throw new Error('APP_BASE_URL is required');",
        "    await page.goto(baseUrl);",
        "    await page.waitForLoadState('domcontentloaded');",
        ""
    ].join("\n");
    return specContent.replace(/(\n\s*try\s*\{\n)/, `$1${navigation}`);
}
function ensurePromotedSpecStrategyMarker(specContent, selectedStrategy) {
    if (selectedStrategy !== "pom")
        return specContent;
    if (!specContent.includes("createPromotedSpecRuntime(") || /PROMOTED_SPEC_STRATEGY\s*=/.test(specContent)) {
        return specContent;
    }
    return `export const PROMOTED_SPEC_STRATEGY = "pom_runtime";\n${specContent}`;
}
async function ensureDirectories(paths) {
    if (paths.caseDir)
        await promises_1.default.mkdir(paths.caseDir, { recursive: true });
    if (paths.caseEvidenceDir)
        await promises_1.default.mkdir(paths.caseEvidenceDir, { recursive: true });
    if (paths.caseRunsDir)
        await promises_1.default.mkdir(paths.caseRunsDir, { recursive: true });
    await promises_1.default.mkdir(paths.plansDir, { recursive: true });
    await promises_1.default.mkdir(paths.specsDir, { recursive: true });
}
async function verifyPromotedSpec(specPath, timeoutMs = 90000) {
    try {
        const { exec } = await Promise.resolve().then(() => __importStar(require("node:child_process")));
        const { promisify } = await Promise.resolve().then(() => __importStar(require("node:util")));
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
    }
    catch (error) {
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
function deriveScreenSignatureFromPlan(plan) {
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
const SCREEN_TYPE_KEYWORDS = {
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
const METHOD_INTENT_KEYWORDS = {
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
function normalizeSemanticText(value) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
function getSemanticStepText(step) {
    const target = step.target && typeof step.target === "object"
        ? `${step.target.value ?? ""} ${step.target.name ?? ""} ${step.target.role ?? ""}`
        : "";
    return normalizeSemanticText(`${target} ${step.description ?? ""} ${step.action}`);
}
function isUsernameSemanticTarget(text) {
    return text.includes("username") || text.includes("usuario");
}
function isPasswordSemanticTarget(text) {
    return text.includes("password") || text.includes("contrasena");
}
function isLoginSemanticTrigger(text) {
    return text.includes("log in") || text.includes("login") || text.includes("iniciar sesion");
}
function hasPriorLoginSemanticEvidence(step, allSteps) {
    const currentIndex = allSteps.indexOf(step);
    if (currentIndex <= 0)
        return false;
    return allSteps.slice(0, currentIndex).some((candidate) => {
        const text = getSemanticStepText(candidate);
        return (candidate.action === "fill" || candidate.action.startsWith("assert"))
            && (isUsernameSemanticTarget(text) || isPasswordSemanticTarget(text));
    });
}
function isFirstVisibleSemanticSelection(text) {
    return /\b(primer[ao]?\s+(producto|item|registro|card|tarjeta|fila)|primera?\s+(tarjeta|card|fila)|first\s+visible\s+(item|product|card|row))\b/i.test(text);
}
function deriveFirstVisibleSemanticIntent(text) {
    if (/\b(fila|row)\b/i.test(text))
        return "select_first_visible_row";
    if (/\b(tarjeta|card)\b/i.test(text))
        return "select_first_visible_card";
    if (/\b(producto|product)\b/i.test(text))
        return "select_first_visible_product";
    return "select_first_visible_item";
}
function classifyScreenType(step, allSteps) {
    const target = step.target && typeof step.target === "object"
        ? (step.target.value ?? step.target.name ?? step.target.role ?? "").toLowerCase()
        : "";
    const action = step.action.toLowerCase();
    const description = (step.description ?? "").toLowerCase();
    const recoveryMeta = step.recoveryMetadata;
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
function classifyMethodIntent(step, screenType, allSteps) {
    const target = step.target && typeof step.target === "object"
        ? (step.target.value ?? step.target.name ?? step.target.role ?? "").toLowerCase()
        : "";
    const action = step.action.toLowerCase();
    const description = (step.description ?? "").toLowerCase();
    const recoveryMeta = step.recoveryMetadata;
    const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
    const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";
    const normalizedText = getSemanticStepText(step);
    if (action.startsWith("assert")) {
        if (isUsernameSemanticTarget(normalizedText) || isPasswordSemanticTarget(normalizedText))
            return "expect_login_form";
        if (normalizedText.includes("welcome") || normalizedText.includes("logout") || normalizedText.includes("cerrar sesion"))
            return "expect_logged_in";
        return "expect_loaded";
    }
    if (action === "fill") {
        if (isUsernameSemanticTarget(normalizedText))
            return "fill_username";
        if (isPasswordSemanticTarget(normalizedText))
            return "fill_password";
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
    if (action === "navigate")
        return "open_home";
    if (action === "login")
        return "start_session";
    if (action.startsWith("assert"))
        return "expect_loaded";
    if (action === "click" || action === "select") {
        if (screenType === "login")
            return hasPriorLoginSemanticEvidence(step, allSteps) ? "submit_login" : "open_login_modal";
        if (screenType === "category")
            return "select_category";
        if (screenType === "product_list")
            return "select_product";
        if (screenType === "home")
            return "click_primary_action";
        return "click_primary_action";
    }
    return "unknown";
}
function deriveSemanticScreenType(step, allSteps) {
    return classifyScreenType(step, allSteps);
}
function deriveSemanticMethodIntent(step, screenType) {
    return classifyMethodIntent(step, screenType, []);
}
function derivePageObjectClassNameFromScreenType(screenType) {
    return pom_ownership_1.SCREEN_TYPE_CLASS_MAP[screenType] ?? "GenericPage";
}
function deriveMethodNameFromIntent(intent) {
    return pom_ownership_1.METHOD_INTENT_NAME_MAP[intent] ?? "executeAction";
}
function deriveMethodParameters(intent) {
    return pom_ownership_1.METHOD_INTENT_PARAMS[intent] ?? [];
}
function deriveScreenSignatureFromScreenType(screenType, appSlug) {
    return `screen:${appSlug}-${screenType}`;
}
async function registerPOMCandidatesForBlockedPromotion(plan, automationId, appProfile, outputRoot, pomStatus, specResultMissingMethods) {
    if (pomStatus !== "needs_page_object" && pomStatus !== "needs_page_method") {
        return { pomCandidatesRegistered: 0 };
    }
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)(appProfile, outputRoot);
    const flowReg = await (0, flow_registry_1.ensureFlowRegistry)(appProfile, outputRoot);
    let candidatesRegistered = 0;
    const sourcePlanId = automationId;
    const nonNavigationSteps = plan.steps.filter((s) => s.action !== "navigate" && s.action !== "login");
    const routedMethods = [];
    for (const step of nonNavigationSteps) {
        const screenType = deriveSemanticScreenType(step, plan.steps);
        const intent = classifyMethodIntent(step, screenType, plan.steps);
        const recoveryMeta = step.recoveryMetadata;
        const ownerClassName = pom_ownership_1.INTENT_PREFERRED_OWNER[intent] ?? pom_ownership_1.SCREEN_TYPE_CLASS_MAP[screenType] ?? "GenericPage";
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
            const detailScreenType = screenType === "product_detail" ? screenType : "product_detail";
            const intent = "expect_loaded";
            const recoveryMeta = step.recoveryMetadata;
            const ownerClassName = pom_ownership_1.INTENT_PREFERRED_OWNER[intent] ?? pom_ownership_1.SCREEN_TYPE_CLASS_MAP[detailScreenType] ?? "ProductDetailPage";
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
    const methodsByOwner = new Map();
    for (const method of routedMethods) {
        const existing = methodsByOwner.get(method.ownerClassName) ?? [];
        existing.push(method);
        methodsByOwner.set(method.ownerClassName, existing);
    }
    for (const [ownerClassName, methods] of methodsByOwner.entries()) {
        if (ownerClassName === "OtpPage")
            continue;
        const primaryScreenType = Object.entries(pom_ownership_1.SCREEN_TYPE_CLASS_MAP).find(([, cls]) => cls === ownerClassName)?.[0];
        const screenSignature = primaryScreenType
            ? `screen:${appProfile.appSlug}-${primaryScreenType}`
            : `screen:${appProfile.appSlug}-${ownerClassName.toLowerCase().replace(/page$/, "")}`;
        let existingPO = registry.pageObjects.find((po) => po.className === ownerClassName);
        if (!existingPO) {
            existingPO = registry.pageObjects.find((po) => po.screenSignature === screenSignature);
        }
        const uniqueMethods = new Map();
        for (const m of methods) {
            if (!uniqueMethods.has(m.intent)) {
                uniqueMethods.set(m.intent, m);
            }
        }
        if (!existingPO && uniqueMethods.size > 0) {
            const regResult = (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
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
                (0, page_object_registry_1.registerMethodCandidate)(registry, existingPO.id, {
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
    await (0, flow_registry_1.registerFlowCandidate)(flowReg, {
        name: flowName,
        steps: flowSteps,
        requiredDataKeys: plan.requiredData.filter((d) => d.required).map((d) => d.key),
        confidence: 0.5
    });
    if (pomStatus === "needs_page_method" && specResultMissingMethods.length > 0) {
        const skipIntents = [];
        for (const missingMethod of specResultMissingMethods) {
            const derivedIntentMatch = missingMethod.match(/derivedIntent="([^"]+)"/);
            const intent = derivedIntentMatch ? derivedIntentMatch[1] : missingMethod.trim();
            // Skip login-related intents
            if (skipIntents.includes(intent))
                continue;
            // Always use INTENT_PREFERRED_OWNER for consistency, don't trust stale expectedOwner from missing method string
            const ownerClassName = pom_ownership_1.INTENT_PREFERRED_OWNER[intent] ?? "GenericPage";
            let ownerPO = registry.pageObjects.find((po) => po.className === ownerClassName);
            if (!ownerPO) {
                ownerPO = registry.pageObjects.find((po) => po.className === "ProductListPage" && po.status === "active");
            }
            if (!ownerPO && registry.pageObjects.length > 0) {
                ownerPO = registry.pageObjects.find((po) => po.status === "candidate") ?? registry.pageObjects[0];
            }
            if (ownerPO) {
                const methodName = deriveMethodNameFromIntent(intent);
                (0, page_object_registry_1.registerMethodCandidate)(registry, ownerPO.id, {
                    name: methodName,
                    intent,
                    parameters: deriveMethodParameters(intent),
                    confidence: 0.5,
                    sourceActionId: `${sourcePlanId}-missing-${intent}`
                });
            }
        }
    }
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, appProfile, outputRoot);
    await (0, flow_registry_1.saveFlowRegistry)(flowReg, appProfile, outputRoot);
    return { pomCandidatesRegistered: candidatesRegistered };
}
async function promoteExecutionPlan(input, allowDraft = false, metadata) {
    const plan = input.plan;
    // A persisted plan is itself an authoritative promotion input.  The CLI
    // commonly reloads only `plan.json`, so do not silently fall back to the
    // reduced execution-plan shape when the caller omits sourceScenario.
    const authoritativeSourceScenario = input.sourceScenario
        ?? plan.sourceScenario;
    const validation = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
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
    const automationId = (0, automation_naming_1.buildAutomationId)({
        externalId: plan.scenario.externalId,
        caseId: plan.scenario.caseId,
        title: plan.scenario.title
    });
    const runtimeConfig = input.fullConfig;
    let appProfile;
    if (input.appProfileObject) {
        appProfile = input.appProfileObject;
    }
    else {
        appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: input.appProfile ?? runtimeConfig?.app.appProfile,
            appName: input.appName ?? runtimeConfig?.app.name,
            baseUrl: input.baseUrl ?? runtimeConfig?.app.baseUrl
        });
    }
    console.log(`[promote] Using appSlug=${appProfile.appSlug}`);
    // Determine sectionSlug from input
    const sectionSlug = input.sectionSlug || undefined;
    if (sectionSlug) {
        console.log(`[promote] Using sectionSlug=${sectionSlug}`);
    }
    const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, automationId, input.outputRoot, sectionSlug);
    const promotionPolicy = input.promotionPolicy;
    const planHasAuthConsumedSteps = plan.steps.some(s => {
        const desc = (s.description ?? "").toLowerCase();
        return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
    });
    await (0, app_profile_1.ensureAppStructure)(appPaths.appDir, sectionSlug);
    if (!appPaths.planPath || !appPaths.specPath) {
        throw new Error("Unable to resolve promoted automation paths.");
    }
    if (planHasAuthConsumedSteps) {
        const authValidation = (0, app_profile_1.validateAuthFlowDependencies)(appPaths.appDir);
        if (!authValidation.valid) {
            throw new Error(`AuthFlow is required but dependencies are missing: ${authValidation.missing.join(", ")}. ` +
                `Run ensureAppStructure or copy framework files from default app.`);
        }
    }
    try {
        await promises_1.default.access(appPaths.planPath);
        if (!input.overwrite) {
            throw new Error(`Automation '${automationId}' already exists at '${appPaths.planPath}'. Use --overwrite to replace.`);
        }
    }
    catch (err) {
        if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) {
            throw err;
        }
    }
    let wasOverwritten = false;
    let previousAutomationPath;
    let previousStatus;
    if (input.overwrite) {
        try {
            await promises_1.default.access(appPaths.planPath);
            wasOverwritten = true;
            previousAutomationPath = appPaths.planPath;
            const appDirPathsForLoad = (0, app_profile_1.buildAppAutomationPaths)(appProfile, undefined, input.outputRoot);
            try {
                const existingAppIndex = await (0, automation_index_1.loadAutomationIndex)(appDirPathsForLoad.indexPath);
                const existingEntry = existingAppIndex.automations.find((a) => a.id === automationId);
                if (existingEntry) {
                    previousStatus = existingEntry.status;
                }
            }
            catch {
                // Index may not exist or be unreadable, continue without previous status
            }
        }
        catch {
            // Automation does not exist, nothing to overwrite
        }
    }
    await ensureDirectories(appPaths);
    // Write case.meta.json with section and app metadata
    if (appPaths.caseDir) {
        const caseMeta = {
            appSlug: appProfile.appSlug,
            sectionSlug: sectionSlug ?? "default-section",
            sectionName: input.sectionName,
            sectionId: input.sectionId,
            sourceScenarioId: plan.scenario.externalId,
            testRailCaseId: plan.scenario.caseId ?? input.sectionId,
            generatedAt: new Date().toISOString(),
            title: plan.scenario.title,
        };
        await writeFileAtomicWithRetry(node_path_1.default.join(appPaths.caseDir, "case.meta.json"), JSON.stringify(caseMeta, null, 2));
    }
    if (appPaths.caseDir) {
        const runtimeForData = input.fullConfig ?? env_1.config;
        const dataContext = (0, data_context_1.buildDataContext)(runtimeForData);
        const promotedDataManifest = (0, promoted_data_1.buildPromotedDataManifest)(plan, dataContext);
        (0, promoted_data_1.savePromotedDataManifestSync)(node_path_1.default.join(appPaths.caseDir, "promoted-data.json"), promotedDataManifest);
    }
    // Existing physical specs are admitted before generation. The contract and
    // semantic context here are rebuilt from the current discovery inputs.
    if (appPaths.caseDir && authoritativeSourceScenario && !input.skipExistingSpecAdmission) {
        const currentRegistry = promotionPolicy?.specMode === "page-object"
            ? await (0, page_object_registry_1.loadPageObjectRegistry)(appProfile, input.outputRoot).catch(() => undefined)
            : undefined;
        const currentExecutionContract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan, authoritativeSourceScenario, {
            appSlug: appProfile.appSlug,
            sectionSlug,
            pageObjectRegistry: currentRegistry,
        });
        const semanticContext = {
            requiredAssertions: (authoritativeSourceScenario.observableOracles ?? []).map((oracle) => oracle.requirement),
            observableOracles: authoritativeSourceScenario.observableOracles ?? [],
            scenarioSteps: authoritativeSourceScenario.steps ?? [],
            semanticErrors: [],
        };
        const existingRoute = await tryPromoteExistingSpecBeforeGeneration({
            caseDir: appPaths.caseDir,
            specPath: appPaths.specPath,
            planPath: appPaths.planPath,
            freshPlan: plan,
            appSlug: appProfile.appSlug,
            sectionSlug,
            caseId: plan.scenario.caseId,
            sourceScenario: authoritativeSourceScenario,
            executionContract: currentExecutionContract,
            semanticContext,
        });
        if (existingRoute.handled && existingRoute.promoted) {
            const promotedEntry = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(appPaths.caseDir, "automation.json"), "utf8"));
            return promotedEntry;
        }
    }
    // Generate spec — POM-aware when policy provided
    const inlineDebugMode = input.inlineDebugMode ?? false;
    let pomStatus;
    let strategyDiagnostics;
    let pomDiagnostics;
    let generatedSpecContent = "";
    let registryForSpecValidation;
    let specGenerationDiagnostics;
    if (promotionPolicy && promotionPolicy.specMode === "page-object") {
        const registry = await (0, page_object_registry_1.loadPageObjectRegistry)(appProfile, input.outputRoot).catch(() => undefined);
        registryForSpecValidation = registry;
        // Detect if plan requires AuthFlow from metadata (preferred) or auth-consumed steps (legacy)
        const authFlowMetadata = plan.metadata?.authFlowRequired
            ? {
                alias: plan.metadata.authFlowAlias || "defaultClient",
                landing: plan.metadata.authFlowLanding || "transactions_menu",
                insertionAfterStepIndex: plan.metadata.authFlowInsertionAfterStepIndex,
                contractBinding: plan.executionContract?.auth?.aggregate
            }
            : undefined;
        // Legacy detection: check for auth-consumed step descriptions
        const hasAuthConsumedSteps = !authFlowMetadata && plan.steps.some(s => {
            const desc = (s.description ?? "").toLowerCase();
            return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
        });
        const authFlowOptions = authFlowMetadata ?? (hasAuthConsumedSteps ? {
            alias: "defaultClient",
            landing: "transactions_menu"
        } : undefined);
        const specResult = await (0, spec_generator_1.generateSpecFromPlanWithPolicy)({
            plan,
            automationId,
            appProfile,
            appPaths,
            sectionSlug,
            scenarioId: plan.scenario.externalId,
            promotionPolicy,
            inlineDebugMode,
            pageObjectRegistry: registry,
            authFlowOptions
        });
        generatedSpecContent = specResult.specContent;
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
                throw new Error(`POM_RUNTIME_REQUIRED_BUT_UNAVAILABLE: blockers=${blockers.join(" | ") || "unknown"}`);
            }
        }
        // Fail promotion if spec validation found critical issues
        if (specResult.validationErrors && specResult.validationErrors.length > 0) {
            for (const err of specResult.validationErrors) {
                console.error(`[promote-plan] Spec validation error: ${err}`);
            }
            throw new Error(`Spec validation failed: ${specResult.validationErrors.join("; ")}. ` +
                "Promotion blocked to prevent degraded spec from being promoted.");
        }
        // Register POM candidates if any were generated
        if (specResult.generatedCandidates > 0 && registry) {
            const { savePageObjectRegistry } = await Promise.resolve().then(() => __importStar(require("./page-object-registry")));
            await savePageObjectRegistry(registry, appProfile, input.outputRoot);
        }
        // Register POM candidates when promotion is blocked by missing page objects/methods
        const pomCandidateResult = await registerPOMCandidatesForBlockedPromotion(plan, automationId, appProfile, input.outputRoot, specResult.pomStatus, specResult.missingMethods);
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
        if ((0, auto_pom_1.shouldRunAutoPom)(specResult.pomStatus, promotionPolicy)) {
            console.log(`[promote-plan] Auto-POM triggered for status: ${specResult.pomStatus}`);
            const autoPomResult = await (0, auto_pom_1.runAutoPomPipeline)({
                plan,
                automationId,
                appProfile,
                appPaths,
                sectionSlug,
                scenarioId: plan.scenario.externalId,
                outputRoot: input.outputRoot,
                promotionPolicy,
                inlineDebugMode: input.inlineDebugMode ?? false,
                initialPomStatus: specResult.pomStatus,
                initialMissingMethods: specResult.missingMethods
            });
            pomStatus = autoPomResult.pomStatus;
            if (autoPomResult.diagnostics.finalPomStatus === "promoted") {
                generatedSpecContent = autoPomResult.specContent;
                console.log(`[promote-plan] Auto-POM succeeded, spec regenerated and promoted.`);
            }
            else {
                generatedSpecContent = autoPomResult.specContent;
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
    }
    else {
        const specContent = (0, spec_generator_1.generateSpecFromPlan)(plan, automationId, appProfile, appPaths, {
            sectionSlug,
            scenarioId: plan.scenario.externalId
        });
        generatedSpecContent = specContent;
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
    const specGenerationResult = await (0, spec_generation_hybrid_1.runHybridSpecGeneration)({
        plan,
        deterministicDraft: generatedSpecContent,
        appProfile,
        appPaths,
        sectionSlug,
        scenarioId: plan.scenario.externalId,
        promotionPolicy,
        pageObjectRegistry: registryForSpecValidation,
        sourceScenario: authoritativeSourceScenario,
        headed: input.headed,
        executionSource: input.executionSource,
    });
    const generatedExecutionContract = specGenerationResult.executionContract;
    const planContent = JSON.stringify({
        ...plan,
        ...(authoritativeSourceScenario ? { sourceScenario: authoritativeSourceScenario } : {}),
        ...(generatedExecutionContract ? { executionContract: generatedExecutionContract } : {})
    }, null, 2);
    await writeFileAtomicWithRetry(appPaths.planPath, planContent);
    if (appPaths.caseConfigPath) {
        await writeFileAtomicWithRetry(appPaths.caseConfigPath, JSON.stringify({
            id: automationId,
            externalId: plan.scenario.externalId,
            caseId: plan.scenario.caseId,
            title: plan.scenario.title,
            source: input.source ?? "manual",
            appSlug: appProfile.appSlug,
            appConfigPath: appPaths.configPath,
            createdAt: new Date().toISOString()
        }, null, 2));
    }
    specGenerationDiagnostics = specGenerationResult.diagnostics;
    generatedSpecContent = specGenerationResult.specContent;
    generatedSpecContent = (0, spec_generation_hybrid_1.rewritePromotedRuntimeImport)(generatedSpecContent, appPaths.specPath);
    generatedSpecContent = (0, spec_generation_hybrid_1.rewritePromotedAuthFlowHelperImport)(generatedSpecContent, appPaths.specPath, appProfile.appSlug);
    generatedSpecContent = ensurePromotedSpecNavigation(generatedSpecContent, plan);
    generatedSpecContent = ensurePromotedSpecStrategyMarker(generatedSpecContent, strategyDiagnostics?.selectedStrategy);
    const promotedImportValidation = await (0, spec_generation_hybrid_1.validatePromotedSpecInternalImports)(generatedSpecContent, appPaths.specPath);
    console.log(`[promoted-spec-imports] specPath=${appPaths.specPath} internalImports=${promotedImportValidation.internalImports} resolved=${promotedImportValidation.resolved} unresolved=${promotedImportValidation.unresolved.length}`);
    const previousSpec = await readExistingSpecInfo(appPaths.specPath);
    let specWritten = false;
    let specPromotionAllowed = specGenerationResult.promotionAllowed && promotedImportValidation.unresolved.length === 0;
    if (promotedImportValidation.unresolved.length > 0) {
        specGenerationDiagnostics.errors.push(`promoted_spec_internal_imports_unresolved:${promotedImportValidation.unresolved.join(",")}`);
    }
    if (specPromotionAllowed) {
        await writeFileAtomicWithRetry(appPaths.specPath, generatedSpecContent);
        specWritten = true;
    }
    else {
        pomStatus = "needs_manual_review";
        if (strategyDiagnostics) {
            strategyDiagnostics.blockers.push("spec_generation_validation_failed");
            strategyDiagnostics.reason = "spec_generation_validation_failed";
        }
    }
    if (specGenerationDiagnostics) {
        specGenerationDiagnostics.specWritten = specWritten;
        specGenerationDiagnostics.previousSpec = previousSpec;
    }
    if (appPaths.caseDir && strategyDiagnostics) {
        strategyDiagnostics = {
            ...strategyDiagnostics,
            specPath: appPaths.specPath,
            specHash: (0, node_crypto_1.createHash)("sha256").update(generatedSpecContent).digest("hex"),
            specSource: specWritten ? "generatedSpec" : "ai_candidate",
        };
        await writeFileAtomicWithRetry(node_path_1.default.join(appPaths.caseDir, "promotion-diagnostics.json"), JSON.stringify(strategyDiagnostics, null, 2));
    }
    const requirePomRuntimeContract = input.requirePomRuntime === true || process.env.PROMOTION_REQUIRE_POM_RUNTIME === "true";
    if (requirePomRuntimeContract && appPaths.specPath && specPromotionAllowed) {
        const diagnosticsPath = appPaths.caseDir ? node_path_1.default.join(appPaths.caseDir, "promotion-diagnostics.json") : undefined;
        const contractResult = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(appPaths.specPath, diagnosticsPath);
        if (!contractResult.valid) {
            throw new Error(`PROMOTED_SPEC_RUNTIME_CONTRACT_INVALID: ${contractResult.errors.join(" | ")}`);
        }
    }
    if (input.persistAppConfig !== false) {
        const existingConfig = (0, app_profile_1.loadPromotedAppConfigSync)({ appSlug: appProfile.appSlug });
        const appConfig = (0, app_profile_1.serializeRuntimeConfigForPromotion)(input.fullConfig ?? env_1.config, existingConfig);
        appConfig.appProfile = {
            ...appConfig.appProfile,
            appSlug: appProfile.appSlug,
            name: appProfile.name ?? appConfig.appProfile.name,
            baseUrl: appProfile.baseUrl ?? appConfig.appProfile.baseUrl,
            baseUrlHash: appProfile.baseUrlHash ?? appConfig.appProfile.baseUrlHash,
            updatedAt: new Date().toISOString()
        };
        await (0, app_profile_1.savePromotedAppConfig)(appConfig, input.outputRoot);
    }
    const appDirPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, undefined, input.outputRoot);
    const appIndexPath = appDirPaths.indexPath;
    const appIndex = await (0, automation_index_1.loadAutomationIndex)(appIndexPath);
    const source = input.source ?? "manual";
    const rawAutomationStatus = (0, automation_naming_1.determineAutomationStatus)(plan.status, source);
    // Override status if POM requires a non-active status
    const automationStatus = !specPromotionAllowed
        ? "spec_failed"
        : pomStatus === "inline_debug_only"
            ? "inline_debug_only"
            : pomStatus === "needs_page_object" || pomStatus === "needs_page_method"
                ? "blocked_missing_pom"
                : pomStatus === "needs_manual_review"
                    ? "blocked_missing_pom"
                    : rawAutomationStatus;
    const now = new Date().toISOString();
    const appIndexEntry = {
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
        specVerificationStatus: specPromotionAllowed ? "passed" : "failed",
        metadata: pomDiagnostics || wasOverwritten || specGenerationDiagnostics ? {
            ...metadata,
            ...(pomDiagnostics ? { pomDiagnostics } : {}),
            ...(specGenerationDiagnostics ? { specGeneration: specGenerationDiagnostics } : {}),
            ...(strategyDiagnostics ? { promotionStrategyDiagnostics: strategyDiagnostics } : {}),
            ...(wasOverwritten ? {
                overwritten: true,
                previousAutomationPath,
                previousStatus
            } : {})
        } : metadata,
        ...(specPromotionAllowed ? (0, persisted_spec_revalidation_1.buildPromotedArtifactIdentity)(appPaths.specPath, generatedSpecContent) : {})
    };
    // --- Verify promoted spec if requested ---
    if (input.verifySpec && appPaths.specPath && automationStatus === "active") {
        console.log(`[promote-plan] Running spec verification for ${appPaths.specPath}`);
        const verificationResult = await verifyPromotedSpec(appPaths.specPath, input.specVerificationTimeoutMs ?? 90000);
        appIndexEntry.specVerificationStatus = verificationResult.status;
        if (verificationResult.status === "failed") {
            console.error(`[promote-plan] Spec verification FAILED. Promotion marked as spec_failed.`);
            appIndexEntry.status = "spec_failed";
            delete appIndexEntry.promotionPersisted;
            delete appIndexEntry.promotedSpecPath;
            delete appIndexEntry.promotedSpecHash;
            appIndexEntry.metadata = {
                ...appIndexEntry.metadata,
                specVerification: {
                    status: "failed",
                    error: verificationResult.error,
                    tracePath: verificationResult.tracePath,
                    screenshotPath: verificationResult.screenshotPath
                }
            };
        }
        else if (verificationResult.status === "passed") {
            console.log(`[promote-plan] Spec verification PASSED`);
            appIndexEntry.metadata = {
                ...appIndexEntry.metadata,
                specVerification: {
                    status: "passed"
                }
            };
        }
    }
    const updatedAppIndex = (0, automation_index_1.upsertAutomationIndexEntry)(appIndex, appIndexEntry);
    await (0, automation_index_1.saveAutomationIndex)(updatedAppIndex, appIndexPath);
    if (appPaths.caseAutomationPath) {
        await writeFileAtomicWithRetry(appPaths.caseAutomationPath, JSON.stringify(appIndexEntry, null, 2));
    }
    if (appPaths.caseDir && strategyDiagnostics) {
        await writeFileAtomicWithRetry(node_path_1.default.join(appPaths.caseDir, "promotion-diagnostics.json"), JSON.stringify(strategyDiagnostics, null, 2));
    }
    // --- Update global index too ---
    const globalIndexPath = input.outputRoot !== undefined
        ? node_path_1.default.join(input.outputRoot, "automations/index.json")
        : undefined;
    const globalIndex = await (0, automation_index_1.loadAutomationIndex)(globalIndexPath);
    const updatedGlobalIndex = (0, automation_index_1.upsertAutomationIndexEntry)(globalIndex, appIndexEntry);
    await (0, automation_index_1.saveAutomationIndex)(updatedGlobalIndex, globalIndexPath);
    return appIndexEntry;
}
