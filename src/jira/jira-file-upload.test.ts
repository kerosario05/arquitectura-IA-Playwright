import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "../discovery/step-intent-parser";
import { validateExecutionPlan } from "../plans/execution-plan-validator";
import type { ExecutionPlan } from "../types/execution-plan.types";
import { deriveJiraInputRequirements, jiraScenarioGenerationInstructions } from "./jira-input-requirements";
import { compileJiraSpec } from "./jira-spec-compiler";

const uploadStep = 'Adjuntar el archivo de prueba en "Formulario"';

test("Jira parses a source-backed attachment as a file-field action", () => {
  assert.match(jiraScenarioGenerationInstructions(), /controlType:"file"/);
  assert.match(jiraScenarioGenerationInstructions(), /never invent a filename, path, or file bytes/);
  const [intent] = parseStepIntent(uploadStep);
  assert.equal(intent?.type, "action_fill");
  assert.equal(intent?.actionVerb, "upload");
  assert.equal(intent?.actionTarget, "Formulario");

  assert.deepEqual(deriveJiraInputRequirements([uploadStep]), [{
    dataCondition: undefined, key: "jira_step_1", label: "Formulario", stepIndex: 1, operation: "fill", required: true,
    editable: true, sensitive: false, controlType: "file", source: "jira_step",
  }]);
});

test("file attachment plans validate and compile through the Jira runtime", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", externalId: "PAY-1:jira:1", title: "Adjuntar formulario" },
    createdAt: new Date(0).toISOString(),
    requiredData: [{ key: "jira_step_1", required: true, resolved: true }],
    steps: [{ index: 1, action: "uploadFile", description: "upload [jira_step_1]",
      target: { strategy: "label", value: "Formulario", exact: true }, valueKey: "jira_step_1" }],
  };

  assert.deepEqual(validateExecutionPlan(plan), { valid: true, status: "validated", issues: [] });
  const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "fixture", sectionSlug: "jira",
    automationId: "fixture", specPath: "fixture/case.spec.ts" });
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /attachJiraSpecFile\(page,/);
  assert.match(compiled.source, /resolveJiraSpecValue\("jira_step_1"/);
});

