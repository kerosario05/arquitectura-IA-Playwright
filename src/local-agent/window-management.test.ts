import test from 'node:test';
import assert from 'node:assert/strict';
import type {Page} from '@playwright/test';
import {maximizeBrowserWindow} from './window-management';

test('maximizes the recording page window, restores first and brings it forward',async()=>{
  const calls: Array<{method:string;params?:any}> = [];
  const page = {
    context:()=>({newCDPSession:async(target:unknown)=>{
      assert.equal(target,page);
      return {send:async(method:string,params?:any)=>{
        calls.push({method,params});
        if(method==='Target.getTargetInfo') return {targetInfo:{targetId:'recording-page'}};
        if(method==='Browser.getWindowForTarget') return {windowId:7};
        if(method==='Browser.getWindowBounds') return {bounds:{windowState:'maximized'}};
        return {};
      },detach:async()=>{calls.push({method:'detach'});}};
    }}),
    bringToFront:async()=>{calls.push({method:'bringToFront'});},
  } as unknown as Page;
  assert.equal(await maximizeBrowserWindow(page),true);
  assert.deepEqual(calls,[
    {method:'Target.getTargetInfo',params:undefined},
    {method:'Browser.getWindowForTarget',params:{targetId:'recording-page'}},
    {method:'Browser.setWindowBounds',params:{windowId:7,bounds:{windowState:'normal'}}},
    {method:'Browser.setWindowBounds',params:{windowId:7,bounds:{windowState:'maximized'}}},
    {method:'bringToFront'},
    {method:'Browser.getWindowBounds',params:{windowId:7}},
    {method:'detach'},
  ]);
});

test('unsupported CDP remains best effort and detaches',async()=>{
  let detached=false;
  const page={context:()=>({newCDPSession:async()=>({send:async()=>{throw new Error('unsupported');},detach:async()=>{detached=true;}})})} as unknown as Page;
  assert.equal(await maximizeBrowserWindow(page),false);
  assert.equal(detached,true);
});

test('early browser connection waits for a recording page and never chooses among windows',async()=>{
  const empty={contexts:()=>[{pages:()=>[]}]} as any;
  const multiple={contexts:()=>[{pages:()=>[{},{}]}]} as any;
  assert.equal(await maximizeBrowserWindow(empty),false);
  assert.equal(await maximizeBrowserWindow(multiple),false);
});
