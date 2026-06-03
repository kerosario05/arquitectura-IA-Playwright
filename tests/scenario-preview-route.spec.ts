import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { jobStore } from "../src/server/jobs/job-store";
import { startScenarioPreviewRun } from "../src/server/jobs/scenario-preview-runner";
import type { McpScenario } from "../src/scenarios/scenario-types";

function makeMcpScenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return {
    sourceIssueKey: overrides.sourceIssueKey ?? "PROJ-1",
    title: overrides.title ?? "Test scenario",
    steps: overrides.steps ?? ["Step 1"],
    preconditions: overrides.preconditions ?? [],
    expectedResult: overrides.expectedResult ?? "Result",
    type: overrides.type ?? "functional",
    database: overrides.database ?? "",
    isConverted: overrides.isConverted ?? 0,
    automationType: overrides.automationType ?? "e2e",
    setupStrategy: overrides.setupStrategy ?? "default",
    appSlug: overrides.appSlug ?? "test-app",
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

function validateScenarioPreviewRequest(body: Record<string, unknown>): { ok: true } | { ok: false; status: number; error: string; message: string } {
  const scenarios = body.scenarios as McpScenario[] | undefined;

  if (!scenarios || scenarios.length === 0) {
    return { ok: false, status: 400, error: "invalid_preview_scenarios", message: "No hay escenarios válidos para ejecutar." };
  }

  const validScenarios = scenarios.filter(
    (s) => s.mcpExecutable === true && s.validation?.valid !== false
  );

  if (validScenarios.length === 0) {
    return { ok: false, status: 400, error: "invalid_preview_scenarios", message: "No hay escenarios válidos para ejecutar." };
  }

  for (const sc of validScenarios) {
    if (!sc.steps || sc.steps.length === 0) {
      return { ok: false, status: 400, error: "invalid_preview_scenarios", message: `El escenario "${sc.sourceIssueKey}" no tiene steps.` };
    }
  }

  const functionalAppSlug = body.functionalAppSlug as string | undefined;
  const appSlug = body.appSlug as string | undefined;
  const targetAppSlug = body.targetAppSlug as string | undefined;
  if (!functionalAppSlug && !appSlug && !targetAppSlug) {
    return { ok: false, status: 400, error: "invalid_preview_scenarios", message: "appSlug es requerido." };
  }

  const requiresTestRailSync = body.publishToTestRail === true || body.createTestRun === true || body.reportResults === true;
  if (requiresTestRailSync) {
    if (!body.testrailProjectId || !body.testrailSuiteId || !body.testrailSectionId) {
      return {
        ok: false,
        status: 400,
        error: "invalid_preview_scenarios",
        message: "projectId, suiteId y sectionId son requeridos para publicar y reportar en TestRail.",
      };
    }
  }

  return { ok: true };
}

// ── Route validation tests ──

test("scenario-preview route: returns 400 if scenarios is missing", () => {
  const result = validateScenarioPreviewRequest({});
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.error).toBe("invalid_preview_scenarios");
    expect(result.message).toBe("No hay escenarios válidos para ejecutar.");
  }
});

test("scenario-preview route: returns 400 if scenarios is empty array", () => {
  const result = validateScenarioPreviewRequest({ scenarios: [] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.error).toBe("invalid_preview_scenarios");
  }
});

test("scenario-preview route: returns 400 if scenario is not mcpExecutable", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario({ mcpExecutable: false })],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.error).toBe("invalid_preview_scenarios");
  }
});

test("scenario-preview route: returns 400 if scenario is invalid", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario({ validation: { valid: false, errors: ["Invalid"], warnings: [] } })],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
  }
});

test("scenario-preview route: returns 400 if scenario has no steps", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario({ steps: [] })],
    appSlug: "kiosko",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.message).toContain("no tiene steps");
  }
});

test("scenario-preview route: returns 400 if appSlug is missing", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario()],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.message).toContain("appSlug es requerido");
  }
});

test("scenario-preview route: accepts valid scenarios with appSlug", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81", caseId: undefined })],
    appSlug: "kiosko",
  });
  expect(result.ok).toBe(true);
});

test("scenario-preview route: accepts valid scenarios with targetAppSlug", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario({ targetAppSlug: "kiosko" })],
    targetAppSlug: "kiosko",
  });
  expect(result.ok).toBe(true);
});

test("scenario-preview route: accepts valid scenarios with functionalAppSlug even when appSlug is technical", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario({ targetAppSlug: "kiosko" })],
    appSlug: "tests",
    targetAppSlug: "tests",
    functionalAppSlug: "kiosko",
  });
  expect(result.ok).toBe(true);
});

