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
exports.normalizeAppSlug = normalizeAppSlug;
exports.normalizeSectionSlug = normalizeSectionSlug;
exports.resolveSectionProfileSync = resolveSectionProfileSync;
exports.resolveCaseSpecOutputPath = resolveCaseSpecOutputPath;
exports.resolveProjectNameFromTestRail = resolveProjectNameFromTestRail;
exports.resolveAppProfile = resolveAppProfile;
exports.resolveSectionProfile = resolveSectionProfile;
exports.ensureAppStructure = ensureAppStructure;
exports.validateAuthFlowDependencies = validateAuthFlowDependencies;
exports.logAppProfile = logAppProfile;
exports.deriveAppProfile = deriveAppProfile;
exports.getPromotedAppDirectory = getPromotedAppDirectory;
exports.buildAppAutomationPaths = buildAppAutomationPaths;
exports.serializeRuntimeConfigForPromotion = serializeRuntimeConfigForPromotion;
exports.buildMergedConfig = buildMergedConfig;
exports.loadPromotedAppConfigSync = loadPromotedAppConfigSync;
exports.loadRouteProfile = loadRouteProfile;
exports.normalizeRouteProfileConfig = normalizeRouteProfileConfig;
exports.savePromotedAppConfig = savePromotedAppConfig;
exports.redactPromotedAppConfigForLogs = redactPromotedAppConfigForLogs;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const SENSITIVE_KEY_HINTS = ["password", "secret", "token", "key", "pass"];
const APP_PROFILE_IO_RETRIES = 3;
const APP_PROFILE_IO_RETRY_DELAY_MS = 50;
function isMissingFileError(error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
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
    for (let attempt = 0; attempt <= APP_PROFILE_IO_RETRIES; attempt += 1) {
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
            if (isTransientFsError(error) && attempt < APP_PROFILE_IO_RETRIES) {
                await delay(APP_PROFILE_IO_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            throw error;
        }
    }
}
const APPS_ROOT = node_path_1.default.join("automations", "apps");
const APP_SUBDIRS = ["pages", "flows", "cases", "lib", "components"];
const FRAMEWORK_AUTH_FLOW_FILES = {
    flows: ["auth.flow.ts", "auth.flow.js", "auth.flow.helpers.ts"],
    pages: ["identification.page.ts", "phoneconfirmation.page.ts", "operationsmenu.page.ts", "productlist.page.ts"],
    components: ["otp.component.ts", "virtual-keyboard.component.ts"]
};
function normalizeText(value) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}
function normalizeAppSlug(input) {
    if (!input || !input.trim())
        return "default";
    const raw = input.trim();
    const sanitized = raw.replace(/\.\./g, "").replace(/[\\/]/g, "-");
    const normalized = normalizeText(sanitized)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    if (!normalized || normalized === "default")
        return "default";
    return normalized;
}
/**
 * Normalize section name to a safe sectionSlug
 * - Remove accents
 * - Lowercase
 * - Spaces to dashes
 * - Block path traversal (../, ..\)
 * - Block / and \ characters
 * - Limit to [a-z0-9-]
 */
function normalizeSectionSlug(input) {
    if (!input || !input.trim())
        return "default-section";
    const raw = input.trim();
    // Block path traversal attempts
    const sanitized = raw.replace(/\.\./g, "").replace(/[\\/]/g, "-");
    // Normalize: lowercase, remove accents
    const normalized = normalizeText(sanitized)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    if (!normalized || normalized === "default")
        return "default-section";
    return normalized;
}
/**
 * Synchronously resolve section profile from available metadata.
 * Lightweight alternative to the async resolveSectionProfile() for cases
 * where only sectionName/sectionSlug are available (not TestRail API).
 */
