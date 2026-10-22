import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from '@playwright/test';
import {PromotedSpecRuntime} from './promoted-spec-runtime';

test('credential rejection checks fresh equivalent feedback while rejecting unrelated outcomes', async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  const runtime=new PromotedSpecRuntime(page,{captureDiagnostics:false,stabilityTimeoutMs:1200,actionTimeoutMs:2500});
  (runtime as any).ensureInitialEvidence=async()=>undefined;
  (runtime as any).captureEvidenceStep=async()=>undefined;
  for(const [expected,observed] of [['Credenciales inválidas','Usuario o Contraseña inválidos.'],['Invalid credentials','Invalid username or password.']]) {
   const options={stepIndex:7,target:`text:${expected}`,credentialRejectionTarget:expected,polarity:'positive' as const,assertion:async()=>{throw Error('runtime owns feedback check');}};
   await page.setContent(`<main><div role="dialog"><p>${observed}</p><button>Close</button></div></main>`);
   await runtime.expectPromotedVisible(options);
   for(const unrelated of ['Service unavailable','Sign in','Operation successful','']) {
    await page.setContent(`<main><p>${unrelated}</p></main>`);
    await assert.rejects(runtime.expectPromotedVisible(options),/PROMOTED_CREDENTIAL_REJECTION_NOT_OBSERVED/);
   }
  }
 } finally {await browser.close();}
});

test('promoted negative visibility rechecks the fresh page and fails for success, blank or unresolved descriptors',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  const runtime=new PromotedSpecRuntime(page,{captureDiagnostics:false,stabilityTimeoutMs:1200,actionTimeoutMs:2500});
  (runtime as any).ensureInitialEvidence=async()=>undefined;
  (runtime as any).captureEvidenceStep=async()=>undefined;
  for(const forbidden of ['comprobante de transacción exitosa','Order completed']) {
   const options={stepIndex:8,target:`text:${forbidden}`,negativeVisibilityTarget:forbidden,polarity:'negative' as const,assertion:async()=>{throw Error('runtime must own this assertion');}};
   await page.setContent('<main><h1>Sign in</h1><p role="alert">Invalid credentials</p><input aria-label="Username"></main>');
   await runtime.expectPromotedVisible(options);
   await page.setContent(`<main><h1>${forbidden}</h1></main>`);
   await assert.rejects(runtime.expectPromotedVisible(options),/negative_visibility_target_present/);
   await page.setContent('');
   await assert.rejects(runtime.expectPromotedVisible(options),/negative_visibility_blank_snapshot/);
  }
  await assert.rejects(runtime.expectPromotedVisible({stepIndex:8,target:'text:Done',polarity:'negative',assertion:async()=>undefined}),/PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED/);
  await assert.rejects(runtime.expectPromotedVisible({stepIndex:8,target:'text:Other',negativeVisibilityTarget:'Done',polarity:'negative',assertion:async()=>undefined}),/PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED/);
  let positiveCalled=false;
  await runtime.expectPromotedVisible({stepIndex:7,target:'text:Error',polarity:'positive',assertion:async()=>{positiveCalled=true;}});
  assert.equal(positiveCalled,true,'positive assertion keeps its original callback');
 }finally {await browser.close();}
});
