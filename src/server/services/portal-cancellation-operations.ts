import { randomUUID } from "node:crypto";
import { PortalCancellationError } from "./portal-comercial-request-cancellation";

/**
 * A cancellation by creator can take minutes (each request is re-read and verified against the Portal), far longer
 * than one HTTP request survives. It runs in the background and the panel polls its progress.
 */
export type CancellationOperation = {
  id: string;
  slug: string;
  createdBy: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  cancelledIds: string[];
  /** Size of the reviewed list being cancelled (known once the run has read the Portal). */
  total: number;
  failed: { id: string; reason: string } | null;
  error?: { code: string; message: string };
};

const MAX_KEPT = 20;
const operations = new Map<string, CancellationOperation>();

export class CancellationAlreadyRunningError extends Error {
  constructor(readonly operationId: string) {
    super("cancellation_already_running");
    this.name = "CancellationAlreadyRunningError";
  }
}

export function startCancellationOperation(
  slug: string,
  createdBy: string,
  run: (onProgress: (cancelledIds: string[], total?: number) => void) => Promise<{ cancelledIds: string[]; failed: { id: string; reason: string } | null }>,
): CancellationOperation {
  const running = [...operations.values()].find((operation) => operation.slug === slug && operation.status === "running");
  if (running) throw new CancellationAlreadyRunningError(running.id);
  const operation: CancellationOperation = {
    id: randomUUID(), slug, createdBy, status: "running", startedAt: new Date().toISOString(), cancelledIds: [], total: 0, failed: null,
  };
  operations.set(operation.id, operation);
  while (operations.size > MAX_KEPT) {
    const oldest = [...operations.values()].find((item) => item.status !== "running");
    if (!oldest) break;
    operations.delete(oldest.id);
  }
  void (async () => {
    try {
      const result = await run((ids, total) => { operation.cancelledIds = ids; if (total !== undefined) operation.total = total; });
      operation.cancelledIds = result.cancelledIds;
      operation.failed = result.failed;
      operation.status = "done";
    } catch (error) {
      operation.status = "failed";
      operation.error = error instanceof PortalCancellationError
        ? { code: error.code, message: error.message }
        : { code: "cancellation_internal_error", message: "No se pudo completar la cancelación." };
    } finally {
      operation.finishedAt = new Date().toISOString();
    }
  })();
  return operation;
}

/** The run in progress for a project, else the most recent one (so a reopened panel can follow it). */
export function getLatestCancellationOperation(slug: string): CancellationOperation | undefined {
  const own = [...operations.values()].filter((operation) => operation.slug === slug);
  return own.find((operation) => operation.status === "running") ?? own[own.length - 1];
}

export function getCancellationOperation(slug: string, id: string): CancellationOperation | undefined {
  const operation = operations.get(id);
  return operation && operation.slug === slug ? operation : undefined;
}

/** Test helper: forget every operation. */
export function resetCancellationOperations(): void {
  operations.clear();
}
