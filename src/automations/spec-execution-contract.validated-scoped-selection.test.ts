import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSpecExecutionContract} from './spec-execution-contract';
import {compileDeterministicSpec} from './spec-compiler/deterministic-spec-compiler';
function fixture(field='Oficial', appSlug='app-one') {
  const action=`Seleccionar "Opción QA" en "${field}"`;
  const candidate={targetType:'structural',validatedByInteraction:true,locatorCandidates:[],structuralContext:{owner:{tag:'span',role:'combobox'},stableDirectAttributes:{role:'combobox'},deterministicStructuralIdentity:true,structuralIdentityMatchCount:1,captureScopeUnique:true,captureTargetMatchCount:1}};
  const plan:any={version:'1.0',source:'discovery_generated',status:'validated',scenario:{caseId:0,externalId:'QA-1',title:'Selection'},requiredData:[],steps:[{index:1,action:'click',description:action,target:{strategy:'selection_option_causal_surface',value:'Opción QA'}}]};
  const source:any={title:'Selection',steps:[{index:1,action,associatedField:field,technicalTargetCandidates:[candidate]}]};
  return {plan,source,appSlug,candidate};
}
for(const [app,field] of [['app-one','Oficial'],['app-two','Cuenta de origen']]) test(`validated scoped selection defers to shared runtime for ${app}`,()=>{
  const f=fixture(field,app);const contract=buildSpecExecutionContract(f.plan,f.source,{appSlug:f.appSlug});
  assert.equal(contract.steps[0].resolutionState,'runtime_resolution_required');
  const compiled=compileDeterministicSpec(contract,{targetSpecPath:`${process.cwd()}/automations/apps/${app}/cases/qa/case.spec.ts`});
  assert.deepEqual(compiled.unsupportedCapabilities,[]);
  assert.ok(compiled.source.includes(`associatedField: '${field}'`));
  assert.equal(compiled.source.includes("target: 'role:span'"),false);
});
test('unvalidated or ambiguous or unscoped selections do not gain runtime authority',()=>{
  for(const invalid of ['unvalidated','ambiguous','unscoped','value_missing']){
    const f=fixture();
    if(invalid==='unvalidated') f.plan.status='draft';
    if(invalid==='ambiguous') f.candidate.structuralContext.structuralIdentityMatchCount=2;
    if(invalid==='unscoped') delete f.source.steps[0].associatedField;
    if(invalid==='value_missing') {f.source.steps[0].action='Seleccionar en "Oficial"';f.plan.steps[0].description=f.source.steps[0].action;f.plan.steps[0].target.value='';}
    const contract=buildSpecExecutionContract(f.plan,f.source);
    assert.notEqual(contract.steps[0].resolutionState,'runtime_resolution_required',invalid);
  }
});
test('an exact observed option ref preserves the authored literal when the plan target names the owner',()=>{
  const f=fixture('Producto');f.plan.steps[0].target={strategy:'text',value:'Producto'};f.plan.steps[0].technicalTargetRefs=['role:option|Opción QA'];
  let contract=buildSpecExecutionContract(f.plan,f.source);
  assert.equal(contract.steps[0].resolvedExecutionTarget,'Opción QA');
  assert.equal(contract.steps[0].resolutionState,'runtime_resolution_required');
  f.plan.steps[0].technicalTargetRefs=['role:option|Otra opción'];
  contract=buildSpecExecutionContract(f.plan,f.source);
  assert.equal(contract.steps[0].resolvedExecutionTarget,undefined);
});
