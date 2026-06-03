import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { jobStore } from "../src/server/jobs/job-store";
import { startScenarioPreviewRun } from "../src/server/jobs/scenario-preview-runner";
import type { McpScenario } from "../src/scenarios/scenario-types";

const ROOT = process.cwd();

function makeScenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return {
    sourceIssueKey: overrides.sourceIssueKey ?? "PREVIEW-1",
    title: overrides.title ?? "Visualizar detalle del primer prestamo personal visible",
    steps: overrides.steps ?? [
      '1. Clic en "Iniciar".',
      '2. Clic en "Informacion de productos".',
      '3. Clic en "Prestamos".',
      '4. Validar que se muestre "Prestamos personales".',
      '5. Clic en "Finalizar sesion".',
    ],
    preconditions: overrides.preconditions ?? [],
    expectedResult: overrides.expectedResult ?? 'Se muestran "Prestamos" y el usuario puede volver.',
    type: overrides.type ?? "functional",
    database: overrides.database ?? "",
    isConverted: overrides.isConverted ?? 0,
    automationType: overrides.automationType ?? "e2e",
    setupStrategy: overrides.setupStrategy ?? "default",
    appSlug: overrides.appSlug ?? "arquitectura-automatizacion",
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

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

test.describe("scenario-preview e2e canonicalization", () => {
  test.beforeEach(() => {
    process.env.SCENARIO_PREVIEW_SKIP_DISCOVERY_PREVIEW = "true";
  });

  test.afterEach(() => {
    delete process.env.SCENARIO_PREVIEW_SKIP_DISCOVERY_PREVIEW;
    const fenixDir = path.join(ROOT, "automations", "apps", "fenix");
    if (fs.existsSync(fenixDir)) {
      fs.rmSync(fenixDir, { recursive: true, force: true });
    }
  });

  test("kiosko runner writes canonical visual labels to preview artifacts", () => {
    const job = jobStore.create("scenario-preview", {
      scenarios: [
        makeScenario({
          sourceIssueKey: "AA-381",
          targetAppSlug: "kiosko",
          targetAppName: "KIOSKO",
          steps: [
            '1. Clic en "Iniciar".',
            '2. Clic en "Informacion de productos".',
            '3. Clic en "Prestamos".',
            '4. Clic en "Depositos a Plazo".',
            '5. Clic en "Tarjetas de credito".',
            '6. Clic en "Finalizar sesion".',
          ],
          expectedResult: 'Se muestran "Prestamos", "Depositos a Plazo" y "Tarjetas de credito".',
        }),
      ],
      appSlug: "arquitectura-automatizacion",
      targetAppSlug: "kiosko",
    });

    startScenarioPreviewRun(job.id);

    const updated = jobStore.get(job.id);
    expect(updated?.status).toBe("done");

    const artifactDir = updated?.summary?.artifactsDir;
    expect(artifactDir).toBeTruthy();

    const previewScenarios = readJson<Array<{ steps: string[]; expectedResult: string }>>(path.join(artifactDir!, "preview-scenarios.json"));
    const generatedCase = readJson<{ steps: string[]; expectedResult: string }>(path.join(artifactDir!, "generated-cases", "preview-001.json"));
    const results = readJson<{ ok: boolean; skippedDiscoveryPreview?: boolean }>(path.join(artifactDir!, "results.json"));

    const previewText = JSON.stringify(previewScenarios);
    const caseText = JSON.stringify(generatedCase);

    expect(results.ok).toBe(true);
    expect(results.skippedDiscoveryPreview).toBe(true);

    expect(previewText).toContain('Informaci');
    expect(previewText).toContain('Pr');
    expect(previewText).toContain('Dep');
    expect(previewText).toContain('Tarjetas de cr');
    expect(previewText).toContain('Finalizar sesi');

    expect(previewText).not.toContain('Clic en "Prestamos"');
    expect(previewText).not.toContain('Clic en "préstamo"');
    expect(previewText).not.toContain('Clic en "Depositos a Plazo"');
    expect(previewText).not.toContain('Clic en "Tarjetas de credito"');
    expect(previewText).not.toContain('Clic en "Informacion de productos"');

    expect(caseText).toContain('Clic en \\"Pr');
    expect(caseText).toContain('Clic en \\"Dep');
    expect(caseText).toContain('Clic en \\"Tarjetas de cr');
    expect(caseText).not.toContain('Clic en \\"Prestamos\\"');
    expect(caseText).not.toContain('Clic en \\"préstamo\\"');

    expect(updated?.logs.some((line) => line.includes("[scenario-preview-runner] beforeWrite scenario=PREVIEW-001"))).toBe(true);
    expect(updated?.logs.some((line) => line.includes("[scenario-preview-runner] beforeValidate scenario=PREVIEW-001"))).toBe(true);
  });

  test("fenix runner stays multi-app and does not expect kiosko labels", () => {
    const fenixDir = path.join(ROOT, "automations", "apps", "fenix");
    fs.mkdirSync(fenixDir, { recursive: true });
    fs.writeFileSync(
      path.join(fenixDir, "app.config.json"),
      JSON.stringify(
        {
          appSlug: "fenix",
          routeProfile: {
            name: "gestion_clientes",
            entry: [
              { businessLabel: "iniciar", visibleLabel: "Ingresar" },
              { businessLabel: "clientes", visibleLabel: "Gestión de clientes" },
            ],
            aliases: {
              gestion_clientes: "Gestión de clientes",
            },
            domainTerms: {
              cliente: ["cliente", "clientes"],
            },
            visibleControls: ["Ingresar", "Gestión de clientes", "Buscar", "Volver"],
            representativeFixture: {},
            notes: [],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const job = jobStore.create("scenario-preview", {
      scenarios: [
        makeScenario({
          sourceIssueKey: "FX-101",
          appSlug: "fenix",
          targetAppSlug: "fenix",
          targetAppName: "Fenix",
          title: "Gestion de clientes disponible",
          steps: [
            '1. Clic en "Ingresar".',
            '2. Clic en "Gestion de clientes".',
            '3. Validar que no se muestre "Prestamos".',
          ],
          expectedResult: 'Se muestra "Gestion de clientes".',
        }),
      ],
      appSlug: "fenix",
      targetAppSlug: "fenix",
    });

    startScenarioPreviewRun(job.id);

    const updated = jobStore.get(job.id);
    expect(updated?.status).toBe("done");

    const artifactDir = updated?.summary?.artifactsDir!;
    const previewText = fs.readFileSync(path.join(artifactDir, "preview-scenarios.json"), "utf-8");

    expect(previewText).toContain("Gestión de clientes");
    expect(previewText).not.toContain('Clic en \\"Préstamos\\"');
    expect(previewText).toContain('Validar que no se muestre \\"Prestamos\\".');
  });
});
