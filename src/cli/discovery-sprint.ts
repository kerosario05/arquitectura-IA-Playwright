import { config, requireJiraConfig, requireTestRailConfig } from "../config/env";
import { resolveAppProfile, ensureAppStructure } from "../automations/app-profile";
import { TestRailClient } from "../clients/testrail.client";
import type { AppProfile } from "../types/app-profile.types";
import type { TestScenario } from "../types/testrail.types";
import { sanitizeTestRailRef } from "../server/services/testrail-case-publisher";
import type { AddResultForCaseInput } from "../types/testrail.types";

type CliArgs = {
  projectKey: string;
  sprintId?: number;
  activeSprint: boolean;
  status?: string;
  maxResults: number;
  app?: string;
  headed: boolean;
  autoPromote: boolean;
  dryRun: boolean;
  overwrite: boolean;
};

type StoryResult = {
  jiraKey: string;
  title: string;
  testRailCaseId: number;
  discoveryStatus: "passed" | "failed" | "skipped";
  testRailStatusId: number;
  comment: string;
  durationMs: number;
};

// TestRail status IDs: 1=passed, 2=blocked, 3=untested, 5=failed
const TR_PASSED = 1;
const TR_FAILED = 5;
const TR_BLOCKED = 2;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    projectKey: "",
    activeSprint: false,
    maxResults: 50,
    headed: false,
    autoPromote: true,
    dryRun: false,
    overwrite: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--active-sprint") { args.activeSprint = true; continue; }
    if (token === "--headed") { args.headed = true; continue; }
    if (token === "--auto-promote") { args.autoPromote = true; continue; }
    if (token === "--no-auto-promote") { args.autoPromote = false; continue; }
    if (token === "--dry-run") { args.dryRun = true; continue; }
    if (token === "--overwrite") { args.overwrite = true; continue; }

    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    if (token === "--project-key") { args.projectKey = nextValue.trim().toUpperCase(); i += 1; continue; }
    if (token === "--sprint-id") {
      const n = Number(nextValue);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --sprint-id: ${nextValue}`);
      args.sprintId = n;
      i += 1; continue;
    }
    if (token === "--status") { args.status = nextValue.trim(); i += 1; continue; }
    if (token === "--max-results") {
      const n = Number(nextValue);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --max-results: ${nextValue}`);
      args.maxResults = n;
      i += 1; continue;
    }
    if (token === "--app") { args.app = nextValue.trim(); i += 1; continue; }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.projectKey) throw new Error("--project-key is required.");
  if (!args.activeSprint && !args.sprintId) {
    throw new Error("Either --active-sprint or --sprint-id <id> is required.");
  }

  return args;
}

function buildJql(projectKey: string, sprintId: number, status?: string): string {
  const parts = [`project = "${projectKey}"`, `sprint = ${sprintId}`];
  if (status) parts.push(`status = "${status}"`);
  return parts.join(" AND ") + " ORDER BY created DESC";
}

function mapPromotionStatusToTestRail(promotionStatus: string, caseStatus: string): number {
  if (promotionStatus === "promoted") return TR_PASSED;
  if (promotionStatus === "spec_failed") return TR_FAILED;
  if (caseStatus === "exploration_failed") return TR_FAILED;
  if (promotionStatus === "not_promoted") return TR_BLOCKED;
  return TR_FAILED;
}

function buildDiscoveryComment(
  promotionStatus: string,
  caseStatus: string,
  outputDir: string,
  durationMs: number
): string {
  const parts: string[] = [];
  parts.push(`Discovery: ${caseStatus}`);
  if (promotionStatus !== "not_promoted") parts.push(`Promotion: ${promotionStatus}`);
  parts.push(`Duración: ${Math.round(durationMs / 1000)}s`);
  parts.push(`Evidencia: ${outputDir}`);
  return parts.join(" | ");
}

async function syncScenarioToTestRail(
  client: TestRailClient,
  scenario: TestScenario,
  projectId: string,
  suiteId: string | undefined,
  sectionId: string
): Promise<number> {
  const stepsSeparated = scenario.steps.map((s) => ({
    content: s.action,
    expected: s.expected ?? ""
  }));

  // Sanitize refs: never send undefined/null/empty
  const safeRef = sanitizeTestRailRef(scenario.externalId) || "UNKNOWN";

  const existing = await client.getCasesByRefs(projectId, safeRef, suiteId, sectionId);

  if (existing.length > 0) {
    const updated = await client.updateCase(existing[0].id, {
      title: scenario.title,
      refs: safeRef,
      preconditions: scenario.preconditions,
      stepsSeparated
    });
    console.log(`  [testrail] Actualizado C${updated.id} ← ${scenario.externalId}: "${scenario.title}" refs="${safeRef}"`);
    return updated.id;
  }

  const created = await client.addCase(sectionId, {
    title: scenario.title,
    refs: safeRef,
    preconditions: scenario.preconditions,
    stepsSeparated
  });
  console.log(`  [testrail] Creado C${created.id} ← ${scenario.externalId}: "${scenario.title}" refs="${safeRef}"`);
  return created.id;
}

