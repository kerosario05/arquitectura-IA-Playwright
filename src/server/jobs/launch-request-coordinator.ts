import { createHash } from "node:crypto";

type RequestEntry<T> = {
  fingerprint: string;
  pending?: Promise<T>;
  result?: T;
  expiresAt: number;
};

const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const activeRequests = new Map<string, RequestEntry<unknown>>();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalize(nested)]));
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/**
 * Coalesces simultaneous identical launches even for older clients without an
 * idempotency key. Clients that retry after a lost response should send a stable
 * Idempotency-Key; successful results for that key are replayed for five minutes.
 */
export async function coordinateLaunchRequest<T>(
  request: unknown,
  idempotencyKey: string | undefined,
  execute: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const requestFingerprint = fingerprint(request);
  const normalizedKey = idempotencyKey?.trim();
  const key = normalizedKey
    ? `key:${normalizedKey}`
    : `inflight:${requestFingerprint}`;
  const now = Date.now();
  for (const [storedKey, entry] of activeRequests) {
    if (entry.expiresAt <= now) activeRequests.delete(storedKey);
  }
  const previous = activeRequests.get(key) as RequestEntry<T> | undefined;

  if (previous) {
    if (previous.fingerprint !== requestFingerprint) {
      throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_LAUNCH");
    }
    if (previous.pending) return { result: await previous.pending, replayed: true };
    if (normalizedKey && previous.result !== undefined) return { result: previous.result, replayed: true };
  }

  const entry: RequestEntry<T> = {
    fingerprint: requestFingerprint,
    expiresAt: normalizedKey ? now + IDEMPOTENCY_TTL_MS : Number.POSITIVE_INFINITY,
  };
  const pending = execute();
  entry.pending = pending;
  activeRequests.set(key, entry as RequestEntry<unknown>);
  try {
    const result = await pending;
    if (normalizedKey) {
      entry.result = result;
      entry.pending = undefined;
      entry.expiresAt = Date.now() + IDEMPOTENCY_TTL_MS;
    } else {
      activeRequests.delete(key);
    }
    return { result, replayed: false };
  } catch (error) {
    activeRequests.delete(key);
    throw error;
  }
}
