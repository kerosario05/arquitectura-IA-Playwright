"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSprintRun = startSprintRun;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const job_store_1 = require("./job-store");
const ROOT = path_1.default.resolve(__dirname, "..", "..", "..");
const SCRIPT = path_1.default.join(ROOT, "src", "cli", "discovery-sprint.ts");
function startSprintRun(jobId) {
    const job = job_store_1.jobStore.getInternal(jobId);
    if (!job)
        return;
    const p = job.params;
    const cliArgs = [SCRIPT, "--project-key", p.projectKey];
    if (p.activeSprint)
        cliArgs.push("--active-sprint");
    if (p.sprintId)
        cliArgs.push("--sprint-id", String(p.sprintId));
    if (p.status)
        cliArgs.push("--status", p.status);
    if (p.maxResults)
        cliArgs.push("--max-results", String(p.maxResults));
    if (p.app)
        cliArgs.push("--app", p.app);
    if (p.headed)
        cliArgs.push("--headed");
    if (p.autoPromote === false)
        cliArgs.push("--no-auto-promote");
    if (p.dryRun)
        cliArgs.push("--dry-run");
    if (p.overwrite)
        cliArgs.push("--overwrite");
    const child = (0, child_process_1.spawn)("npx", ["tsx", ...cliArgs], {
        shell: true,
        cwd: ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
    });
    job_store_1.jobStore.update(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
        process: child
    });
    const handleData = (data) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
            if (line.trim())
                job_store_1.jobStore.appendLog(jobId, line.trimEnd());
        }
    };
    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);
    child.on("close", (code) => {
        job_store_1.jobStore.update(jobId, {
            status: code === 0 ? "done" : "failed",
            completedAt: new Date().toISOString(),
            exitCode: code ?? undefined
        });
        job_store_1.jobStore.appendLog(jobId, `[server] Proceso terminado — código de salida: ${code ?? "?"}`);
    });
    child.on("error", (err) => {
        job_store_1.jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
        job_store_1.jobStore.appendLog(jobId, `[server] Error al iniciar proceso: ${err.message}`);
    });
}
