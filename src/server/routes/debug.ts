/**
 * @file debug.ts
 * @description Dev-only debug endpoints for direct TestRail publishing.
 *
 * ONLY available when NODE_ENV !== "production" OR DEBUG_TESTRAIL_ENDPOINTS=true.
 *
 * Endpoint: POST /api/debug/testrail/publish-scenario
 * Allows testing add_case/update_case directly from Postman with a single
 * scenario, bypassing QA Lab and AI scenario generation.
 *
 * Optional env vars:
 *   DEBUG_TESTRAIL_PAYLOAD=true  → include the full add_case body in the response
 *   DEBUG_TESTRAIL_ENDPOINTS=true → enable these routes even in production
 */

import { Router } from "express";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import {
  publishScenariosToTestRail,
  buildSafeTestRailRefs,
  buildCustomExpected,
} from "../services/testrail-case-publisher";
import type { McpScenario } from "../../scenarios/scenario-types";
import type { ScenarioPreviewPublishContext } from "../services/testrail-sync-types";

export const debugRouter = Router();

// ── Guard: only enabled outside production or when explicitly enabled ──────────
const isDebugEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.DEBUG_TESTRAIL_ENDPOINTS === "true";

const isPayloadDebugEnabled = process.env.DEBUG_TESTRAIL_PAYLOAD === "true";

