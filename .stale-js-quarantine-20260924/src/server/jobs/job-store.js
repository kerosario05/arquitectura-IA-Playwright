"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobStore = void 0;
const crypto_1 = require("crypto");
const events_1 = require("events");
class JobStore {
    jobs = new Map();
    create(type, params) {
        const id = (0, crypto_1.randomUUID)();
        const job = {
            id,
            type,
            status: "queued",
            params,
            createdAt: new Date().toISOString(),
            logs: [],
            emitter: new events_1.EventEmitter()
        };
        job.emitter.setMaxListeners(100);
        this.jobs.set(id, job);
        return this.serialize(job);
    }
    get(id) {
        const job = this.jobs.get(id);
        return job ? this.serialize(job) : undefined;
    }
    getInternal(id) {
        return this.jobs.get(id);
    }
    list() {
        return Array.from(this.jobs.values())
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((j) => this.serialize(j));
    }
    update(id, patch) {
        const job = this.jobs.get(id);
        if (!job)
            return;
        Object.assign(job, patch);
        // Auto-compute durationMs when job completes (if not explicitly provided)
        if (patch.completedAt && job.startedAt && !patch.durationMs && !job.durationMs) {
            job.durationMs = new Date(patch.completedAt).getTime() - new Date(job.startedAt).getTime();
        }
        job.emitter.emit("update", this.serialize(job));
    }
    clearTransientParams(id) {
        const job = this.jobs.get(id);
        if (!job)
            return;
        delete job.params.runtimeEntriesByCase;
        delete job.params.dataOverrides;
    }
    appendLog(id, line) {
        const job = this.jobs.get(id);
        if (!job)
            return;
        job.logs.push(line);
        job.emitter.emit("log", line);
    }
    subscribe(id, handlers) {
        const job = this.jobs.get(id);
        if (!job)
            return () => { };
        job.emitter.on("log", handlers.onLog);
        job.emitter.on("update", handlers.onUpdate);
        return () => {
            job.emitter.off("log", handlers.onLog);
            job.emitter.off("update", handlers.onUpdate);
        };
    }
    serialize(job) {
        const { process: _proc, emitter: _em, ...pub } = job;
        const params = { ...pub.params };
        const runtimeEntriesByCase = params.runtimeEntriesByCase;
        if (runtimeEntriesByCase && typeof runtimeEntriesByCase === "object" && !Array.isArray(runtimeEntriesByCase)) {
            params.runtimeEntriesByCase = Object.fromEntries(Object.entries(runtimeEntriesByCase).map(([caseId, entries]) => [
                caseId,
                Array.isArray(entries)
                    ? entries.map((entry) => {
                        const value = entry && typeof entry === "object" ? entry : {};
                        return {
                            key: value.key,
                            source: value.source,
                            sensitive: value.sensitive === true,
                            present: typeof value.value === "string" && value.value.length > 0,
                        };
                    })
                    : [],
            ]));
        }
        return { ...pub, params };
    }
}
exports.jobStore = new JobStore();
