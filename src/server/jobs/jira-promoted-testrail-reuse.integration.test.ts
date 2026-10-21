import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { linkJiraAutomationToTestRailCase, loadAutomationIndex } from "../../automations/automation-index";
import { resolveJiraPublishedCaseId } from "../../jira/jira-case-input-persistence";
import { resolvePromotedSpecTargetFromEntries, validatePromotedEntryForExecution } from "./discovery-batch-runner";
import { resolveExistingCaseExecutionPlan } from "./launch-orchestrator";
import type { PromotedAutomationIndexEntry } from "../../types/automation-promotion.types";

test("a verified Jira promotion links to TestRail and is reusable from its selected section", async () => {
  const appSlug = `jira-reuse-fixture-${process.pid}-${Date.now()}`;
  const appRoot = path.resolve("automations", "apps", appSlug);
  const caseId = 90091;
  const externalId = "SYNTH-1:jira:1";
  const caseDir = path.join(appRoot, "sections", "jira-synth-1", "cases", "jira-synth-1-positive-flow");
  const specPath = path.join(caseDir, "case.spec.ts");
  const planPath = path.join(caseDir, "plan.json");
  const indexPath = path.join(appRoot, "index.json");
  const specText = [
    'import { navigateJiraSpecRoute } from "../../../../../src/jira/jira-spec-runtime";',
    'const baseUrl = process.env.APP_BASE_URL;',
    'await page.goto(baseUrl, { waitUntil: "domcontentloaded" });',
  ].join("\\n");
  const entry: PromotedAutomationIndexEntry = {
    id: "jira-synth-1-positive-flow",
    externalId,
    title: "Synthetic positive flow",
    planPath: path.relative(process.cwd(), planPath),
    specPath: path.relative(process.cwd(), specPath),
    appSlug,
    status: "active",
    source: "discovery",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    specVerificationStatus: "passed",
    tags: ["jira_semantic", "jira_generated"],
    metadata: { specGeneration: {
      mode: "deterministic",
      provider: null,
      model: null,
      invocations: 0,
      invocationsConsumed: 0,
      durationMs: 0,
      usage: {
        inputTokens: null,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        nonCachedInputTokens: null,
        outputTokens: null,
        reasoningOutputTokens: null,
        totalPhysicalTokens: null,
        durationMs: null,
        credits: null,
      },
      validation: {
        schema: "passed",
        structure: "passed",
        typescript: "skipped",
        playwrightDiscovery: "skipped",
        semanticCoverage: "passed",
        functionalExecution: "passed",
      },
      promotionAllowed: true,
      specsRequested: 1,
      specsValidated: 1,
      specsRejected: 0,
      specWritten: true,
      errors: [],
      warnings: [],
    } },
  };

  try {
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(specPath, specText, "utf8");
    await fs.writeFile(planPath, JSON.stringify({ scenario: { source: "jira", externalId }, steps: [{ action: "navigate" }] }), "utf8");
    const duplicateExternalIdEntry = { ...entry, id: `${entry.id}-older-promotion` };
    await fs.writeFile(indexPath, JSON.stringify({ version: "1.0", updatedAt: new Date().toISOString(), automations: [duplicateExternalIdEntry, entry] }), "utf8");

    const publishedCases = [{ scenarioId: externalId, caseId, sourceType: "jira_preview" }];
    assert.equal(resolveJiraPublishedCaseId(publishedCases, externalId), caseId);
    assert.equal(resolveJiraPublishedCaseId([
      ...publishedCases,
      { scenarioId: externalId, caseId: caseId + 1, sourceType: "jira_preview" },
    ], externalId), undefined);

    const ambiguous = await linkJiraAutomationToTestRailCase({ appSlug, externalId, caseId });
    assert.equal(ambiguous.linked, false);
    assert.equal(ambiguous.reason, "jira_promotion_ambiguous");

    const linked = await linkJiraAutomationToTestRailCase({ appSlug, externalId, caseId, automationId: entry.id });
    assert.equal(linked.linked, true, linked.reason);

    const stored = await loadAutomationIndex(indexPath);
    const persisted = stored.automations.find((candidate) => candidate.id === entry.id)!;
    assert.equal(persisted.caseId, caseId);
    assert.equal(persisted.promotionPersisted, true);
    assert.equal(persisted.promotedSpecHash, createHash("sha256").update(specText).digest("hex"));

    const structural = validatePromotedEntryForExecution({
      caseId,
      appSlug,
      sectionSlug: "regresion-kiosko",
      entry: persisted,
    });
    assert.equal(structural.reusable, true, structural.reason);

    const resolved = resolvePromotedSpecTargetFromEntries({
      caseId,
      appSlug,
      sectionSlug: "regresion-kiosko",
      entries: [persisted],
    });
    assert.equal(resolved.reusable, true, resolved.reason);
    assert.equal(path.resolve(resolved.specPath ?? ""), specPath);

    const plan = resolveExistingCaseExecutionPlan({
      caseIds: [caseId],
      appSlug,
      sectionSlug: "regresion-kiosko",
      entries: [persisted],
    });
    assert.equal(plan.existingSpec.length, 1);
    assert.equal(plan.existingSpec[0].executionSource, "existing_spec");
    assert.equal(plan.existingSpec[0].mcpRequired, false);
    assert.equal(plan.launchAccepted, true);

    await fs.writeFile(specPath, `${specText}// tampered\n`, "utf8");
    const tampered = resolvePromotedSpecTargetFromEntries({ caseId, appSlug, sectionSlug: "regresion-kiosko", entries: [persisted] });
    assert.equal(tampered.reusable, false);
    assert.equal(tampered.reason, "promoted_spec_hash_mismatch");
  } finally {
    await fs.rm(appRoot, { recursive: true, force: true });
  }
});
