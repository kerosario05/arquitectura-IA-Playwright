import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createPromotedSpecRuntime } from "../src/automations/runtime/promoted-spec-runtime";
import { EvidenceRecorder } from "../src/evidence/evidence-recorder";
import { buildEvidencePaths } from "../src/evidence/evidence-paths";
import { consolidateRunEvidenceForExecution } from "../src/server/jobs/discovery-batch-runner";
import { jobStore } from "../src/server/jobs/job-store";
import { resolveEvidenceDocxForJob } from "../src/server/routes/runs";

const EVIDENCE_ROOT = path.join(process.cwd(), ".artifacts", "evidence");

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function rmIfExists(targetPath: string): Promise<void> {
  if (fs.existsSync(targetPath)) {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  }
}

async function withEnv(
  updates: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("explicit section slug is preserved for runtime evidence identity", async () => {
  const appSlug = uniqueId("app");
  const sectionSlug = "detalle-kiosko";
  const scenarioId = `C${Math.floor(Math.random() * 100000)}`;
  const runId = uniqueId("job");
  const scenarioTitle = "Runtime Evidence Init";
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
    originalLog(...args);
  };

  try {
    await withEnv(
      {
        EVIDENCE_ENABLED: "true",
        EVIDENCE_PER_SCENARIO_DOCX: "false",
        EVIDENCE_APP_SLUG: appSlug,
        EVIDENCE_SECTION_SLUG: sectionSlug,
        APP_SLUG: appSlug,
        SECTION_SLUG: "default-section",
        SCENARIO_ID: scenarioId,
        SCENARIO_TITLE: scenarioTitle,
        EVIDENCE_RUN_ID: runId,
      },
      async () => {
        const fakePage = {
          on: () => undefined,
        } as any;
        const runtime = createPromotedSpecRuntime(fakePage);
        await runtime.finishEvidence();
      },
    );
  } finally {
    console.log = originalLog;
  }

  const paths = buildEvidencePaths({
    appSlug,
    sectionSlug,
    scenarioId,
    scenarioTitle,
    runId,
  });

  expect(logs.some((line) => line.includes("[evidence] initialized scenario="))).toBe(true);
  expect(logs.some((line) => line.includes("[evidence] init failed"))).toBe(false);
  expect(logs.some((line) => line.includes("Cannot use import statement outside a module"))).toBe(false);
  expect(logs.some((line) => line.includes("Failed to load the ES module"))).toBe(false);
  expect(logs.some((line) => line.includes("perScenarioDocxGenerated=false"))).toBe(true);
  expect(logs.some((line) => /\[evidence\]\s+scenario=.*\sdocx=/.test(line))).toBe(false);
  expect(fs.existsSync(paths.evidenceJsonPath)).toBe(true);
  expect(paths.evidenceJsonPath.includes(`${path.sep}${sectionSlug}${path.sep}`)).toBe(true);
  expect(paths.evidenceJsonPath.includes(`${path.sep}default-section${path.sep}`)).toBe(false);

  await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});

test("generic explicit section slug is propagated without hardcoding", async () => {
  const appSlug = uniqueId("app");
  const sectionSlug = uniqueId("section-ficticia");
  const scenarioId = uniqueId("scenario");
  const runId = uniqueId("run");

  await withEnv(
    {
      EVIDENCE_ENABLED: "true",
      EVIDENCE_APP_SLUG: appSlug,
      EVIDENCE_SECTION_SLUG: sectionSlug,
      APP_SLUG: appSlug,
      SECTION_SLUG: "default-section",
      SCENARIO_ID: scenarioId,
      SCENARIO_TITLE: "Generic Section Propagation",
      EVIDENCE_RUN_ID: runId,
    },
    async () => {
      const fakePage = { on: () => undefined } as any;
      const runtime = createPromotedSpecRuntime(fakePage);
      await runtime.finishEvidence();
    },
  );

  const paths = buildEvidencePaths({
    appSlug,
    sectionSlug,
    scenarioId,
    scenarioTitle: "Generic Section Propagation",
    runId,
  });

  expect(fs.existsSync(paths.evidenceJsonPath)).toBe(true);
  expect(paths.evidenceJsonPath.includes(`${path.sep}${sectionSlug}${path.sep}`)).toBe(true);
  expect(paths.evidenceJsonPath.includes(`${path.sep}default-section${path.sep}`)).toBe(false);

  await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});

