import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateJobProcess} from './terminate-job-process';
import {jobStore} from './job-store';
test('Windows terminates only the selected job tree and waits for completion',async()=>{
  const calls:unknown[]=[];
  await terminateJobProcess({pid:123,exitCode:null,signalCode:null} as any,'win32',async(...args)=>{calls.push(args);});
  assert.deepEqual(calls,[['taskkill.exe',['/PID','123','/T','/F']]]);
});
test('missing process and termination failures are not reported as success',async()=>{
  await assert.rejects(()=>terminateJobProcess(undefined),/proceso cancelable/);
  await assert.rejects(()=>terminateJobProcess({pid:123,exitCode:null,signalCode:null} as any,'win32',async()=>{throw new Error('denied');}),/denied/);
});
test('cancelled jobs cannot become failed or done through delayed process callbacks',()=>{
  const job=jobStore.create('scenario-preview',{});
  const internal=jobStore.getInternal(job.id)!;
  internal.parentJobId='cancel-fixture'; // avoid writing synthetic history to the workspace
  internal.cancellationRequested=true;
  jobStore.update(job.id,{status:'failed'});
  assert.equal(jobStore.get(job.id)?.status,'queued');
  jobStore.update(job.id,{status:'cancelled'});
  jobStore.update(job.id,{status:'done'});
  assert.equal(jobStore.get(job.id)?.status,'cancelled');
});