// ── Request body shape ─────────────────────────────────────────────────────────
interface DebugPublishScenarioBody {
  projectId?: unknown;
  suiteId?: unknown;
  sectionId?: unknown;
  appSlug?: unknown;
  storyKey?: unknown;
  scenarioId?: unknown;
  title?: unknown;
  steps?: unknown;
  expectedResult?: unknown;
  caseOracle?: unknown;
  createTestRun?: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCacheKey(storyKey: string, scenarioId: string): string {
  return `debug-${storyKey}-${scenarioId}`;
}

function validateBody(body: DebugPublishScenarioBody): {
  ok: true;
  projectId: number;
  suiteId: number;
  sectionId: number;
  appSlug: string;
  storyKey: string;
  scenarioId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  caseOracle: string;
  createTestRun: boolean;
} | { ok: false; error: string; missing: string[] } {
  const missing: string[] = [];

  if (typeof body.projectId !== "number" || !Number.isFinite(body.projectId))
    missing.push("projectId (number)");
  if (typeof body.suiteId !== "number" || !Number.isFinite(body.suiteId))
    missing.push("suiteId (number)");
  if (typeof body.sectionId !== "number" || !Number.isFinite(body.sectionId))
    missing.push("sectionId (number)");
  if (!body.appSlug || typeof body.appSlug !== "string")
    missing.push("appSlug (string)");
  if (!body.storyKey || typeof body.storyKey !== "string")
    missing.push("storyKey (string)");
  if (!body.scenarioId || typeof body.scenarioId !== "string")
    missing.push("scenarioId (string)");
  if (!body.title || typeof body.title !== "string")
    missing.push("title (string)");
  if (
    !Array.isArray(body.steps) ||
    body.steps.length === 0 ||
    !body.steps.every((s) => typeof s === "string")
  )
    missing.push("steps (string[])");
  if (!body.expectedResult || typeof body.expectedResult !== "string")
    missing.push("expectedResult (string)");

  if (missing.length > 0) {
    return { ok: false, error: "invalid_request", missing };
  }

  return {
    ok: true,
    projectId: body.projectId as number,
    suiteId: body.suiteId as number,
    sectionId: body.sectionId as number,
    appSlug: body.appSlug as string,
    storyKey: body.storyKey as string,
    scenarioId: body.scenarioId as string,
    title: body.title as string,
    steps: body.steps as string[],
    expectedResult: body.expectedResult as string,
    caseOracle: typeof body.caseOracle === "string" ? body.caseOracle : "",
    createTestRun: body.createTestRun === true,
  };
}

// ── Route ──────────────────────────────────────────────────────────────────────

debugRouter.post("/testrail/publish-scenario", async (req, res) => {
  // ── Gate ────────────────────────────────────────────────────────────────────
  if (!isDebugEnabled) {
    res.status(403).json({
      ok: false,
      error: "forbidden",
      message:
        "This endpoint is disabled in production. Set DEBUG_TESTRAIL_ENDPOINTS=true to enable it.",
    });
    return;
  }

  console.log("[testrail-debug] endpoint=POST /api/debug/testrail/publish-scenario");

  // ── Validate body ───────────────────────────────────────────────────────────
  const validation = validateBody(req.body as DebugPublishScenarioBody);
  if (!validation.ok) {
    res.status(400).json({
      ok: false,
      error: validation.error,
      message: `Missing or invalid fields: ${validation.missing.join(", ")}`,
      missing: validation.missing,
    });
    return;
  }

  const {
    projectId,
    suiteId,
    sectionId,
    appSlug,
    storyKey,
    scenarioId,
    title,
    steps,
    expectedResult,
    caseOracle,
    createTestRun,
  } = validation;

  // ── Build a minimal McpScenario ─────────────────────────────────────────────
  const scenario: McpScenario & { caseOracle?: string } = {
    sourceIssueKey: storyKey,
    title,
    steps,
    preconditions: [],
    expectedResult,
    caseOracle: caseOracle || undefined,
    type: "functional",
    database: "none",
    isConverted: 0,
    automationType: "manual",
    setupStrategy: "none",
    appSlug,
    routeProfile: "debug",
    dataRequirements: "none",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };

  // ── Build publish context ────────────────────────────────────────────────────
  const cacheKey = buildCacheKey(storyKey, scenarioId);
  const ctx: ScenarioPreviewPublishContext = {
    projectId,
    suiteId,
    sectionId,
    appSlug,
    storyKey,
    scenarios: [scenario],
    cacheKey,
  };

  // ── Pre-publish diagnostics ──────────────────────────────────────────────────
  const previewRefs = buildSafeTestRailRefs(scenario, scenarioId, storyKey);
  const previewExpected = buildCustomExpected(scenario);
  const hasRefs = Boolean(previewRefs);
  const hasCustomRefs = hasRefs; // custom_refs mirrors refs in this publisher

  console.log(`[testrail-debug] endpoint=add_case`);
  console.log(`[testrail-debug] storyKey=${storyKey} scenarioId=${scenarioId} sectionId=${sectionId}`);
  console.log(`[testrail-debug] hasRefs=${hasRefs} hasCustomRefs=${hasCustomRefs}`);
  console.log(`[testrail-debug] previewRefs="${previewRefs}"`);
  console.log(`[testrail-debug] steps=${steps.length} expectedResult="${expectedResult.substring(0, 80)}"`);

  const previewPayload = {
    title,
    refs: previewRefs,
    custom_preconds: scenario.preconditions.length > 0
      ? scenario.preconditions.join(" | ")
      : "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.\n- Datos de prueba disponibles según el escenario.",
    custom_expected: previewExpected,
    custom_case_oracle: caseOracle || undefined,
    custom_steps_separated: steps.map((s) => ({
      content: s.replace(/^\d+[.)]\s*/, "").trim(),
      expected: "",
    })),
    custom_source: "qa_lab_generated",
    custom_scenario_id: scenarioId,
    custom_app_slug: appSlug,
    custom_sprint_id: "",
    custom_story_key: storyKey,
    custom_cache_key: cacheKey,
  };

  if (isPayloadDebugEnabled) {
    console.log(
      `[testrail-debug] final add_case body=${JSON.stringify(previewPayload, null, 2)}`
    );
  } else {
    console.log(
      `[testrail-debug] final add_case body (keys)=${Object.keys(previewPayload).join(",")}`
    );
  }

  // ── Call publishScenariosToTestRail ─────────────────────────────────────────
  let testRailClient: TestRailClient;
  try {
    testRailClient = new TestRailClient(requireTestRailConfig(config));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[testrail-debug] TestRail config error: ${message}`);
    res.status(500).json({
      ok: false,
      error: "testrail_config_missing",
      message,
    });
    return;
  }

  try {
    const publishResult = await publishScenariosToTestRail(testRailClient, ctx);

    const firstMapping = publishResult.mappings[0];

    const responseBody: Record<string, unknown> = {
      ok: true,
      created: publishResult.created,
      updated: publishResult.updated,
      reused: publishResult.reused,
      caseIds: publishResult.caseIds,
      refs: firstMapping?.testRailRef ?? previewRefs,
      hasRefs,
      hasCustomRefs,
      mappings: publishResult.mappings.map((m) => ({
        scenarioId: m.scenarioId,
        caseId: m.testRailCaseId,
        source: m.source,
        ref: m.testRailRef,
      })),
    };

    // TestRun (skipped unless explicitly requested)
    if (createTestRun) {
      if (publishResult.caseIds.length === 0) {
        responseBody.testRun = {
          skipped: true,
          reason: "No caseIds available after publish",
        };
      } else {
        try {
          const run = await testRailClient.addRun({
            projectId: String(projectId),
            suiteId: String(suiteId),
            name: `[DEBUG] ${storyKey} / ${scenarioId}`,
            description: `Debug test run created via /api/debug/testrail/publish-scenario`,
            caseIds: publishResult.caseIds,
          });
          responseBody.testRun = {
            id: run.id,
            url: run.url,
          };
          console.log(
            `[testrail-debug] createdTestRun id=${run.id} url=${run.url ?? "n/a"}`
          );
        } catch (runErr) {
          const runMsg = runErr instanceof Error ? runErr.message : String(runErr);
          console.warn(`[testrail-debug] testRun creation failed: ${runMsg}`);
          responseBody.testRun = { skipped: true, reason: runMsg };
        }
      }
    }

    // Include full payload if DEBUG_TESTRAIL_PAYLOAD=true
    if (isPayloadDebugEnabled) {
      responseBody.debugPayload = previewPayload;
    }

    console.log(
      `[testrail-debug] publish complete created=${publishResult.created} updated=${publishResult.updated} reused=${publishResult.reused} caseIds=${publishResult.caseIds.join(",")}`
    );

    res.status(200).json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[testrail-debug] publishScenariosToTestRail failed: ${message}`);
    res.status(502).json({
      ok: false,
      error: "publish_failed",
      message,
      diagnostics: {
        projectId,
        suiteId,
        sectionId,
        storyKey,
        scenarioId,
        previewRefs,
        hasRefs,
        hasCustomRefs,
        ...(isPayloadDebugEnabled ? { attemptedPayload: previewPayload } : {}),
      },
    });
  }
});

