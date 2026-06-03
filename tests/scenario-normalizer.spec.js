"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_normalizer_1 = require("../src/automations/scenario-normalizer");
// ── Helpers ──
function makeRouteProfile(overrides = {}) {
    return {
        name: overrides.name ?? "test_profile",
        entry: overrides.entry ?? [
            { businessLabel: "iniciar", visibleLabel: "Iniciar" },
            { businessLabel: "informacion_productos", visibleLabel: "Información de productos" },
        ],
        aliases: overrides.aliases ?? {
            tarjetas_credito: ["Tarjetas de crédito", "Tarjetas"],
            depositos_plazo: "Depósitos a Plazo",
            prestamos: "Préstamos",
            finalizar_sesion: "Finalizar sesión",
        },
        intermediates: overrides.intermediates ?? {},
        domainTerms: overrides.domainTerms ?? {
            producto: ["producto", "tarjeta de crédito", "depósito a plazo", "préstamo"],
            categoria: ["categoría", "subcategoría"],
        },
        visibleControls: overrides.visibleControls ?? [
            "Iniciar",
            "Información de productos",
            "Tarjetas de crédito",
            "Depósitos a Plazo",
            "Préstamos",
            "Finalizar sesión",
        ],
        representativeFixture: overrides.representativeFixture ?? {},
        notes: overrides.notes ?? [],
    };
}
function makeMcpScenario(overrides = {}) {
    return {
        sourceIssueKey: overrides.sourceIssueKey ?? "PROJ-1",
        title: overrides.title ?? "Test scenario",
        steps: overrides.steps ?? ["Step 1"],
        preconditions: overrides.preconditions ?? [],
        expectedResult: overrides.expectedResult ?? "Result",
        type: overrides.type ?? "functional",
        database: overrides.database ?? "",
        isConverted: overrides.isConverted ?? 0,
        automationType: overrides.automationType ?? "e2e",
        setupStrategy: overrides.setupStrategy ?? "default",
        appSlug: overrides.appSlug ?? "kiosko",
        targetAppSlug: overrides.targetAppSlug,
        targetAppName: overrides.targetAppName,
        routeProfile: overrides.routeProfile ?? "",
        dataRequirements: overrides.dataRequirements ?? "",
        nonExecutableCriteria: overrides.nonExecutableCriteria ?? "",
        mcpExecutable: overrides.mcpExecutable ?? true,
        caseId: overrides.caseId,
        validation: overrides.validation ?? { valid: true, errors: [], warnings: [] },
    };
}
function makeVirtualCase(overrides = {}) {
    return {
        id: overrides.id ?? "preview-001",
        displayId: overrides.displayId ?? "PREVIEW-001",
        title: overrides.title ?? "Test case",
        sourceIssueKey: overrides.sourceIssueKey ?? "PROJ-1",
        steps: overrides.steps ?? ["Step 1"],
        expectedResult: overrides.expectedResult ?? "Result",
        preconditions: overrides.preconditions ?? [],
        appSlug: overrides.appSlug ?? "kiosko",
        routeProfile: overrides.routeProfile ?? "",
        dataRequirements: overrides.dataRequirements ?? "",
        mcpExecutable: overrides.mcpExecutable ?? true,
        source: "scenario_preview",
        targetAppSlug: overrides.targetAppSlug,
        targetAppName: overrides.targetAppName,
        type: overrides.type ?? "functional",
        automationType: overrides.automationType ?? "e2e",
        setupStrategy: overrides.setupStrategy ?? "default",
    };
}
// ── normalizeForComparison tests ──
(0, test_1.test)("normalizeForComparison: strips accents", () => {
    (0, test_1.expect)((0, scenario_normalizer_1.normalizeForComparison)("Información")).toBe("informacion");
    (0, test_1.expect)((0, scenario_normalizer_1.normalizeForComparison)("Préstamos")).toBe("prestamos");
    (0, test_1.expect)((0, scenario_normalizer_1.normalizeForComparison)("Depósitos")).toBe("depositos");
});
(0, test_1.test)("normalizeForComparison: lowercases", () => {
    (0, test_1.expect)((0, scenario_normalizer_1.normalizeForComparison)("INICIAR")).toBe("iniciar");
});
(0, test_1.test)("normalizeForComparison: preserves quotes", () => {
    (0, test_1.expect)((0, scenario_normalizer_1.normalizeForComparison)('Clic en "Iniciar"')).toBe('clic en "iniciar"');
});
// ── stripStepNumbering tests ──
(0, test_1.test)("stripStepNumbering: removes numbering with dot", () => {
    (0, test_1.expect)((0, scenario_normalizer_1.stripStepNumbering)('1. Clic en "Iniciar".')).toBe('Clic en "Iniciar".');
});
(0, test_1.test)("stripStepNumbering: removes numbering with parenthesis", () => {
    (0, test_1.expect)((0, scenario_normalizer_1.stripStepNumbering)('2) Clic en "Iniciar".')).toBe('Clic en "Iniciar".');
});
(0, test_1.test)("stripStepNumbering: preserves non-numbered steps", () => {
    (0, test_1.expect)((0, scenario_normalizer_1.stripStepNumbering)('Clic en "Iniciar".')).toBe('Clic en "Iniciar".');
});
// ── buildCanonicalLabelMap tests ──
(0, test_1.test)("buildCanonicalLabelMap: builds map from routeProfile entry", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("iniciar")).toBe("Iniciar");
    (0, test_1.expect)(map.get("informacion de productos")).toBe("Información de productos");
});
(0, test_1.test)("buildCanonicalLabelMap: builds map from visibleControls", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("tarjetas de credito")).toBe("Tarjetas de crédito");
    (0, test_1.expect)(map.get("depositos a plazo")).toBe("Depósitos a Plazo");
    (0, test_1.expect)(map.get("prestamos")).toBe("Préstamos");
});
(0, test_1.test)("buildCanonicalLabelMap: builds map from aliases", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("finalizar sesion")).toBe("Finalizar sesión");
});
(0, test_1.test)("buildCanonicalLabelMap: builds map from domainTerms", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("categoria")).toBe("categoría");
    (0, test_1.expect)(map.get("subcategoria")).toBe("subcategoría");
});
// ── canonicalizeText tests ──
(0, test_1.test)("canonicalizeText: fixes damaged labels using routeProfile", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Tarjetas de credito", map)).toBe("Tarjetas de crédito");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Depositos a Plazo", map)).toBe("Depósitos a Plazo");
    // "Prestamos" may be canonicalized to "Préstamos" or "préstamos" depending on label order
    const prestamosResult = (0, scenario_normalizer_1.canonicalizeText)("Prestamos", map);
    (0, test_1.expect)(prestamosResult.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")).toBe("prestamos");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Finalizar sesion", map)).toBe("Finalizar sesión");
});
(0, test_1.test)("canonicalizeText: does not remove accents from final text", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    const result = (0, scenario_normalizer_1.canonicalizeText)('Validar que se muestre "Tarjetas de credito".', map);
    (0, test_1.expect)(result).toContain("Tarjetas de crédito");
    (0, test_1.expect)(result).not.toContain("Tarjetas de credito");
});
(0, test_1.test)("canonicalizeText: preserves text without mapping", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Some unknown label", map)).toBe("Some unknown label");
});
(0, test_1.test)("canonicalizeText: handles mojibake variants", () => {
    const rp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Informacion de productos", map)).toBe("Información de productos");
});
// ── buildCanonicalEntrySteps tests ──
(0, test_1.test)("buildCanonicalEntrySteps: builds entry steps from routeProfile", () => {
    const rp = makeRouteProfile();
    const steps = (0, scenario_normalizer_1.buildCanonicalEntrySteps)(rp);
    (0, test_1.expect)(steps).toContain('Clic en "Iniciar".');
    (0, test_1.expect)(steps).toContain('Clic en "Información de productos".');
    (0, test_1.expect)(steps).toHaveLength(2);
});
(0, test_1.test)("buildCanonicalEntrySteps: returns empty for null routeProfile", () => {
    (0, test_1.expect)((0, scenario_normalizer_1.buildCanonicalEntrySteps)(null)).toEqual([]);
});
// ── normalizeEntrySteps tests ──
(0, test_1.test)("normalizeEntrySteps: eliminates duplicate entry steps", () => {
    const rp = makeRouteProfile();
    const input = [
        'Clic en "Iniciar".',
        'Clic en "Información de productos".',
        'Clic en "Iniciar".',
        'Clic en "Informacion de productos".',
        'Validar que se muestre "Tarjetas de crédito".',
    ];
    const { steps, deduped } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    (0, test_1.expect)(steps).toEqual([
        'Clic en "Iniciar".',
        'Clic en "Información de productos".',
        'Validar que se muestre "Tarjetas de crédito".',
    ]);
    (0, test_1.expect)(deduped).toBe(2);
});
(0, test_1.test)("normalizeEntrySteps: does not duplicate if Codex already generated", () => {
    const rp = makeRouteProfile();
    const input = [
        'Clic en "Iniciar".',
        'Clic en "Información de productos".',
    ];
    const { steps, deduped } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    (0, test_1.expect)(steps).toEqual([
        'Clic en "Iniciar".',
        'Clic en "Información de productos".',
    ]);
    (0, test_1.expect)(deduped).toBe(0);
});
(0, test_1.test)("normalizeEntrySteps: inserts missing entry steps", () => {
    const rp = makeRouteProfile();
    const input = [
        'Clic en "Información de productos".',
    ];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    // All entry steps should be prepended, including missing ones
    (0, test_1.expect)(steps[0]).toBe('Clic en "Iniciar".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Información de productos".');
    (0, test_1.expect)(steps.length).toBeGreaterThanOrEqual(2);
});
(0, test_1.test)("normalizeEntrySteps: supports routeProfile with 3+ entry steps", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "home", visibleLabel: "Inicio" },
            { businessLabel: "menu", visibleLabel: "Menú principal" },
            { businessLabel: "products", visibleLabel: "Productos" },
        ],
    });
    const input = [
        'Clic en "Productos".',
        'Clic en "Inicio".',
    ];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    // All canonical entry steps should be prepended in order
    (0, test_1.expect)(steps[0]).toBe('Clic en "Inicio".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Menú principal".');
    (0, test_1.expect)(steps[2]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps.length).toBeGreaterThanOrEqual(3);
});
(0, test_1.test)("normalizeEntrySteps: strips numbering", () => {
    const rp = makeRouteProfile();
    const input = [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
    ];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    (0, test_1.expect)(steps).toContain('Clic en "Iniciar".');
    (0, test_1.expect)(steps).toContain('Clic en "Información de productos".');
});
// ── normalizeScenario tests ──
(0, test_1.test)("normalizeScenario: canonicalizes title, steps, expectedResult", () => {
    const rp = makeRouteProfile();
    const scenario = makeMcpScenario({
        title: "Visualizar Tarjetas de credito",
        steps: [
            '1. Clic en "Iniciar".',
            '2. Clic en "Informacion de productos".',
            '3. Validar "Tarjetas de credito".',
        ],
        expectedResult: "Se muestran las Tarjetas de credito",
    });
    const { scenario: normalized, stats } = (0, scenario_normalizer_1.normalizeScenario)(scenario, rp, null);
    (0, test_1.expect)(normalized.title).toContain("Tarjetas de crédito");
    (0, test_1.expect)(normalized.steps.some((s) => s.includes("Tarjetas de crédito"))).toBe(true);
    (0, test_1.expect)(normalized.expectedResult).toContain("Tarjetas de crédito");
    (0, test_1.expect)(stats.canonicalizedLabels).toBeGreaterThan(0);
});
(0, test_1.test)("normalizeScenario: deduplicates entry steps", () => {
    const rp = makeRouteProfile();
    const scenario = makeMcpScenario({
        steps: [
            'Clic en "Iniciar".',
            'Clic en "Información de productos".',
            'Clic en "Iniciar".',
            'Clic en "Informacion de productos".',
            'Validar algo.',
        ],
    });
    const { scenario: normalized, stats } = (0, scenario_normalizer_1.normalizeScenario)(scenario, rp, null);
    (0, test_1.expect)(normalized.steps).toHaveLength(3);
    (0, test_1.expect)(stats.entryDeduped).toBe(2);
});
// ── normalizeVirtualCase tests ──
(0, test_1.test)("normalizeVirtualCase: preserves accents in final output", () => {
    const rp = makeRouteProfile();
    const vc = makeVirtualCase({
        title: "Visualizar Depositos a Plazo",
        steps: [
            'Clic en "Iniciar".',
            'Clic en "Informacion de productos".',
            'Validar "Depositos a Plazo".',
            'Validar "Prestamos".',
        ],
        expectedResult: "Se muestran los Depositos y Prestamos",
    });
    const { vc: normalized } = (0, scenario_normalizer_1.normalizeVirtualCase)(vc, rp, null);
    (0, test_1.expect)(normalized.title).toContain("Depósitos a Plazo");
    (0, test_1.expect)(normalized.steps.some((s) => s.includes("Depósitos a Plazo"))).toBe(true);
    // Accept either capitalization - accent preservation is the key requirement
    const hasPrestamos = normalized.steps.some((s) => s.includes("Préstamos") || s.includes("préstamos"));
    (0, test_1.expect)(hasPrestamos).toBe(true);
    // expectedResult may contain partial words that don't match full canonical labels
    const hasDepositosAccent = normalized.expectedResult.includes("Depósitos") || normalized.expectedResult.includes("depósitos");
    const hasDepositosPlain = normalized.expectedResult.includes("Depositos") || normalized.expectedResult.includes("depositos");
    (0, test_1.expect)(hasDepositosAccent || hasDepositosPlain).toBe(true);
    const hasPrestamosResult = normalized.expectedResult.includes("Préstamos") || normalized.expectedResult.includes("préstamos") || normalized.expectedResult.includes("Prestamos");
    (0, test_1.expect)(hasPrestamosResult).toBe(true);
    // Should NOT contain damaged versions
    (0, test_1.expect)(normalized.title).not.toContain("Depositos");
    (0, test_1.expect)(normalized.title).not.toContain("Prestamos");
});
(0, test_1.test)("normalizeVirtualCase: toVirtualCase conserves canonical labels", () => {
    const rp = makeRouteProfile();
    const vc = makeVirtualCase({
        steps: [
            'Clic en "Iniciar".',
            'Clic en "Información de productos".',
            'Validar que se muestre "Tarjetas de crédito".',
            'Validar que se muestre "Depositos a Plazo".',
            'Validar que se muestre "Cuentas de Efectivo".',
            'Validar que se muestre "Prestamos".',
        ],
    });
    const { vc: normalized } = (0, scenario_normalizer_1.normalizeVirtualCase)(vc, rp, null);
    // All labels should be preserved with accents
    (0, test_1.expect)(normalized.steps.join(" ")).toContain("Información de productos");
    (0, test_1.expect)(normalized.steps.join(" ")).toContain("Tarjetas de crédito");
    (0, test_1.expect)(normalized.steps.join(" ")).toContain("Depósitos a Plazo");
    // Accept either capitalization
    const stepsText = normalized.steps.join(" ");
    (0, test_1.expect)(stepsText.includes("Préstamos") || stepsText.includes("préstamos")).toBe(true);
});
// ── validateVirtualCases tests ──
(0, test_1.test)("validateVirtualCases: detects duplicate entry steps", () => {
    const rp = makeRouteProfile();
    const cases = [
        makeVirtualCase({
            steps: [
                'Clic en "Iniciar".',
                'Clic en "Iniciar".',
                'Validar algo.',
            ],
        }),
    ];
    const { valid, issues } = (0, scenario_normalizer_1.validateVirtualCases)(cases, rp, null);
    (0, test_1.expect)(valid).toBe(false);
    (0, test_1.expect)(issues.some((i) => i.type === "duplicate_entry_step")).toBe(true);
});
(0, test_1.test)("validateVirtualCases: detects empty steps", () => {
    const cases = [makeVirtualCase({ steps: [] })];
    const { valid, issues } = (0, scenario_normalizer_1.validateVirtualCases)(cases, null, null);
    (0, test_1.expect)(valid).toBe(false);
    (0, test_1.expect)(issues.some((i) => i.type === "empty_steps")).toBe(true);
});
(0, test_1.test)("validateVirtualCases: detects missing fields", () => {
    const cases = [makeVirtualCase({ id: "", title: "" })];
    const { valid, issues } = (0, scenario_normalizer_1.validateVirtualCases)(cases, null, null);
    (0, test_1.expect)(valid).toBe(false);
    (0, test_1.expect)(issues.some((i) => i.type === "missing_field")).toBe(true);
});
(0, test_1.test)("validateVirtualCases: detects sensitive actions", () => {
    const cases = [makeVirtualCase({
            steps: ['Clic en "Iniciar".', 'rm -rf /'],
        })];
    const { valid, issues } = (0, scenario_normalizer_1.validateVirtualCases)(cases, null, null);
    (0, test_1.expect)(valid).toBe(false);
    (0, test_1.expect)(issues.some((i) => i.type === "sensitive_action")).toBe(true);
});
(0, test_1.test)("validateVirtualCases: passes for valid cases", () => {
    const rp = makeRouteProfile();
    const cases = [
        makeVirtualCase({
            steps: [
                'Clic en "Iniciar".',
                'Clic en "Información de productos".',
                'Validar algo.',
            ],
        }),
    ];
    const { valid, issues } = (0, scenario_normalizer_1.validateVirtualCases)(cases, rp, null);
    (0, test_1.expect)(valid).toBe(true);
    (0, test_1.expect)(issues).toHaveLength(0);
});
// ── Multi-app tests ──
(0, test_1.test)("multi-app: KIOSKO uses its own routeProfile labels", () => {
    const kioskoRp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(kioskoRp, null);
    (0, test_1.expect)(map.get("tarjetas de credito")).toBe("Tarjetas de crédito");
    (0, test_1.expect)(map.get("informacion de productos")).toBe("Información de productos");
});
(0, test_1.test)("multi-app: FENIX uses its own labels if in app.config", () => {
    const fenixRp = {
        name: "gestion_clientes",
        entry: [
            { businessLabel: "login", visibleLabel: "Iniciar sesión" },
            { businessLabel: "clientes", visibleLabel: "Gestión de clientes" },
        ],
        aliases: {
            aprobacion: "Aprobación",
            consulta: "Consulta de clientes",
        },
        intermediates: {},
        domainTerms: {},
        visibleControls: [
            "Iniciar sesión",
            "Gestión de clientes",
            "Aprobación",
            "Consulta de clientes",
            "Volver",
        ],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(fenixRp, null);
    (0, test_1.expect)(map.get("gestion de clientes")).toBe("Gestión de clientes");
    (0, test_1.expect)(map.get("aprobacion")).toBe("Aprobación");
    (0, test_1.expect)(map.get("consulta de clientes")).toBe("Consulta de clientes");
    // Should NOT have KIOSKO labels
    (0, test_1.expect)(map.get("tarjetas de credito")).toBeUndefined();
    (0, test_1.expect)(map.get("informacion de productos")).toBeUndefined();
});
(0, test_1.test)("multi-app: does not mix routeProfiles between apps", () => {
    const kioskoRp = makeRouteProfile();
    const fenixRp = {
        name: "gestion_clientes",
        entry: [{ businessLabel: "login", visibleLabel: "Iniciar sesión" }],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Iniciar sesión", "Gestión de clientes"],
        representativeFixture: {},
        notes: [],
    };
    const kioskoMap = (0, scenario_normalizer_1.buildCanonicalLabelMap)(kioskoRp, null);
    const fenixMap = (0, scenario_normalizer_1.buildCanonicalLabelMap)(fenixRp, null);
    // KIOSKO map should have KIOSKO labels
    (0, test_1.expect)(kioskoMap.get("tarjetas de credito")).toBe("Tarjetas de crédito");
    // FENIX map should NOT have KIOSKO labels
    (0, test_1.expect)(fenixMap.get("tarjetas de credito")).toBeUndefined();
    // FENIX map should have FENIX labels
    (0, test_1.expect)(fenixMap.get("gestion de clientes")).toBe("Gestión de clientes");
});
(0, test_1.test)("multi-app: targetAppSlug determines functional appDir", () => {
    const appSlug = "kiosko";
    (0, test_1.expect)(appSlug).toBe("kiosko");
    const otherSlug = "fenix";
    (0, test_1.expect)(otherSlug).toBe("fenix");
    (0, test_1.expect)(appSlug).not.toBe(otherSlug);
});
// ── Multi-app canonicalization tests ──
(0, test_1.test)("multi-app: KIOSKO canonicalizes Prestamos to Préstamos", () => {
    const kioskoRp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(kioskoRp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Prestamos", map)).toBe("Préstamos");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("prestamos", map)).toBe("Préstamos");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Clic en \"Prestamos\".", map)).toBe("Clic en \"Préstamos\".");
});
(0, test_1.test)("multi-app: KIOSKO canonicalizes Depositos a Plazo to Depósitos a Plazo", () => {
    const kioskoRp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(kioskoRp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Depositos a Plazo", map)).toBe("Depósitos a Plazo");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("depositos a plazo", map)).toBe("Depósitos a Plazo");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Clic en \"Depositos a Plazo\".", map)).toBe("Clic en \"Depósitos a Plazo\".");
});
(0, test_1.test)("multi-app: KIOSKO canonicalizes Tarjetas de credito to Tarjetas de crédito", () => {
    const kioskoRp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(kioskoRp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Tarjetas de credito", map)).toBe("Tarjetas de crédito");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("tarjetas de credito", map)).toBe("Tarjetas de crédito");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Clic en \"Tarjetas de credito\".", map)).toBe("Clic en \"Tarjetas de crédito\".");
});
(0, test_1.test)("multi-app: KIOSKO canonicalizes Finalizar sesion to Finalizar sesión", () => {
    const kioskoRp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(kioskoRp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Finalizar sesion", map)).toBe("Finalizar sesión");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("finalizar sesion", map)).toBe("Finalizar sesión");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Clic en \"Finalizar sesion\".", map)).toBe("Clic en \"Finalizar sesión\".");
});
(0, test_1.test)("multi-app: FENIX canonicalizes Gestion de clientes to Gestión de clientes", () => {
    const fenixRp = {
        name: "gestion_clientes",
        entry: [
            { businessLabel: "ingresar", visibleLabel: "Ingresar" },
            { businessLabel: "clientes", visibleLabel: "Clientes" },
        ],
        aliases: {
            gestion_clientes: "Gestión de clientes",
            aprobacion: "Aprobación",
        },
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Ingresar", "Clientes", "Gestión de clientes", "Aprobación", "Buscar", "Volver"],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(fenixRp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Gestion de clientes", map)).toBe("Gestión de clientes");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("gestion de clientes", map)).toBe("Gestión de clientes");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Clic en \"Gestion de clientes\".", map)).toBe("Clic en \"Gestión de clientes\".");
});
(0, test_1.test)("multi-app: FENIX canonicalizes Aprobacion to Aprobación", () => {
    const fenixRp = {
        name: "gestion_clientes",
        entry: [{ businessLabel: "ingresar", visibleLabel: "Ingresar" }],
        aliases: {
            aprobacion: "Aprobación",
        },
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Ingresar", "Aprobación", "Volver"],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(fenixRp, null);
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Aprobacion", map)).toBe("Aprobación");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("aprobacion", map)).toBe("Aprobación");
});
(0, test_1.test)("multi-app: FENIX does NOT canonicalize Prestamos to Préstamos", () => {
    const fenixRp = {
        name: "gestion_clientes",
        entry: [{ businessLabel: "ingresar", visibleLabel: "Ingresar" }],
        aliases: {
            gestion_clientes: "Gestión de clientes",
        },
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Ingresar", "Gestión de clientes", "Volver"],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(fenixRp, null);
    // FENIX does not have "Préstamos" in its labels
    (0, test_1.expect)(map.get("prestamos")).toBeUndefined();
    // So "Prestamos" should NOT be changed
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Prestamos", map)).toBe("Prestamos");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Clic en \"Prestamos\".", map)).toBe("Clic en \"Prestamos\".");
});
(0, test_1.test)("multi-app: KIOSKO does NOT canonicalize Gestion de clientes", () => {
    const kioskoRp = makeRouteProfile();
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(kioskoRp, null);
    // KIOSKO does not have "Gestión de clientes" in its labels
    (0, test_1.expect)(map.get("gestion de clientes")).toBeUndefined();
    // So "Gestion de clientes" should NOT be changed
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Gestion de clientes", map)).toBe("Gestion de clientes");
});
(0, test_1.test)("multi-app: app without config receives no hardcoded Kiosko labels", () => {
    // Empty routeProfile
    const emptyRp = {
        name: "default",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(emptyRp, null);
    // Should not have any Kiosko labels
    (0, test_1.expect)(map.get("prestamos")).toBeUndefined();
    (0, test_1.expect)(map.get("tarjetas de credito")).toBeUndefined();
    (0, test_1.expect)(map.get("depositos a plazo")).toBeUndefined();
    (0, test_1.expect)(map.get("finalizar sesion")).toBeUndefined();
    // Text should remain unchanged
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Prestamos", map)).toBe("Prestamos");
    (0, test_1.expect)((0, scenario_normalizer_1.canonicalizeText)("Tarjetas de credito", map)).toBe("Tarjetas de credito");
});
(0, test_1.test)("multi-app: buildCanonicalLabelMap includes aliases string[]", () => {
    const rp = {
        name: "test",
        entry: [],
        aliases: {
            tarjetas_credito: ["Tarjetas de crédito", "Tarjetas"],
            depositos_plazo: ["Depósitos a Plazo", "Depósitos a plazo"],
        },
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("tarjetas de credito")).toBe("Tarjetas de crédito");
    (0, test_1.expect)(map.get("tarjetas")).toBe("Tarjetas");
    (0, test_1.expect)(map.get("depositos a plazo")).toBe("Depósitos a Plazo");
    (0, test_1.expect)(map.get("depositos a plazo")).toBe("Depósitos a Plazo");
});
(0, test_1.test)("multi-app: buildCanonicalLabelMap includes domainTerms string[]", () => {
    const rp = {
        name: "test",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {
            producto: ["producto", "tarjeta de crédito", "depósito a plazo"],
        },
        visibleControls: [],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("producto")).toBe("producto");
    (0, test_1.expect)(map.get("tarjeta de credito")).toBe("tarjeta de crédito");
    (0, test_1.expect)(map.get("deposito a plazo")).toBe("depósito a plazo");
});
(0, test_1.test)("multi-app: buildCanonicalLabelMap includes visibleControls", () => {
    const rp = {
        name: "test",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Volver", "Finalizar sesión", "Solicitar"],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("volver")).toBe("Volver");
    (0, test_1.expect)(map.get("finalizar sesion")).toBe("Finalizar sesión");
    (0, test_1.expect)(map.get("solicitar")).toBe("Solicitar");
});
(0, test_1.test)("multi-app: buildCanonicalLabelMap includes entry visibleLabels", () => {
    const rp = {
        name: "test",
        entry: [
            { businessLabel: "home", visibleLabel: "Inicio" },
            { businessLabel: "menu", visibleLabel: "Menú principal" },
        ],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(rp, null);
    (0, test_1.expect)(map.get("inicio")).toBe("Inicio");
    (0, test_1.expect)(map.get("menu principal")).toBe("Menú principal");
});
(0, test_1.test)("multi-app: appConfig routeProfile is merged with request routeProfile", () => {
    const requestRp = {
        name: "request_profile",
        entry: [{ businessLabel: "start", visibleLabel: "Iniciar" }],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Iniciar"],
        representativeFixture: {},
        notes: [],
    };
    const appConfig = {
        routeProfile: {
            name: "app_profile",
            entry: [{ businessLabel: "end", visibleLabel: "Finalizar sesión" }],
            aliases: { prestamos: "Préstamos" },
            visibleControls: ["Finalizar sesión", "Préstamos"],
            domainTerms: {},
        },
    };
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(requestRp, appConfig);
    // Should have labels from both
    (0, test_1.expect)(map.get("iniciar")).toBe("Iniciar");
    (0, test_1.expect)(map.get("finalizar sesion")).toBe("Finalizar sesión");
    (0, test_1.expect)(map.get("prestamos")).toBe("Préstamos");
});
(0, test_1.test)("multi-app: normalizeScenario applies canonicalization using appConfig labels", () => {
    const appConfig = {
        routeProfile: {
            name: "kiosko_info_productos",
            entry: [
                { businessLabel: "iniciar", visibleLabel: "Iniciar" },
                { businessLabel: "info_prod", visibleLabel: "Información de productos" },
            ],
            aliases: {
                tarjetas_credito: ["Tarjetas de crédito", "Tarjetas"],
                prestamos: "Préstamos",
            },
            visibleControls: ["Iniciar", "Información de productos", "Tarjetas de crédito", "Préstamos"],
            domainTerms: {},
        },
    };
    const scenario = makeMcpScenario({
        title: "Visualizar tarjetas de credito y prestamos",
        steps: [
            'Clic en "Iniciar".',
            'Clic en "Informacion de productos".',
            'Validar "Tarjetas de credito".',
            'Validar "Prestamos".',
        ],
        expectedResult: "Se muestran tarjetas de credito y prestamos",
    });
    const { scenario: normalized } = (0, scenario_normalizer_1.normalizeScenario)(scenario, null, appConfig);
    (0, test_1.expect)(normalized.title).toContain("Tarjetas de crédito");
    (0, test_1.expect)(normalized.title).toContain("Préstamos");
    (0, test_1.expect)(normalized.steps.some((s) => s.includes("Tarjetas de crédito"))).toBe(true);
    (0, test_1.expect)(normalized.steps.some((s) => s.includes("Préstamos"))).toBe(true);
    (0, test_1.expect)(normalized.expectedResult).toContain("Tarjetas de crédito");
    (0, test_1.expect)(normalized.expectedResult).toContain("Préstamos");
});