function resolveSectionProfileSync(sectionName, sectionSlug, sectionId) {
    if (sectionSlug?.trim()) {
        return {
            sectionSlug: normalizeSectionSlug(sectionSlug),
            sectionName,
            sectionId,
            source: "qa_lab",
        };
    }
    if (sectionName?.trim()) {
        return {
            sectionSlug: normalizeSectionSlug(sectionName),
            sectionName,
            sectionId,
            source: "scenario",
        };
    }
    // No real section: return undefined slug. Downstream will use "default-section".
    return {
        sectionSlug: undefined,
        source: "default",
    };
}
function resolveCaseSpecOutputPath(appSlug, caseSlug, sectionSlug, outputRoot) {
    const root = outputRoot ?? ".";
    const appDir = node_path_1.default.join(root, "automations", "apps", appSlug);
    const sectionsDir = node_path_1.default.join(appDir, "sections");
    const effectiveSection = sectionSlug && sectionSlug !== "default-section" ? normalizeSectionSlug(sectionSlug) : "default-section";
    const sectionDir = node_path_1.default.join(sectionsDir, effectiveSection);
    const caseDir = node_path_1.default.join(sectionDir, "cases", caseSlug);
    return {
        specPath: node_path_1.default.join(caseDir, "case.spec.ts"),
        metaPath: node_path_1.default.join(caseDir, "case.meta.json"),
        caseDir,
        sectionsDir,
    };
}
async function resolveProjectNameFromTestRail(options) {
    try {
        const baseApiUrl = `${options.baseUrl}/index.php?/api/v2`;
        const authHeader = `Basic ${Buffer.from(`${options.email}:${options.apiKey}`).toString("base64")}`;
        const response = await fetch(`${baseApiUrl}/get_project/${options.projectId}`, {
            headers: { Authorization: authHeader }
        });
        if (!response.ok)
            return null;
        const project = await response.json();
        return project.name || null;
    }
    catch {
        return null;
    }
}
async function resolveAppProfile(options) {
    const now = new Date().toISOString();
    let appSlug;
    let source;
    let projectId;
    let projectName;
    if (options.cliAppSlug?.trim()) {
        appSlug = normalizeAppSlug(options.cliAppSlug);
        source = "cli";
    }
    else if (options.envAppSlug?.trim()) {
        appSlug = normalizeAppSlug(options.envAppSlug);
        source = "env";
    }
    else if (options.testRailProjectId) {
        const projectNameResolved = await resolveProjectNameFromTestRail({
            projectId: options.testRailProjectId,
            baseUrl: options.testRailBaseUrl || "",
            email: options.testRailEmail || "",
            apiKey: options.testRailApiKey || ""
        });
        if (projectNameResolved) {
            appSlug = normalizeAppSlug(projectNameResolved);
            source = "testrail_project";
            projectId = options.testRailProjectId;
            projectName = projectNameResolved;
        }
        else {
            appSlug = "default";
            source = "default";
        }
    }
    else {
        appSlug = "default";
        source = "default";
    }
    const baseDir = node_path_1.default.join(APPS_ROOT, appSlug);
    const profile = {
        appSlug,
        source,
        name: options.appName || projectName || undefined,
        baseUrl: options.baseUrl,
        baseUrlHash: options.baseUrl ? node_crypto_1.default.createHash("sha256").update(options.baseUrl).digest("hex").slice(0, 12) : undefined,
        projectId,
        projectName,
        createdAt: now,
        updatedAt: now
    };
    return { profile, baseDir };
}
async function resolveSectionProfile(options) {
    const now = new Date().toISOString();
    let sectionSlug;
    let source;
    let sectionId;
    let sectionName;
    if (options.cliSectionSlug?.trim()) {
        sectionSlug = normalizeSectionSlug(options.cliSectionSlug);
        source = "cli";
    }
    else if (options.envSectionId) {
        // Could fetch section name from TestRail API if needed
        sectionSlug = `section-${options.envSectionId}`;
        source = "env";
        sectionId = options.envSectionId;
    }
    else if (options.testCaseSectionId) {
        sectionSlug = `section-${options.testCaseSectionId}`;
        source = "testrail_case";
        sectionId = options.testCaseSectionId;
        sectionName = options.testCaseSectionName;
        // If we have section name, use it for a more readable slug
        if (options.testCaseSectionName) {
            sectionSlug = normalizeSectionSlug(options.testCaseSectionName);
        }
    }
    else if (options.testCaseSectionName?.trim()) {
        sectionSlug = normalizeSectionSlug(options.testCaseSectionName);
        source = "scenario";
        sectionName = options.testCaseSectionName;
    }
    else {
        sectionSlug = "default-section";
        source = "default";
    }
    const sectionProfile = {
        sectionSlug,
        source,
        sectionId,
        sectionName,
        createdAt: now,
        updatedAt: now
    };
    return { sectionProfile };
}
async function ensureAppStructure(baseDir, sectionSlug) {
    const created = [];
    await promises_1.default.mkdir(baseDir, { recursive: true });
    for (const subdir of APP_SUBDIRS) {
        const dirPath = node_path_1.default.join(baseDir, subdir);
        try {
            await promises_1.default.access(dirPath);
        }
        catch {
            await promises_1.default.mkdir(dirPath, { recursive: true });
            created.push(subdir);
        }
    }
    // Always create section folders when a sectionSlug is provided (including "default-section")
    // This ensures new promotions always go to sections/<slug>/cases/, never to root cases/
    if (sectionSlug) {
        const sectionsDir = node_path_1.default.join(baseDir, "sections");
        const sectionDir = node_path_1.default.join(sectionsDir, sectionSlug);
        const sectionSubdirs = ["cases", "evidence", "runs"];
        await promises_1.default.mkdir(sectionsDir, { recursive: true });
        for (const subdir of sectionSubdirs) {
            const dirPath = node_path_1.default.join(sectionDir, subdir);
            try {
                await promises_1.default.access(dirPath);
            }
            catch {
                await promises_1.default.mkdir(dirPath, { recursive: true });
                created.push(`sections/${sectionSlug}/${subdir}`);
            }
        }
        console.log(`[app-structure] ensured section path ${sectionDir}`);
    }
    const defaultAppDir = node_path_1.default.resolve(__dirname, "../../automations/apps/default");
    for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.flows) {
        const targetPath = node_path_1.default.join(baseDir, "flows", fileName);
        const sourcePath = node_path_1.default.join(defaultAppDir, "flows", fileName);
        try {
            await promises_1.default.access(targetPath);
        }
        catch {
            try {
                await promises_1.default.copyFile(sourcePath, targetPath);
                created.push(`flows/${fileName}`);
            }
            catch {
                console.warn(`[ensureAppStructure] Missing framework flow file: ${sourcePath}`);
            }
        }
    }
    for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.pages) {
        const targetPath = node_path_1.default.join(baseDir, "pages", fileName);
        const sourcePath = node_path_1.default.join(defaultAppDir, "pages", fileName);
        try {
            await promises_1.default.access(targetPath);
        }
        catch {
            try {
                await promises_1.default.copyFile(sourcePath, targetPath);
                created.push(`pages/${fileName}`);
            }
            catch {
                console.warn(`[ensureAppStructure] Missing framework page file: ${sourcePath}`);
            }
        }
    }
    for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.components) {
        const targetPath = node_path_1.default.join(baseDir, "components", fileName);
        const sourcePath = node_path_1.default.join(defaultAppDir, "components", fileName);
        try {
            await promises_1.default.access(targetPath);
        }
        catch {
            try {
                await promises_1.default.copyFile(sourcePath, targetPath);
                created.push(`components/${fileName}`);
            }
            catch {
                console.warn(`[ensureAppStructure] Missing framework component file: ${sourcePath}`);
            }
        }
    }
    await registerFrameworkPageObjects(baseDir);
    return created;
}
async function registerFrameworkPageObjects(baseDir) {
    const normalizedBase = baseDir.replace(/\\/g, "/").toLowerCase();
    if (normalizedBase.includes(".tmp-test") || normalizedBase.includes("test-results") || normalizedBase.includes("tmpdir") || normalizedBase.includes(".artifacts/tmp")) {
        return;
    }
    const appSlug = node_path_1.default.basename(baseDir);
    const appDirMarker = `${node_path_1.default.sep}automations${node_path_1.default.sep}apps${node_path_1.default.sep}`;
    const appDirIndex = baseDir.lastIndexOf(appDirMarker);
    const isStandardAppDir = appDirIndex >= 0;
    let registry;
    let saveRegistry;
    if (isStandardAppDir) {
        const { loadPageObjectRegistry, savePageObjectRegistry } = await Promise.resolve().then(() => __importStar(require("./page-object-registry")));
        const appProfile = {
            appSlug,
            source: "default",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const outputRoot = baseDir.slice(0, appDirIndex);
        registry = await loadPageObjectRegistry(appProfile, outputRoot);
        saveRegistry = async () => savePageObjectRegistry(registry, appProfile, outputRoot);
    }
    else {
        const indexPath = node_path_1.default.join(baseDir, "page-objects.index.json");
        try {
            const raw = await promises_1.default.readFile(indexPath, "utf-8");
            registry = JSON.parse(raw);
        }
        catch {
            registry = { version: "1.0", appSlug, pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
        }
        saveRegistry = async () => {
            await promises_1.default.mkdir(baseDir, { recursive: true });
            const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
            await promises_1.default.writeFile(tempPath, JSON.stringify(registry, null, 2), "utf-8");
            await promises_1.default.rename(tempPath, indexPath).catch(async () => {
                await promises_1.default.rm(indexPath, { force: true }).catch(() => undefined);
                await promises_1.default.rename(tempPath, indexPath);
            });
        };
    }
    const frameworkPageObjects = [
        {
            id: "po_framework_productlistpage",
            className: "ProductListPage",
            filePath: `automations/apps/${appSlug}/pages/productlist.page.ts`,
            screenSignature: `screen:${appSlug}-product_list`,
            methods: [
                { name: "selectProduct", intent: "select_product", parameters: ["productName"], available: true, status: "active", sensitive: false, confidence: 1.0, source: "" },
                { name: "selectFirstVisibleCard", intent: "select_first_visible_card", parameters: [], available: true, status: "active", sensitive: false, confidence: 1.0, source: "" }
            ],
            confidence: 1.0,
            status: "active",
            sourcePlanIds: [],
            caseIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        },
        {
            id: "po_framework_operationsmenupage",
            className: "OperationsMenuPage",
            filePath: `automations/apps/${appSlug}/pages/operationsmenu.page.ts`,
            screenSignature: `screen:${appSlug}-operations_menu`,
            methods: [
                { name: "openModule", intent: "open_module", parameters: ["moduleName"], available: true, status: "active", sensitive: false, confidence: 1.0, source: "" },
                { name: "expectModuleVisible", intent: "expect_loaded", parameters: ["moduleName"], available: true, status: "active", sensitive: false, confidence: 1.0, source: "" }
            ],
            confidence: 1.0,
            status: "active",
            sourcePlanIds: [],
            caseIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    ];
    for (const po of frameworkPageObjects) {
        const existing = registry.pageObjects.find((p) => p.className === po.className);
        if (!existing) {
            registry.pageObjects.push(po);
        }
    }
    registry.updatedAt = new Date().toISOString();
    await saveRegistry();
}
function validateAuthFlowDependencies(baseDir) {
    const missing = [];
    for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.flows) {
        const targetPath = node_path_1.default.join(baseDir, "flows", fileName);
        try {
            node_fs_1.default.accessSync(targetPath);
        }
        catch {
            missing.push(`flows/${fileName}`);
        }
    }
    for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.pages) {
        const targetPath = node_path_1.default.join(baseDir, "pages", fileName);
        try {
            node_fs_1.default.accessSync(targetPath);
        }
        catch {
            missing.push(`pages/${fileName}`);
        }
    }
    for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.components) {
        const targetPath = node_path_1.default.join(baseDir, "components", fileName);
        try {
            node_fs_1.default.accessSync(targetPath);
        }
        catch {
            missing.push(`components/${fileName}`);
        }
    }
    return { valid: missing.length === 0, missing };
}
function logAppProfile(profile, baseDir, ensured) {
    const ensuredStr = ensured ? ensured.join(", ") : "pages, flows, cases, lib";
    console.log(`[app-profile] appSlug=${profile.appSlug} source=${profile.source} baseDir=${baseDir}`);
    if (profile.source === "testrail_project" && profile.projectId) {
        console.log(`[app-profile] projectId=${profile.projectId} projectName="${profile.projectName || ""}"`);
    }
    console.log(`[app-profile] ensured structure: ${ensuredStr}`);
}
function inferNameFromBaseUrl(baseUrl) {
    if (!baseUrl)
        return undefined;
    try {
        const parsed = new URL(baseUrl);
        const host = parsed.hostname.replace(/^www\./i, "");
        const parts = host.split(".").filter(Boolean);
        if (parts.length === 0)
            return undefined;
        const candidate = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        return candidate ? candidate.replace(/[-_]+/g, " ") : undefined;
    }
    catch {
        return undefined;
    }
}
function deriveSlugFromBaseUrl(baseUrl) {
    if (!baseUrl)
        return "default";
    try {
        const parsed = new URL(baseUrl);
        const host = parsed.hostname.replace(/^www\./i, "");
        const parts = host.split(".").filter(Boolean);
        const candidate = parts.length >= 2 ? parts[parts.length - 2] : host;
        return normalizeAppSlug(candidate);
    }
    catch {
        return "default";
    }
}
function deriveAppProfile(input) {
    const now = input.now ?? new Date().toISOString();
    const slug = input.appProfile?.trim()
        ? normalizeAppSlug(input.appProfile)
        : input.appName?.trim()
            ? normalizeAppSlug(input.appName)
            : deriveSlugFromBaseUrl(input.baseUrl);
    const resolvedName = input.appName?.trim() || inferNameFromBaseUrl(input.baseUrl);
    return {
        appSlug: slug || "default",
        source: "default",
        name: resolvedName,
        baseUrl: input.baseUrl,
        baseUrlHash: input.baseUrl ? node_crypto_1.default.createHash("sha256").update(input.baseUrl).digest("hex").slice(0, 12) : undefined,
        createdAt: now,
        updatedAt: now
    };
}
function getPromotedAppDirectory(appProfile, outputRoot) {
    return node_path_1.default.join(outputRoot ?? ".", "automations", "apps", appProfile.appSlug);
}
function buildAppAutomationPaths(appProfile, automationId, outputRoot, sectionSlug) {
    const appDir = getPromotedAppDirectory(appProfile, outputRoot);
    // Always use sections/<section>/... paths. Never write to root cases/ dir.
    // Legacy root cases/ is only for reading existing promoted specs.
    const section = sectionSlug && sectionSlug !== "default-section" ? sectionSlug : "default-section";
    const casesDir = node_path_1.default.join(appDir, "sections", section, "cases");
    const plansDir = node_path_1.default.join(appDir, "sections", section, "plans");
    const specsDir = node_path_1.default.join(appDir, "sections", section, "specs");
    const evidenceDir = node_path_1.default.join(appDir, "sections", section, "evidence");
    const runsDir = node_path_1.default.join(appDir, "sections", section, "runs");
    const pagesDir = node_path_1.default.join(appDir, "pages");
    const componentsDir = node_path_1.default.join(appDir, "components");
    const flowsDir = node_path_1.default.join(appDir, "flows");
    const caseDir = automationId ? node_path_1.default.join(casesDir, automationId) : undefined;
    return {
        appDir,
        configPath: node_path_1.default.join(appDir, "app.config.json"),
        testDataRefsPath: node_path_1.default.join(appDir, "test-data.refs.json"),
        indexPath: node_path_1.default.join(appDir, "index.json"),
        pageObjectsIndexPath: node_path_1.default.join(appDir, "page-objects.index.json"),
        flowsIndexPath: node_path_1.default.join(appDir, "flows.index.json"),
        pagesDir,
        componentsDir,
        flowsDir,
        casesDir,
        caseDir,
        caseConfigPath: caseDir ? node_path_1.default.join(caseDir, "case.json") : undefined,
        caseAutomationPath: caseDir ? node_path_1.default.join(caseDir, "automation.json") : undefined,
        caseEvidenceDir: caseDir ? node_path_1.default.join(caseDir, "evidence") : undefined,
        caseRunsDir: caseDir ? node_path_1.default.join(caseDir, "runs") : undefined,
        plansDir,
        specsDir,
        evidenceDir,
        runsDir,
        planPath: caseDir ? node_path_1.default.join(caseDir, "plan.json") : undefined,
        specPath: caseDir ? node_path_1.default.join(caseDir, "case.spec.ts") : undefined
    };
}
function buildTestDataRefs(testData) {
    const refs = {};
    for (const key of Object.keys(testData)) {
        refs[key] = `APP_TEST_DATA_JSON.${key}`;
    }
    return refs;
}
function shouldPersistSensitiveValue(key) {
    const normalized = normalizeText(key);
    return !SENSITIVE_KEY_HINTS.some((hint) => normalized.includes(hint));
}
function sanitizeExtraLoginFields(extraLoginFields) {
    if (!extraLoginFields)
        return undefined;
    const sanitized = {};
    for (const [key, value] of Object.entries(extraLoginFields)) {
        sanitized[key] = shouldPersistSensitiveValue(key) ? value : "__REDACTED__";
    }
    return sanitized;
}
function serializeRuntimeConfigForPromotion(config, existingConfig) {
    const profile = deriveAppProfile({
        appProfile: config.app.appProfile,
        appName: config.app.name,
        baseUrl: config.app.baseUrl
    });
    return {
        appProfile: { ...profile, ignoreHTTPSErrors: config.app.ignoreHTTPSErrors },
        baseUrl: config.app.baseUrl,
        loginMode: config.app.loginMode,
        testData: config.app.testData,
        testDataAliases: config.app.testDataAliases,
        testDataRefs: buildTestDataRefs(config.app.testData),
        username: config.app.username,
        password: config.app.password,
        usernameRef: config.app.username ? "APP_USERNAME" : undefined,
        passwordRef: config.app.password ? "APP_PASSWORD" : undefined,
        extraLoginFields: sanitizeExtraLoginFields(config.app.extraLoginFields),
        missingInputBehavior: config.app.missingInputBehavior,
        ignoreHTTPSErrors: config.app.ignoreHTTPSErrors,
        // Preserve routeProfile from existing config if available
        routeProfile: existingConfig?.routeProfile,
        updatedAt: new Date().toISOString()
    };
}
function buildMergedConfig(appConfig, globalConfig) {
    const ignoreHTTPSErrors = appConfig.ignoreHTTPSErrors !== undefined
        ? appConfig.ignoreHTTPSErrors
        : globalConfig.app.ignoreHTTPSErrors;
    const mergedApp = {
        ...globalConfig.app,
        name: appConfig.appProfile.name ?? globalConfig.app.name,
        appProfile: appConfig.appProfile.appSlug,
        baseUrl: appConfig.baseUrl,
        loginMode: appConfig.loginMode,
        username: appConfig.username ?? globalConfig.app.username,
        password: appConfig.password ?? globalConfig.app.password,
        extraLoginFields: appConfig.extraLoginFields,
        testData: appConfig.testData,
        testDataAliases: appConfig.testDataAliases,
        missingInputBehavior: appConfig.missingInputBehavior,
        ignoreHTTPSErrors
    };
    return {
        ...globalConfig,
        app: mergedApp
    };
}
function loadPromotedAppConfigSync(options) {
    const appProfile = {
        appSlug: normalizeAppSlug(options.appSlug),
        source: "default",
        createdAt: "",
        updatedAt: ""
    };
    const paths = buildAppAutomationPaths(appProfile);
    const configPath = options.configPath ?? paths.configPath;
    for (let attempt = 0; attempt <= APP_PROFILE_IO_RETRIES; attempt += 1) {
        try {
            const raw = node_fs_1.default.readFileSync(configPath, "utf-8");
            return JSON.parse(raw);
        }
        catch (error) {
            if (isMissingFileError(error)) {
                return undefined;
            }
            if (isTransientFsError(error) && attempt < APP_PROFILE_IO_RETRIES) {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, APP_PROFILE_IO_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            return undefined;
        }
    }
    return undefined;
}
function loadRouteProfile(appSlug, routeProfileNameOrExplicit) {
    // If routeProfileNameOrExplicit is already a normalized object, return it.
    if (routeProfileNameOrExplicit && typeof routeProfileNameOrExplicit === "object" && !Array.isArray(routeProfileNameOrExplicit)) {
        const normalized = normalizeRouteProfileConfig({ routeProfile: routeProfileNameOrExplicit }, appSlug);
        if (normalized) {
            const name = routeProfileNameOrExplicit.name || "explicit";
            console.log(`[route-profile] appSlug=${appSlug} source=app_config routeProfile=${name}`);
            return normalized;
        }
    }
    // Load app config
    const config = loadPromotedAppConfigSync({ appSlug });
    let selectedProfile = undefined;
    let source = "app_config";
    let profileName = "default";
    // Check 1: routeProfileNameOrExplicit is a string (could be name of profile or JSON string)
    if (typeof routeProfileNameOrExplicit === "string" && routeProfileNameOrExplicit.trim()) {
        const trimmed = routeProfileNameOrExplicit.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                const parsed = JSON.parse(trimmed);
                const normalized = normalizeRouteProfileConfig({ routeProfile: parsed }, appSlug);
                if (normalized) {
                    const name = parsed.name || "explicit";
                    console.log(`[route-profile] appSlug=${appSlug} source=app_config routeProfile=${name}`);
                    return normalized;
                }
            }
            catch (e) {
                // ignore JSON parse error, treat as string name
            }
        }
        // Try finding in appConfig.routeProfiles[name]
        const routeProfiles = config?.routeProfiles;
        if (routeProfiles && typeof routeProfiles === "object" && routeProfiles[trimmed]) {
            selectedProfile = routeProfiles[trimmed];
            profileName = trimmed;
        }
        else if (config?.routeProfile && typeof config.routeProfile === "object" && config.routeProfile.name === trimmed) {
            selectedProfile = config.routeProfile;
            profileName = trimmed;
        }
    }
    // Check 2: Try to fall back to the active route profile in app config
    if (!selectedProfile && config) {
        const activeName = config.activeRouteProfileName;
        const routeProfiles = config.routeProfiles;
        if (activeName && routeProfiles && typeof routeProfiles === "object" && routeProfiles[activeName]) {
            selectedProfile = routeProfiles[activeName];
            profileName = activeName;
        }
        else if (config.routeProfile) {
            selectedProfile = config.routeProfile;
            profileName = config.routeProfile.name || "default";
        }
    }
    if (selectedProfile) {
        const normalized = normalizeRouteProfileConfig({ routeProfile: selectedProfile }, appSlug);
        if (normalized) {
            console.log(`[route-profile] appSlug=${appSlug} source=app_config routeProfile=${profileName}`);
            return normalized;
        }
    }
    console.log(`[route-profile] appSlug=${appSlug} no routeProfile resolved, returning undefined`);
    return undefined;
}
/**
 * Normalize routeProfile from app.config.json to standard AppRouteProfile format.
 *
 * Supports two formats:
 *
 * A) app.config.json with routeProfile object:
 * {
 *   "appSlug": "kiosko",
 *   "routeProfile": {
 *     "name": "product_information",
 *     "entry": [],
 *   "aliases": {},
 *     "intermediates": {},
 *     "domainTerms": {}
 *   }
 * }
 *
 * B) routeProfile standalone flat:
 * {
 *   "appSlug": "kiosko",
 *   "routeProfile": "product_information",
 *   "entry": [],
 *   "aliases": {},
 *   "intermediates": {},
 *   "domainTerms": {}
 * }
 */
