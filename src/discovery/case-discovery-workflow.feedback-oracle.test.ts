import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {buildPromotionSourceScenario} from './case-discovery-workflow';
import {buildSpecExecutionContract,validateSpecExecutionContract} from '../automations/spec-execution-contract';
import {compileDeterministicSpec} from '../automations/spec-compiler/deterministic-spec-compiler';

test('observed credential feedback binds the authored assertion to the actual visible message through compilation',()=>{
 const authored='Validar que se muestre "problema de credenciales"';
 const observed='Usuario o contraseña incorrectos';
 const scenario={source:'testrail',caseId:1,externalId:'C1',title:'Rejection',steps:[{index:1,action:'Presionar "Sign in"',dataHints:[]},{index:2,action:authored,dataHints:[]}],raw:{id:1,title:'Rejection',custom_expected:''}} as any;
 const result={version:'1.0',caseId:1,caseTitle:'Rejection',status:'discovered_passed',discoveredAt:new Date().toISOString(),discoveredObjects:[],steps:[{index:1,action:'Presionar "Sign in"',status:'found',targetText:'Sign in'},{index:2,action:authored,targetText:authored,status:'found',assertionStatus:'passed',assertionClassification:'feedback_message',matchedText:observed,assertionDiagnostics:{resolver:'feedback_message'}}]} as any;
 const source=buildPromotionSourceScenario(scenario,result);
 const plan={version:'1.0',source:'discovery_generated',status:'validated',scenario:{externalId:'C1',title:'Rejection'},requiredData:[],createdAt:new Date().toISOString(),steps:[{index:1,action:'click',target:{strategy:'text',value:'Sign in'},description:'Presionar "Sign in"'}]} as any;
 const contract=buildSpecExecutionContract(plan,source);
 assert.equal(contract.steps.find(step=>step.scenarioStepIndex===2)?.oracle?.target,observed);
 const compiled=compileDeterministicSpec(contract,{targetSpecPath:path.resolve('automations/apps/fixture/sections/fixture/cases/fixture/case.spec.ts')});
 assert.deepEqual(compiled.unsupportedCapabilities,[]);
 assert.equal(contract.steps.find(step=>step.scenarioStepIndex===2)?.oracle?.type,'credential_rejection');
 assert.ok(compiled.source.includes('credentialRejectionTarget:'));
 assert.ok(compiled.source.includes(observed));
});

test('a separately proven negative assertion survives the source contract and deterministic compiler',()=>{
 const forbidden='comprobante de transacción exitosa';
 const assertion=`Validar que no se muestre "${forbidden}"`;
 const declared={index:8,action:assertion,dataHints:[],polarity:'negative',canonicalAssertion:{intent:'validation_present',polarity:'negative'}};
 const scenario={source:'testrail',caseId:1,externalId:'C1',title:'Rejection',steps:[declared],raw:{id:1,title:'Rejection',custom_expected:''}} as any;
 for(const proven of [true,false]) {
  const result={version:'1.0',caseId:1,caseTitle:'Rejection',status:'discovered_passed',discoveredAt:new Date().toISOString(),discoveredObjects:[],steps:[{index:8,action:assertion,targetText:assertion,status:proven?'found':'needs_assertion_resolution',assertionStatus:proven?'passed':'needs_assertion_resolution',assertionDiagnostics:{oracleType:'negative_visibility',forbiddenTarget:forbidden,snapshotStable:proven,visibleElementCount:2}}]} as any;
  const source=buildPromotionSourceScenario(scenario,result);
  const plan={version:'1.0',source:'discovery_generated',status:'validated',scenario:{externalId:'C1',title:'Rejection'},requiredData:[],createdAt:new Date().toISOString(),steps:[]} as any;
  const contract=buildSpecExecutionContract(plan,source);
  const compiled=compileDeterministicSpec(contract,{targetSpecPath:path.resolve('automations/apps/fixture/sections/fixture/cases/fixture/case.spec.ts')});
  if(proven) {
   assert.equal(validateSpecExecutionContract(contract).valid,true);
   assert.equal(contract.steps[0].oracle?.type,'negative_visibility');
   assert.equal(contract.steps[0].oracle?.polarity,'negative');
   assert.deepEqual(compiled.unsupportedCapabilities,[]);
   assert.ok(compiled.source.includes('negativeVisibilityTarget:'));
   assert.ok(compiled.source.includes(forbidden));
  } else assert.ok(compiled.unsupportedCapabilities.length>0,'unproven absence must never compile as a passing assertion');
 }
});
