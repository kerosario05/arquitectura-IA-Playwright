import test from 'node:test';
import assert from 'node:assert/strict';
import {declaredIncomeFloor,forcedIdentifications,freshRecordingCedulas} from './recording-fresh-cedulas';
// The history-exclusion tests below describe the behavior with ID reuse switched off.
process.env.DATA_CEDULAS_REUSE='false';
test('pinned identifications are parsed to digits and empty entries ignored',()=>{
  assert.deepEqual(forcedIdentifications({DATA_CEDULAS_FORCED_IDS:' 223-0011200-4 , ,00100878693'} as any),['22300112004','00100878693']);
  assert.deepEqual(forcedIdentifications({} as any),[]);
});
test('declared income floors the income estimator but ignores income type/date fields',()=>{
  const requirements:any=[
    {valueKey:'entity_1.salario',semanticField:'Salario',value:'$80,000.00 mensual'},
    {valueKey:'entity_1.tipo_de_ingreso_seleccion',semanticField:'Tipo de ingreso',value:'Salario'},
    {valueKey:'entity_1.fecha_de_ingreso',semanticField:'Fecha de ingreso',value:'01-11-2020'},
  ];
  assert.equal(declaredIncomeFloor(requirements,{DATA_CEDULAS_INCOME_TO_DECLARED_RATIO:'0.99'} as any),79200);
  assert.equal(declaredIncomeFloor(requirements,{} as any),0,'off by default');
  assert.equal(declaredIncomeFloor([requirements[1],requirements[2]],{DATA_CEDULAS_INCOME_TO_DECLARED_RATIO:'0.99'} as any),0);
});
const scenario:any={runtimeInputRequirements:[{valueKey:'numero_identificacion',semanticField:'Número de identificación',valueRole:'action_input'}],runtimeDataset:{resolvedValues:{numero_identificacion:'10000000001'}}};
function deps(enabled=true) {
  const calls:any[]=[];
  return {calls,issued:new Map(),config:()=>({dataServices:{dataCedulas:{enabled,database:'QA1'}}}),generate:async(db:string,count:number,exclude:string[])=>{calls.push({db,count,exclude:[...exclude]});return {customers:[{Cedula:'10000000002'},{Cedula:'10000000003'}].slice(0,count)};}} as any;
}
test('unpromoted recording obtains distinct discovery and spec data excluding its old ID',async()=>{
  const d=deps();const result=await freshRecordingCedulas('example',scenario,true,d);
  assert.deepEqual(result,{values:{numero_identificacion:'10000000002'},specValues:{numero_identificacion:'10000000003'}});
  assert.equal(d.calls[0].count,2);assert.deepEqual(d.calls[0].exclude,['10000000001']);
});
test('promoted rerun requests only one; disabled and unrelated inputs never generate',async()=>{
  const d=deps();assert.deepEqual((await freshRecordingCedulas('example',scenario,false,d)).specValues,{});assert.equal(d.calls[0].count,1);
  const off=deps(false);await freshRecordingCedulas('example',scenario,true,off);assert.equal(off.calls.length,0);
  const unrelated=deps();await freshRecordingCedulas('example',{...scenario,runtimeInputRequirements:[]} as any,true,unrelated);assert.equal(unrelated.calls.length,0);
});
test('generator failure or a repeated identification blocks reuse of stale data',async()=>{
  const d=deps();d.generate=async()=>({customers:[{Cedula:'10000000001'},{Cedula:'10000000001'}]});
  await assert.rejects(()=>freshRecordingCedulas('example',scenario,true,d),/frescas/);
});
test('with reuse on, previously issued and recorded IDs stay eligible; only this call keeps them distinct',async()=>{
  delete process.env.DATA_CEDULAS_REUSE;
  try {
    const d=deps();await freshRecordingCedulas('example',scenario,true,d);
    assert.deepEqual(d.calls[0].exclude,[]);
    d.generate=async(_db:string,_count:number,exclude:string[])=>{
      assert.deepEqual(exclude,['10000000002','10000000003'].slice(0,0),'issued ids are not excluded on the next call');
      return {customers:[{Cedula:'10000000002'}]};
    };
    const next=await freshRecordingCedulas('example',scenario,false,d);
    assert.equal(next.values.numero_identificacion,'10000000002');
  } finally { process.env.DATA_CEDULAS_REUSE='false'; }
});
test('next rerun excludes recently issued IDs even when the prior attempt did not create the customer',async()=>{
  const d=deps();await freshRecordingCedulas('example',scenario,true,d);
  d.generate=async(_db:string,_count:number,exclude:string[])=>{
    assert.ok(exclude.includes('10000000002'));assert.ok(exclude.includes('10000000003'));
    return {customers:[{Cedula:'10000000004'}]};
  };
  const next=await freshRecordingCedulas('example',scenario,false,d);
  assert.equal(next.values.numero_identificacion,'10000000004');
});