function normalizeRouteProfileConfig(config, appSlug) {
    const routeProfile = config.routeProfile;
    if (!routeProfile) {
        return undefined;
    }
    // Format A: routeProfile is already an object
    if (typeof routeProfile === "object" && !Array.isArray(routeProfile)) {
        const normalized = {
            entryPoints: routeProfile.entry ?? routeProfile.entryPoints ?? [],
            aliases: routeProfile.aliases ?? {},
            domainTerms: normalizeDomainTerms(routeProfile.domainTerms),
            blockedLabels: routeProfile.blockedLabels ?? [],
            submitLikeLabels: routeProfile.submitLikeLabels ?? []
        };
        // Convert intermediates to routes if routes not present
        if (routeProfile.routes) {
            normalized.routes = routeProfile.routes;
        }
        else if (routeProfile.intermediates) {
            normalized.routes = convertIntermediatesToRoutes(routeProfile.intermediates);
        }
        const source = "app_config_object";
        const loggedAppSlug = config.appProfile?.appSlug ?? appSlug ?? "unknown";
        console.log(`[route-profile] normalized appSlug=${loggedAppSlug} source=${source} domainTerms=${normalized.domainTerms?.length ?? 0} routes=${normalized.routes?.length ?? 0}`);
        return normalized;
    }
    // Format B: routeProfile is a string (standalone flat format)
    if (typeof routeProfile === "string") {
        const normalized = {
            entryPoints: config.entry ?? config.entryPoints ?? [],
            aliases: config.aliases ?? {},
            domainTerms: normalizeDomainTerms(config.domainTerms),
            blockedLabels: config.blockedLabels ?? [],
            submitLikeLabels: config.submitLikeLabels ?? []
        };
        // Convert intermediates to routes if routes not present
        if (config.routes) {
            normalized.routes = config.routes;
        }
        else if (config.intermediates) {
            normalized.routes = convertIntermediatesToRoutes(config.intermediates);
        }
        const source = "standalone_flat";
        const loggedAppSlug = config.appProfile?.appSlug ?? appSlug ?? "unknown";
        console.log(`[route-profile] normalized appSlug=${loggedAppSlug} source=${source} domainTerms=${normalized.domainTerms?.length ?? 0} routes=${normalized.routes?.length ?? 0}`);
        return normalized;
    }
    return undefined;
}
/**
 * Normalize domainTerms from various formats to string array.
 * Supports: string[], Record<string, any>, or undefined
 */
