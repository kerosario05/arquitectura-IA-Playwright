import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromotedSpecRuntime, evaluatePromotedCompletionSignal } from "./promoted-spec-runtime";

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
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
    screenshot: async (options?: { path?: string }) => {
      if (!options?.path) return;
      await fs.mkdir(path.dirname(options.path), { recursive: true });
      await fs.writeFile(options.path, Buffer.from("mock-image"));
    },
  };
}

async function readEvidenceJson(rootDir: string, scenarioId: string) {
  const evidencePath = path.join(rootDir, "app-test", "detalle-kiosko", scenarioId, "evidence.json");
  const content = await fs.readFile(evidencePath, "utf-8");
  return JSON.parse(content);
}

test("promoted assertion success is recorded in evidence with screenshot and without duplicates", async () => {
  const evidenceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-evidence-success-"));
  try {
    const scenarioId = "SCN-SUCCESS";
    await withEnv(
      {
        EVIDENCE_ENABLED: "true",
        EVIDENCE_DOCX_ENABLED: "false",
        EVIDENCE_PER_SCENARIO_DOCX: "false",
        EVIDENCE_OUTPUT_DIR: evidenceRoot,
        APP_SLUG: "app-test",
        SECTION_SLUG: "detalle-kiosko",
        SCENARIO_ID: scenarioId,
        SCENARIO_TITLE: "Escenario de validacion auth gate",
      },
      async () => {
        const runtime = new PromotedSpecRuntime(createMockPage() as any, { captureDiagnostics: false });
        await (runtime as any).ensureInitialEvidence();
        await (runtime as any).captureClickStep("Iniciar", "passed");
        await (runtime as any).captureClickStep("transacciones y servicios", "passed");
        await runtime.expectPromotedVisible({
          stepIndex: 2,
          target: "auth_gate",
          description: "Validar que se muestre \"auth_gate\".",
          assertion: async () => undefined,
        });
        await runtime.finishEvidence();

        const evidence = await readEvidenceJson(evidenceRoot, scenarioId);
        assert.strictEqual(evidence.status, "Exitoso");
        assert.strictEqual(evidence.initialScreenEvidence.status, "ready");
        assert.strictEqual(evidence.initialScreenEvidence.captured, true);
        assert.strictEqual(evidence.steps[0].stepIndex, undefined);
        assert.strictEqual(evidence.steps.length, 3);
        assert.strictEqual(evidence.steps[2].stepText, "Validar que se muestre \"auth_gate\".");
        assert.strictEqual(evidence.steps[2].target, "auth_gate");
        assert.strictEqual(evidence.steps[2].status, "passed");
        assert.strictEqual(evidence.steps[2].stepIndex, 2);
        assert.ok(typeof evidence.steps[2].timestamp === "string" && evidence.steps[2].timestamp.length > 0);

        const screenshots = evidence.steps.map((s: any) => s.screenshotPath).filter(Boolean);
        assert.strictEqual(screenshots.length, 3);
        for (const screenshotPath of screenshots) {
          const stats = await fs.stat(screenshotPath);
          assert.ok(stats.size > 0);
        }
        const uniqueStepTexts = new Set(evidence.steps.map((s: any) => s.stepText));
        assert.strictEqual(uniqueStepTexts.size, 3);
      },
    );
  } finally {
    await fs.rm(evidenceRoot, { recursive: true, force: true });
  }
});

test("promoted assertion failure is recorded as failed before error propagation", async () => {
  const evidenceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-evidence-failed-"));
  try {
    const scenarioId = "SCN-FAILED";
    await withEnv(
      {
        EVIDENCE_ENABLED: "true",
        EVIDENCE_DOCX_ENABLED: "false",
        EVIDENCE_PER_SCENARIO_DOCX: "false",
        EVIDENCE_OUTPUT_DIR: evidenceRoot,
        APP_SLUG: "app-test",
        SECTION_SLUG: "detalle-kiosko",
        SCENARIO_ID: scenarioId,
        SCENARIO_TITLE: "Escenario de validacion fallida",
      },
      async () => {
        const runtime = new PromotedSpecRuntime(createMockPage() as any, { captureDiagnostics: false });
        await (runtime as any).ensureInitialEvidence();
        await (runtime as any).captureClickStep("Iniciar", "passed");
        await (runtime as any).captureClickStep("transacciones y servicios", "passed");

        await assert.rejects(
          runtime.expectPromotedVisible({
            stepIndex: 2,
            target: "auth_gate",
            description: "Validar que se muestre \"auth_gate\".",
            assertion: async () => {
              throw new Error("auth gate no detectado");
            },
          }),
          /Promoted assertion failed at step 2 target="auth_gate"/,
        );

        await runtime.finishEvidence();
        const evidence = await readEvidenceJson(evidenceRoot, scenarioId);
        assert.strictEqual(evidence.initialScreenEvidence.status, "ready");
        assert.strictEqual(evidence.initialScreenEvidence.captured, true);
        assert.strictEqual(evidence.steps.length, 3);
        const validationStep = evidence.steps[2];
        assert.strictEqual(validationStep.stepText, "Validar que se muestre \"auth_gate\".");
        assert.strictEqual(validationStep.status, "failed");
        assert.strictEqual(validationStep.target, "auth_gate");
        assert.strictEqual(validationStep.stepIndex, 2);
        assert.ok(typeof validationStep.screenshotPath === "string" && validationStep.screenshotPath.length > 0);
        const stats = await fs.stat(validationStep.screenshotPath);
        assert.ok(stats.size > 0);
      },
    );
  } finally {
    await fs.rm(evidenceRoot, { recursive: true, force: true });
  }
});

