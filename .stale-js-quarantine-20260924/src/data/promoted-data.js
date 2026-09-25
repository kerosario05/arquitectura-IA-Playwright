"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSensitiveDataKey = isSensitiveDataKey;
exports.maskValue = maskValue;
exports.buildPromotedDataManifest = buildPromotedDataManifest;
exports.savePromotedDataManifestSync = savePromotedDataManifestSync;
exports.loadPromotedDataManifestSync = loadPromotedDataManifestSync;
exports.buildPromotedDataContext = buildPromotedDataContext;
exports.requirePromotedData = requirePromotedData;
exports.toSafeTsVariableName = toSafeTsVariableName;
exports.buildDataKeyVariableMap = buildDataKeyVariableMap;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const auto_test_data_generator_1 = require("./auto-test-data-generator");
const SENSITIVE_HINTS = /(password|pass|secret|token|api[_ -]?key|otp|pin|cvv|card[_ -]?number)/i;
function normalize(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
function isSensitiveDataKey(key) {
    return SENSITIVE_HINTS.test(normalize(key));
}
function maskValue(value, sensitive) {
    if (!value)
        return "";
    if (!sensitive)
        return value.length > 64 ? `${value.slice(0, 16)}...(${value.length})` : value;
    if (value.length <= 4)
        return "***";
    return `${"*".repeat(Math.min(8, value.length - 2))}${value.slice(-2)}`;
}
function inferSource(source) {
    if (!source)
        return "unknown";
    if (source === "explicit_runtime_input")
        return "explicit_runtime_input";
    if (source === "runtime_context")
        return "runtime_context";
    if (source === "environment_variable" || source === "app_username" || source === "app_password")
        return "env";
    if (source === "test_data")
        return "app_test_data";
    if (source === "test_data_alias")
        return "alias";
    if (source === "data_override")
        return "explicit_runtime_input";
    if (source === "auto_generated")
        return "auto_generated";
    if (source === "fixture")
        return "fixture";
    return "unknown";
}
function canPersistValue(entry) {
    if (entry.sensitive)
        return false;
    return entry.demoSafe;
}
function findFieldName(step) {
    if (!step.target || step.target === "APP_BASE_URL")
        return "";
    return step.target.name ?? step.target.value ?? step.target.role ?? "";
}
function dataTypeOf(value) {
    if (typeof value === "string")
        return "string";
    if (typeof value === "number")
        return "number";
    if (typeof value === "boolean")
        return "boolean";
    return "unknown";
}
function buildPromotedDataManifest(plan, dataContext) {
    const entries = [];
    const dataIndex = new Map(dataContext.entries.map((entry) => [normalize(entry.key), entry]));
    const requiredMap = new Map(plan.requiredData.map((item) => [normalize(item.key), item]));
    for (const step of plan.steps) {
        if (step.action !== "fill" && step.action !== "select" && step.action !== "press")
            continue;
        const key = step.valueKey?.trim();
        if (!key)
            continue;
        const ctxEntry = dataIndex.get(normalize(key));
        const requiredRef = requiredMap.get(normalize(key));
        const runtimeOnly = ctxEntry?.source === "explicit_runtime_input" || ctxEntry?.source === "runtime_context";
        const sensitive = runtimeOnly || requiredRef?.sensitive === true || ctxEntry?.sensitive === true || isSensitiveDataKey(key);
        const demoSafe = !sensitive;
        const value = ctxEntry?.value;
        entries.push({
            key,
            source: inferSource(ctxEntry?.source),
            fieldName: findFieldName(step),
            stepIndex: step.index,
            valueType: dataTypeOf(value),
            sensitive,
            demoSafe,
            required: requiredRef?.required ?? true,
            maskedValue: maskValue(value ?? "", sensitive),
            value: value && !runtimeOnly && canPersistValue({ sensitive, demoSafe }) ? value : undefined
        });
    }
    return {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        entries
    };
}
function savePromotedDataManifestSync(filePath, manifest) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
    node_fs_1.default.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf-8");
}
function loadPromotedDataManifestSync(filePath) {
    try {
        const raw = node_fs_1.default.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.entries))
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
const EXPLICIT_RUNTIME_INPUTS_ENV = "PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON";
const RUNTIME_DATA_OVERRIDES_ENV = "PROMOTED_RUNTIME_DATA_OVERRIDES_JSON";
function parseRuntimeDataObject(raw) {
    if (!raw?.trim())
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return Object.fromEntries(Object.entries(parsed)
            .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
            .map(([key, value]) => [key, String(value).trim()]));
    }
    catch {
        return {};
    }
}
function toMap(entries) {
    return new Map(entries.map((entry) => [normalize(entry.key), entry]));
}
function buildPromotedDataContext(options) {
    const map = toMap(options.baseDataContext.entries);
    const hydratedFromManifestKeys = [];
    const generatedFallbackKeys = [];
    const profile = (options.testDataProfile ?? "qa").toLowerCase();
    const allowDemoFallback = options.autoGenerateTestData === true && (profile === "demo" || profile === "ecommerce" || profile === "qa");
    // Runtime-only values are applied after configured/test data and before
    // manifest hydration. Explicit input wins over case context by normalized
    // declared key; neither source is persisted into the promoted manifest.
    const runtimeContext = parseRuntimeDataObject(process.env[RUNTIME_DATA_OVERRIDES_ENV]);
    const explicitRuntime = parseRuntimeDataObject(process.env[EXPLICIT_RUNTIME_INPUTS_ENV]);
    for (const [key, value] of Object.entries(runtimeContext)) {
        map.set(normalize(key), { key, value, source: "runtime_context", sensitive: isSensitiveDataKey(key) });
    }
    for (const [key, value] of Object.entries(explicitRuntime)) {
        map.set(normalize(key), { key, value, source: "explicit_runtime_input", sensitive: isSensitiveDataKey(key) });
    }
    for (const item of options.manifest?.entries ?? []) {
        const nKey = normalize(item.key);
        const existing = map.get(nKey);
        if (!existing && item.value) {
            map.set(nKey, { key: item.key, value: item.value, source: "promoted_manifest", sensitive: item.sensitive });
            hydratedFromManifestKeys.push(item.key);
            continue;
        }
        if (!existing && item.required && allowDemoFallback && item.demoSafe) {
            const generated = (0, auto_test_data_generator_1.autoGenerateTestData)(item.key, item.fieldName, "promoted_spec_hydration", {
                enabled: true,
                profile: profile,
                generateSensitiveData: options.autoGenerateSensitiveData === true
            });
            if (generated.generated && generated.value) {
                map.set(nKey, { key: item.key, value: generated.value, source: "auto_generated", sensitive: Boolean(generated.sensitive) });
                generatedFallbackKeys.push(item.key);
            }
        }
    }
    const entries = Array.from(map.values());
    const sensitiveCount = entries.filter((entry) => entry.sensitive).length;
    return {
        entries,
        counts: {
            total: entries.length,
            sensitive: sensitiveCount,
            nonSensitive: entries.length - sensitiveCount
        },
        diagnostics: {
            hydratedFromManifestKeys,
            generatedFallbackKeys
        }
    };
}
function requirePromotedData(dataContext, key, meta) {
    const nKey = normalize(key);
    const found = dataContext.entries.find((entry) => normalize(entry.key) === nKey);
    if (!found || !found.value || found.value.trim().length === 0) {
        const fieldMeta = meta?.fieldName ? ` field="${meta.fieldName}"` : "";
        const stepMeta = meta?.stepIndex !== undefined ? ` stepIndex=${meta.stepIndex}` : "";
        throw new Error(`Missing required promoted data key "${key}".${fieldMeta}${stepMeta}`.trim());
    }
    return found.value;
}
function toSafeTsVariableName(key) {
    const normalized = key
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.replace(/^[^a-zA-Z_$]+/, ""))
        .filter(Boolean);
    if (normalized.length === 0)
        return "dataValue";
    const [first, ...rest] = normalized;
    const camel = `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`).join("")}`;
    return /^[A-Za-z_$]/.test(camel) ? camel : `data${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}
function buildDataKeyVariableMap(keys) {
    const map = new Map();
    const usedNames = new Map();
    for (const key of keys) {
        if (map.has(key))
            continue;
        const base = toSafeTsVariableName(key);
        const current = usedNames.get(base) ?? 0;
        const name = current === 0 ? base : `${base}${current + 1}`;
        usedNames.set(base, current + 1);
        map.set(key, name);
    }
    return map;
}
