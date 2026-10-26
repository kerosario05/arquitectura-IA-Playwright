import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiProvider } from '../ai/ai-provider.types';
import { JIRA_GENERATION_CONCURRENCY, mapJiraGenerationWork, withJiraGenerationConcurrency } from './jira-generation-scheduler';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('bounded work overlaps, preserves source order and handles empty work', async () => {
  const releases = new Map<number, () => void>();
  const started: number[] = [];
  let active = 0, peak = 0;
  const work = Array.from({length:JIRA_GENERATION_CONCURRENCY+3},(_,index)=>index);
  const pending = mapJiraGenerationWork(work, async value => {
    started.push(value);
    peak = Math.max(peak, ++active);
    await new Promise<void>(resolve => releases.set(value, resolve));
    active--;
    return value;
  });
  assert.deepEqual(started, work.slice(0,JIRA_GENERATION_CONCURRENCY));
  releases.get(JIRA_GENERATION_CONCURRENCY-1)!(); await flush();
  assert.deepEqual(started, work.slice(0,JIRA_GENERATION_CONCURRENCY+1));
  releases.get(1)!(); await flush();
  assert.deepEqual(started, work.slice(0,JIRA_GENERATION_CONCURRENCY+2));
  while (releases.size) {
    const pendingValues=[...releases.keys()];
    for (const value of pendingValues) {
      const release=releases.get(value);
      if (!release) continue;
      releases.delete(value);
      release();
    }
    await flush();
  }
  assert.deepEqual(await pending, work);
  assert.equal(peak, JIRA_GENERATION_CONCURRENCY);
  assert.deepEqual(await mapJiraGenerationWork([], async value => value), []);
});

test('provider limit is shared across callers and releases slots after failure', async () => {
  const releases: Array<() => void> = [];
  let active = 0, peak = 0, calls = 0;
  const provider: AiProvider = { providerType: 'fake', providerName: 'fixture', model: 'fixture',
    async completeJson() {
      const index = calls++;
      peak = Math.max(peak, ++active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      if (index === 0) throw new Error('synthetic failure');
      return {rawText:'{}', model:'fixture', providerName:'fixture', durationMs:0};
    }
  };
  const first=withJiraGenerationConcurrency(provider), second=withJiraGenerationConcurrency(provider);
  const pending=Promise.allSettled(Array.from({length:7}, (_,i)=>(i%2 ? first : second).completeJson({messages:[]})));
  assert.equal(calls,JIRA_GENERATION_CONCURRENCY);
  for (let i=0;i<7;i++) { releases[i](); await flush(); }
  const results=await pending;
  assert.equal(peak,JIRA_GENERATION_CONCURRENCY);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.equal(calls,7);
});
