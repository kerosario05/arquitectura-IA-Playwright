import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium, type Browser} from '@playwright/test';
import {WebSessionRecorder} from './web-session-recorder';

for (const mode of ['direct-headed','agent','headless'] as const) {
  test(`recording ${mode} uses the intended native-window and viewport policy`,async()=>{
    const original=chromium.launch;
    let launchOptions:any;
    let contextOptions:any;
    const browser={newContext:async(options:any)=>{
      contextOptions=options;
      throw new Error('fixture stops before capture');
    }} as unknown as Browser;
    chromium.launch=async(options)=>{launchOptions=options;return browser;};
    try {
      const recorder=new WebSessionRecorder({baseUrl:'https://example.invalid',framesDir:'.artifacts/tmp/window-fixture',
        headless:mode==='direct-headed'?false:true,
        connectBrowser:mode==='agent'?async()=>browser:undefined});
      await assert.rejects(()=>recorder.start(),/fixture stops before capture/);
      assert.equal(contextOptions.viewport,mode==='headless'?undefined:null);
      if(mode==='direct-headed') {
        assert.equal(launchOptions.headless,false);
        assert.deepEqual(launchOptions.args,['--start-maximized']);
      } else if(mode==='agent') assert.equal(launchOptions,undefined);
      else {
        assert.equal(launchOptions.headless,true);
        assert.equal(launchOptions.args,undefined);
      }
    } finally {chromium.launch=original;}
  });
}
