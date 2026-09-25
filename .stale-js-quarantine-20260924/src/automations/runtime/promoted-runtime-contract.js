"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePromotedSpecRuntimeContract = validatePromotedSpecRuntimeContract;
exports.collectPromotedSpecs = collectPromotedSpecs;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
function detectStrategy(specContent) {
    if (specContent.includes(`PROMOTED_SPEC_STRATEGY = "pom_runtime"`))
        return "pom_runtime";
    if (specContent.includes(`PROMOTED_SPEC_STRATEGY = "inline_executor"`))
        return "inline_executor";
    return "unknown";
}
function hasAnyRuntimeHelper(specContent) {
    return [
        "clickPromotedTarget(",
        "fillPromotedField(",
        "expectPromotedVisible(",
        "selectPromotedItem("
    ].some((token) => specContent.includes(token));
}
function looksLikePromotedActionSpec(specContent) {
    return specContent.includes("[target:") || specContent.includes("await promotedRuntime.");
}
function detectFillValueLiteralFieldNameAntiPattern(specContent) {
    const errors = [];
    const fillPromotedFieldRegex = /fillPromotedField\(\{\s*stepIndex:\s*\d+,\s*field:\s*'([^']+)',\s*value:\s*String\(([^)]+)\),[^}]*fill:\s*async\s*\(\)\s*=>\s*\{\s*await\s+\w+\.\w+\([^}]+\}\s*\}\)/g;
    let match;
    while ((match = fillPromotedFieldRegex.exec(specContent)) !== null) {
        const fieldName = match[1];
        const valueVar = match[2];
        const fullCall = match[0];
        const fillMethodMatch = fullCall.match(/await\s+\w+\.\w+\(\s*'([^']+)',\s*'([^']+)'\s*\)/);
        if (fillMethodMatch) {
            const firstArg = fillMethodMatch[1];
            const secondArg = fillMethodMatch[2];
            if (firstArg === fieldName && secondArg === fieldName) {
                errors.push(`PROMOTED_FILL_VALUE_LITERAL_FIELD_NAME: fillPromotedField field="${fieldName}" has callback fill('${firstArg}', '${secondArg}') where second arg equals field name instead of using value variable "${valueVar}"`);
            }
        }
    }
    return errors;
}
function detectUnusedRequirePromotedData(specContent) {
    const warnings = [];
    const declaredVars = new Set();
    const usedVars = new Set();
    const declareRegex = /const\s+(\w+)\s*=\s*requirePromotedData\(/g;
    let match;
    while ((match = declareRegex.exec(specContent)) !== null) {
        declaredVars.add(match[1]);
    }
    const usageRegex = /\b(\w+)\b(?!\s*=)/g;
    while ((match = usageRegex.exec(specContent)) !== null) {
        const varName = match[1];
        if (declaredVars.has(varName)) {
            usedVars.add(varName);
        }
    }
    for (const declaredVar of declaredVars) {
        if (!usedVars.has(declaredVar)) {
            warnings.push(`UNUSED_PROMOTED_DATA_VAR: Variable "${declaredVar}" declared with requirePromotedData but not used`);
        }
    }
    return warnings;
}
async function validatePhysicalPageObjectCalls(specPath, specContent) {
    const errors = [];
    const imports = [...specContent.matchAll(/import\s*\{\s*([A-Za-z_]\w*)\s*\}\s*from\s*['"]([^'"]*pages\/[^'"]+)['"]/g)];
    for (const [, className, importPath] of imports) {
        const instanceMatch = specContent.match(new RegExp(`const\\s+([A-Za-z_]\\w*)\\s*=\\s*new\\s+${className}\\s*\\(`));
        if (!instanceMatch)
            continue;
        const instanceName = instanceMatch[1];
        const moduleBase = node_path_1.default.resolve(node_path_1.default.dirname(specPath), importPath);
        let modulePath;
        for (const candidate of [moduleBase, `${moduleBase}.ts`, `${moduleBase}.tsx`, `${moduleBase}.js`]) {
            try {
                await promises_1.default.access(candidate);
                modulePath = candidate;
                break;
            }
            catch { /* try next extension */ }
        }
        if (!modulePath) {
            errors.push(`physical_pom_module_missing:${className}:${importPath}`);
            continue;
        }
        const moduleSource = await promises_1.default.readFile(modulePath, "utf-8");
        const methodNames = new Set();
        const methodRegex = /(?:async\s+)?(?:public\s+|private\s+|protected\s+)?([A-Za-z_]\w*)\s*\(/g;
        for (const method of moduleSource.matchAll(methodRegex))
            methodNames.add(method[1]);
        const calls = [...specContent.matchAll(new RegExp(`\\b${instanceName}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\(`, "g"))];
        for (const [, methodName] of calls) {
            if (!methodNames.has(methodName))
                errors.push(`physical_pom_method_missing:${className}.${methodName}`);
        }
    }
    return errors;
}
async function validatePromotedSpecRuntimeContract(specPath, diagnosticsPath) {
    const errors = [];
    const warnings = [];
    let specContent = "";
    try {
        specContent = await promises_1.default.readFile(specPath, "utf-8");
    }
    catch {
        return {
            valid: false,
            strategy: "unknown",
            usesPromotedRuntime: false,
            diagnosticsFound: false,
            errors: [`spec_not_found:${specPath}`],
            warnings
        };
    }
    const strategy = detectStrategy(specContent);
    const usesPromotedRuntime = specContent.includes("createPromotedSpecRuntime(");
    const hasRuntimeHelperUsage = hasAnyRuntimeHelper(specContent);
    let diagnostics;
    let diagnosticsFound = false;
    if (diagnosticsPath) {
        try {
            const raw = await promises_1.default.readFile(diagnosticsPath, "utf-8");
            diagnostics = JSON.parse(raw);
            diagnosticsFound = true;
        }
        catch {
            warnings.push(`diagnostics_missing_or_invalid:${diagnosticsPath}`);
        }
    }
    const currentSpecHash = (0, node_crypto_1.createHash)("sha256").update(specContent).digest("hex");
    const normalizedSpecPath = node_path_1.default.resolve(specPath);
    const normalizedDiagnosticsPath = diagnostics?.specPath ? node_path_1.default.resolve(diagnostics.specPath) : undefined;
    const identityReason = !diagnostics?.specHash || !diagnostics?.specSource || !diagnostics?.specPath
        ? "missing_identity"
        : normalizedDiagnosticsPath !== normalizedSpecPath
            ? "source_mismatch"
            : diagnostics.specHash !== currentSpecHash
                ? "hash_mismatch"
                : "matched";
    const diagnosticsApplicable = identityReason === "matched";
    console.log(`[promotion-diagnostics-identity] matched=${diagnosticsApplicable} reason=${identityReason}`);
    // A stale candidate must not dictate the selected strategy, but an explicit
    // requirement is a runtime safety constraint and remains fail-closed even
    // when its metadata cannot be matched to the current physical spec.
    const selectedStrategy = diagnosticsApplicable ? diagnostics?.selectedStrategy : undefined;
    const requirePomRuntime = diagnostics?.requirePomRuntime === true;
    if (selectedStrategy === "pom") {
        if (strategy !== "pom_runtime") {
            errors.push("diagnostics_pom_but_spec_marker_not_pom_runtime");
        }
        if (!usesPromotedRuntime) {
            errors.push("pom_runtime_missing_createPromotedSpecRuntime");
        }
        if (strategy === "inline_executor") {
            errors.push("pom_runtime_contains_inline_strategy_marker");
        }
        if (looksLikePromotedActionSpec(specContent) && !hasRuntimeHelperUsage) {
            errors.push("pom_runtime_missing_runtime_helper_usage");
        }
    }
    if (selectedStrategy === "inline") {
        if (strategy === "pom_runtime") {
            errors.push("diagnostics_inline_but_spec_marker_pom_runtime");
        }
    }
    if (requirePomRuntime) {
        if (strategy !== "pom_runtime") {
            errors.push("require_pom_runtime_but_spec_not_pom_runtime");
        }
        if (diagnostics?.fallbackUsed === true) {
            errors.push("require_pom_runtime_but_fallback_used");
        }
    }
    if (strategy === "pom_runtime") {
        if (!usesPromotedRuntime) {
            errors.push("spec_marker_pom_runtime_without_runtime_factory");
        }
        if (!hasRuntimeHelperUsage && looksLikePromotedActionSpec(specContent)) {
            errors.push("pom_runtime_strategy_without_runtime_helpers");
        }
    }
    if (strategy === "inline_executor" && selectedStrategy === "pom") {
        errors.push("inline_executor_with_pom_selected_strategy");
    }
    if (selectedStrategy === "pom" && diagnostics?.fallbackUsed) {
        warnings.push("pom_selected_with_fallback_used");
    }
    if (diagnosticsApplicable && selectedStrategy === "pom" && Array.isArray(diagnostics?.blockers) && diagnostics.blockers.length > 0) {
        const fatalBlocker = diagnostics.blockers.some((b) => /missing_|validation_error|unavailable|failed/i.test(b));
        if (fatalBlocker) {
            errors.push("pom_selected_with_fatal_blockers");
        }
    }
    const fillValueErrors = detectFillValueLiteralFieldNameAntiPattern(specContent);
    errors.push(...fillValueErrors);
    errors.push(...await validatePhysicalPageObjectCalls(specPath, specContent));
    const unusedDataWarnings = detectUnusedRequirePromotedData(specContent);
    warnings.push(...unusedDataWarnings);
    return {
        valid: errors.length === 0,
        strategy,
        usesPromotedRuntime,
        diagnosticsFound,
        errors,
        warnings
    };
}
async function collectPromotedSpecs(appSlug) {
    const appsRoot = node_path_1.default.resolve("automations/apps");
    const appDirs = appSlug
        ? [node_path_1.default.join(appsRoot, appSlug)]
        : (await promises_1.default.readdir(appsRoot)).map((d) => node_path_1.default.join(appsRoot, d));
    const rows = [];
    async function collectCaseSpecs(root) {
        let entries;
        try {
            entries = await promises_1.default.readdir(root, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const entryPath = node_path_1.default.join(root, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "spec-generation")
                    continue;
                await collectCaseSpecs(entryPath);
                continue;
            }
            if (entry.name !== "case.spec.ts" && entry.name !== "spec.ts")
                continue;
            const caseDir = node_path_1.default.dirname(entryPath);
            rows.push({
                caseSlug: node_path_1.default.basename(caseDir),
                specPath: entryPath,
                diagnosticsPath: node_path_1.default.join(caseDir, "promotion-diagnostics.json")
            });
        }
    }
    for (const appDir of appDirs)
        await collectCaseSpecs(appDir);
    return rows;
}