test("missing section falls back to default-section", async () => {
  const appSlug = uniqueId("app");
  const scenarioId = uniqueId("scenario");
  const runId = uniqueId("run");

  await withEnv(
    {
      EVIDENCE_ENABLED: "true",
      EVIDENCE_APP_SLUG: appSlug,
      APP_SLUG: appSlug,
      EVIDENCE_SECTION_SLUG: undefined,
      SECTION_SLUG: undefined,
      SCENARIO_ID: scenarioId,
      SCENARIO_TITLE: "Fallback Section",
      EVIDENCE_RUN_ID: runId,
    },
    async () => {
      const fakePage = { on: () => undefined } as any;
      const runtime = createPromotedSpecRuntime(fakePage);
      await runtime.finishEvidence();
    },
  );

  const fallbackPaths = buildEvidencePaths({
    appSlug,
    sectionSlug: "default-section",
    scenarioId,
    scenarioTitle: "Fallback Section",
    runId,
  });
  expect(fs.existsSync(fallbackPaths.evidenceJsonPath)).toBe(true);
  expect(fallbackPaths.evidenceJsonPath.includes(`${path.sep}default-section${path.sep}`)).toBe(true);

  await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});

test("evidence recorder writes simulated functional result artifact", async () => {
  const appSlug = uniqueId("app");
  const sectionSlug = uniqueId("section");
  const scenarioId = uniqueId("scenario");
  const runId = uniqueId("run");

  const recorder = new EvidenceRecorder({
    appSlug,
    sectionSlug,
    scenarioId,
    scenarioTitle: "Simulated Result",
    runId,
  }, {
    enabled: true,
    docxEnabled: true,
    perScenarioDocx: false,
  });

  await recorder.start();
  recorder.addStepRecord(1, "Paso funcional simulado", { status: "passed" });
  const record = await recorder.finish();

  expect(record.steps).toHaveLength(1);
  expect(record.steps[0].status).toBe("passed");
  expect(record.evidenceJsonPath).toBeDefined();
  expect(record.evidenceJsonPath && fs.existsSync(record.evidenceJsonPath)).toBe(true);

  await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});

test("consolidation counts 4 evidences and keeps documentPath on the same jobId", async () => {
  const appSlug = uniqueId("app");
  const sectionSlug = "detalle-kiosko";
  const job = jobStore.create("discovery-batch", { appSlug, sectionSlug });
  const runId = job.id;

  for (const label of ["A", "B", "C", "D"]) {
    const recorder = new EvidenceRecorder({
      appSlug,
      sectionSlug,
      scenarioId: uniqueId(`scenario-${label.toLowerCase()}`),
      scenarioTitle: `Scenario ${label}`,
      runId,
    }, {
      enabled: true,
      docxEnabled: true,
      perScenarioDocx: false,
    });
    await recorder.start();
    recorder.addStepRecord(1, `Paso ${label}`, { status: "passed" });
    await recorder.finish();
  }

  const consolidation = await consolidateRunEvidenceForExecution(runId, appSlug, sectionSlug, "Section");
  expect(consolidation.attempted).toBe(true);
  expect(consolidation.generated).toBe(true);
  expect(consolidation.documentPathPresent).toBe(true);
  expect(consolidation.scenarioEvidenceCount).toBe(4);
  expect(consolidation.documentPath).toBeDefined();
  expect(consolidation.documentPath && fs.existsSync(consolidation.documentPath)).toBe(true);

  jobStore.update(job.id, {
    status: "done",
    summary: {
      totalStories: 4,
      synced: 0,
      passed: 4,
      failed: 0,
      documentAttempted: true,
      documentGenerated: true,
      documentPathPresent: true,
      documentPath: consolidation.documentPath,
      evidenceResults: 4,
    },
  });

  const resolution = resolveEvidenceDocxForJob(job.id);
  expect(resolution.status).toBe("ready");
  expect(resolution.documentReady).toBe(true);
  expect(path.resolve(resolution.documentPath ?? "")).toBe(path.resolve(consolidation.documentPath ?? ""));

  await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});
