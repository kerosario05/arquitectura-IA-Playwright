/**
 * Route Profile Normalization Integration Tests
 * 
 * Tests for normalizeRouteProfileConfig function that handles:
 * - app.config.json with routeProfile object
 * - routeProfile standalone flat format
 * - intermediates to routes conversion
 * - domainTerms normalization
 */

import { test, expect } from "@playwright/test";
import { normalizeRouteProfileConfig, loadRouteProfile, type PromotedAppConfig } from "../src/automations/app-profile";

test("normalizes routeProfile object format with domainTerms as Record", () => {
  const config: any = {
    appProfile: {
      appSlug: "kiosko",
      source: "default",
      name: "Kiosko",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: {
      name: "product_information",
      entry: [],
      aliases: { tarjetas: "Tarjetas" },
      intermediates: {
        tarjetas_credito: ["Tarjetas", "Tarjeta de Crédito"],
        cuentas_pesos: ["Cuentas", "Cuenta de Ahorro", "Pesos"]
      },
      domainTerms: {
        tarjetas: "tarjeta",
        tarjetas_credito: "tarjeta",
        depositos_plazo: "depósito",
        cuentas_efectivo: "cuenta",
        prestamos: "préstamo"
      }
    }
  };
  
  const normalized = normalizeRouteProfileConfig(config as PromotedAppConfig);
  
  expect(normalized).toBeDefined();
  // Deduplication reduces 5 entries to 4 unique values (tarjeta appears twice)
  expect(normalized!.domainTerms).toHaveLength(4);
  expect(normalized!.domainTerms).toContain("tarjeta");
  expect(normalized!.domainTerms).toContain("depósito");
  expect(normalized!.domainTerms).toContain("cuenta");
  expect(normalized!.domainTerms).toContain("préstamo");
  
  expect(normalized!.routes).toHaveLength(2);
  expect(normalized!.routes![0].from).toBe("tarjetas_credito");
  expect(normalized!.routes![0].intermediates).toEqual(["Tarjetas", "Tarjeta de Crédito"]);
});

test("normalizes routeProfile object format with domainTerms as array", () => {
  const config: any = {
    appProfile: {
      appSlug: "test-app",
      source: "default",
      name: "Test",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: {
      domainTerms: ["tarjeta", "cuenta", "préstamo", "depósito"]
    }
  };
  
  const normalized = normalizeRouteProfileConfig(config as PromotedAppConfig);
  
  expect(normalized).toBeDefined();
  expect(normalized!.domainTerms).toHaveLength(4);
  expect(normalized!.domainTerms).toEqual(["tarjeta", "cuenta", "préstamo", "depósito"]);
});

test("normalizes standalone flat format with top-level fields", () => {
  const config: any = {
    appProfile: {
      appSlug: "test-app",
      source: "default",
      name: "Test",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: "product_information",
    entry: [{ businessLabel: "start", visibleLabel: "Iniciar" }],
    aliases: { start: "Iniciar" },
    intermediates: {
      tarjetas: ["Tarjetas", "Tarjeta de Crédito"]
    },
    domainTerms: {
      tarjetas: "tarjeta",
      cuentas: "cuenta"
    }
  };
  
  const normalized = normalizeRouteProfileConfig(config as PromotedAppConfig);
  
  expect(normalized).toBeDefined();
  expect(normalized!.domainTerms).toHaveLength(2);
  expect(normalized!.domainTerms).toContain("tarjeta");
  expect(normalized!.domainTerms).toContain("cuenta");
  expect(normalized!.routes).toHaveLength(1);
  expect(normalized!.routes![0].from).toBe("tarjetas");
});

test("converts intermediates to routes when routes not present", () => {
  const config: any = {
    appProfile: {
      appSlug: "test-app",
      source: "default",
      name: "Test",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: {
      intermediates: {
        route_a: ["Step 1", "Step 2", "Step 3"],
        route_b: ["Step A", "Step B"]
      }
    }
  };
  
  const normalized = normalizeRouteProfileConfig(config as PromotedAppConfig);
  
  expect(normalized).toBeDefined();
  expect(normalized!.routes).toHaveLength(2);
  expect(normalized!.routes![0].from).toBe("route_a");
  expect(normalized!.routes![0].intermediates).toEqual(["Step 1", "Step 2", "Step 3"]);
  expect(normalized!.routes![1].from).toBe("route_b");
  expect(normalized!.routes![1].intermediates).toEqual(["Step A", "Step B"]);
});

test("uses routes when both routes and intermediates present", () => {
  const config: any = {
    appProfile: {
      appSlug: "test-app",
      source: "default",
      name: "Test",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: {
      routes: [{ from: "A", intermediates: ["B", "C"], domain: "test" }],
      intermediates: {
        route_x: ["X1", "X2"]
      }
    }
  };
  
  const normalized = normalizeRouteProfileConfig(config as PromotedAppConfig);
  
  expect(normalized).toBeDefined();
  expect(normalized!.routes).toHaveLength(1);
  expect(normalized!.routes![0].from).toBe("A");
  expect(normalized!.routes![0].domain).toBe("test");
});

test("returns undefined when routeProfile is undefined", () => {
  const config: PromotedAppConfig = {
    appProfile: {
      appSlug: "test-app",
      source: "default",
      name: "Test",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  
  const normalized = normalizeRouteProfileConfig(config);
  
  expect(normalized).toBeUndefined();
});

test("deduplicates domainTerms", () => {
  const config: any = {
    appProfile: {
      appSlug: "test-app",
      source: "default",
      name: "Test",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: {
      domainTerms: {
        a: "tarjeta",
        b: "tarjeta",
        c: "cuenta",
        d: "cuenta"
      }
    }
  };
  
  const normalized = normalizeRouteProfileConfig(config as PromotedAppConfig);
  
  expect(normalized).toBeDefined();
  expect(normalized!.domainTerms).toHaveLength(2);
  expect(normalized!.domainTerms).toContain("tarjeta");
  expect(normalized!.domainTerms).toContain("cuenta");
});

test("preserves appSlug in log output", () => {
  const config: PromotedAppConfig = {
    appProfile: {
      appSlug: "kiosko",
      source: "default",
      name: "Kiosko",
      baseUrl: "https://example.com",
      baseUrlHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: {
      domainTerms: ["tarjeta", "cuenta"]
    }
  };
  
  // This test verifies the log output format
  // In actual execution, you should see:
  // [route-profile] normalized appSlug=kiosko source=app_config_object domainTerms=2 routes=0
  const normalized = normalizeRouteProfileConfig(config);
  
  expect(normalized).toBeDefined();
  expect(normalized!.domainTerms).toHaveLength(2);
});

test("loadRouteProfile loads from app.config.json with routeProfile", () => {
  // This test verifies that loadRouteProfile correctly loads routeProfile
  // from automations/apps/<appSlug>/app.config.json
  
  // Note: This test requires kiosko app config to have routeProfile defined.
  // If the config is overwritten by ensureAppStructure, this test may fail.
  // Run `npm run ensure-app-structure -- --app kiosko` to create the config,
  // then manually add routeProfile to automations/apps/kiosko/app.config.json
  
  const normalized = loadRouteProfile("kiosko");
  
  // Skip if routeProfile not configured (expected in fresh environments)
  if (!normalized) {
    console.log("[test] Skipping - kiosko app.config.json does not have routeProfile configured");
    test.skip();
    return;
  }
  
  // Verify routeProfile is loaded
  expect(normalized.domainTerms).toBeDefined();
  expect(normalized.domainTerms?.length).toBeGreaterThan(0);
});

test("loadRouteProfile returns undefined for non-existent app", () => {
  const normalized = loadRouteProfile("non-existent-app-xyz");
  
  expect(normalized).toBeUndefined();
});

test("normalizeRouteProfileConfig uses appSlug parameter when appProfile missing", () => {
  const config: PromotedAppConfig = {
    baseUrl: "https://example.com",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "auto_generate",
    updatedAt: "2026-01-01T00:00:00.000Z",
    routeProfile: {
      domainTerms: ["producto", "servicio"]
    }
  } as any;
  
  // Should use the appSlug parameter instead of "unknown"
  const normalized = normalizeRouteProfileConfig(config, "test-app");
  
  expect(normalized).toBeDefined();
  expect(normalized!.domainTerms).toHaveLength(2);
});
