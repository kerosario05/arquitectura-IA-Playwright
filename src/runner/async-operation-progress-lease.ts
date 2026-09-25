export type AsyncOperationProgressLeaseOptions = {
  startedAt?: number;
  idleWindowMs: number;
  hardSafetyCapMs: number;
};

export type AsyncOperationProgressLeaseSnapshot = {
  startedAt: number;
  lastMeaningfulProgressAt: number;
  idleDeadline: number;
  hardSafetyDeadline: number;
};

/**
 * Tracks the two independent bounds for an asynchronous UI operation.
 * Meaningful progress may renew only the idle deadline; the hard safety
 * deadline is fixed at operation start and can never be extended.
 */
export class AsyncOperationProgressLease {
  readonly startedAt: number;
  readonly idleWindowMs: number;
  readonly hardSafetyDeadline: number;
  private _lastMeaningfulProgressAt: number;
  private _idleDeadline: number;

  constructor(options: AsyncOperationProgressLeaseOptions) {
    const startedAt = options.startedAt ?? Date.now();
    const idleWindowMs = Math.max(1, options.idleWindowMs);
    const hardSafetyCapMs = Math.max(idleWindowMs, options.hardSafetyCapMs);

    this.startedAt = startedAt;
    this.idleWindowMs = idleWindowMs;
    this._lastMeaningfulProgressAt = startedAt;
    this.hardSafetyDeadline = startedAt + hardSafetyCapMs;
    this._idleDeadline = Math.min(this.hardSafetyDeadline, startedAt + idleWindowMs);
  }

  get lastMeaningfulProgressAt(): number {
    return this._lastMeaningfulProgressAt;
  }

  get idleDeadline(): number {
    return this._idleDeadline;
  }

  recordMeaningfulProgress(at = Date.now()): void {
    if (at < this.startedAt || at >= this.hardSafetyDeadline) return;
    this._lastMeaningfulProgressAt = at;
    this._idleDeadline = Math.min(this.hardSafetyDeadline, at + this.idleWindowMs);
  }

  renewIdleDeadline(idleWindowMs: number, at = Date.now()): void {
    if (at < this.startedAt || at >= this.hardSafetyDeadline) return;
    this._lastMeaningfulProgressAt = at;
    this._idleDeadline = Math.min(this.hardSafetyDeadline, at + Math.max(1, idleWindowMs));
  }

  snapshot(): AsyncOperationProgressLeaseSnapshot {
    return {
      startedAt: this.startedAt,
      lastMeaningfulProgressAt: this._lastMeaningfulProgressAt,
      idleDeadline: this._idleDeadline,
      hardSafetyDeadline: this.hardSafetyDeadline,
    };
  }
}