function normalizeDomainTerms(domainTerms) {
    if (!domainTerms) {
        return [];
    }
    if (Array.isArray(domainTerms)) {
        const unique = Array.from(new Set(domainTerms.filter(t => typeof t === "string")));
        return unique;
    }
    if (typeof domainTerms === "object") {
        // Record<string, any> - extract keys or values
        const entries = Object.entries(domainTerms);
        if (entries.length > 0) {
            // If values are strings, use values; otherwise use keys
            const firstValue = entries[0][1];
            let result;
            if (typeof firstValue === "string") {
                result = Object.values(domainTerms).filter(v => typeof v === "string");
            }
            else {
                result = Object.keys(domainTerms);
            }
            // Deduplicate
            const unique = Array.from(new Set(result));
            return unique;
        }
    }
    return [];
}
/**
 * Convert intermediates object to routes array.
 *
 * Input: { "Tarjetas": ["Tarjeta de Crédito", "Tarjeta de Débito"], ... }
 * Output: [{ from: "Tarjetas", intermediates: ["Tarjeta de Crédito", "Tarjeta de Débito"] }, ...]
 */
function convertIntermediatesToRoutes(intermediates) {
    if (!intermediates || typeof intermediates !== "object") {
        return [];
    }
    return Object.entries(intermediates).map(([from, intermediatesList]) => ({
        from,
        intermediates: Array.isArray(intermediatesList) ? intermediatesList : [],
        domain: undefined
    }));
}
async function savePromotedAppConfig(config, outputRoot) {
    const paths = buildAppAutomationPaths(config.appProfile, undefined, outputRoot);
    await promises_1.default.mkdir(paths.appDir, { recursive: true });
    await promises_1.default.mkdir(paths.pagesDir, { recursive: true });
    await promises_1.default.mkdir(paths.componentsDir, { recursive: true });
    await promises_1.default.mkdir(paths.flowsDir, { recursive: true });
    await promises_1.default.mkdir(paths.casesDir, { recursive: true });
    await promises_1.default.mkdir(paths.plansDir, { recursive: true });
    await promises_1.default.mkdir(paths.specsDir, { recursive: true });
    await promises_1.default.mkdir(paths.evidenceDir, { recursive: true });
    await promises_1.default.mkdir(paths.runsDir, { recursive: true });
    await writeFileAtomicWithRetry(paths.configPath, JSON.stringify(config, null, 2));
    await writeFileAtomicWithRetry(paths.testDataRefsPath, JSON.stringify(config.testDataRefs, null, 2));
}
function redactPromotedAppConfigForLogs(config) {
    return {
        appProfile: config.appProfile,
        baseUrl: config.baseUrl,
        loginMode: config.loginMode,
        testDataKeys: Object.keys(config.testData),
        testDataAliases: config.testDataAliases,
        usernameRef: config.usernameRef,
        passwordRef: config.passwordRef,
        hasUsername: Boolean(config.username),
        hasPassword: Boolean(config.password),
        missingInputBehavior: config.missingInputBehavior,
        updatedAt: config.updatedAt
    };
}