async function resolveAndEnsureApp(args: CliArgs): Promise<AppProfile> {
  const envAppSlug = process.env.APP_SLUG;
  const { profile, baseDir } = await resolveAppProfile({
    cliAppSlug: args.app,
    envAppSlug,
    baseUrl: config.app.baseUrl,
    appName: config.app.name
  });
  const ensured = await ensureAppStructure(baseDir);
  logAppProfile(profile, baseDir, ensured.length > 0 ? ensured : undefined);
  return profile;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ─── Configuración ───────────────────────────────────────────────────
  const jiraConfig = requireJiraConfig(config);
  const testRailConfig = requireTestRailConfig(config);
  const projectId = config.integrations.testRail?.projectId;
  const suiteId = config.integrations.testRail?.suiteId;
  const sectionId = config.integrations.testRail?.sectionId;

  if (!projectId) throw new Error("TESTRAIL_PROJECT_ID no está configurado en .env");
  if (!sectionId) throw new Error("TESTRAIL_SECTION_ID no está configurado en .env");

  const jiraClient = new JiraClient(jiraConfig);
  const testRailClient = new TestRailClient(testRailConfig);

  // ─── Paso 1: Resolver sprint ──────────────────────────────────────────
  let sprintId = args.sprintId;
  let sprintLabel = `sprint ${sprintId}`;

  if (args.activeSprint) {
    console.log(`[discovery:sprint] Buscando sprint activo para proyecto ${args.projectKey}...`);
    const activeSprint = await jiraClient.getActiveSprint(args.projectKey);
    if (!activeSprint) {
      throw new Error(`No se encontró sprint activo para el proyecto ${args.projectKey}.`);
    }
    sprintId = activeSprint.id;
    sprintLabel = activeSprint.name;
    console.log(`[discovery:sprint] Sprint activo: "${activeSprint.name}" (id: ${sprintId})`);
  }

  if (!sprintId) throw new Error("No se pudo determinar el sprint.");

  // ─── Paso 2: Fetch de historias desde Jira ────────────────────────────
  const jql = buildJql(args.projectKey, sprintId, args.status);
  console.log(`\n[discovery:sprint] JQL: ${jql}`);
  console.log(`[discovery:sprint] Obteniendo historias...`);

  const rawIssues = await jiraClient.searchIssues(jql, undefined, args.maxResults);

  if (rawIssues.length === 0) {
    console.log(`[discovery:sprint] No se encontraron historias con los filtros indicados.`);
    return;
  }

  const scenarios = normalizeJiraIssues(rawIssues, {
    acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField
  });

  console.log(`[discovery:sprint] Historias encontradas: ${scenarios.length}`);

  if (args.dryRun) {
    console.log("\n[discovery:sprint] --dry-run activo. Escenarios a procesar:\n");
    for (const s of scenarios) {
      console.log(`  ${s.externalId}: "${s.title}" (${s.steps.length} pasos)`);
      for (const step of s.steps) {
        console.log(`    ${step.index}. ${step.action}`);
      }
    }
    console.log("\n[discovery:sprint] Fin del dry-run. No se ejecutó nada.");
    return;
  }

  // ─── Paso 3: Sincronizar a TestRail ───────────────────────────────────
  console.log(`\n[discovery:sprint] Sincronizando ${scenarios.length} caso(s) a TestRail...`);

  const scenarioCaseMap = new Map<string, number>(); // jiraKey → testRailCaseId

  for (const scenario of scenarios) {
    try {
      const caseId = await syncScenarioToTestRail(
        testRailClient,
        scenario,
        projectId,
        suiteId,
        sectionId
      );
      scenarioCaseMap.set(scenario.externalId, caseId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [testrail] ERROR sincronizando ${scenario.externalId}: ${msg}`);
    }
  }

  const syncedCaseIds = Array.from(scenarioCaseMap.values());
  console.log(`[discovery:sprint] ${syncedCaseIds.length} caso(s) sincronizados en TestRail.`);

  // ─── Paso 4: Crear TestRail Run ───────────────────────────────────────
  const runName = `[Jira] ${args.projectKey} — ${sprintLabel}${args.status ? ` — ${args.status}` : ""} — ${new Date().toISOString().slice(0, 10)}`;
  const runDescription = `Pipeline automático desde Jira. JQL: ${jql}`;

  console.log(`\n[discovery:sprint] Creando TestRail Run: "${runName}"...`);

  const testRailRun = await testRailClient.addRun({
    projectId,
    suiteId,
    name: runName,
    description: runDescription,
    caseIds: syncedCaseIds
  });

  console.log(`[discovery:sprint] Run creado: id=${testRailRun.id}${testRailRun.url ? "  url=" + testRailRun.url : ""}`);

  // ─── Paso 5: Discovery + generación de scripts ────────────────────────
  console.log(`\n[discovery:sprint] Iniciando discovery para ${scenarios.length} historia(s)...\n`);

  const appProfile = await resolveAndEnsureApp(args);
  const storyResults: StoryResult[] = [];

  for (const scenario of scenarios) {
    const testRailCaseId = scenarioCaseMap.get(scenario.externalId);
    if (!testRailCaseId) {
      console.log(`[discovery:sprint] Saltando ${scenario.externalId} — no sincronizado a TestRail.`);
      continue;
    }

    console.log(`\n${"─".repeat(60)}`);
    console.log(`[discovery:sprint] [${scenario.externalId}] "${scenario.title}"`);

    const startTime = Date.now();
    let discoveryStatus: "passed" | "failed" | "skipped" = "failed";
    let testRailStatusId = TR_FAILED;
    let comment = "";

    try {
      const workflowResult = await runCaseDiscoveryWorkflow({
        scenario,
        headed: args.headed,
        autoPromote: args.autoPromote,
        promotionDryRun: false,
        promotionStrict: false,
        requirePromotionApproval: false,
        pageObjectMode: true,
        allowPageObjectCandidates: true,
        overwrite: args.overwrite,
        config,
        appProfile
      });

      testRailStatusId = mapPromotionStatusToTestRail(
        workflowResult.promotionStatus,
        workflowResult.caseResult.status
      );
      discoveryStatus = testRailStatusId === TR_PASSED ? "passed" : "failed";
      comment = buildDiscoveryComment(
        workflowResult.promotionStatus,
        workflowResult.caseResult.status,
        workflowResult.outputDir,
        workflowResult.durationMs
      );

      console.log(`[discovery:sprint] Resultado: ${discoveryStatus.toUpperCase()} — ${workflowResult.promotionStatus}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      comment = `Error inesperado: ${msg}`;
      console.error(`[discovery:sprint] ERROR en ${scenario.externalId}: ${msg}`);
    }

    storyResults.push({
      jiraKey: scenario.externalId,
      title: scenario.title,
      testRailCaseId,
      discoveryStatus,
      testRailStatusId,
      comment,
      durationMs: Date.now() - startTime
    });
  }

  // ─── Paso 6: Reportar resultados a TestRail ───────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[discovery:sprint] Enviando resultados al Run ${testRailRun.id}...`);

  const testRailResults: AddResultForCaseInput[] = storyResults.map((r) => ({
    runId: testRailRun.id,
    caseId: r.testRailCaseId,
    statusId: r.testRailStatusId,
    comment: r.comment,
    elapsed: `${Math.round(r.durationMs / 1000)}s`
  }));

  const reportResult = await testRailClient.addResultsForCases(testRailRun.id, testRailResults);
  console.log(`[discovery:sprint] ${reportResult.added} resultado(s) enviado(s) a TestRail.`);

  // ─── Resumen final ────────────────────────────────────────────────────
  const passed = storyResults.filter((r) => r.discoveryStatus === "passed").length;
  const failed = storyResults.filter((r) => r.discoveryStatus === "failed").length;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[discovery:sprint] PIPELINE COMPLETADO`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Sprint:            ${sprintLabel}`);
  console.log(`Historias Jira:    ${scenarios.length}`);
  console.log(`Sincronizadas TR:  ${syncedCaseIds.length}`);
  console.log(`Passed:            ${passed}`);
  console.log(`Failed:            ${failed}`);
  console.log(`TestRail Run:      id=${testRailRun.id}${testRailRun.url ? "  " + testRailRun.url : ""}`);
  console.log(`${"=".repeat(60)}\n`);

  console.log("Detalle por historia:");
  for (const r of storyResults) {
    const icon = r.discoveryStatus === "passed" ? "✓" : "✗";
    console.log(`  ${icon} [${r.jiraKey}] C${r.testRailCaseId}  ${r.discoveryStatus.toUpperCase()}  "${r.title}"`);
  }

  if (failed > 0) process.exitCode = 1;
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("discovery-sprint.ts");
if (isMainModule) {
  main()
    .then(() => { if (!process.exitCode) process.exitCode = 0; })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[discovery:sprint] ${message}`);
      process.exitCode = 1;
    });
}
