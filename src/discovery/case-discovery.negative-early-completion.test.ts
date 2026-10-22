import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateEarlyCompletion,parseScenarioStepsForDiscovery} from './case-discovery';
import {resolveAssertionTargets} from './assertion-resolver';

for(const forbidden of ['comprobante de transacción exitosa','Order completed']) {
 test(`negative outcome stays pending at early completion until explicit resolution: ${forbidden}`,()=>{
  const snapshot={title:'Form',url:'https://fixture.test/form',elements:[
   {id:'error',tagName:'div',role:'alert',text:'Invalid credentials',visible:true},
   {id:'field',tagName:'input',label:'Username',visible:true},
  ],summary:{buttons:0,inputs:1,links:0,headings:0,dialogs:0}} as any;
  const parsed=parseScenarioStepsForDiscovery({title:'Rejection',steps:[
   {index:1,action:'Presionar "Sign in"'},
   {index:2,action:'Validar que se muestre "Invalid credentials"'},
   {index:3,action:`Validar que no se muestre "${forbidden}"`},
  ]} as any);
  const result=evaluateEarlyCompletion(snapshot,parsed.assertionTargets,[],undefined,{currentStepIndex:1});
  const negative=parsed.assertionTargets.find(target=>target.index===3)!;
  assert.equal(result.satisfied,false);
  assert.ok(result.pendingAssertions.includes(negative.target));
  assert.ok(!result.skippedAssertions.includes(negative.target));
  // The ordinary assertion consumer can use a fresh nonblank rejection snapshot;
  // early completion must reach it rather than manufacture absence evidence.
  const evidence={snapshotStable:false,authRejection:{classification:'AUTH_REJECTED' as const,authHttpStatus:403,errorSurfaceObserved:true,businessSurfaceReached:false}};
  assert.equal(resolveAssertionTargets(snapshot,[negative],{negativeVisibility:evidence})[0].status,'passed');
  const successVisible={...snapshot,elements:[...snapshot.elements,{id:'success',tagName:'div',text:forbidden,visible:true}]};
  assert.equal(resolveAssertionTargets(successVisible,[negative],{negativeVisibility:evidence})[0].status,'failed');
  const positiveOnly=evaluateEarlyCompletion(snapshot,parsed.assertionTargets.filter(target=>target.index===2),[],undefined,{currentStepIndex:1});
  assert.equal(positiveOnly.satisfied,true);
 });
}
