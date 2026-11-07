import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createArtifactJsonReader,createRefreshingSnapshot,forEachArtifact} from './execution-list-cache';

test('artifact loading bounds concurrent disk operations and visits every item once',async()=>{
  let active=0,peak=0;const seen:number[]=[];
  await forEachArtifact([1,2,3,4,5],async value=>{active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));seen.push(value);active--;},2);
  assert.equal(peak,2);assert.deepEqual(seen.sort(),[1,2,3,4,5]);
});

test('cold requests share one refresh; expired snapshot is returned without waiting',async()=>{
  let now=0,calls=0;let finish!:(v:number[])=>void;
  const read=createRefreshingSnapshot(()=>{calls++;return new Promise<number[]>(r=>finish=r);},25,()=>now);
  const a=read(),b=read();assert.equal(calls,1);finish([1]);assert.deepEqual(await a,[1]);assert.deepEqual(await b,[1]);
  now=26;assert.deepEqual(await read(),[1]);assert.equal(calls,2);assert.deepEqual(await read(),[1]);assert.equal(calls,2);
  finish([2]);await new Promise(r=>setImmediate(r));assert.deepEqual(await read(),[2]);
});
test('refresh failure retains the last complete snapshot; cold errors remain errors',async()=>{
  let now=0;const read=createRefreshingSnapshot(async()=>{if(now)throw Error('disk');return [1];},25,()=>now);
  await read();now=26;assert.deepEqual(await read(),[1]);await new Promise(r=>setImmediate(r));assert.deepEqual(await read(),[1]);
  await assert.rejects(createRefreshingSnapshot(async()=>{throw Error('disk');},25)(),/disk/);
});
test('artifact cache detects edits, corruption, deletion and recreation',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'execution-cache-'));const file=path.join(dir,'job.json');const read=createArtifactJsonReader();
  try{await fs.writeFile(file,'{"passed":1}');const a=await read(file);assert.equal(await read(file),a);await fs.writeFile(file,'{"passed":22}');assert.deepEqual(await read(file),{passed:22});await fs.writeFile(file,'bad');assert.equal(await read(file),null);await fs.rm(file);assert.equal(await read(file),null);await fs.writeFile(file,'{"passed":3}');assert.deepEqual(await read(file),{passed:3});}finally{await fs.rm(dir,{recursive:true,force:true});}
});
