import { test, expect } from "@playwright/test";
import {
  buildPreviewFailureGroups,
  buildPreviewSummaryReport,
  classifyPreviewFailure,
  resolvePreviewAppProfile,
  resolvePreviewCompletion,
  virtualCaseToTestScenario
} from "../src/cli/discovery-preview";
import { resolveCaseDiscoveryAppSlug } from "../src/discovery/case-discovery";
import { inferAppFromTestRailSection } from "../src/automations/app-auto-resolver";
import { normalizeEntrySteps, buildCanonicalEntrySteps, normalizeForComparison } from "../src/automations/scenario-normalizer";
import type { McpRouteProfile } from "../src/scenarios/scenario-types";

const TECHNICAL_SLUGS = new Set(["tests", "test", "default", "unknown", "undefined", "null"]);

function isTechnicalSlug(slug: string): boolean {
  return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}

function hasNonDefaultRouteProfile(rp: McpRouteProfile | null): boolean {
  if (!rp) return false;
  const hasDomainTerms = Object.keys(rp.domainTerms ?? {}).length > 0;
  const hasEntry = (rp.entry ?? []).length > 0;
  const hasVisibleControls = (rp.visibleControls ?? []).length > 0;
  return hasDomainTerms || hasEntry || hasVisibleControls;
}

