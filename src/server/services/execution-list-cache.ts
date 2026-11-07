import { promises as fs } from 'node:fs';

export async function forEachArtifact<T>(values: T[], visit: (value: T) => Promise<void>, concurrency = 16): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({length:Math.min(values.length,concurrency)}, async()=>{
    while(next<values.length) {
      const value = values[next++];
      await visit(value);
    }
  }));
}

/** One refresh at a time; readers keep the last complete snapshot while it runs. */
export function createRefreshingSnapshot<T>(load: () => Promise<T>, ttlMs: number, now = Date.now) {
  let snapshot: { value: T; at: number } | undefined;
  let pending: Promise<T> | undefined;
  return (): Promise<T> => {
    if (!snapshot || now() - snapshot.at >= ttlMs) {
      if (!pending) {
        pending = load().then(value => {
          snapshot = { value, at: now() };
          return value;
        }).finally(() => { pending = undefined; });
        // A background failure must not discard a valid snapshot or reject unhandled.
        if (snapshot) void pending.catch(() => undefined);
      }
    }
    return snapshot ? Promise.resolve(snapshot.value) : pending!;
  };
}

/** Reparse only changed artifacts. This cache never writes source recordings/jobs. */
export function createArtifactJsonReader(maxEntries = 2048, project: (value: any, file: string) => unknown = value => value) {
  const entries = new Map<string, { stamp: string; value: unknown }>();
  return async <T>(file: string): Promise<T | null> => {
    try {
      const stat = await fs.stat(file);
      const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      const cached = entries.get(file);
      if (cached?.stamp === stamp) return cached.value as T;
      const value = project(JSON.parse(await fs.readFile(file, 'utf8')), file) as T;
      entries.delete(file);
      entries.set(file, { stamp, value });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return value;
    } catch {
      entries.delete(file);
      return null;
    }
  };
}
