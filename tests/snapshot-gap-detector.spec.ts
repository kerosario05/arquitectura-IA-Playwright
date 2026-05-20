import { test, expect } from "@playwright/test";
import { analyzeSnapshotGaps, formatGapDiagnosis } from "../src/agent/snapshot-gap-detector";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { PageSnapshot } from "../src/types/page-snapshot.types";

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    version: "1.0",
    source: "rule_based",
    status: "needs_data",
    scenario: { source: "testrail", externalId: "C37750", caseId: 37750, title: "Consulta listado de tarjetas de credito" },
    requiredData: [],
    steps: [
      { index: 1, action: "navigate", target: "APP_BASE_URL", description: "Navigate to base URL" },
      { index: 2, action: "login", description: "Apply configured login strategy" },
      {
        index: 3,
        action: "noop",
        description: "Abrir URL del Kiosko. Clic en 'Iniciar'. Clic en 'Información de productos'. Clic en 'Tarjetas'. Clic en 'Tarjeta de Crédito'. Validar listado de tarjetas de crédito.",
        expected: "Validar que la pantalla final muestre señales esperadas: Tarjeta de Crédito Visa Clásica Visa Gold Visa Platinum Visa Infinite"
      }
    ],
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function makeSnapshot(elements: Array<{ text?: string; label?: string; placeholder?: string; name?: string; nearbyText?: string }>): PageSnapshot {
  return {
    version: "1.0",
    url: "https://172.27.4.50/",
    title: "Kiosco de Autogestión",
    capturedAt: new Date().toISOString(),
    elements: elements.map((el, i) => ({
      id: `el-${i + 1}`,
      type: "button" as const,
      text: el.text,
      label: el.label,
      placeholder: el.placeholder,
      name: el.name,
      nearbyText: el.nearbyText,
      visible: true,
      candidateLocators: [],
      dataHints: []
    })),
    summary: { totalElements: elements.length, buttons: elements.length, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
  };
}

test.describe("analyzeSnapshotGaps", () => {
  test("detects missing targets in NOOP step when snapshot only has initial screen", () => {
    const plan = makePlan();
    const snapshot = makeSnapshot([
      { text: "Iniciar" },
      { text: "¡Hola!" },
      { text: "Bienvenido al kiosco de autogestión de Banco Santa Cruz" }
    ]);

    const analysis = analyzeSnapshotGaps(plan, snapshot);

    expect(analysis.hasGaps).toBe(true);
    expect(analysis.gaps).toHaveLength(1);
    expect(analysis.gaps[0].stepIndex).toBe(3);
    expect(analysis.allMissingTargets.length).toBeGreaterThan(0);
  });

  test("reports specific missing targets for C37750-like scenario", () => {
    const plan = makePlan();
    const snapshot = makeSnapshot([
      { text: "Iniciar" },
      { text: "¡Hola!" }
    ]);

    const analysis = analyzeSnapshotGaps(plan, snapshot);

    const allMissing = analysis.allMissingTargets.join(" ").toLowerCase();
    expect(allMissing).toContain("información")
    expect(allMissing).toContain("tarjetas")
    expect(allMissing).toContain("crédito")
  });

  test("no gaps when all targets exist in snapshot", () => {
    const plan = makePlan({
      steps: [
        { index: 1, action: "noop", description: "Clic en 'Iniciar'" }
      ]
    });
    const snapshot = makeSnapshot([{ text: "Iniciar" }]);

    const analysis = analyzeSnapshotGaps(plan, snapshot);

    expect(analysis.hasGaps).toBe(false);
    expect(analysis.gaps).toHaveLength(0);
  });

  test("no gaps when snapshot is undefined", () => {
    const plan = makePlan({
      steps: [
        { index: 1, action: "noop", description: "Some action" }
      ]
    });

    const analysis = analyzeSnapshotGaps(plan, undefined);

    expect(analysis.hasGaps).toBe(true);
  });

  test("skips non-NOOP steps", () => {
    const plan = makePlan({
      steps: [
        { index: 1, action: "navigate", target: "APP_BASE_URL" },
        { index: 2, action: "login" },
        { index: 3, action: "click", target: { strategy: "text", value: "Iniciar" } }
      ]
    });
    const snapshot = makeSnapshot([{ text: "Iniciar" }]);

    const analysis = analyzeSnapshotGaps(plan, snapshot);

    expect(analysis.hasGaps).toBe(false);
  });

  test("detects targets in quoted strings", () => {
    const plan = makePlan({
      steps: [
        { index: 1, action: "noop", description: "Clic en 'Información de productos'" }
      ]
    });
    const snapshot = makeSnapshot([{ text: "Iniciar" }]);

    const analysis = analyzeSnapshotGaps(plan, snapshot);

    expect(analysis.hasGaps).toBe(true);
    expect(analysis.gaps[0].missingTargets).toContain("Información de productos");
  });

  test("handles empty NOOP description", () => {
    const plan = makePlan({
      steps: [
        { index: 1, action: "noop", description: "" }
      ]
    });
    const snapshot = makeSnapshot([{ text: "Iniciar" }]);

    const analysis = analyzeSnapshotGaps(plan, snapshot);

    expect(analysis.hasGaps).toBe(false);
  });

  test("handles undefined snapshot gracefully", () => {
    const plan = makePlan();

    const analysis = analyzeSnapshotGaps(plan, undefined);

    expect(analysis.hasGaps).toBe(true);
    expect(analysis.allMissingTargets.length).toBeGreaterThan(0);
  });
});

test.describe("formatGapDiagnosis", () => {
  test("returns empty string when no gaps", () => {
    const analysis = { hasGaps: false, gaps: [], allMissingTargets: [] };
    const diagnosis = formatGapDiagnosis(analysis, true);
    expect(diagnosis).toBe("");
  });

  test("includes missing targets in diagnosis", () => {
    const analysis = {
      hasGaps: true,
      gaps: [{ stepIndex: 3, stepDescription: "Test step", missingTargets: ["Tarjetas", "Tarjeta de Crédito"] }],
      allMissingTargets: ["Tarjetas", "Tarjeta de Crédito"]
    };

    const diagnosis = formatGapDiagnosis(analysis, true);

    expect(diagnosis).toContain("Tarjetas");
    expect(diagnosis).toContain("Tarjeta de Crédito");
  });

  test("includes discovery recommendation when noPlaywright is true", () => {
    const analysis = {
      hasGaps: true,
      gaps: [{ stepIndex: 3, stepDescription: "Test step", missingTargets: ["Tarjetas"] }],
      allMissingTargets: ["Tarjetas"]
    };

    const diagnosis = formatGapDiagnosis(analysis, true);

    expect(diagnosis).toContain("browser discovery");
    expect(diagnosis).toContain("not present in the captured snapshot");
  });

  test("includes step index in diagnosis", () => {
    const analysis = {
      hasGaps: true,
      gaps: [{ stepIndex: 3, stepDescription: "Test step", missingTargets: ["Tarjetas"] }],
      allMissingTargets: ["Tarjetas"]
    };

    const diagnosis = formatGapDiagnosis(analysis, true);

    expect(diagnosis).toContain("Step #3");
  });

  test("does not include discovery recommendation when noPlaywright is false", () => {
    const analysis = {
      hasGaps: true,
      gaps: [{ stepIndex: 3, stepDescription: "Test step", missingTargets: ["Tarjetas"] }],
      allMissingTargets: ["Tarjetas"]
    };

    const diagnosis = formatGapDiagnosis(analysis, false);

    expect(diagnosis).not.toContain("browser discovery");
  });
});
