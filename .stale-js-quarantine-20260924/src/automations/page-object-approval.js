"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArgs = parseArgs;
exports.isMethodAutoApprovable = isMethodAutoApprovable;
exports.isPageObjectAutoApprovable = isPageObjectAutoApprovable;
exports.approvePageObjectCandidates = approvePageObjectCandidates;
exports.autoApproveSafePageObjects = autoApproveSafePageObjects;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const page_object_registry_1 = require("../automations/page-object-registry");
const app_profile_1 = require("../automations/app-profile");
function parseArgs(argv) {
    const args = {
        app: "default",
        only: undefined,
        all: false,
        overwriteActive: false,
        dryRun: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--dry-run") {
            args.dryRun = true;
            continue;
        }
        if (token === "--overwrite-active") {
            args.overwriteActive = true;
            continue;
        }
        if (token === "--all") {
            args.all = true;
            continue;
        }
        if (token === "--app") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --app");
            }
            args.app = nextValue;
            i += 1;
            continue;
        }
        if (token === "--only") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --only");
            }
            args.only = nextValue;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function deriveCandidateFileName(className) {
    const baseName = className.replace(/Page$/, "").toLowerCase().replace(/-/g, "");
    return `${baseName}.page.candidate.ts`;
}
function deriveActiveFileName(className) {
    const baseName = className.replace(/Page$/, "").toLowerCase().replace(/-/g, "");
    return `${baseName}.page.ts`;
}
const SENSITIVE_INTENTS = new Set([
    "login",
    "otp",
    "submit_form",
    "confirm_action",
    "transfer",
    "payment",
    "send",
    "accept_terms"
]);
const SENSITIVE_PARAM_PATTERNS = [
    /password/i,
    /otp/i,
    /secret/i,
    /token/i,
    /ssn/i,
    /document.?number/i,
    /credit.?card/i,
    /cvv/i,
    /pin/i
];
const BLOCKED_LOGIN_SOURCE_PATTERNS = [
    /admin123/i,
    /['"`]admin['"`]/i,
    /\botp\b/i,
    /\bpin\b/i,
    /\btoken\b/i
];
function isMethodAutoApprovable(method, options) {
    if (method.status !== "candidate") {
        return { approvable: false, reason: `status is '${method.status}', not 'candidate'` };
    }
    if (method.sensitive === true && options.blockSensitive) {
        return { approvable: false, reason: "sensitive=true" };
    }
    if (method.confidence < options.confidenceThreshold) {
        return { approvable: false, reason: `confidence ${method.confidence} < threshold ${options.confidenceThreshold}` };
    }
    if (options.blockedIntents?.includes(method.intent)) {
        return { approvable: false, reason: `blocked intent '${method.intent}'` };
    }
    if (SENSITIVE_INTENTS.has(method.intent) && options.blockSensitive) {
        return { approvable: false, reason: `sensitive intent '${method.intent}'` };
    }
    for (const param of method.parameters) {
        for (const pattern of SENSITIVE_PARAM_PATTERNS) {
            if (pattern.test(param)) {
                return { approvable: false, reason: `sensitive parameter '${param}'` };
            }
        }
    }
    return { approvable: true };
}
function isPageObjectAutoApprovable(po, options) {
    const approvableMethods = [];
    const blockedMethods = [];
    for (const method of po.methods) {
        if (method.status === "active" && method.available) {
            continue;
        }
        const check = isMethodAutoApprovable(method, options);
        if (check.approvable) {
            approvableMethods.push(method);
        }
        else {
            blockedMethods.push({ method, reason: check.reason });
        }
    }
    return { approvableMethods, blockedMethods };
}
async function approvePageObjectCandidates(appSlug, outputRoot, options) {
    const appProfile = {
        appSlug,
        source: "default",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)(appProfile, outputRoot);
    const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, undefined, outputRoot);
    const pagesDir = appPaths.pagesDir;
    const result = {
        approved: 0,
        skipped: 0,
        errors: [],
        warnings: [],
        files: []
    };
    const candidates = registry.pageObjects.filter((po) => po.status === "candidate");
    if (options.onlyClassName) {
        const filtered = candidates.filter((po) => po.className === options.onlyClassName);
        if (filtered.length === 0) {
            result.errors.push(`No candidate found with className '${options.onlyClassName}'`);
            return result;
        }
        await processCandidates(filtered, registry, pagesDir, options, result);
    }
    else if (options.approveAll) {
        if (candidates.length === 0) {
            result.warnings.push("No candidates to approve");
            return result;
        }
        await processCandidates(candidates, registry, pagesDir, options, result);
    }
    else {
        result.errors.push("Must specify --only <ClassName> or --all to approve candidates");
        return result;
    }
    if (!options.dryRun && result.approved > 0) {
        await (0, page_object_registry_1.savePageObjectRegistry)(registry, appProfile, outputRoot);
    }
    return result;
}
async function processCandidates(toApprove, registry, pagesDir, options, result) {
    for (const candidate of toApprove) {
        const candidateFileName = deriveCandidateFileName(candidate.className);
        const candidateFilePath = node_path_1.default.join(pagesDir, candidateFileName);
        const activeFilePath = node_path_1.default.join(pagesDir, deriveActiveFileName(candidate.className));
        try {
            try {
                await promises_1.default.access(candidateFilePath);
            }
            catch {
                result.errors.push(`Source candidate file not found: ${candidateFilePath}`);
                result.files.push({ className: candidate.className, status: "error" });
                continue;
            }
            if (!options.overwriteActive) {
                try {
                    await promises_1.default.access(activeFilePath);
                    result.errors.push(`Active Page Object already exists: ${activeFilePath}. Use --overwrite-active to replace.`);
                    result.files.push({ className: candidate.className, status: "error" });
                    continue;
                }
                catch {
                    // No active file, proceed
                }
            }
            const hasSensitiveMethods = candidate.methods.some((m) => m.sensitive === true);
            if (hasSensitiveMethods) {
                result.warnings.push(`Candidate '${candidate.className}' contains sensitive methods. These will be approved as-is.`);
            }
            if (options.dryRun) {
                result.skipped += 1;
                result.files.push({ className: candidate.className, status: "skipped" });
                continue;
            }
            await promises_1.default.mkdir(pagesDir, { recursive: true });
            await promises_1.default.copyFile(candidateFilePath, activeFilePath);
            const now = new Date().toISOString();
            candidate.status = "active";
            candidate.filePath = activeFilePath.replace(/\\/g, "/");
            for (const method of candidate.methods) {
                method.status = "active";
                method.available = true;
            }
            candidate.approvalMetadata = {
                approvedAt: now,
                approvedFrom: candidateFilePath.replace(/\\/g, "/"),
                approvedBy: "page-objects:approve"
            };
            result.approved += 1;
            result.files.push({ className: candidate.className, status: "approved" });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.errors.push(`Failed to approve ${candidate.className}: ${message}`);
            result.files.push({ className: candidate.className, status: "error" });
        }
    }
}
async function autoApproveSafePageObjects(appSlug, outputRoot, options) {
    const appProfile = {
        appSlug,
        source: "default",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)(appProfile, outputRoot);
    const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, undefined, outputRoot);
    const pagesDir = appPaths.pagesDir;
    const result = {
        approved: 0,
        skipped: 0,
        errors: [],
        warnings: [],
        files: [],
        autoApprovedMethods: [],
        blockedAutoApprovals: []
    };
    const confidenceThreshold = options.confidenceThreshold ?? 0.50;
    const blockSensitive = options.blockSensitive ?? true;
    let candidates = registry.pageObjects.filter((po) => po.status === "candidate");
    if (options.onlyClassName) {
        candidates = candidates.filter((po) => po.className === options.onlyClassName);
        if (candidates.length === 0) {
            result.errors.push(`No candidate found with className '${options.onlyClassName}'`);
            return result;
        }
    }
    for (const candidate of candidates) {
        const candidateFileName = deriveCandidateFileName(candidate.className);
        const candidateFilePath = node_path_1.default.join(pagesDir, candidateFileName);
        const activeFilePath = node_path_1.default.join(pagesDir, deriveActiveFileName(candidate.className));
        try {
            try {
                await promises_1.default.access(candidateFilePath);
            }
            catch {
                result.errors.push(`Source candidate file not found: ${candidateFilePath}`);
                result.files.push({ className: candidate.className, status: "error" });
                continue;
            }
            if (candidate.className === "LoginPage") {
                const candidateSource = await promises_1.default.readFile(candidateFilePath, "utf-8");
                const blockedPattern = BLOCKED_LOGIN_SOURCE_PATTERNS.find((pattern) => pattern.test(candidateSource));
                if (blockedPattern) {
                    result.blockedAutoApprovals.push(`${candidate.className}: source blocked by pattern ${blockedPattern}`);
                    result.skipped += 1;
                    result.files.push({ className: candidate.className, status: "skipped" });
                    continue;
                }
            }
            const { approvableMethods, blockedMethods } = isPageObjectAutoApprovable(candidate, {
                confidenceThreshold,
                blockSensitive,
                allowedIntents: options.allowedIntents,
                blockedIntents: options.blockedIntents
            });
            for (const { method, reason } of blockedMethods) {
                result.blockedAutoApprovals.push(`${candidate.className}.${method.name}(): ${reason}`);
            }
            if (approvableMethods.length === 0 &&
                candidate.status === "active" &&
                candidate.methods.every((m) => m.status === "active" && m.available)) {
                result.skipped += 1;
                result.files.push({ className: candidate.className, status: "skipped" });
                continue;
            }
            if (options.dryRun) {
                result.skipped += 1;
                result.files.push({ className: candidate.className, status: "skipped" });
                continue;
            }
            const hasActiveFile = await promises_1.default.access(activeFilePath).then(() => true).catch(() => false);
            if (!hasActiveFile || options.overwriteActive) {
                await promises_1.default.mkdir(pagesDir, { recursive: true });
                await promises_1.default.copyFile(candidateFilePath, activeFilePath);
            }
            const now = new Date().toISOString();
            candidate.filePath = activeFilePath.replace(/\\/g, "/");
            candidate.status = "active";
            for (const method of approvableMethods) {
                method.status = "active";
                method.available = true;
                result.autoApprovedMethods.push(`${candidate.className}.${method.name}()`);
            }
            candidate.approvalMetadata = {
                approvedAt: now,
                approvedFrom: candidateFilePath.replace(/\\/g, "/"),
                approvedBy: "auto-pom",
                autoApproved: true,
                blockedMethods: blockedMethods.map((b) => b.method.name)
            };
            result.approved += 1;
            result.files.push({ className: candidate.className, status: "approved" });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.errors.push(`Failed to auto-approve ${candidate.className}: ${message}`);
            result.files.push({ className: candidate.className, status: "error" });
        }
    }
    if (!options.dryRun && result.approved > 0) {
        await (0, page_object_registry_1.savePageObjectRegistry)(registry, appProfile, outputRoot);
    }
    return result;
}
