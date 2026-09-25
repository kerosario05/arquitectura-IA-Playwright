"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const promoted_spec_runtime_1 = require("./promoted-spec-runtime");
function withEnv(vars, fn) {
    const original = {};
    for (const [key, value] of Object.entries(vars)) {
        original[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    return fn().finally(() => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    });
}
function createMockPage() {
    return {
        on: () => undefined,
        url: () => "https://example.test/",
        isClosed: () => false,
        waitForLoadState: async () => undefined,
        evaluate: async () => true,
        screenshot: async (options) => {
            if (!options?.path)
                return;
            await promises_1.default.mkdir(node_path_1.default.dirname(options.path), { recursive: true });
            await promises_1.default.writeFile(options.path, Buffer.from("mock-image"));
        },
    };
}
async function readEvidenceJson(rootDir, scenarioId) {
    const evidencePath = node_path_1.default.join(rootDir, "app-test", "detalle-kiosko", scenarioId, "evidence.json");
    const content = await promises_1.default.readFile(evidencePath, "utf-8");
    return JSON.parse(content);
}
(0, node_test_1.default)("promoted assertion success is recorded in evidence with screenshot and without duplicates", async () => {
    const evidenceRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "runtime-evidence-success-"));
    try {
        const scenarioId = "SCN-SUCCESS";
        await withEnv({
            EVIDENCE_ENABLED: "true",
            EVIDENCE_DOCX_ENABLED: "false",
            EVIDENCE_PER_SCENARIO_DOCX: "false",
            EVIDENCE_OUTPUT_DIR: evidenceRoot,
            APP_SLUG: "app-test",
            SECTION_SLUG: "detalle-kiosko",
            SCENARIO_ID: scenarioId,
            SCENARIO_TITLE: "Escenario de validacion auth gate",
        }, async () => {
            const runtime = new promoted_spec_runtime_1.PromotedSpecRuntime(createMockPage(), { captureDiagnostics: false });
            await runtime.ensureInitialEvidence();
            await runtime.captureClickStep("Iniciar", "passed");
            await runtime.captureClickStep("transacciones y servicios", "passed");
            await runtime.expectPromotedVisible({
                stepIndex: 2,
                target: "auth_gate",
                description: "Validar que se muestre \"auth_gate\".",
                assertion: async () => undefined,
            });
            await runtime.finishEvidence();
            const evidence = await readEvidenceJson(evidenceRoot, scenarioId);
            node_assert_1.default.strictEqual(evidence.status, "Exitoso");
            node_assert_1.default.strictEqual(evidence.initialScreenEvidence.status, "ready");
            node_assert_1.default.strictEqual(evidence.initialScreenEvidence.captured, true);
            node_assert_1.default.strictEqual(evidence.steps[0].stepIndex, undefined);
            node_assert_1.default.strictEqual(evidence.steps.length, 3);
            node_assert_1.default.strictEqual(evidence.steps[2].stepText, "Validar que se muestre \"auth_gate\".");
            node_assert_1.default.strictEqual(evidence.steps[2].target, "auth_gate");
            node_assert_1.default.strictEqual(evidence.steps[2].status, "passed");
            node_assert_1.default.strictEqual(evidence.steps[2].stepIndex, 2);
            node_assert_1.default.ok(typeof evidence.steps[2].timestamp === "string" && evidence.steps[2].timestamp.length > 0);
            const screenshots = evidence.steps.map((s) => s.screenshotPath).filter(Boolean);
            node_assert_1.default.strictEqual(screenshots.length, 3);
            for (const screenshotPath of screenshots) {
                const stats = await promises_1.default.stat(screenshotPath);
                node_assert_1.default.ok(stats.size > 0);
            }
            const uniqueStepTexts = new Set(evidence.steps.map((s) => s.stepText));
            node_assert_1.default.strictEqual(uniqueStepTexts.size, 3);
        });
    }
    finally {
        await promises_1.default.rm(evidenceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("promoted assertion failure is recorded as failed before error propagation", async () => {
    const evidenceRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "runtime-evidence-failed-"));
    try {
        const scenarioId = "SCN-FAILED";
        await withEnv({
            EVIDENCE_ENABLED: "true",
            EVIDENCE_DOCX_ENABLED: "false",
            EVIDENCE_PER_SCENARIO_DOCX: "false",
            EVIDENCE_OUTPUT_DIR: evidenceRoot,
            APP_SLUG: "app-test",
            SECTION_SLUG: "detalle-kiosko",
            SCENARIO_ID: scenarioId,
            SCENARIO_TITLE: "Escenario de validacion fallida",
        }, async () => {
            const runtime = new promoted_spec_runtime_1.PromotedSpecRuntime(createMockPage(), { captureDiagnostics: false });
            await runtime.ensureInitialEvidence();
            await runtime.captureClickStep("Iniciar", "passed");
            await runtime.captureClickStep("transacciones y servicios", "passed");
            await node_assert_1.default.rejects(runtime.expectPromotedVisible({
                stepIndex: 2,
                target: "auth_gate",
                description: "Validar que se muestre \"auth_gate\".",
                assertion: async () => {
                    throw new Error("auth gate no detectado");
                },
            }), /Promoted assertion failed at step 2 target="auth_gate"/);
            await runtime.finishEvidence();
            const evidence = await readEvidenceJson(evidenceRoot, scenarioId);
            node_assert_1.default.strictEqual(evidence.initialScreenEvidence.status, "ready");
            node_assert_1.default.strictEqual(evidence.initialScreenEvidence.captured, true);
            node_assert_1.default.strictEqual(evidence.steps.length, 3);
            const validationStep = evidence.steps[2];
            node_assert_1.default.strictEqual(validationStep.stepText, "Validar que se muestre \"auth_gate\".");
            node_assert_1.default.strictEqual(validationStep.status, "failed");
            node_assert_1.default.strictEqual(validationStep.target, "auth_gate");
            node_assert_1.default.strictEqual(validationStep.stepIndex, 2);
            node_assert_1.default.ok(typeof validationStep.screenshotPath === "string" && validationStep.screenshotPath.length > 0);
            const stats = await promises_1.default.stat(validationStep.screenshotPath);
            node_assert_1.default.ok(stats.size > 0);
        });
    }
    finally {
        await promises_1.default.rm(evidenceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("c42940 spec keeps UTF-8-safe auth gate checks", async () => {
    const specPath = node_path_1.default.join(process.cwd(), "automations", "apps", "arquitectura-automatizacion", "sections", "detalle-kiosko", "cases", "c42940-acceder-a-transacciones-y-servicios-para-iniciar-autenticacion", "case.spec.ts");
    const content = await promises_1.default.readFile(specPath, "utf-8");
    const hasUtf8SafeRegex = content.includes("identificaci(?:o|\\u00f3)n|otp|transacciones y servicios")
        || content.includes("identificaci[oó]n|otp|transacciones y servicios");
    const hasAuthStageAssertion = content.includes("detectedStage") && content.includes("phone_confirmation");
    node_assert_1.default.ok(hasUtf8SafeRegex || hasAuthStageAssertion);
    node_assert_1.default.ok(!content.includes("oÃ"));
});
