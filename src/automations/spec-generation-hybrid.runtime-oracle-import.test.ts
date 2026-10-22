import assert from "node:assert/strict";
import test from "node:test";
import { structuralValidation } from "./spec-generation-hybrid";

function check(assertion: string, importExpect = false) {
  const specContent = `import { test${importExpect ? ", expect" : ""} } from '@playwright/test';
import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = 'deterministic_compiler';
test('fixture', async ({page}) => {
 process.env.APP_SLUG='fixture'; process.env.SECTION_SLUG='section';
 process.env.SCENARIO_ID='S1'; process.env.SCENARIO_TITLE='fixture';
 const promotedRuntime=createPromotedSpecRuntime(page);
 try { ${assertion} } finally { await promotedRuntime.finishEvidence(); }
});`;
  return structuralValidation({ specContent, expectedAppSlug:"fixture", expectedSectionSlug:"section",
    expectedScenarioId:"S1", expectedScenarioTitle:"fixture", sourceExpectedResultPresent:false,
    expectedResultText:"", scenarioSteps:[], requiredAssertions:['Invalid credentials'],
    observableOracles:[], executableStepIndexes:[], planStepActions:new Map(),
    response:{specContent,coveredStepIndexes:[],coveredAssertions:[],usedPageObjects:[],declaredIdentifiers:[],unresolvedRequirements:[],warnings:[]},
    availablePageObjects:[],observedEvidencePhrases:[],promotedRuntimeMethodsAllowlist:['expectPromotedVisible'],mode:'deterministic' });
}

test('runtime-owned assertions need no unused Playwright expect import',()=>{
  const result=check(`await promotedRuntime.expectPromotedVisible({stepIndex:7,target:'text:Invalid credentials',polarity:'positive',credentialRejectionTarget:'Invalid credentials',assertion:async()=>{}});`);
  assert.ok(!result.structureErrors.includes('missing_expect_import_for_assertions'));
});

test('direct expect calls still require their import and unused imports remain rejected',()=>{
  assert.ok(check(`await expect(page.getByText('Error')).toBeVisible();`).structureErrors.includes('missing_expect_import_for_assertions'));
  assert.ok(!check(`await expect(page.getByText('Error')).toBeVisible();`,true).structureErrors.includes('missing_expect_import_for_assertions'));
  assert.ok(check('',true).structureErrors.includes('unused_import:expect'));
});

test('removing assertions still fails coverage even though no import is required',()=>{
  const result=check('');
  assert.ok(result.semanticErrors.length>0);
});
