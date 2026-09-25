"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWebAppConfig = buildWebAppConfig;
exports.materializeProjectRuntime = materializeProjectRuntime;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const project_reader_1 = require("./project-reader");
const secret_resolver_1 = require("./secret-resolver");
const LOGIN_MODE_MAP = { 1: "password", 2: "no_login", 3: "manual" };
const MISSING_INPUT_MAP = {
    1: "fail",
    2: "prompt",
    3: "skip",
    4: "auto_generate",
};
function safeParseObject(raw) {
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeJsonAtomic(filePath, data) {
    const dir = path_1.default.dirname(filePath);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    fs_1.default.renameSync(tmpPath, filePath);
}
function buildWebAppConfig(cfg, warnings) {
    const w = cfg.web;
    const appConfig = {
        name: cfg.name,
        baseUrl: w.baseUrl,
        loginMode: LOGIN_MODE_MAP[w.loginMode] ?? w.loginMode,
        testData: safeParseObject(w.testDataJson),
        testDataAliases: safeParseObject(w.testDataAliasesJson),
        missingInputBehavior: MISSING_INPUT_MAP[w.missingInputBehavior] ?? w.missingInputBehavior,
        ignoreHTTPSErrors: w.ignoreHTTPSErrors === true,
    };
    if (w.username)
        appConfig.username = w.username;
    if (w.extraLoginFieldsJson)
        appConfig.extraLoginFields = safeParseObject(w.extraLoginFieldsJson);
    if (w.passwordSecretRef) {
        try {
            appConfig.password = (0, secret_resolver_1.resolveSecretRef)(w.passwordSecretRef);
        }
        catch (err) {
            if (err instanceof secret_resolver_1.SecretResolutionError && err.code === "secret_not_found") {
                warnings.push(`password_secret_not_found:${w.passwordSecretRef}`);
            }
            else {
                warnings.push("secret_resolution_pending");
            }
        }
    }
    return appConfig;
}
function buildMobileAppConfig(cfg) {
    const appConfig = {};
    if (cfg.otp && cfg.otp.enabled) {
        appConfig.otpProfile = {
            strategy: cfg.otp.strategy,
            defaultChannel: cfg.otp.defaultChannel ?? undefined,
            allowedChannels: safeParseArray(cfg.otp.allowedChannelsJson),
            enabledEnvironments: safeParseArray(cfg.otp.enabledEnvironmentsJson),
        };
    }
    return appConfig;
}
function safeParseArray(raw) {
    if (!raw)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function buildMobileConfigFile(cfg) {
    const m = cfg.mobile;
    // Read the existing mobile.config.json if present to preserve rich fields
    // (screens, flows, functionalDataProfiles, executionSignals) that may have been
    // manually configured but are not stored in the SQL MobileConfig schema.
    let existingConfig = {};
    const appDir = path_1.default.join(process.cwd(), "automations", "apps", cfg.slug);
    const configPath = path_1.default.join(appDir, "mobile.config.json");
    try {
        if (fs_1.default.existsSync(configPath)) {
            existingConfig = JSON.parse(fs_1.default.readFileSync(configPath, "utf-8"));
        }
    }
    catch { /* ignore */ }
    return {
        // Always overwrite these from SQL (authoritative source)
        appSlug: cfg.slug,
        packageName: m.packageName,
        appName: m.appName,
        platform: m.platform,
        mainActivity: m.mainActivity,
        ...(m.framework ? { framework: m.framework } : {}),
        // Preserve rich fields from existing config if present
        ...(existingConfig.screens ? { screens: existingConfig.screens } : {}),
        ...(existingConfig.flows ? { flows: existingConfig.flows } : {}),
        ...(existingConfig.functionalDataProfiles ? { functionalDataProfiles: existingConfig.functionalDataProfiles } : {}),
        ...(existingConfig.executionSignals ? { executionSignals: existingConfig.executionSignals } : {}),
        updatedAt: new Date().toISOString(),
    };
}
function toIsoString(v) {
    if (!v)
        return new Date().toISOString();
    return typeof v === "string" ? v : v.toISOString();
}
function buildKnowledgeFile(cfg) {
    let version = cfg.knowledge?.schemaVersion ?? 1;
    let createdAt = toIsoString(cfg.knowledge?.createdAt ?? cfg.createdAt);
    let updatedAt = toIsoString(cfg.knowledge?.updatedAt ?? cfg.updatedAt);
    let items = [];
    if (cfg.knowledge?.knowledgeJson) {
        try {
            const parsed = JSON.parse(cfg.knowledge.knowledgeJson);
            if (parsed && typeof parsed === "object") {
                if (Array.isArray(parsed.items))
                    items = parsed.items;
                if (typeof parsed.version === "number")
                    version = parsed.version;
                if (typeof parsed.createdAt === "string")
                    createdAt = parsed.createdAt;
                if (typeof parsed.updatedAt === "string")
                    updatedAt = parsed.updatedAt;
            }
        }
        catch {
            // keep empty defaults
        }
    }
    return { version, appSlug: cfg.slug, createdAt, updatedAt, items };
}
async function materializeProjectRuntime(identifier) {
    const cfg = identifier.id
        ? await (0, project_reader_1.getProjectConfigurationById)(identifier.id)
        : await (0, project_reader_1.getProjectConfigurationBySlug)(identifier.slug ?? "");
    if (!cfg) {
        const err = new Error("project not found");
        err.code = "project_not_found";
        throw err;
    }
    if (cfg.status !== 1) {
        const err = new Error("project_not_ready");
        err.code = "project_not_ready";
        throw err;
    }
    if (!cfg.enabled) {
        const err = new Error("project_disabled");
        err.code = "project_disabled";
        throw err;
    }
    const appDir = path_1.default.join(process.cwd(), "automations", "apps", cfg.slug);
    const warnings = [];
    const filesWritten = [];
    if (cfg.projectType === 1) {
        if (!cfg.web)
            throw new Error("missing WebProjectConfiguration");
        writeJsonAtomic(path_1.default.join(appDir, "app.config.json"), buildWebAppConfig(cfg, warnings));
        filesWritten.push("app.config.json");
    }
    else if (cfg.projectType === 2) {
        if (!cfg.mobile)
            throw new Error("missing MobileProjectConfiguration");
        writeJsonAtomic(path_1.default.join(appDir, "app.config.json"), buildMobileAppConfig(cfg));
        filesWritten.push("app.config.json");
        writeJsonAtomic(path_1.default.join(appDir, "mobile.config.json"), buildMobileConfigFile(cfg));
        filesWritten.push("mobile.config.json");
    }
    writeJsonAtomic(path_1.default.join(appDir, "app.knowledge.json"), buildKnowledgeFile(cfg));
    filesWritten.push("app.knowledge.json");
    return {
        projectId: cfg.id,
        slug: cfg.slug,
        projectType: cfg.projectType,
        filesWritten,
        warnings,
    };
}
