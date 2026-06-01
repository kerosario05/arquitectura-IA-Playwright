import { jobStore } from "./job-store";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { runCaseDiscoveryWorkflow } from "../../discovery/case-discovery-workflow";
import { resolveAppProfile, ensureAppStructure } from "../../automations/app-profile";
import { loadAllAppAutomationEntries } from "../../automations/automation-registry-loader";
import type { TestScenario } from "../../types/testrail.types";
import type { AddResultForCaseInput } from "../../types/testrail.types";

// ─── Types matching the preview response ──────────────────────────────────────

type PreviewStep = { content: string; expected: string };

type PreviewScenario = {
  title: string;
  refs: string;
  custom_preconds: string | null;
  custom_steps_separated: PreviewStep[];
  custom_expected: string;
};

type PreviewStory = {
  jiraKey: string;
  title: string;
  scenarios: PreviewScenario[];
};

export type ScenarioRunParams = {
  stories: PreviewStory[];
  sprint?: { id: number; name: string };
  sectionId?: string;
  app?: string;
  headed?: boolean;
  autoPromote?: boolean;
  overwrite?: boolean;
  force?: boolean;
  autoRepair?: boolean;
  repairTimeoutMs?: number;
};

// ─── TestRail status IDs ──────────────────────────────────────────────────────

const TR_PASSED = 1;
const TR_FAILED = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(jobId: string, msg: string): void {
  console.log(msg);
  jobStore.appendLog(jobId, msg);
}

