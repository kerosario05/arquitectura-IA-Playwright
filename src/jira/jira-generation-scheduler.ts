import type { AiProvider } from '../ai/ai-provider.types';

// Keep each provider request unchanged and bound parallel work. Six workers
// reduce wall time for independent clause batches without changing result order.
export const JIRA_GENERATION_CONCURRENCY = 6;

/** Independent work completes concurrently; consumer order follows the source. */
export async function mapJiraGenerationWork<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JIRA_GENERATION_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

// Shared across requests and nested repair batches: concurrency never multiplies.
let active = 0;
const waiting: Array<() => void> = [];

export function withJiraGenerationConcurrency(provider: AiProvider): AiProvider {
  return {
    ...provider,
    async completeJson(request) {
      if (active < JIRA_GENERATION_CONCURRENCY) active++;
      else await new Promise<void>(resolve => waiting.push(resolve));
      try {
        return await provider.completeJson(request);
      } finally {
        const release = waiting.shift();
        if (release) release();
        else active--;
      }
    },
  };
}
