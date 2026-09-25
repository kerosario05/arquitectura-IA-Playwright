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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAppSlug = normalizeAppSlug;
exports.normalizeProjectNameToSlug = normalizeProjectNameToSlug;
exports.inferAppFromTestRailSection = inferAppFromTestRailSection;
exports.resolveAppForPreview = resolveAppForPreview;
exports.ensureFunctionalAppProfile = ensureFunctionalAppProfile;
exports.loadAppConfig = loadAppConfig;
exports.getRouteProfileFromConfig = getRouteProfileFromConfig;
exports.getRouteProfilesFromConfig = getRouteProfilesFromConfig;
exports.buildEntrySteps = buildEntrySteps;
exports.detectKioskoInfoProductos = detectKioskoInfoProductos;
exports.seedKioskoInfoProductosRouteProfile = seedKioskoInfoProductosRouteProfile;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const APPS_DIR = path.join(process.cwd(), "automations", "apps");
const PREFIXES_TO_REMOVE = [
    /^regresi[oó]n[\s_]+/i,
    /^regression[\s_]+/i,
    /^detalle[\s_]+/i,
    /^smoke[\s_]+/i,
    /^api\s+tests?[\s_]+/i,
    /^api[\s_]+/i,
    /^pruebas?[\s_]+/i,
    /^automatizaci[oó]n[\s_]+/i,
    /^automatisation[\s_]+/i,
    /^qa[\s_]+/i,
    /^tests?[\s_]+/i,
    /^validaci[oó]n[\s_]+/i,
    /^sanity[\s_]+/i,
];
function stripPrefixes(input) {
    let result = input.trim();
    for (const prefix of PREFIXES_TO_REMOVE) {
        result = result.replace(prefix, "");
    }
    return result.trim();
}
function normalizeAppSlug(input) {
    let slug = input.trim().toLowerCase();
    // Remove accents
    slug = slug.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Replace underscores and spaces with hyphens
    slug = slug.replace(/[_\s]+/g, "-");
    // Remove path traversal characters
    slug = slug.replace(/[/\\]/g, "");
    slug = slug.replace(/\.\./g, "");
    // Keep only a-z, 0-9, and hyphens
    slug = slug.replace(/[^a-z0-9-]/g, "");
    // Remove duplicate hyphens
    slug = slug.replace(/-+/g, "-");
    // Trim hyphens from ends
    slug = slug.replace(/^-+|-+$/g, "");
    return slug;
}
function normalizeProjectNameToSlug(name) {
    let slug = name.trim().toLowerCase();
    slug = slug.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    slug = slug.replace(/[^a-z0-9\s-]/g, "");
    slug = slug.replace(/[\s_]+/g, "-");
    slug = slug.replace(/-+/g, "-");
    slug = slug.replace(/^-+|-+$/g, "");
    return slug;
}
function inferAppFromTestRailSection(sectionName) {
    if (!sectionName || !sectionName.trim())
        return null;
    const stripped = stripPrefixes(sectionName);
    if (!stripped || stripped.length < 2)
        return null;
    const appName = stripped.trim();
    const appSlug = normalizeAppSlug(appName);
    if (!appSlug)
        return null;
    return {
        appName,
        appSlug,
        source: "testrail_section",
        confidence: "high",
        reason: `Detected app from TestRail section name: ${sectionName}`,
    };
}
function resolveAppForPreview(req) {
    // 1. Explicit targetAppSlug
    if (req.targetAppSlug?.trim()) {
        const slug = normalizeAppSlug(req.targetAppSlug.trim());
        return {
            appName: req.targetAppName?.trim() || slug,
            appSlug: slug,
            source: "explicit",
            confidence: "high",
            reason: `Explicit targetAppSlug: ${req.targetAppSlug}`,
        };
    }
    // 2. Explicit targetAppName
    if (req.targetAppName?.trim()) {
        const slug = normalizeAppSlug(req.targetAppName.trim());
        return {
            appName: req.targetAppName.trim(),
            appSlug: slug,
            source: "explicit",
            confidence: "high",
            reason: `Explicit targetAppName: ${req.targetAppName}`,
        };
    }
    // 3. Request appSlug (explicit from request body)
    if (req.requestAppSlug?.trim()) {
        const slug = normalizeAppSlug(req.requestAppSlug.trim());
        return {
            appName: slug,
            appSlug: slug,
            source: "request",
            confidence: "high",
            reason: `Request appSlug: ${req.requestAppSlug}`,
        };
    }
    // TestRail and Jira metadata describe work items, not app identity.
    return {
        appName: "",
        appSlug: "",
        source: "fallback",
        confidence: "low",
        reason: "No app inference source available",
    };
}
function isSafeSlug(slug) {
    if (!slug || slug.length === 0)
        return false;
    if (slug.includes("/") || slug.includes("\\") || slug.includes(".."))
        return false;
    if (!/^[a-z0-9-]+$/.test(slug))
        return false;
    return true;
}
const SUBDIRS = ["pages", "flows", "components", "sections", "lib"];
async function ensureDirExists(dir) {
    try {
        const exists = await fs
            .access(dir)
            .then(() => true)
            .catch(() => false);
        if (!exists) {
            await fs.mkdir(dir, { recursive: true });
            return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
async function ensureFunctionalAppProfile(input) {
    const { appSlug, appName, source, sectionName, testRailProjectId, testRailProjectName } = input;
    if (!isSafeSlug(appSlug)) {
        throw new Error(`Invalid appSlug: ${appSlug}. Path traversal or invalid characters detected.`);
    }
    const appDir = path.join(APPS_DIR, appSlug);
    const appConfigPath = path.join(appDir, "app.config.json");
    // Check if app dir already exists
    const dirExisted = await fs
        .access(appDir)
        .then(() => true)
        .catch(() => false);
    // Create app directory and subdirectories
    let created = false;
    if (!dirExisted) {
        await fs.mkdir(appDir, { recursive: true });
        created = true;
    }
    // Create subdirectories if missing
    for (const sub of SUBDIRS) {
        await ensureDirExists(path.join(appDir, sub));
    }
    // Create index.json if missing
    const indexPath = path.join(appDir, "index.json");
    const indexExists = await fs
        .access(indexPath)
        .then(() => true)
        .catch(() => false);
    if (!indexExists) {
        await fs.writeFile(indexPath, JSON.stringify({ version: "1.0", updatedAt: new Date().toISOString(), automations: [] }, null, 2), "utf-8");
    }
    // Create page-objects.index.json if missing
    const poPath = path.join(appDir, "page-objects.index.json");
    const poExists = await fs
        .access(poPath)
        .then(() => true)
        .catch(() => false);
    if (!poExists) {
        await fs.writeFile(poPath, JSON.stringify({ version: "1.0", appSlug, pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() }, null, 2), "utf-8");
    }
    // Create flows.index.json if missing
    const flowsPath = path.join(appDir, "flows.index.json");
    const flowsExists = await fs
        .access(flowsPath)
        .then(() => true)
        .catch(() => false);
    if (!flowsExists) {
        await fs.writeFile(flowsPath, JSON.stringify({ version: "1.0", appSlug, flows: [], updatedAt: new Date().toISOString() }, null, 2), "utf-8");
    }
    // Create or preserve app.config.json
    let configCreated = false;
    const configExists = await fs
        .access(appConfigPath)
        .then(() => true)
        .catch(() => false);
    if (!configExists) {
        const initialConfig = {
            appSlug,
            name: appName,
            source: {
                type: source,
                sectionName: sectionName || null,
            },
            routeProfile: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        if (testRailProjectId != null) {
            initialConfig.testRailProjectId = testRailProjectId;
        }
        if (testRailProjectName?.trim()) {
            initialConfig.testRailProjectName = testRailProjectName.trim();
        }
        await fs.writeFile(appConfigPath, JSON.stringify(initialConfig, null, 2), "utf-8");
        configCreated = true;
    }
    else {
        // Update lastUsedSource metadata without overwriting existing config
        try {
            const existingContent = await fs.readFile(appConfigPath, "utf-8");
            const existingConfig = JSON.parse(existingContent);
            existingConfig.lastUsedSource = {
                type: source,
                sectionName: sectionName || null,
                updatedAt: new Date().toISOString(),
            };
            existingConfig.updatedAt = new Date().toISOString();
            await fs.writeFile(appConfigPath, JSON.stringify(existingConfig, null, 2), "utf-8");
        }
        catch {
            // If config is corrupted, leave it as-is
        }
    }
    console.log(`[app-resolver] sectionName="${sectionName || "N/A"}" inferred appName="${appName}" appSlug="${appSlug}" confidence=high`);
    console.log(`[app-resolver] ensure app structure ${appDir} created=${created} configCreated=${configCreated}`);
    return {
        appSlug,
        appName,
        appDir,
        appConfigPath,
        created,
        configCreated,
    };
}
async function loadAppConfig(appSlug) {
    if (!isSafeSlug(appSlug))
        return null;
    const appConfigPath = path.join(APPS_DIR, appSlug, "app.config.json");
    try {
        const content = await fs.readFile(appConfigPath, "utf-8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
function getRouteProfileFromConfig(config) {
    if (!config)
        return null;
    const rp = config.routeProfile;
    if (rp && typeof rp === "object" && !Array.isArray(rp)) {
        return rp;
    }
    return null;
}
function getRouteProfilesFromConfig(config) {
    if (!config)
        return null;
    const rps = config.routeProfiles;
    if (rps && typeof rps === "object" && !Array.isArray(rps)) {
        return rps;
    }
    return null;
}
function buildEntrySteps(routeProfile) {
    if (!routeProfile)
        return [];
    const entry = routeProfile.entry;
    if (!Array.isArray(entry))
        return [];
    return entry
        .map((e) => {
        if (typeof e === "object" && e !== null && "visibleLabel" in e) {
            return e.visibleLabel;
        }
        return null;
    })
        .filter(Boolean);
}
const KIOSKO_ALIASES = ["kiosko", "kiosco", "kiosk", "kiosque"];
const INFO_PRODUCTOS_ALIASES = [
    "información de productos",
    "informacion de productos",
    "información productos",
    "informacion productos",
    "informacion_productos",
    "información_productos",
    "product information",
    "productos",
    "catálogo de productos",
    "catalogo de productos",
    "catálogo productos",
    "catalogo productos",
];
function detectKioskoInfoProductos(input) {
    if (input.targetAppSlug !== "kiosko")
        return false;
    const sources = [
        input.jiraSummary,
        input.jiraDescription,
        input.testrailSectionName,
        input.functionalModule,
        ...(input.scenarioTitles ?? []),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const hasInfoProductos = INFO_PRODUCTOS_ALIASES.some((alias) => {
        const normalized = alias
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
        return sources.includes(normalized);
    });
    return hasInfoProductos;
}
function seedKioskoInfoProductosRouteProfile() {
    return {
        name: "informacion_productos",
        entry: [
            { businessLabel: "iniciar", visibleLabel: "Iniciar" },
            { businessLabel: "informacion_productos", visibleLabel: "Información de productos" },
        ],
        aliases: {
            tarjetas_credito: ["Tarjetas de crédito", "Tarjetas"],
            depositos_plazo: ["Depósitos a Plazo", "Depósitos a plazo"],
            cuentas_efectivo: ["Cuentas de Efectivo", "Cuentas"],
            prestamos: ["Préstamos"],
            volver: "Volver",
            solicitar: "Solicitar",
            finalizar_sesion: "Finalizar sesión",
        },
        domainTerms: {
            producto: ["producto", "tarjeta de crédito", "depósito a plazo", "cuenta de efectivo", "préstamo"],
            categoria: ["categoría", "subcategoría"],
        },
        visibleControls: [
            "Iniciar",
            "Información de productos",
            "Tarjetas de crédito",
            "Depósitos a Plazo",
            "Cuentas de Efectivo",
            "Préstamos",
            "Volver",
            "Solicitar",
            "Finalizar sesión",
        ],
        intermediate: {
            informacion_productos: ["Iniciar", "Información de productos"],
        },
        representativeFixture: {},
        notes: ["RouteProfile inicial inferido para KIOSKO / Información de productos."],
    };
}