function previewToTestScenario(
  scenario: PreviewScenario,
  jiraKey: string,
  caseId: number
): TestScenario {
  return {
    source: "testrail" as const,
    externalId: `C${caseId}`,
    caseId,
    title: scenario.title,
    preconditions: scenario.custom_preconds ?? undefined,
    references: jiraKey,
    steps: scenario.custom_steps_separated.map((s, i) => ({
      index: i + 1,
      action: s.content,
      expected: s.expected || undefined,
      dataHints: []
    }))
  };
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function startScenarioRun(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });

  const p = job.params as ScenarioRunParams;
  const trProjectId = config.integrations.testRail?.projectId;
  const trSuiteId = config.integrations.testRail?.suiteId;
  const resolvedSectionId = p.sectionId || config.integrations.testRail?.sectionId;
  const sprintLabel = p.sprint?.name ?? "Manual";

  if (!trProjectId) {
    log(jobId, "[scenario-run] ERROR: TESTRAIL_PROJECT_ID no configurado en .env");
    jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString(), exitCode: 1 });
    return;
  }
  if (!resolvedSectionId) {
    log(jobId, "[scenario-run] ERROR: sectionId requerido (body o TESTRAIL_SECTION_ID en .env)");
    jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString(), exitCode: 1 });
    return;
  }

  try {
    const tr = new TestRailClient(requireTestRailConfig(config));

    // ── Fase 1: Guardar escenarios en TestRail ────────────────────────────────
    log(jobId, `\n${"─".repeat(50)}`);
    log(jobId, `[Fase 1] Guardando ${p.stories.reduce((s, h) => s + h.scenarios.length, 0)} escenario(s) en TestRail...`);

    const syncedCases: { jiraKey: string; caseId: number; title: string; scenario: PreviewScenario }[] = [];

    for (const story of p.stories) {
      log(jobId, `[Fase 1] Historia ${story.jiraKey}: "${story.title}" — ${story.scenarios.length} escenario(s)`);

      // Buscar casos existentes en la sección por suite para detectar duplicados por título
      let existingCases: { id: number; title: string }[] = [];
      try {
        existingCases = await tr.getCases(trProjectId, trSuiteId, resolvedSectionId);
      } catch {
        existingCases = [];
      }

      for (const scenario of story.scenarios) {
        const stepsSeparated = scenario.custom_steps_separated.map((s) => ({
          content: s.content,
          expected: s.expected
        }));

        try {
          const match = existingCases.find((c) => c.title === scenario.title);
          let caseId: number;

          if (match) {
            const updated = await tr.updateCase(match.id, {
              title: scenario.title,
              preconditions: scenario.custom_preconds ?? undefined,
              stepsSeparated,
              expectedResult: scenario.custom_expected
            });
            caseId = updated.id;
            log(jobId, `  [Fase 1] Actualizado C${caseId}: "${scenario.title}"`);
          } else {
            const created = await tr.addCase(resolvedSectionId, {
              title: scenario.title,
              preconditions: scenario.custom_preconds ?? undefined,
              stepsSeparated,
              expectedResult: scenario.custom_expected
            });
            caseId = created.id;
            log(jobId, `  [Fase 1] Creado C${caseId}: "${scenario.title}"`);
          }

          syncedCases.push({ jiraKey: story.jiraKey, caseId, title: scenario.title, scenario });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(jobId, `  [Fase 1] ERROR guardando "${scenario.title}": ${msg}`);
        }
      }
    }

    log(jobId, `[Fase 1] ${syncedCases.length} caso(s) guardados en TestRail`);

    if (syncedCases.length === 0) {
      log(jobId, "[Fase 1] ERROR: no se pudo guardar ningún caso en TestRail — abortando pipeline");
      jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString(), exitCode: 1 });
      return;
    }

    // ── Crear TestRail Run ────────────────────────────────────────────────────
    const runName = `[Auto] ${sprintLabel} — ${new Date().toISOString().slice(0, 10)}`;
    log(jobId, `[Fase 1] Creando Run: "${runName}"...`);

    const testRailRun = await tr.addRun({
      projectId: trProjectId,
      suiteId: trSuiteId,
      name: runName,
      description: `Pipeline automático IA → TestRail → Playwright. Sprint: ${sprintLabel}`,
      caseIds: syncedCases.map((c) => c.caseId)
    });

    log(jobId, `[Fase 1] Run creado → id=${testRailRun.id}${testRailRun.url ? "  " + testRailRun.url : ""}`);

    // ── Fase 2: Discovery (Playwright) por caso ───────────────────────────────
    log(jobId, `\n${"─".repeat(50)}`);
    log(jobId, `[Fase 2] Iniciando discovery para ${syncedCases.length} caso(s)...`);

    const { profile: appProfile, baseDir } = await resolveAppProfile({
      cliAppSlug: p.app,
      envAppSlug: process.env.APP_SLUG,
      baseUrl: config.app.baseUrl,
      appName: config.app.name
    });
    await ensureAppStructure(baseDir);

    // Cargar registro de automatizaciones para detectar casos ya automatizados
    const automationEntries = await loadAllAppAutomationEntries();
    const automationByCaseId = new Map(
      automationEntries
        .filter((e) => typeof e.caseId === "number")
        .map((e) => [e.caseId as number, e])
    );
    log(jobId, `[Fase 2] Registro cargado — ${automationByCaseId.size} caso(s) ya automatizados en el proyecto`);

    const results: AddResultForCaseInput[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const synced of syncedCases) {
      log(jobId, `\n[Fase 2] [C${synced.caseId}] "${synced.title}"`);

      // Verificar si ya está automatizado
      const existingEntry = automationByCaseId.get(synced.caseId);
      if (existingEntry && existingEntry.status === "active" && !p.force) {
        log(jobId, `[Fase 2] [C${synced.caseId}] ⏭ OMITIDO — ya automatizado (status=active, specPath=${existingEntry.specPath})`);
        log(jobId, `[Fase 2] [C${synced.caseId}]   → Usa force=true para re-correr el discovery`);
        skipped++;
        results.push({
          runId: testRailRun.id,
          caseId: synced.caseId,
          statusId: TR_PASSED,
          comment: `Spec ya promovida y activa: ${existingEntry.specPath}`,
          elapsed: "0s"
        });
        continue;
      }

      if (existingEntry && !p.force) {
        log(jobId, `[Fase 2] [C${synced.caseId}] ℹ Caso existe en registro con status="${existingEntry.status}" — ejecutando discovery`);
      }

      const testScenario = previewToTestScenario(synced.scenario, synced.jiraKey, synced.caseId);
      const startTime = Date.now();

      // Redirigir console al jobStore para que los logs del discovery aparezcan en el SSE
      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;
      const captureConsole = (...args: unknown[]) => {
        const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
        origLog(msg);
        jobStore.appendLog(jobId, msg);
      };
      console.log = captureConsole;
      console.warn = captureConsole;
      console.error = captureConsole;

      try {
        const workflowResult = await runCaseDiscoveryWorkflow({
          scenario: testScenario,
          headed: p.headed ?? false,
          autoPromote: p.autoPromote ?? true,
          promotionDryRun: false,
          promotionStrict: false,
          requirePromotionApproval: false,
          pageObjectMode: true,
          allowPageObjectCandidates: true,
          overwrite: p.overwrite ?? false,
          autoRepair: p.autoRepair ?? (process.env.AGENT_AUTO_REPAIR_ENABLED === "true"),
          repairTimeoutMs: p.repairTimeoutMs ?? 180_000,
          agentMaxAttempts: 5,
          config,
          appProfile
        });

        const durationMs = Date.now() - startTime;
        const statusId = workflowResult.promotionStatus === "promoted" ? TR_PASSED : TR_FAILED;
        const status = statusId === TR_PASSED ? "✓ PASSED" : "✗ FAILED";

        log(jobId, `[Fase 2] [C${synced.caseId}] ${status} — ${workflowResult.promotionStatus} (${Math.round(durationMs / 1000)}s)`);

        statusId === TR_PASSED ? passed++ : failed++;

        results.push({
          runId: testRailRun.id,
          caseId: synced.caseId,
          statusId,
          comment: `Discovery: ${workflowResult.caseResult.status} | Promotion: ${workflowResult.promotionStatus}`,
          elapsed: `${Math.round(durationMs / 1000)}s`
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;
        log(jobId, `[Fase 2] [C${synced.caseId}] ✗ ERROR: ${msg}`);
        failed++;
        results.push({
          runId: testRailRun.id,
          caseId: synced.caseId,
          statusId: TR_FAILED,
          comment: `Error inesperado: ${msg}`,
          elapsed: `${Math.round(durationMs / 1000)}s`
        });
      } finally {
        // Restaurar console original
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
      }
    }

    // ── Fase 3: Reportar resultados a TestRail ────────────────────────────────
    log(jobId, `\n${"─".repeat(50)}`);
    log(jobId, `[Fase 3] Enviando ${results.length} resultado(s) al Run ${testRailRun.id}...`);

    if (results.length === 0) {
      log(jobId, "[Fase 3] Sin resultados para reportar — todos los casos fueron omitidos o fallaron antes del discovery");
    } else {
      const reportResult = await tr.addResultsForCases(testRailRun.id, results);
      log(jobId, `[Fase 3] ${reportResult.added} resultado(s) reportados a TestRail`);
    }

    // ── Resumen final ─────────────────────────────────────────────────────────
    log(jobId, `\n${"=".repeat(50)}`);
    log(jobId, `PIPELINE COMPLETADO`);
    log(jobId, `${"=".repeat(50)}`);
    log(jobId, `Historias procesadas : ${p.stories.length}`);
    log(jobId, `Casos en TestRail    : ${syncedCases.length}`);
    log(jobId, `Passed               : ${passed}`);
    log(jobId, `Failed               : ${failed}`);
    log(jobId, `Omitidos (ya auto)   : ${skipped}`);
    log(jobId, `TestRail Run         : id=${testRailRun.id}${testRailRun.url ? "  " + testRailRun.url : ""}`);
    log(jobId, `${"=".repeat(50)}`);

    const allPassed = failed === 0 && syncedCases.length > 0;
    jobStore.update(jobId, {
      status: allPassed ? "done" : "failed",
      completedAt: new Date().toISOString(),
      exitCode: allPassed ? 0 : 1,
      summary: {
        sprintLabel,
        totalStories: p.stories.length,
        synced: syncedCases.length,
        passed,
        failed,
        testRailRunId: testRailRun.id,
        testRailRunUrl: typeof testRailRun.url === "string" ? testRailRun.url : undefined
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(jobId, `[scenario-run] ERROR fatal: ${msg}`);
    jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString(), exitCode: 1 });
  }
}