// ── Smoke test endpoint for isolating TestRail field issues ────────────────────
debugRouter.post("/testrail/add-case-smoke", async (req, res) => {
  if (!isDebugEnabled) {
    res.status(403).json({ ok: false, error: "forbidden", message: "Debug endpoints are disabled in production." });
    return;
  }

  const sectionId = Number(req.body?.sectionId);
  const title = String(req.body?.title ?? "Smoke Test");
  const refs = String(req.body?.refs ?? "");
  const mode = String(req.body?.mode ?? "minimal");

  if (!sectionId) {
    res.status(400).json({ ok: false, error: "sectionId is required" });
    return;
  }

  let trClient: TestRailClient;
  try {
    trClient = new TestRailClient(requireTestRailConfig(config));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "testrail_config", message: err.message });
    return;
  }

  const buildPayload = (m: string): Record<string, unknown> => {
    const base: Record<string, unknown> = { title };
    const stepsText = "1. Clic en \"Iniciar\".\n2. Validar que se muestre \"Tarjetas\".";
    const stepsSeparated = [
      { content: "Clic en \"Iniciar\".", expected: "" },
      { content: "Validar que se muestre \"Tarjetas\".", expected: "" },
    ];
    switch (m) {
      case "minimal":
        return { title };
      case "refs_only":
        return { ...base, refs };
      case "custom_refs":
        return { ...base, refs, custom_refs: refs };
      case "steps_text":
        return { ...base, refs, custom_steps: stepsText };
      case "steps_preconds":
        return { ...base, refs, custom_steps: stepsText, custom_preconds: "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado." };
      case "steps_preconds_expected":
        return { ...base, refs, custom_steps: stepsText, custom_preconds: "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.", custom_expected: "Debe mostrarse Tarjetas." };
      case "steps_preconds_expected_oracle":
        return { ...base, refs, custom_steps: stepsText, custom_preconds: "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.", custom_expected: "Debe mostrarse Tarjetas.", custom_case_oracle: process.env.TESTRAIL_DEFAULT_CASE_ORACLE || "QA" };
      case "required_no_refs":
        return { title, custom_steps: stepsText, custom_preconds: "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.", custom_expected: "Debe mostrarse Tarjetas.", custom_case_oracle: process.env.TESTRAIL_DEFAULT_CASE_ORACLE || "QA" };
      case "steps_separated":
        return { ...base, refs, custom_steps_separated: stepsSeparated };
      case "expected":
        return { ...base, refs, custom_expected: "Resultado esperado smoke." };
      case "full":
        return {
          title, refs, custom_refs: refs, custom_preconds: "Precondiciones smoke",
          custom_expected: "Resultado esperado smoke.",
          custom_steps: stepsText, custom_steps_separated: stepsSeparated,
          custom_source: "smoke", custom_scenario_id: "SMOKE-001", custom_app_slug: "smoke",
        };
      default:
        return { title };
    }
  };

  const payload = buildPayload(mode);
  const keys = Object.keys(payload).join(",");

  // Log additional diagnostics for step modes
  if (mode === "steps_text") {
    const s = payload.custom_steps as string | undefined;
    console.log(`[testrail-smoke] mode=steps_text keys=${keys} customStepsLength=${s?.length ?? 0}`);
  }
  if (mode === "steps_preconds") {
    const s = payload.custom_steps as string | undefined;
    const p = payload.custom_preconds as string | undefined;
    console.log(`[testrail-smoke] mode=steps_preconds keys=${keys} customStepsLength=${s?.length ?? 0} precondsLength=${p?.length ?? 0}`);
  }
  if (mode === "steps_preconds_expected") {
    const s = payload.custom_steps as string | undefined;
    const p = payload.custom_preconds as string | undefined;
    const e = payload.custom_expected as string | undefined;
    console.log(`[testrail-smoke] mode=steps_preconds_expected keys=${keys} customStepsLength=${s?.length ?? 0} precondsLength=${p?.length ?? 0} expectedLength=${e?.length ?? 0}`);
  }
  if (mode === "steps_preconds_expected_oracle") {
    const s = payload.custom_steps as string | undefined;
    const p = payload.custom_preconds as string | undefined;
    const e = payload.custom_expected as string | undefined;
    const o = payload.custom_case_oracle as string | undefined;
    console.log(`[testrail-smoke] mode=steps_preconds_expected_oracle keys=${keys} customStepsLength=${s?.length ?? 0} precondsLength=${p?.length ?? 0} expectedLength=${e?.length ?? 0} oracleLength=${o?.length ?? 0} oracleValue="${o ?? ""}"`);
  }
  if (mode === "required_no_refs") {
    console.log(`[testrail-smoke] mode=required_no_refs keys=${keys}`);
  }
  if (mode === "steps_separated") {
    const arr = payload.custom_steps_separated as any[] | undefined;
    console.log(`[testrail-smoke] mode=steps_separated keys=${keys} separatedCount=${arr?.length ?? 0}`);
  }

  try {
    const result = await trClient.addCase(String(sectionId), payload as any, { preservePayload: true });
    console.log(`[testrail-smoke] mode=${mode} keys=${keys} status=ok caseId=${result.id}`);
    res.json({ ok: true, mode, keys, caseId: result.id });
  } catch (err: any) {
    const msg = err.message ?? String(err);
    console.log(`[testrail-smoke] mode=${mode} keys=${keys} status=error error="${msg.slice(0, 200)}"`);
    res.status(502).json({ ok: false, mode, keys, error: msg });
  }
});

