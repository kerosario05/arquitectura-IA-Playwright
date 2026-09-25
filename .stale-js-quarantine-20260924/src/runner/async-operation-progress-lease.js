"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncOperationProgressLease = void 0;
/**
 * Tracks the two independent bounds for an asynchronous UI operation.
 * Meaningful progress may renew only the idle deadline; the hard safety
 * deadline is fixed at operation start and can never be extended.
 */
class AsyncOperationProgressLease {
    startedAt;
    idleWindowMs;
    hardSafetyDeadline;
    _lastMeaningfulProgressAt;
    _idleDeadline;
    constructor(options) {
        const startedAt = options.startedAt ?? Date.now();
        const idleWindowMs = Math.max(1, options.idleWindowMs);
        const hardSafetyCapMs = Math.max(idleWindowMs, options.hardSafetyCapMs);
        this.startedAt = startedAt;
        this.idleWindowMs = idleWindowMs;
        this._lastMeaningfulProgressAt = startedAt;
        this.hardSafetyDeadline = startedAt + hardSafetyCapMs;
        this._idleDeadline = Math.min(this.hardSafetyDeadline, startedAt + idleWindowMs);
    }
    get lastMeaningfulProgressAt() {
        return this._lastMeaningfulProgressAt;
    }
    get idleDeadline() {
        return this._idleDeadline;
    }
    recordMeaningfulProgress(at = Date.now()) {
        if (at < this.startedAt || at >= this.hardSafetyDeadline)
            return;
        this._lastMeaningfulProgressAt = at;
        this._idleDeadline = Math.min(this.hardSafetyDeadline, at + this.idleWindowMs);
    }
    renewIdleDeadline(idleWindowMs, at = Date.now()) {
        if (at < this.startedAt || at >= this.hardSafetyDeadline)
            return;
        this._lastMeaningfulProgressAt = at;
        this._idleDeadline = Math.min(this.hardSafetyDeadline, at + Math.max(1, idleWindowMs));
    }
    snapshot() {
        return {
            startedAt: this.startedAt,
            lastMeaningfulProgressAt: this._lastMeaningfulProgressAt,
            idleDeadline: this._idleDeadline,
            hardSafetyDeadline: this.hardSafetyDeadline,
        };
    }
}
exports.AsyncOperationProgressLease = AsyncOperationProgressLease;
