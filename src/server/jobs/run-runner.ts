import { spawn } from "child_process";
import path from "path";
import { jobStore } from "./job-store";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "src", "cli", "discovery-sprint.ts");

type SprintParams = {
  projectKey: string;
  sprintId?: number;
  activeSprint?: boolean;
  status?: string;
  maxResults?: number;
  app?: string;
  headed?: boolean;
  autoPromote?: boolean;
  dryRun?: boolean;
  overwrite?: boolean;
};

export function startSprintRun(jobId: string): void {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const p = job.params as SprintParams;
  const cliArgs: string[] = [SCRIPT, "--project-key", p.projectKey];

  if (p.activeSprint) cliArgs.push("--active-sprint");
  if (p.sprintId) cliArgs.push("--sprint-id", String(p.sprintId));
  if (p.status) cliArgs.push("--status", p.status);
  if (p.maxResults) cliArgs.push("--max-results", String(p.maxResults));
  if (p.app) cliArgs.push("--app", p.app);
  if (p.headed) cliArgs.push("--headed");
  if (p.autoPromote === false) cliArgs.push("--no-auto-promote");
  if (p.dryRun) cliArgs.push("--dry-run");
  if (p.overwrite) cliArgs.push("--overwrite");

  const child = spawn("npx", ["tsx", ...cliArgs], {
    shell: true,
    cwd: ROOT,
    env: process.env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  jobStore.update(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
    process: child
  });

  const handleData = (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) jobStore.appendLog(jobId, line.trimEnd());
    }
  };

  child.stdout?.on("data", handleData);
  child.stderr?.on("data", handleData);

  child.on("close", (code) => {
    jobStore.update(jobId, {
      status: code === 0 ? "done" : "failed",
      completedAt: new Date().toISOString(),
      exitCode: code ?? undefined
    });
    jobStore.appendLog(jobId, `[server] Proceso terminado — código de salida: ${code ?? "?"}`);
  });

  child.on("error", (err) => {
    jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
    jobStore.appendLog(jobId, `[server] Error al iniciar proceso: ${err.message}`);
  });
}
