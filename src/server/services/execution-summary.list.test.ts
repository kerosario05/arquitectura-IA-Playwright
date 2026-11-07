import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import '../../config/env';
import type {ExecutionSummaryListItem} from './execution-summary.service';

test('async execution list preserves manifest precedence, preview counts, archived history and project identities',async()=>{
  const original=process.cwd();const dir=await fs.mkdtemp(path.join(os.tmpdir(),'execution-list-'));
  const write=async(relative:string,value:unknown)=>{const file=path.join(dir,'.artifacts',relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value));};
  try{
    await write('scenario-launch-runs/launch1/launch-manifest.json',{jobId:'job1',createdAt:'2026-10-30T12:00:00Z',appSlug:'portal-comercial',summary:{total:1,passed:1,failed:0},jira:{title:'Primary'}});
    await write('scenario-preview-runs/job1/job.json',{status:'done',appSlug:'portal-comercial'});
    await write('scenario-preview-runs/job2/job.json',{status:'done',appSlug:'fenix',createdAt:'2026-10-31T12:00:00Z'});
    await write('scenario-preview-runs/job2/results.json',{results:[{title:'Observed preview',status:'passed'}]});
    await write('qa-lab-run-history/job2.json',{id:'job2',status:'done',params:{appSlug:'fenix'}});
    await write('qa-lab-run-history/job3.json',{id:'job3',status:'done',createdAt:'2026-10-29T12:00:00Z',params:{appSlug:'fenix'},summary:{passed:2,failed:0}});
    const moduleUrl=pathToFileURL(path.join(original,'src/server/services/execution-summary.service.ts')).href;
    const loaderUrl=pathToFileURL(path.join(original,'node_modules/tsx/dist/loader.mjs')).href;
    // Isolate cwd in a child process: Windows pins its native cwd handle until
    // process exit, even when chdir appears restored during concurrent fs I/O.
    const child=spawnSync(process.execPath,['--import',loaderUrl,'--input-type=module','--eval',
      `const {listExecutionSummaries}=await import(${JSON.stringify(moduleUrl)});const rows=await listExecutionSummaries();console.log(JSON.stringify({rows,same:(await listExecutionSummaries())===rows}));`],
      {cwd:dir,env:process.env,encoding:'utf8',timeout:15000});
    assert.equal(child.status,0,child.stderr);
    const {rows,same}=JSON.parse(child.stdout.trim()) as {rows:ExecutionSummaryListItem[];same:boolean};
    assert.deepEqual(rows.map(r=>r.launchId),['job2','launch1','job3']);
    assert.equal(rows[0].huTitle,'Observed preview');assert.equal(rows[0].passed,1);assert.equal(rows[0].appSlug,'fenix');
    assert.equal(rows[1].huTitle,'Primary');assert.equal(rows[1].scenarioCount,1);assert.equal(rows[1].appSlug,'portal-comercial');
    assert.equal(rows[2].passed,2);assert.equal(same,true);
  }finally{await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
