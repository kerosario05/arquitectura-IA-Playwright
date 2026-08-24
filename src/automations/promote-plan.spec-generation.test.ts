import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promoteExecutionPlan } from "./promote-plan";
import { buildAutomationId } from "./automation-naming";
import { buildAppAutomationPaths, type AppProfile } from "./app-profile";
import type { ExecutionPlan } from "../types/execution-plan.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";

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

function buildPlan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: {
      source: "manual",
      externalId: "C42940",
      title: "Acceder a Transacciones y servicios para iniciar autenticacion"
    },
    requiredData: [],
    steps: [
      {
        index: 1,
        action: "click",
        description: "Iniciar",
        target: { strategy: "text", value: "Iniciar" }
      }
    ]
  };
}

test("existing spec is not counted as freshly written when promotion is blocked", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promote-spec-written-"));
  const plan = buildPlan();
  const appProfile: AppProfile = {
    appSlug: "arquitectura-automatizacion",
    source: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const automationId = buildAutomationId({
    externalId: plan.scenario.externalId,
    caseId: plan.scenario.caseId,
    title: plan.scenario.title
  });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, outputRoot, "detalle-kiosko");
  const previousSpecContent = "// previous spec should remain untouched\nexport {};\n";
  await fs.mkdir(path.dirname(appPaths.specPath), { recursive: true });
  await fs.writeFile(appPaths.specPath, previousSpecContent, "utf-8");

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () => {
    const result = await promoteExecutionPlan({
      plan,
      outputRoot,
      appProfileObject: appProfile,
      source: "discovery",
      sectionSlug: "detalle-kiosko",
      promotionPolicy: {
        ...DEFAULT_PROMOTION_POLICY,
        specMode: "inline-debug",
        requirePageObjects: false,
        allowInlineFallback: true,
        blockPromotionWhenPageObjectMissing: false
      },
      sourceScenario: {
        title: plan.scenario.title,
        steps: [{ index: 1, action: "click", description: "Iniciar" }],
        expectedResult: "Debe visualizarse el flujo de autenticacion"
      }
    });

    assert.strictEqual(result.status, "spec_failed");
    const metadata = result.metadata?.specGeneration;
    assert.ok(metadata);
    assert.strictEqual(metadata?.specWritten, false);
    assert.strictEqual(metadata?.previousSpec?.existed, true);
    assert.ok(typeof metadata?.previousSpec?.hash === "string" && metadata.previousSpec.hash.length > 0);
    assert.ok(typeof metadata?.previousSpec?.lastModifiedAt === "string" && metadata.previousSpec.lastModifiedAt.length > 0);

    const currentSpec = await fs.readFile(appPaths.specPath, "utf-8");
    assert.strictEqual(currentSpec, previousSpecContent);
  });
});
