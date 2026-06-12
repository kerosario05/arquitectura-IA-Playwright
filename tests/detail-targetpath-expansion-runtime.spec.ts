import { test, expect } from "@playwright/test";
import { runCaseDiscovery } from "../src/discovery/case-discovery";
import * as fs from "node:fs";
import * as path from "node:path";

test.describe("Task A: Detail TargetPath Expansion Runtime", () => {
  const artifactsDir = ".artifacts/test-targetpath-expansion-runtime";

  test.beforeEach(async () => {
    await fs.promises.mkdir(artifactsDir, { recursive: true });
  });

  test.afterEach(async () => {
    await fs.promises.rm(artifactsDir, { recursive: true, force: true });
  });

  const createMockRouteProfile = (productName: string, intermediates: string[], detailSections: string[]) => ({
    entry: ["Iniciar"],
    aliases: { "Información de productos": ["Productos", "Información de productos"] },
    visibleControls: ["Iniciar", "Información de productos", ...intermediates, productName, ...detailSections],
    domainTerms: { elemento: "producto" },
    targetPaths: {
      [productName]: {
        target: productName,
        requiredIntermediates: intermediates,
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          clickableToDetail: true,
          productLabel: productName,
          normalizedLabel: productName.toLowerCase(),
          detailSections,
          actionButtons: ["Volver", "Solicitar"],
          presentationType: "detail_page"
        }
      }
    }
  });

  test("Préstamo Personal uses exact click, not ordinal selection", async ({ page }) => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    const mockScenario: any = {
      id: 99001,
      title: "Visualizar detalles de Préstamo Personal",
      steps: [
        { index: 1, content: 'Clic en "Iniciar".' },
        { index: 2, content: 'Clic en "Información de productos".' },
        { index: 3, content: 'Clic en "Préstamos".' },
        { index: 4, content: 'Clic en "Préstamo Personal".' },
        { index: 5, content: 'Validar que se muestre "Beneficios".' }
      ],
      expected_result: "Se visualizan los detalles del Préstamo Personal.",
      routeProfile: createMockRouteProfile(
        "Préstamo Personal",
        ["Información de productos", "Préstamos"],
        ["Beneficios", "Información del Producto"]
      )
    };

    try {
      await runCaseDiscovery({
        page,
        scenario: mockScenario,
        evidenceDir: path.join(artifactsDir, "evidence-prestamo"),
        pendingObjectsPath: path.join(artifactsDir, "pending-objects-prestamo.json"),
        pendingPlansPath: path.join(artifactsDir, "pending-plans-prestamo.json"),
        appBaseUrl: "data:text/html,<html><body><h1>Mock</h1></body></html>",
        headless: true,
        appSlug: "test-app",
        config: {} as any
      }).catch(() => {});
    } finally {
      console.log = originalLog;
    }

    // Verify logs show detail-route-expansion-runtime
    const expansionLogs = logs.filter(l => l.includes("[detail-route-expansion-runtime]"));
    expect(expansionLogs.length).toBeGreaterThan(0);

    // Verify no ordinal selection logs
    const ordinalRemovedLog = expansionLogs.find(l => l.includes("removedOrdinal=true"));
    if (ordinalRemovedLog) {
      console.log(`✓ Ordinal selection removed for Préstamo Personal`);
    }

    // Verify exact target is in expansion
    const expansionCompleteLog = expansionLogs.find(l => l.includes("expansionComplete=true"));
    if (expansionCompleteLog) {
      expect(expansionCompleteLog).toContain("Préstamo Personal");
      console.log(`✓ Exact target 'Préstamo Personal' added to navigation path`);
    }

    // Verify finalProductClickStepIndex was updated
    const finalClickLog = expansionLogs.find(l => l.includes("updatedFinalProductClickStepIndex"));
    expect(finalClickLog).toBeDefined();
    expect(finalClickLog).toContain('target="Préstamo Personal"');
    console.log(`✓ finalProductClickStepIndex updated to exact target click`);
  });

  test("Depósitos a plazo en Dólares uses exact click, doesn't select Pesos", async ({ page }) => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    const mockScenario: any = {
      id: 99002,
      title: "Visualizar detalles de Depósitos a plazo en Dólares",
      steps: [
        { index: 1, content: 'Clic en "Iniciar".' },
        { index: 2, content: 'Clic en "Información de productos".' },
        { index: 3, content: 'Clic en "Depósitos a plazo".' },
        { index: 4, content: 'Clic en "Depósitos a plazo en Dólares".' },
        { index: 5, content: 'Validar que se muestre "Detalles".' }
      ],
      expected_result: "Se visualizan los detalles de Depósitos a plazo en Dólares.",
      routeProfile: createMockRouteProfile(
        "Depósitos a plazo en Dólares",
        ["Información de productos", "Depósitos a plazo"],
        ["Detalles", "Requisitos"]
      )
    };

    try {
      await runCaseDiscovery({
        page,
        scenario: mockScenario,
        evidenceDir: path.join(artifactsDir, "evidence-depositos"),
        pendingObjectsPath: path.join(artifactsDir, "pending-objects-depositos.json"),
        pendingPlansPath: path.join(artifactsDir, "pending-plans-depositos.json"),
        appBaseUrl: "data:text/html,<html><body><h1>Mock</h1></body></html>",
        headless: true,
        appSlug: "test-app",
        config: {} as any
      }).catch(() => {});
    } finally {
      console.log = originalLog;
    }

    const expansionLogs = logs.filter(l => l.includes("[detail-route-expansion-runtime]"));
    expect(expansionLogs.length).toBeGreaterThan(0);

    // Verify exact Dólares variant is used
    const expansionCompleteLog = expansionLogs.find(l => l.includes("expansionComplete=true"));
    if (expansionCompleteLog) {
      expect(expansionCompleteLog).toContain("Depósitos a plazo en Dólares");
      expect(expansionCompleteLog).not.toContain("Pesos");
      console.log(`✓ Exact variant 'Dólares' used, not 'Pesos'`);
    }

    // Verify finalProductClickStepIndex targets Dólares
    const finalClickLog = expansionLogs.find(l => l.includes("updatedFinalProductClickStepIndex"));
    expect(finalClickLog).toBeDefined();
    expect(finalClickLog).toContain('target="Depósitos a plazo en Dólares"');
    console.log(`✓ finalProductClickStepIndex targets exact Dólares variant`);
  });

  test("Tarjeta Crédito Visa Gold uses exact click from targetPath", async ({ page }) => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    const mockScenario: any = {
      id: 99003,
      title: "Visualizar detalles de Tarjeta Crédito Visa Gold",
      steps: [
        { index: 1, content: 'Clic en "Iniciar".' },
        { index: 2, content: 'Clic en "Información de productos".' },
        { index: 3, content: 'Clic en "Tarjetas de Crédito".' },
        { index: 4, content: 'Clic en "Tarjeta Crédito Visa Gold".' },
        { index: 5, content: 'Validar que se muestre "Detalles".' }
      ],
      expected_result: "Se visualizan los detalles de la Tarjeta Crédito Visa Gold.",
      routeProfile: createMockRouteProfile(
        "Tarjeta Crédito Visa Gold",
        ["Información de productos", "Tarjetas de Crédito"],
        ["Detalles", "Beneficios"]
      )
    };

    try {
      await runCaseDiscovery({
        page,
        scenario: mockScenario,
        evidenceDir: path.join(artifactsDir, "evidence-visa-gold"),
        pendingObjectsPath: path.join(artifactsDir, "pending-objects-visa-gold.json"),
        pendingPlansPath: path.join(artifactsDir, "pending-plans-visa-gold.json"),
        appBaseUrl: "data:text/html,<html><body><h1>Mock</h1></body></html>",
        headless: true,
        appSlug: "test-app",
        config: {} as any
      }).catch(() => {});
    } finally {
      console.log = originalLog;
    }

    const expansionLogs = logs.filter(l => l.includes("[detail-route-expansion-runtime]"));
    expect(expansionLogs.length).toBeGreaterThan(0);

    // Verify exact Visa Gold target
    const expansionCompleteLog = expansionLogs.find(l => l.includes("expansionComplete=true"));
    if (expansionCompleteLog) {
      expect(expansionCompleteLog).toContain("Tarjeta Crédito Visa Gold");
      console.log(`✓ Exact target 'Tarjeta Crédito Visa Gold' used`);
    }

    const finalClickLog = expansionLogs.find(l => l.includes("updatedFinalProductClickStepIndex"));
    expect(finalClickLog).toBeDefined();
    expect(finalClickLog).toContain('target="Tarjeta Crédito Visa Gold"');
    console.log(`✓ Visa Gold exact click configured`);
  });

  test("No ordinal selection remains when targetPath exists", async ({ page }) => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    const mockScenario: any = {
      id: 99004,
      title: "Visualizar detalles de Cuenta de Ahorros Personal en Pesos",
      steps: [
        { index: 1, content: 'Clic en "Iniciar".' },
        { index: 2, content: 'Clic en "Información de productos".' },
        { index: 3, content: 'Clic en "Cuentas de Efectivo".' },
        { index: 4, content: 'Seleccionar el primer elemento visible del listado.' },
        { index: 5, content: 'Validar que se muestre "Detalles".' }
      ],
      expected_result: "Se visualizan los detalles de la cuenta.",
      routeProfile: createMockRouteProfile(
        "Cuenta de Ahorros Personal en Pesos",
        ["Información de productos", "Cuentas de Efectivo"],
        ["Detalles", "Requisitos"]
      )
    };

    try {
      await runCaseDiscovery({
        page,
        scenario: mockScenario,
        evidenceDir: path.join(artifactsDir, "evidence-cuenta-pesos"),
        pendingObjectsPath: path.join(artifactsDir, "pending-objects-cuenta-pesos.json"),
        pendingPlansPath: path.join(artifactsDir, "pending-plans-cuenta-pesos.json"),
        appBaseUrl: "data:text/html,<html><body><h1>Mock</h1></body></html>",
        headless: true,
        appSlug: "test-app",
        config: {} as any
      }).catch(() => {});
    } finally {
      console.log = originalLog;
    }

    const expansionLogs = logs.filter(l => l.includes("[detail-route-expansion-runtime]"));
    expect(expansionLogs.length).toBeGreaterThan(0);

    // Verify ordinal was removed
    const ordinalRemovedLog = expansionLogs.find(l => l.includes("removedOrdinal=true"));
    expect(ordinalRemovedLog).toBeDefined();
    expect(ordinalRemovedLog).toContain("reason=replaced_with_exact_path");
    console.log(`✓ Generic ordinal selection removed`);

    // Verify exact target added
    const addedStepLog = expansionLogs.find(l =>
      l.includes("addedStep=true") && l.includes("Cuenta de Ahorros Personal en Pesos")
    );
    expect(addedStepLog).toBeDefined();
    console.log(`✓ Exact target 'Cuenta de Ahorros Personal en Pesos' added`);

    // Verify no ordinal selection references remain in expansion
    const expansionCompleteLog = expansionLogs.find(l => l.includes("expansionComplete=true"));
    expect(expansionCompleteLog).toBeDefined();
    expect(expansionCompleteLog).not.toContain("Seleccionar");
    expect(expansionCompleteLog).not.toContain("primer");
    expect(expansionCompleteLog).not.toContain("listado");
    console.log(`✓ No ordinal selection references in final expansion`);
  });

  test("Detail scenario without targetPath is marked blocked", async ({ page }) => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    const mockRouteProfileWithoutTarget = {
      entry: ["Iniciar"],
      aliases: {},
      visibleControls: ["Iniciar", "Información de productos", "Seguros"],
      domainTerms: { elemento: "producto" },
      targetPaths: {
        // No entry for "Seguro de Vida"
      }
    };

    const mockScenario: any = {
      id: 99005,
      title: "Visualizar detalles de Seguro de Vida",
      steps: [
        { index: 1, content: 'Clic en "Iniciar".' },
        { index: 2, content: 'Clic en "Información de productos".' },
        { index: 3, content: 'Clic en "Seguros".' },
        { index: 4, content: 'Clic en "Seguro de Vida".' },
        { index: 5, content: 'Validar que se muestre "Detalles".' }
      ],
      expected_result: "Se visualizan los detalles del Seguro de Vida.",
      routeProfile: mockRouteProfileWithoutTarget
    };

    try {
      await runCaseDiscovery({
        page,
        scenario: mockScenario,
        evidenceDir: path.join(artifactsDir, "evidence-seguro"),
        pendingObjectsPath: path.join(artifactsDir, "pending-objects-seguro.json"),
        pendingPlansPath: path.join(artifactsDir, "pending-plans-seguro.json"),
        appBaseUrl: "data:text/html,<html><body><h1>Mock</h1></body></html>",
        headless: true,
        appSlug: "test-app",
        config: {} as any
      }).catch(() => {});
    } finally {
      console.log = originalLog;
    }

    const expansionLogs = logs.filter(l => l.includes("[detail-route-expansion-runtime]"));
    expect(expansionLogs.length).toBeGreaterThan(0);

    // Verify blocked status
    const blockedLog = expansionLogs.find(l => l.includes("blocked=true"));
    expect(blockedLog).toBeDefined();
    expect(blockedLog).toContain('detailTarget="Seguro de Vida"');
    expect(blockedLog).toContain("reason=needs_route_profile");
    expect(blockedLog).toContain("suggestion=");
    console.log(`✓ Detail scenario without targetPath marked as blocked`);
    console.log(`✓ Suggestion provided to add targetPath to routeProfile`);
  });
});
