"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const discovery_preview_1 = require("../src/cli/discovery-preview");
const case_discovery_1 = require("../src/discovery/case-discovery");
const app_auto_resolver_1 = require("../src/automations/app-auto-resolver");
const scenario_normalizer_1 = require("../src/automations/scenario-normalizer");
const TECHNICAL_SLUGS = new Set(["tests", "test", "default", "unknown", "undefined", "null"]);
function isTechnicalSlug(slug) {
    return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}
function hasNonDefaultRouteProfile(rp) {
    if (!rp)
        return false;
    const hasDomainTerms = Object.keys(rp.domainTerms ?? {}).length > 0;
    const hasEntry = (rp.entry ?? []).length > 0;
    const hasVisibleControls = (rp.visibleControls ?? []).length > 0;
    return hasDomainTerms || hasEntry || hasVisibleControls;
}
function makeRouteProfile(overrides = {}) {
    return {
        name: overrides.name ?? "test_profile",
        entry: overrides.entry ?? [
            { businessLabel: "iniciar", visibleLabel: "Iniciar" },
            { businessLabel: "informacion_productos", visibleLabel: "Información de productos" },
        ],
        aliases: overrides.aliases ?? {},
        intermediates: overrides.intermediates ?? {},
        domainTerms: overrides.domainTerms ?? { producto: ["producto"] },
        visibleControls: overrides.visibleControls ?? ["Iniciar", "Información de productos"],
        representativeFixture: overrides.representativeFixture ?? {},
        notes: overrides.notes ?? [],
    };
}
(0, test_1.test)("discovery-preview con --app propaga appProfile cli", async () => {
    const result = await (0, discovery_preview_1.resolvePreviewAppProfile)("app-a");
    (0, test_1.expect)(result.resolvedAppSlug).toBe("app-a");
    (0, test_1.expect)(result.appProfileObj.appSlug).toBe("app-a");
    (0, test_1.expect)(result.appProfileObj.source).toBe("cli");
    (0, test_1.expect)(String(result.appProfileObj.appDir)).toContain("automations/apps/app-a");
    (0, test_1.expect)(String(result.appProfileObj.configPath)).toContain("automations/apps/app-a/app.config.json");
});
(0, test_1.test)("runCaseDiscovery prioriza appSlug explicito sobre APP_SLUG del env", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        appSlug: "app-a",
        env: { APP_SLUG: "app-b" },
    })).toBe("app-a");
});
(0, test_1.test)("runCaseDiscovery usa APP_SLUG del env si no recibe appSlug explicito", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        env: { APP_SLUG: "app-b" },
    })).toBe("app-b");
});
(0, test_1.test)("failureGroups agrupa fallos por causa sin perder promotion gate", () => {
    const failureGroups = (0, discovery_preview_1.buildPreviewFailureGroups)([
        {
            id: "1",
            displayId: "PREVIEW-001",
            title: "Assertion failed",
            status: "failed",
            failedTargets: [],
            failedAssertions: ["Solicitar"],
            assertionImportance: "contextual",
            discoveryStatus: "discovered_partial",
            promotionStatus: "not_applicable",
            promotionReason: "Promotion not applicable because discovery status is discovered_partial.",
        },
        {
            id: "2",
            displayId: "PREVIEW-002",
            title: "Target failed",
            status: "failed",
            failedTargets: ["el primer producto visible del listado"],
            failedAssertions: [],
            error: "target_not_found",
        },
        {
            id: "3",
            displayId: "PREVIEW-003",
            title: "Route profile failed",
            status: "failed",
            failedTargets: [],
            failedAssertions: [],
            error: "[route-profile] appSlug=default no routeProfile in app.config.json, returning undefined",
        },
    ]);
    (0, test_1.expect)(failureGroups.contextual_assertion_not_found).toBe(1);
    (0, test_1.expect)(failureGroups.target_not_found).toBeGreaterThanOrEqual(1);
    (0, test_1.expect)(failureGroups.route_profile_missing).toBe(1);
    (0, test_1.expect)(failureGroups.promotion_not_applicable).toBe(1);
    (0, test_1.expect)(failureGroups.assertion_not_found_unrecovered).toBe(0);
});
(0, test_1.test)("failureGroups separa optional y review_needed", () => {
    const failureGroups = (0, discovery_preview_1.buildPreviewFailureGroups)([
        {
            id: "1",
            displayId: "PREVIEW-010",
            title: "Optional assertion",
            status: "failed",
            failedAssertions: ["Volver"],
            assertionImportance: "optional",
            promotionStatus: "not_applicable",
        },
        {
            id: "2",
            displayId: "PREVIEW-011",
            title: "Conditional assertion",
            status: "failed",
            failedAssertions: ["Si aplica"],
            assertionImportance: "blocking",
            conditionalAssertion: true,
            conditionalRisk: "high",
            reviewNeededReason: "conditional_assertion_without_data",
            promotionStatus: "not_applicable",
        },
        {
            id: "3",
            displayId: "PREVIEW-012",
            title: "Unsafe action",
            status: "failed",
            failedAssertions: [],
            reviewNeededReason: "unsafe_action_requires_review",
            promotionStatus: "not_applicable",
        },
    ]);
    (0, test_1.expect)(failureGroups.optional_assertion_not_found).toBe(1);
    (0, test_1.expect)(failureGroups.unsafe_action_requires_review).toBe(1);
    (0, test_1.expect)(failureGroups.conditional_assertion_without_data).toBe(1);
});
(0, test_1.test)("clasifica net::ERR_CONNECTION_CLOSED como environment_navigation_error", () => {
    (0, test_1.expect)((0, discovery_preview_1.classifyPreviewFailure)({
        id: "1",
        displayId: "PREVIEW-004",
        title: "Environment failure",
        status: "failed",
        error: "page.goto: net::ERR_CONNECTION_CLOSED at https://172.27.4.50/",
    })).toEqual({
        failureType: "environment_navigation_error",
        phase: "navigation_start",
    });
});
(0, test_1.test)("dominantFailure prefiere causa raiz sobre promotion_not_applicable", () => {
    const report = (0, discovery_preview_1.buildPreviewSummaryReport)([
        {
            id: "1",
            caseId: "PREVIEW-001",
            displayId: "PREVIEW-001",
            title: "ordinal",
            status: "failed",
            failureType: "ordinal_selection_no_safe_candidate",
            promotionStatus: "not_applicable",
        },
        {
            id: "2",
            caseId: "PREVIEW-002",
            displayId: "PREVIEW-002",
            title: "ordinal-2",
            status: "failed",
            failureType: "ordinal_selection_no_safe_candidate",
            promotionStatus: "not_applicable",
        },
        {
            id: "3",
            caseId: "PREVIEW-003",
            displayId: "PREVIEW-003",
            title: "promotion consequence",
            status: "failed",
            failureType: "promotion_not_applicable",
            promotionStatus: "not_applicable",
        },
    ], 3, {
        ordinal_selection_no_safe_candidate: 2,
        promotion_not_applicable: 3,
    });
    (0, test_1.expect)(report.dominantFailure).toBe("ordinal_selection_no_safe_candidate");
});
// ── Technical slug prohibition tests ──
(0, test_1.test)("isTechnicalSlug: 'tests' is technical", () => {
    (0, test_1.expect)(isTechnicalSlug("tests")).toBe(true);
});
(0, test_1.test)("isTechnicalSlug: 'default' is technical", () => {
    (0, test_1.expect)(isTechnicalSlug("default")).toBe(true);
});
(0, test_1.test)("isTechnicalSlug: 'app-a' is NOT technical", () => {
    (0, test_1.expect)(isTechnicalSlug("app-a")).toBe(false);
});
(0, test_1.test)("isTechnicalSlug: 'kiosko' is NOT technical", () => {
    (0, test_1.expect)(isTechnicalSlug("kiosko")).toBe(false);
});
(0, test_1.test)("isTechnicalSlug: 'test' is technical", () => {
    (0, test_1.expect)(isTechnicalSlug("test")).toBe(true);
});
// ── hasNonDefaultRouteProfile tests ──
(0, test_1.test)("hasNonDefaultRouteProfile: null routeProfile is false", () => {
    (0, test_1.expect)(hasNonDefaultRouteProfile(null)).toBe(false);
});
(0, test_1.test)("hasNonDefaultRouteProfile: routeProfile with domainTerms is true", () => {
    const rp = makeRouteProfile({ domainTerms: { producto: ["producto"] }, entry: [], visibleControls: [] });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(true);
});
(0, test_1.test)("hasNonDefaultRouteProfile: routeProfile with entry is true", () => {
    const rp = makeRouteProfile({ entry: [{ businessLabel: "start", visibleLabel: "Start" }], domainTerms: {}, visibleControls: [] });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(true);
});
(0, test_1.test)("hasNonDefaultRouteProfile: routeProfile with visibleControls is true", () => {
    const rp = makeRouteProfile({ visibleControls: ["Start"], domainTerms: {}, entry: [] });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(true);
});
(0, test_1.test)("hasNonDefaultRouteProfile: empty routeProfile is false", () => {
    const rp = makeRouteProfile({ entry: [], domainTerms: {}, visibleControls: [], aliases: {}, intermediates: {} });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(false);
});
// ── AppSlug inference chain tests ──
(0, test_1.test)("inferAppFromTestRailSection: detects app from section name", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Regression App-A");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("app-a");
    (0, test_1.expect)(result.source).toBe("testrail_section");
    (0, test_1.expect)(result.confidence).toBe("high");
});
(0, test_1.test)("inferAppFromTestRailSection: returns null for empty section", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.inferAppFromTestRailSection)("")).toBeNull();
    (0, test_1.expect)((0, app_auto_resolver_1.inferAppFromTestRailSection)("   ")).toBeNull();
});
(0, test_1.test)("inferAppFromTestRailSection: strips 'tests' prefix", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Tests App-A");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("app-a");
});
(0, test_1.test)("resolveCaseDiscoveryAppSlug: uses explicit appSlug over env", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        appSlug: "app-a",
        env: { APP_SLUG: "app-b" },
    })).toBe("app-a");
});
(0, test_1.test)("resolveCaseDiscoveryAppSlug: uses env APP_SLUG when no explicit", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        env: { APP_SLUG: "app-b" },
    })).toBe("app-b");
});
(0, test_1.test)("resolveCaseDiscoveryAppSlug: falls back to 'default' when no source", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({})).toBe("default");
});
// ── Entry step insertion tests (via normalizeEntrySteps) ──
(0, test_1.test)("normalizeEntrySteps: prepends all entry steps when none present", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "home", visibleLabel: "Inicio" },
            { businessLabel: "products", visibleLabel: "Productos" },
        ],
    });
    const input = ['Validar que se muestre "Catálogo".'];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    (0, test_1.expect)(steps[0]).toBe('Clic en "Inicio".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[2]).toBe('Validar que se muestre "Catálogo".');
});
(0, test_1.test)("normalizeEntrySteps: does not duplicate when entry steps already present", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "home", visibleLabel: "Inicio" },
            { businessLabel: "products", visibleLabel: "Productos" },
        ],
    });
    const input = [
        'Clic en "Inicio".',
        'Clic en "Productos".',
        'Validar algo.',
    ];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    (0, test_1.expect)(steps[0]).toBe('Clic en "Inicio".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[2]).toBe('Validar algo.');
    (0, test_1.expect)(steps).toHaveLength(3);
});
(0, test_1.test)("normalizeEntrySteps: inserts only missing entry steps when partially present", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "login", visibleLabel: "Iniciar sesión" },
            { businessLabel: "menu", visibleLabel: "Menú principal" },
            { businessLabel: "products", visibleLabel: "Productos" },
        ],
    });
    const input = [
        'Clic en "Menú principal".',
        'Clic en "Productos".',
        'Validar algo.',
    ];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    // "Iniciar sesión" should be prepended, others stay in order
    (0, test_1.expect)(steps[0]).toBe('Clic en "Iniciar sesión".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Menú principal".');
    (0, test_1.expect)(steps[2]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[3]).toBe('Validar algo.');
});
(0, test_1.test)("normalizeEntrySteps: deduped counts excess entry steps", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "start", visibleLabel: "Start" },
        ],
    });
    const input = [
        'Clic en "Start".',
        'Clic en "Start".',
        'Clic en "Start".',
        'Validar algo.',
    ];
    const { deduped } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    // 3 entry steps in input, 1 canonical → 2 excess
    (0, test_1.expect)(deduped).toBe(2);
});
// ── routeProfile entry rebuilding through normalizeScenario (indirect test) ──
(0, test_1.test)("normalizeScenario: prepends all entry steps via normalizeEntrySteps", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "login", visibleLabel: "Inicio" },
        ],
    });
    const inputSteps = ['Clic en "Productos".', 'Validar algo.'];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(inputSteps, rp);
    (0, test_1.expect)(steps[0]).toBe('Clic en "Inicio".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[2]).toBe('Validar algo.');
});