test("scenario-preview route: requires TestRail ids when publish/report flags are enabled", () => {
  const result = validateScenarioPreviewRequest({
    scenarios: [makeMcpScenario({ targetAppSlug: "kiosko" })],
    appSlug: "kiosko",
    publishToTestRail: true,
    createTestRun: true,
    reportResults: true,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toContain("projectId, suiteId y sectionId");
  }
});

// ── Job store tests ──

test("jobStore: creates scenario-preview job with correct type", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [makeMcpScenario()],
    appSlug: "kiosko",
  });
  expect(job.type).toBe("scenario-preview");
  expect(job.status).toBe("queued");
});

test("jobStore: scenario-preview job is retrievable", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81" })],
    appSlug: "kiosko",
  });
  const retrieved = jobStore.get(job.id);
  expect(retrieved).toBeDefined();
  expect(retrieved?.type).toBe("scenario-preview");
});

test("jobStore: scenario-preview job appears in list", () => {
  const before = jobStore.list().length;
  jobStore.create("scenario-preview", { scenarios: [makeMcpScenario()], appSlug: "kiosko" });
  const after = jobStore.list().length;
  expect(after).toBe(before + 1);
});

// ── Runner tests ──

test("runner: fails job when scenarios is empty", () => {
  const job = jobStore.create("scenario-preview", { scenarios: [] });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.logs.some((l: string) => l.includes("no scenarios provided"))).toBe(true);
});

test("runner: fails job when scenarios is missing", () => {
  const job = jobStore.create("scenario-preview", {});
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.logs.some((l: string) => l.includes("no scenarios provided"))).toBe(true);
});

test("runner: fails job when no valid mcpExecutable scenarios", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [makeMcpScenario({ mcpExecutable: false })],
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.logs.some((l: string) => l.includes("no valid mcpExecutable"))).toBe(true);
});

test("runner: starts job with valid scenarios and saves artifacts", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({ sourceIssueKey: "AA-81", title: "Visualizar categorías" }),
      makeMcpScenario({ sourceIssueKey: "AA-82", title: "Seleccionar producto" }),
    ],
    appSlug: "kiosko",
    targetAppSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  expect(updated?.logs.some((l: string) => l.includes("scenarios=2"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("appSlug=kiosko"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("Saved 2 scenarios"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("PREVIEW-001"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("PREVIEW-002"))).toBe(true);
});

test("runner: uses functional appSlug (targetAppSlug)", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [makeMcpScenario({ targetAppSlug: "kiosko" })],
    appSlug: "arquitectura-automatizacion",
    targetAppSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  expect(updated?.logs.some((l: string) => l.includes("appSlug=kiosko"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("[scenario-preview] requestedAppSlug=arquitectura-automatizacion"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("scenarioTargetAppSlug=kiosko"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("effectiveTargetAppSlug=kiosko"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("command=npm.cmd run discovery:preview -- --input"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("--app kiosko"))).toBe(true);
});

test("runner: sectionName metadata does not replace functional appSlug", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({
        title: "Detalle_KIOSKO",
        sourceIssueKey: "AA-900",
        targetAppSlug: "kiosko",
        appSlug: "kiosko",
      }),
    ],
    appSlug: "kiosko",
    targetAppSlug: "kiosko",
    sectionName: "Kiosko / REGRESION-KIOSKO",
  });

  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  expect(updated?.logs.some((l: string) => l.includes("effectiveTargetAppSlug=kiosko"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("sectionSlug=kiosko-regresion-kiosko"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("metadataOnly=true"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("--app kiosko"))).toBe(true);
});

test("runner: requested technical appSlug and technical scenario target does not resolve to section-derived slug", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({
        title: "Escenario técnico",
        sourceIssueKey: "AA-910",
        targetAppSlug: "kiosko-regresion-kiosko",
        appSlug: "tests",
      }),
    ],
    appSlug: "tests",
    targetAppSlug: "tests",
    sectionName: "Kiosko / REGRESION-KIOSKO",
  });

  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.errorMessage).toContain("section-derived");
  expect(updated?.logs.some((l: string) => l.includes("effectiveTargetAppSlug=kiosko-regresion-kiosko"))).toBe(false);
  expect(updated?.logs.some((l: string) => l.includes("--app kiosko-regresion-kiosko"))).toBe(false);
});

test("runner: default without valid routeProfile does not execute scenario-preview", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({
        sourceIssueKey: "AA-911",
        title: "Sin perfil",
        targetAppSlug: "default",
      }),
    ],
    appSlug: "default",
    targetAppSlug: "default",
  });

  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.errorMessage).toContain("technical/non-executable");
  expect(updated?.errorMessage).toContain("routeProfile");
});