test("positive URL oracle accepts a verified adjacent in-place action and rejects visible failure dialogs", async () => {
  assert.equal(evaluatePromotedCompletionSignal({
    expectedUrlMatches: true,
    routeChangedSinceAction: false,
    failureMessages: [],
    successMessages: [],
  }), false);
  assert.equal(evaluatePromotedCompletionSignal({
    expectedUrlMatches: true,
    routeChangedSinceAction: false,
    actionOutcomeObserved: true,
    failureMessages: [],
    successMessages: [],
  }), true);
  assert.equal(evaluatePromotedCompletionSignal({
    expectedUrlMatches: true,
    routeChangedSinceAction: false,
    actionOutcomeObserved: false,
    failureMessages: [],
    successMessages: ["Transferencia realizada exitosamente"],
  }), true);
  assert.equal(evaluatePromotedCompletionSignal({
    expectedUrlMatches: true,
    routeChangedSinceAction: true,
    actionOutcomeObserved: true,
    failureMessages: ["No podemos procesar la operación (Code: 9902)"],
    successMessages: [],
  }), false);

  const page = createMockPage() as any;
  page.url = () => "https://example.test/summary";
  page.evaluate = async () => ({ failureMessages: [], successMessages: [] });
  const runtime = new PromotedSpecRuntime(page, { captureDiagnostics: false });
  (runtime as any).ensureInitialEvidence = async () => undefined;
  (runtime as any).captureEvidenceStep = async () => undefined;
  (runtime as any).lastActionOutcome = {
    stepIndex: 30,
    previousUrl: "https://example.test/summary",
    currentUrl: "https://example.test/summary",
    actionOutcomeObserved: true,
  };
  await runtime.expectPromotedVisible({
    stepIndex: 21,
    target: "Continuar",
    polarity: "positive",
    expectedUrl: "/summary",
    assertion: async () => undefined,
  });

  await runtime.expectPromotedVisible({
    stepIndex: 31,
    target: "Transferencia completada",
    polarity: "positive",
    expectedUrl: "/summary",
    requireCompletionSignal: true,
    assertion: async () => undefined,
  });

  (runtime as any).lastActionOutcome.actionOutcomeObserved = false;
  await assert.rejects(runtime.expectPromotedVisible({
    stepIndex: 31,
    target: "Transferencia completada",
    polarity: "positive",
    expectedUrl: "/summary",
    requireCompletionSignal: true,
    assertion: async () => undefined,
  }), /PROMOTED_COMPLETION_SIGNAL_NOT_OBSERVED/);

  page.evaluate = async () => ({
    failureMessages: ["No podemos procesar la operación (Code: 9902)"],
    successMessages: [],
  });
  await assert.rejects(runtime.expectPromotedVisible({
    stepIndex: 31,
    target: "Transferencia completada",
    polarity: "positive",
    expectedUrl: "/summary",
    requireCompletionSignal: true,
    assertion: async () => undefined,
  }), /PROMOTED_FAILURE_DIALOG_VISIBLE/);
});

test("promoted successful fills feed the shared evidence checkpoint grouper", async () => {
  const runtime = new PromotedSpecRuntime(createMockPage() as any, { captureDiagnostics: false });
  const captured: Array<{ stepText: string; status: string; options: Record<string, unknown> }> = [];
  let filled = false;
  (runtime as any).markBoundaryProgress = async () => undefined;
  (runtime as any).ensureInitialEvidence = async () => undefined;
  (runtime as any).dismissSessionExpiringWarningIfPresent = async () => undefined;
  (runtime as any).refreshActiveContainerForField = async () => ({ candidates: [], best: { matchingFieldFound: true } });
  (runtime as any).waitForPromotedUiStable = async () => undefined;
  (runtime as any).captureEvidenceStep = async (stepText: string, status: string, _error: unknown, options: Record<string, unknown>) => {
    captured.push({ stepText, status, options });
  };

  await runtime.fillPromotedField({
    stepIndex: 14,
    target: "Dirección de correo",
    value: "private-test-value",
    actionIntent: "test_fill",
    fill: async () => { filled = true; },
  });

  assert.strictEqual(filled, true);
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].status, "passed");
  assert.strictEqual(captured[0].options.target, "Dirección de correo");
  assert.strictEqual(captured[0].options.sourceStepIndex, 14);
  assert.ok(!captured[0].stepText.includes("private-test-value"));
});

test("c42940 spec keeps UTF-8-safe auth gate checks", async () => {
  const specPath = path.join(
    process.cwd(),
    "automations",
    "apps",
    "arquitectura-automatizacion",
    "sections",
    "detalle-kiosko",
    "cases",
    "c42940-acceder-a-transacciones-y-servicios-para-iniciar-autenticacion",
    "case.spec.ts",
  );
  const content = await fs.readFile(specPath, "utf-8");
  const hasUtf8SafeRegex = content.includes("identificaci(?:o|\\u00f3)n|otp|transacciones y servicios")
    || content.includes("identificaci[oó]n|otp|transacciones y servicios");
  const hasAuthStageAssertion = content.includes("detectedStage") && content.includes("phone_confirmation");
  assert.ok(hasUtf8SafeRegex || hasAuthStageAssertion);
  assert.ok(!content.includes("oÃ"));
});
