import { test, expect } from "@playwright/test";
import { runCaseDiscovery } from "../src/discovery/case-discovery";
import type { TestRailCase } from "../src/testrail/testrail-types";
import * as fs from "node:fs";
import * as path from "node:path";

test.describe("Detail Screenshot Runtime Integration", () => {
  const mockRouteProfile = {
    entry: ["Iniciar"],
    aliases: { "Información de productos": ["Productos", "Información de productos"] },
    visibleControls: [
      "Iniciar",
      "Información de productos",
      "Tarjetas de Crédito",
      "Tarjeta Crédito Visa Clásica",
      "Detalles",
      "Beneficios",
      "Botón Volver visible"
    ],
    domainTerms: { elemento: "producto" },
    targetPaths: {
      "Tarjeta Crédito Visa Clásica": {
        target: "Tarjeta Crédito Visa Clásica",
        requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
        confidence: "high",
        source: "manual",
        productMetadata: {
          clickableToDetail: true,
          productLabel: "Tarjeta Crédito Visa Clásica",
          normalizedLabel: "tarjeta credito visa clasica",
          detailSections: ["Detalles", "Beneficios"],
          actionButtons: ["Solicitar", "Volver"]
        }
      }
    }
  };

  const mockAppConfig = {
    appSlug: "test-app",
    baseUrl: "data:text/html,<html><body><h1>Mock App</h1></body></html>",
    loginMode: "no_login",
    routeProfile: mockRouteProfile
  };

  const mockScenario: any = {
    id: 99999,
    title: "Visualizar detalles de Tarjeta Crédito Visa Clásica",
    steps: [
      { index: 1, content: 'Clic en "Iniciar".' },
      { index: 2, content: 'Clic en "Información de productos".' },
      { index: 3, content: 'Clic en "Tarjetas de Crédito".' },
      { index: 4, content: 'Clic en "Tarjeta Crédito Visa Clásica".' },
      { index: 5, content: 'Validar que se muestre "Detalles".' },
      { index: 6, content: 'Validar que se muestre "Beneficios".' },
      { index: 7, content: 'Validar que el botón "Solicitar" esté visible.' }
    ],
    expected_result: "Se visualizan los detalles completos de la Tarjeta Crédito Visa Clásica.",
    routeProfile: mockRouteProfile
  };

  test("runCaseDiscovery logs [detail-runtime] at scenario start", async ({ page }) => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    const artifactsDir = ".artifacts/test-detail-runtime-integration";
    await fs.promises.mkdir(artifactsDir, { recursive: true });

    try {
      // This will likely fail during execution but we're checking for logs at startup
      await runCaseDiscovery({
        page,  // Use Playwright's page fixture
        scenario: mockScenario,
        evidenceDir: path.join(artifactsDir, "evidence"),
        pendingObjectsPath: path.join(artifactsDir, "pending-objects.json"),
        pendingPlansPath: path.join(artifactsDir, "pending-plans.json"),
        appBaseUrl: mockAppConfig.baseUrl,
        headless: true,
        appSlug: mockAppConfig.appSlug,
        config: mockAppConfig as any
      }).catch((err) => {
        // Expected to fail - we're just testing log output during initialization
        console.log(`Discovery failed (expected): ${err.message}`);
      });
    } finally {
      console.log = originalLog;
    }

    // Verify [detail-runtime] log was produced
    console.log("=== All captured logs ===");
    logs.forEach((log, idx) => console.log(`${idx}: ${log}`));
    console.log("=== End logs ===");

    const detailRuntimeLogs = logs.filter(l => l.includes("[detail-runtime]"));
    expect(detailRuntimeLogs.length).toBeGreaterThan(0);

    const firstLog = detailRuntimeLogs[0];
    expect(firstLog).toContain('scenario="Visualizar detalles de Tarjeta Crédito Visa Clásica"');
    expect(firstLog).toContain('detailTarget="Tarjeta Crédito Visa Clásica"');
    expect(firstLog).toContain("finalProductClickStepIndex=4");
    expect(firstLog).toContain('criticalAssertions=');

    console.log(`✓ [detail-runtime] log detected at scenario start`);

    // Cleanup
    await fs.promises.rm(artifactsDir, { recursive: true, force: true });
  });

  test.skip("detail screenshot captured after final product click", async () => {
    // This test requires a full mock browser environment with clickable elements
    // Implementation would need to set up a test server with actual HTML pages
    // that simulate the app structure
    console.log("⚠ Skipped - requires full mock environment");
  });

  test.skip("evidence gate overrides status to Fallido when missing screenshot", async () => {
    // This test requires completing discovery and checking evidence.json
    // Implementation would run full discovery and verify evidence gate behavior
    console.log("⚠ Skipped - requires full discovery execution");
  });

  test("critical assertions block early completion (unit-level check)", async () => {
    // This test verifies the early completion policy logic, not full runtime
    const { evaluateEarlyCompletionPolicy } = await import("../src/discovery/early-completion-policy");

    const result = evaluateEarlyCompletionPolicy({
      pendingActions: [],
      executedStepIndices: new Set([1, 2, 3, 4]),
      skippedSteps: [],
      satisfiedAssertions: ["Se muestra Iniciar", "Se muestra Información de productos"],
      pendingAssertions: [
        "Se muestra Tarjeta Crédito Visa Clásica",
        "Se muestra Detalles",
        "Se muestra Beneficios"
      ],
      criticalAssertions: {
        target: "Tarjeta Crédito Visa Clásica",
        detailSections: ["Detalles", "Beneficios"],
        actionButtons: ["Solicitar"]
      }
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("pending_critical_assertions");
    console.log(`✓ Early completion blocked by critical assertions`);
  });
});