// ── Incremental add_case diagnostic ───────────────────────────────────────
debugRouter.post("/testrail/diagnose-refs", async (req, res) => {
  if (!isDebugEnabled) {
    res.status(403).json({ ok: false, error: "forbidden", message: "Debug endpoints are disabled in production." });
    return;
  }
  const sectionId = Number(req.body?.sectionId);
  if (!sectionId) {
    res.status(400).json({ ok: false, error: "sectionId is required" });
    return;
  }

  let trClient: TestRailClient;
  try {
    trClient = new TestRailClient(requireTestRailConfig(config));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "testrail_config", message: err.message });
    return;
  }

  const timestamp = Date.now().toString(36);
  const results: Array<{ label: string; keys: string; status: string; error?: string; caseId?: number }> = [];
  let lastCaseId: number | undefined;

  const payloads: Array<{ label: string; payload: Record<string, unknown> }> = [
    { label: "A: title only", payload: { title: `DEBUG refs diagnostic A ${timestamp}` } },
    { label: "B: + custom_steps", payload: {
      title: `DEBUG refs diagnostic B ${timestamp}`,
      custom_steps: "1. Clic en Iniciar.\n2. Validar menu.",
    }},
    { label: "C: + custom_steps_separated", payload: {
      title: `DEBUG refs diagnostic C ${timestamp}`,
      custom_steps_separated: [
        { content: "Clic en Iniciar.", expected: "" },
        { content: "Validar menu.", expected: "Menu visible." },
      ],
    }},
    { label: "D: + custom_preconds", payload: {
      title: `DEBUG refs diagnostic D ${timestamp}`,
      custom_steps: "1. Clic en Iniciar.\n2. Validar menu.",
      custom_preconds: "Precondiciones:\n- App disponible.",
    }},
    { label: "E: + custom_expected", payload: {
      title: `DEBUG refs diagnostic E ${timestamp}`,
      custom_steps: "1. Clic en Iniciar.\n2. Validar menu.",
      custom_preconds: "Precondiciones:\n- App disponible.",
      custom_expected: "Menu visible.",
    }},
    { label: "F: + custom_case_oracle", payload: {
      title: `DEBUG refs diagnostic F ${timestamp}`,
      custom_steps: "1. Clic en Iniciar.\n2. Validar menu.",
      custom_preconds: "Precondiciones:\n- App disponible.",
      custom_expected: "Menu visible.",
      custom_case_oracle: process.env.TESTRAIL_DEFAULT_CASE_ORACLE || "QA",
    }},
    { label: "G: + custom_fields (scenario_id, app_slug, cache_key)", payload: {
      title: `DEBUG refs diagnostic G ${timestamp}`,
      custom_steps: "1. Clic en Iniciar.\n2. Validar menu.",
      custom_preconds: "Precondiciones:\n- App disponible.",
      custom_expected: "Menu visible.",
      custom_case_oracle: process.env.TESTRAIL_DEFAULT_CASE_ORACLE || "QA",
      custom_scenario_id: `DEBUG-${timestamp}`,
      custom_app_slug: "debug",
      custom_cache_key: `debug-${timestamp}`,
      custom_story_key: "",
    }},
  ];

  for (const { label, payload } of payloads) {
    const keys = Object.keys(payload).join(",");
    try {
      const result = await trClient.addCase(String(sectionId), payload as any, { preservePayload: true });
      lastCaseId = result.id;
      results.push({ label, keys, status: "passed", caseId: result.id });
      console.log(`[testrail-diagnose] ${label} keys=${keys} status=passed caseId=${result.id}`);
    } catch (err: any) {
      const msg = err.message ?? String(err);
      results.push({ label, keys, status: "failed", error: msg.slice(0, 300) });
      console.log(`[testrail-diagnose] ${label} keys=${keys} status=failed error="${msg.slice(0, 200)}"`);
      // Stop at first failure — subsequent payloads would likely fail too
      break;
    }
  }

  // Determine the likely cause
  const firstFail = results.find(r => r.status === "failed");
  let conclusion: string;
  if (!firstFail) {
    conclusion = "All payloads passed. The Undefined array key \"refs\" error is not triggered by standard fields. Check TestRail plugin/customization settings.";
  } else if (firstFail.label === "A: title only") {
    conclusion = "TestRail add_case fails with title alone. This is a TestRail configuration/plugin issue, not a framework issue. Contact TestRail admin.";
  } else {
    const prevPass = results[results.indexOf(firstFail) - 1];
    conclusion = `First failure at ${firstFail.label}. Last passing was ${prevPass?.label ?? "none"}. The field(s) in "${firstFail.label}" but not in "${prevPass?.label ?? "none"}" may trigger the issue.`;
  }

  res.json({ ok: true, sectionId, results, conclusion });
});

// ── Status endpoint (sanity check that debug routes are active) ───────────────
debugRouter.get("/testrail/status", (_req, res) => {
  if (!isDebugEnabled) {
    res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "Debug endpoints are disabled in production.",
    });
    return;
  }
  res.json({
    ok: true,
    debugEnabled: true,
    payloadDebugEnabled: isPayloadDebugEnabled,
    nodeEnv: process.env.NODE_ENV ?? "undefined",
    endpoints: ["POST /api/debug/testrail/publish-scenario"],
  });
});
