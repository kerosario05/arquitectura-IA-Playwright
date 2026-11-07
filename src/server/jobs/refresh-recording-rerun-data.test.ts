import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshRecordingRerunData} from './refresh-recording-rerun-data';

const canonical:any={scenarioId:'case',title:'Example',description:'Example',preconditions:[],kind:'happy_path',provenance:'observed',mobileSteps:[],webSteps:[{action:'fill',valueKey:'cedula',description:'Ingresar [cedula]'}],testRailSteps:[{content:'Ingresar [cedula]',stepTemplate:'Ingresar [cedula]',valueKey:'cedula',expected:''}],requiredData:[{key:'cedula',label:'Cédula',semanticField:'Cédula',stepIndex:0,exampleValue:'10000000001',valueRole:'action_input',source:'RECORDED_CONFIRMED',sensitive:false}],stepTargets:[],sourceRecordingId:'recording',hasUncertainSteps:false,primary:true,canonicalInteractions:[{id:'fill',controlIdentity:'cedula',semanticField:'Cédula',action:'fill',valueKey:'cedula',recordedValue:'10000000001',sourceEventRefs:['e1'],technicalTargetRefs:['css:#cedula'],confidence:1}]};
function prepared(reuse:boolean):any{return {ok:true,jobType:'scenario-preview',appSlug:'example',recordingId:'recording',scenarios:[{scenarioId:'case',recordingId:'recording',recordedScenarioId:'case'}],promotedSpecReuse:[{scenarioId:'case',canonicalScenarioId:'case',reuse,runtimeValues:{cedula:'10000000001'}}]};}
test('rerun transports new data to discovery and keeps spec data separate without changing source',async()=>{
  const p=prepared(false);const before=JSON.stringify(canonical);
  const spec=await refreshRecordingRerunData(p,{load:()=>[canonical],generate:async(_app,_scenario,needsSpec)=>{
    assert.equal(needsSpec,true);return {values:{cedula:'10000000002'},specValues:{cedula:'10000000003'}};
  }});
  assert.equal(p.promotedSpecReuse[0].runtimeValues.cedula,'10000000002');
  assert.equal(spec['case'].cedula,'10000000003');
  assert.ok(JSON.stringify(p.scenarios).includes('10000000002'));
  assert.ok(!JSON.stringify(p.scenarios).includes('10000000003'));
  assert.equal(JSON.stringify(canonical),before);
});
test('promoted rerun replaces runtime values and requests no spec-only identifier',async()=>{
  const p=prepared(true);
  const spec=await refreshRecordingRerunData(p,{load:()=>[canonical],generate:async(_app,_scenario,needsSpec)=>{
    assert.equal(needsSpec,false);return {values:{cedula:'10000000004'},specValues:{}};
  }});
  assert.equal(p.promotedSpecReuse[0].runtimeValues.cedula,'10000000004');assert.deepEqual(spec,{});
});