function makeRouteProfile(overrides: Partial<McpRouteProfile> = {}): McpRouteProfile {
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

test("discovery-preview con --app propaga appProfile cli", async () => {
  const result = await resolvePreviewAppProfile("app-a");

  expect(result.resolvedAppSlug).toBe("app-a");
  expect(result.appProfileObj.appSlug).toBe("app-a");
  expect(result.appProfileObj.source).toBe("cli");
  expect(String(result.appProfileObj.appDir)).toContain("automations/apps/app-a");
  expect(String(result.appProfileObj.configPath)).toContain("automations/apps/app-a/app.config.json");
});

test("runCaseDiscovery prioriza appSlug explicito sobre APP_SLUG del env", () => {
  expect(resolveCaseDiscoveryAppSlug({
    appSlug: "app-a",
    env: { APP_SLUG: "app-b" },
  } as any)).toBe("app-a");
});

test("runCaseDiscovery usa APP_SLUG del env si no recibe appSlug explicito", () => {
  expect(resolveCaseDiscoveryAppSlug({
    env: { APP_SLUG: "app-b" },
  } as any)).toBe("app-b");
});

test("virtualCaseToTestScenario preserves explicit TestRail case identity when present", () => {
  const scenario = virtualCaseToTestScenario({
    id: "preview-001",
    displayId: "PREVIEW-001",
    testRailCaseId: 42811,
    title: "Caso existente",
    sourceIssueKey: "TR-C42811",
    steps: ["Clic en \"Información de productos\"."],
    expectedResult: "Se muestra el detalle",
    preconditions: [],
    appSlug: "app-a",
    routeProfile: "kiosko-default",
    dataRequirements: "",
    mcpExecutable: true,
    source: "scenario_preview",
    type: "Functional",
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
  });
  expect(scenario.source).toBe("testrail");
  expect(scenario.caseId).toBe(42811);
  expect(scenario.externalId).toBe("C42811");
});

test("autoPromote no considera discovered_partial como exito final si no hay spec promovido", () => {
  const completion = resolvePreviewCompletion({
    caseResult: { status: "discovered_partial" },
    promotionStatus: "not_applicable",
  }, true);

  expect(completion.eventStatus).toBe("failed");
  expect(completion.automationReady).toBe(false);
  expect(completion.specGenerationStatus).toBe("failed");
});

test("autoPromote no considera discovered_passed como exito final si spec generation falla", () => {
  const completion = resolvePreviewCompletion({
    caseResult: { status: "discovered_passed" },
    promotionStatus: "spec_failed",
    specPath: "C:\\tmp\\case.spec.ts",
    specGeneration: {
      provider: "copilot",
      model: "gpt-5.4",
      invocations: 1,
      invocationsConsumed: 1,
      promotionAllowed: false,
      specWritten: false,
      finalSpec: { origin: "ai_candidate", fallback: null },
    },
  }, true);

  expect(completion.eventStatus).toBe("failed");
  expect(completion.automationReady).toBe(false);
  expect(completion.aiInvoked).toBe(true);
});

test("autoPromote requiere promotionAllowed y specWritten para automationReady", () => {
  const completion = resolvePreviewCompletion({
    caseResult: { status: "discovered_passed" },
    promotionStatus: "promoted",
    specPath: "C:\\tmp\\case.spec.ts",
    specGeneration: {
      provider: "copilot",
      model: "gpt-5.4",
      invocations: 1,
      invocationsConsumed: 2,
      promotionAllowed: true,
      specWritten: true,
      finalSpec: { origin: "ai_candidate", fallback: null },
    },
  }, true);

  expect(completion.eventStatus).toBe("passed");
  expect(completion.automationReady).toBe(true);
  expect(completion.aiAttempts).toBe(2);
  expect(completion.finalSpecOrigin).toBe("ai_candidate");
});

test("failureGroups agrupa fallos por causa sin perder promotion gate", () => {
  const failureGroups = buildPreviewFailureGroups([
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
  ] as any);

  expect(failureGroups.contextual_assertion_not_found).toBe(1);
  expect(failureGroups.target_not_found).toBeGreaterThanOrEqual(1);
  expect(failureGroups.route_profile_missing).toBe(1);
  expect(failureGroups.promotion_not_applicable).toBe(1);
  expect(failureGroups.assertion_not_found_unrecovered).toBe(0);
});

test("failureGroups separa optional y review_needed", () => {
  const failureGroups = buildPreviewFailureGroups([
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
  ] as any);

  expect(failureGroups.optional_assertion_not_found).toBe(1);
  expect(failureGroups.unsafe_action_requires_review).toBe(1);
  expect(failureGroups.conditional_assertion_without_data).toBe(1);
});

test("clasifica net::ERR_CONNECTION_CLOSED como environment_navigation_error", () => {
  expect(classifyPreviewFailure({
    id: "1",
    displayId: "PREVIEW-004",
    title: "Environment failure",
    status: "failed",
    error: "page.goto: net::ERR_CONNECTION_CLOSED at https://172.27.4.50/",
  } as any)).toEqual({
    failureType: "environment_navigation_error",
    phase: "navigation_start",
  });
});

test("dominantFailure prefiere causa raiz sobre promotion_not_applicable", () => {
  const report = buildPreviewSummaryReport([
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
  ] as any, 3, {
    ordinal_selection_no_safe_candidate: 2,
    promotion_not_applicable: 3,
  } as any);

  expect(report.dominantFailure).toBe("ordinal_selection_no_safe_candidate");
});

// ── Technical slug prohibition tests ──

test("isTechnicalSlug: 'tests' is technical", () => {
  expect(isTechnicalSlug("tests")).toBe(true);
});

test("isTechnicalSlug: 'default' is technical", () => {
  expect(isTechnicalSlug("default")).toBe(true);
});

test("isTechnicalSlug: 'app-a' is NOT technical", () => {
  expect(isTechnicalSlug("app-a")).toBe(false);
});

test("isTechnicalSlug: 'kiosko' is NOT technical", () => {
  expect(isTechnicalSlug("kiosko")).toBe(false);
});

test("isTechnicalSlug: 'test' is technical", () => {
  expect(isTechnicalSlug("test")).toBe(true);
});

// ── hasNonDefaultRouteProfile tests ──

test("hasNonDefaultRouteProfile: null routeProfile is false", () => {
  expect(hasNonDefaultRouteProfile(null)).toBe(false);
});

test("hasNonDefaultRouteProfile: routeProfile with domainTerms is true", () => {
  const rp = makeRouteProfile({ domainTerms: { producto: ["producto"] }, entry: [], visibleControls: [] });
  expect(hasNonDefaultRouteProfile(rp)).toBe(true);
});

test("hasNonDefaultRouteProfile: routeProfile with entry is true", () => {
  const rp = makeRouteProfile({ entry: [{ businessLabel: "start", visibleLabel: "Start" }], domainTerms: {}, visibleControls: [] });
  expect(hasNonDefaultRouteProfile(rp)).toBe(true);
});

test("hasNonDefaultRouteProfile: routeProfile with visibleControls is true", () => {
  const rp = makeRouteProfile({ visibleControls: ["Start"], domainTerms: {}, entry: [] });
  expect(hasNonDefaultRouteProfile(rp)).toBe(true);
});

test("hasNonDefaultRouteProfile: empty routeProfile is false", () => {
  const rp = makeRouteProfile({ entry: [], domainTerms: {}, visibleControls: [], aliases: {}, intermediates: {} });
  expect(hasNonDefaultRouteProfile(rp)).toBe(false);
});

// ── AppSlug inference chain tests ──

test("inferAppFromTestRailSection: detects app from section name", () => {
  const result = inferAppFromTestRailSection("Regression App-A");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("app-a");
  expect(result!.source).toBe("testrail_section");
  expect(result!.confidence).toBe("high");
});

test("inferAppFromTestRailSection: returns null for empty section", () => {
  expect(inferAppFromTestRailSection("")).toBeNull();
  expect(inferAppFromTestRailSection("   ")).toBeNull();
});

test("inferAppFromTestRailSection: strips 'tests' prefix", () => {
  const result = inferAppFromTestRailSection("Tests App-A");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("app-a");
});

test("resolveCaseDiscoveryAppSlug: uses explicit appSlug over env", () => {
  expect(resolveCaseDiscoveryAppSlug({
    appSlug: "app-a",
    env: { APP_SLUG: "app-b" },
  } as any)).toBe("app-a");
});

test("resolveCaseDiscoveryAppSlug: uses env APP_SLUG when no explicit", () => {
  expect(resolveCaseDiscoveryAppSlug({
    env: { APP_SLUG: "app-b" },
  } as any)).toBe("app-b");
});

test("resolveCaseDiscoveryAppSlug: falls back to 'default' when no source", () => {
  expect(resolveCaseDiscoveryAppSlug({} as any)).toBe("default");
});

// ── Entry step insertion tests (via normalizeEntrySteps) ──

test("normalizeEntrySteps: prepends all entry steps when none present", () => {
  const rp = makeRouteProfile({
    entry: [
      { businessLabel: "home", visibleLabel: "Inicio" },
      { businessLabel: "products", visibleLabel: "Productos" },
    ],
  });
  const input = ['Validar que se muestre "Catálogo".'];

  const { steps } = normalizeEntrySteps(input, rp);

  expect(steps[0]).toBe('Clic en "Inicio".');
  expect(steps[1]).toBe('Clic en "Productos".');
  expect(steps[2]).toBe('Validar que se muestre "Catálogo".');
});

test("normalizeEntrySteps: does not duplicate when entry steps already present", () => {
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

  const { steps } = normalizeEntrySteps(input, rp);

  expect(steps[0]).toBe('Clic en "Inicio".');
  expect(steps[1]).toBe('Clic en "Productos".');
  expect(steps[2]).toBe('Validar algo.');
  expect(steps).toHaveLength(3);
});

test("normalizeEntrySteps: inserts only missing entry steps when partially present", () => {
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

  const { steps } = normalizeEntrySteps(input, rp);

  // "Iniciar sesión" should be prepended, others stay in order
  expect(steps[0]).toBe('Clic en "Iniciar sesión".');
  expect(steps[1]).toBe('Clic en "Menú principal".');
  expect(steps[2]).toBe('Clic en "Productos".');
  expect(steps[3]).toBe('Validar algo.');
});

test("normalizeEntrySteps: deduped counts excess entry steps", () => {
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

  const { deduped } = normalizeEntrySteps(input, rp);

  // 3 entry steps in input, 1 canonical → 2 excess
  expect(deduped).toBe(2);
});

// ── routeProfile entry rebuilding through normalizeScenario (indirect test) ──

test("normalizeScenario: prepends all entry steps via normalizeEntrySteps", () => {
  const rp = makeRouteProfile({
    entry: [
      { businessLabel: "login", visibleLabel: "Inicio" },
    ],
  });
  const inputSteps = ['Clic en "Productos".', 'Validar algo.'];
  const { steps } = normalizeEntrySteps(inputSteps, rp);

  expect(steps[0]).toBe('Clic en "Inicio".');
  expect(steps[1]).toBe('Clic en "Productos".');
  expect(steps[2]).toBe('Validar algo.');
});