test("runner: writes diagnostic error when only sectionName exists but no functional app is found", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({
        sourceIssueKey: "AA-901",
        title: "Escenario sin pista funcional",
        targetAppSlug: undefined,
      }),
    ],
    appSlug: "tests",
    sectionName: "Kiosko / REGRESION-KIOSKO",
  });

  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.errorMessage).toContain("technical/non-executable");

  const artifactDir = path.join(process.cwd(), ".artifacts", "scenario-preview-runs", job.id);
  const results = JSON.parse(fs.readFileSync(path.join(artifactDir, "results.json"), "utf-8")) as {
    error: string;
    diagnostics?: {
      requestedAppSlug?: string;
      requestTargetAppSlug?: string | null;
      scenarioTargetAppSlugs?: string[];
      sectionName?: string | null;
      sectionSlug?: string | null;
      titlesSample?: string[];
    };
  };
  expect(results.error).toBe("invalid_target_app_slug");
  expect(results.diagnostics?.requestedAppSlug).toBe("tests");
  expect(results.diagnostics?.scenarioTargetAppSlugs).toEqual([]);
  expect(results.diagnostics?.sectionName).toBe("Kiosko / REGRESION-KIOSKO");
  expect(results.diagnostics?.sectionSlug).toBe("kiosko-regresion-kiosko");
  expect(results.diagnostics?.titlesSample?.[0]).toContain("Escenario sin pista funcional");
});

test("runner: logs include scenario titles", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({ sourceIssueKey: "AA-81", title: "Visualizar categorías principales" }),
    ],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  expect(updated?.logs.some((l: string) => l.includes("Visualizar categorías principales"))).toBe(true);
});

test("runner: does not call discovery:batch", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [makeMcpScenario()],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  // The command should use discovery:preview, not discovery:batch
  expect(updated?.logs.some((l: string) => l.includes("discovery:preview"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("discovery:batch"))).toBe(false);
});

test("runner: summary includes scenario count", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({ sourceIssueKey: "AA-81" }),
      makeMcpScenario({ sourceIssueKey: "AA-82" }),
      makeMcpScenario({ sourceIssueKey: "AA-83" }),
    ],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.summary?.totalStories).toBe(3);
});

test("runner: logs include command and child started before execution", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81" })],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  expect(updated?.logs.some((l: string) => l.includes("command=npm.cmd"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("child started pid="))).toBe(true);
});

test("runner: logs include finalSteps after normalization", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81", title: "Test" })],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  expect(updated?.logs.some((l: string) => l.includes("finalSteps scenario=PREVIEW-001"))).toBe(true);
});

test("runner: preserves targetAppSlug in preview-scenarios json", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({ sourceIssueKey: "AA-81", title: "Visualizar categorías", targetAppSlug: "kiosko" }),
      makeMcpScenario({ sourceIssueKey: "AA-82", title: "Seleccionar producto", targetAppSlug: "kiosko" }),
    ],
    appSlug: "tests",
    targetAppSlug: "kiosko",
  });

  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect.poll(() => jobStore.get(job.id)?.status).toBe("done");
  const finished = jobStore.get(job.id);

  const previewPath = path.join(finished?.summary?.artifactsDir ?? "", "preview-scenarios.json");
  const preview = JSON.parse(fs.readFileSync(previewPath, "utf-8")) as Array<{ targetAppSlug?: string }>;
  expect(preview.every((scenario) => scenario.targetAppSlug === "kiosko")).toBe(true);
});

test("runner: fails with errorMessage when no scenarios provided", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.errorMessage).toBe("No scenarios provided");
  expect(updated?.summary?.errorMessage).toBe("No scenarios provided");
});

test("runner: fails with errorMessage when no valid mcpExecutable scenarios", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({ sourceIssueKey: "AA-81", mcpExecutable: false }),
    ],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.errorMessage).toBe("No valid mcpExecutable scenarios");
  expect(updated?.summary?.errorMessage).toBe("No valid mcpExecutable scenarios");
});

test("runner: summary includes scenarioCount on failure", () => {
  const job = jobStore.create("scenario-preview", {
    scenarios: [
      makeMcpScenario({ sourceIssueKey: "AA-81", mcpExecutable: false }),
      makeMcpScenario({ sourceIssueKey: "AA-82", mcpExecutable: false }),
    ],
    appSlug: "kiosko",
  });
  startScenarioPreviewRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.summary?.totalStories).toBe(2);
});
