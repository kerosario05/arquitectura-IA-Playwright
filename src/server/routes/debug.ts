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
    custom_steps_separated: steps.map((s, i) => ({
      content: s.replace(/^\d+[.)]\s*/, "").trim(),
      expected: i === steps.length - 1 ? expectedResult : "",
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
