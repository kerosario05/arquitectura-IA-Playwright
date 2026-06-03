"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const test_1 = require("@playwright/test");
const job_store_1 = require("../src/server/jobs/job-store");
const scenario_preview_runner_1 = require("../src/server/jobs/scenario-preview-runner");
const ROOT = process.cwd();
function makeScenario(overrides = {}) {
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
function readJson(filePath) {
    return JSON.parse(fs_1.default.readFileSync(filePath, "utf-8"));
}
test_1.test.describe("scenario-preview e2e canonicalization", () => {
    test_1.test.beforeEach(() => {
        process.env.SCENARIO_PREVIEW_SKIP_DISCOVERY_PREVIEW = "true";
    });
    test_1.test.afterEach(() => {
        delete process.env.SCENARIO_PREVIEW_SKIP_DISCOVERY_PREVIEW;
        const fenixDir = path_1.default.join(ROOT, "automations", "apps", "fenix");
        if (fs_1.default.existsSync(fenixDir)) {
            fs_1.default.rmSync(fenixDir, { recursive: true, force: true });
        }
    });
    (0, test_1.test)("kiosko runner writes canonical visual labels to preview artifacts", () => {
        const job = job_store_1.jobStore.create("scenario-preview", {
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
        (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
        const updated = job_store_1.jobStore.get(job.id);
        (0, test_1.expect)(updated?.status).toBe("done");
        const artifactDir = updated?.summary?.artifactsDir;
        (0, test_1.expect)(artifactDir).toBeTruthy();
        const previewScenarios = readJson(path_1.default.join(artifactDir, "preview-scenarios.json"));
        const generatedCase = readJson(path_1.default.join(artifactDir, "generated-cases", "preview-001.json"));
        const results = readJson(path_1.default.join(artifactDir, "results.json"));
        const previewText = JSON.stringify(previewScenarios);
        const caseText = JSON.stringify(generatedCase);
        (0, test_1.expect)(results.ok).toBe(true);
        (0, test_1.expect)(results.skippedDiscoveryPreview).toBe(true);
        (0, test_1.expect)(previewText).toContain('Informaci');
        (0, test_1.expect)(previewText).toContain('Pr');
        (0, test_1.expect)(previewText).toContain('Dep');
        (0, test_1.expect)(previewText).toContain('Tarjetas de cr');
        (0, test_1.expect)(previewText).toContain('Finalizar sesi');
        (0, test_1.expect)(previewText).not.toContain('Clic en "Prestamos"');
        (0, test_1.expect)(previewText).not.toContain('Clic en "préstamo"');
        (0, test_1.expect)(previewText).not.toContain('Clic en "Depositos a Plazo"');
        (0, test_1.expect)(previewText).not.toContain('Clic en "Tarjetas de credito"');
        (0, test_1.expect)(previewText).not.toContain('Clic en "Informacion de productos"');
        (0, test_1.expect)(caseText).toContain('Clic en \\"Pr');
        (0, test_1.expect)(caseText).toContain('Clic en \\"Dep');
        (0, test_1.expect)(caseText).toContain('Clic en \\"Tarjetas de cr');
        (0, test_1.expect)(caseText).not.toContain('Clic en \\"Prestamos\\"');
        (0, test_1.expect)(caseText).not.toContain('Clic en \\"préstamo\\"');
        (0, test_1.expect)(updated?.logs.some((line) => line.includes("[scenario-preview-runner] beforeWrite scenario=PREVIEW-001"))).toBe(true);
        (0, test_1.expect)(updated?.logs.some((line) => line.includes("[scenario-preview-runner] beforeValidate scenario=PREVIEW-001"))).toBe(true);
    });
    (0, test_1.test)("fenix runner stays multi-app and does not expect kiosko labels", () => {
        const fenixDir = path_1.default.join(ROOT, "automations", "apps", "fenix");
        fs_1.default.mkdirSync(fenixDir, { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(fenixDir, "app.config.json"), JSON.stringify({
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
        }, null, 2), "utf-8");
        const job = job_store_1.jobStore.create("scenario-preview", {
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
        (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
        const updated = job_store_1.jobStore.get(job.id);
        (0, test_1.expect)(updated?.status).toBe("done");
        const artifactDir = updated?.summary?.artifactsDir;
        const previewText = fs_1.default.readFileSync(path_1.default.join(artifactDir, "preview-scenarios.json"), "utf-8");
        (0, test_1.expect)(previewText).toContain("Gestión de clientes");
        (0, test_1.expect)(previewText).not.toContain('Clic en \\"Préstamos\\"');
        (0, test_1.expect)(previewText).toContain('Validar que no se muestre \\"Prestamos\\".');
    });
});
