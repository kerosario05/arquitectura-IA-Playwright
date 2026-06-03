import { spawn } from "child_process";
import path from "path";
import { jobStore } from "./job-store";

const ROOT = path.resolve(__dirname, "..", "..", "..");

type DiscoveryBatchParams = {
  caseIds: number[];
  appSlug?: string;
  sectionName?: string;
  overwrite?: boolean;
  autoPromote?: boolean;
  autoPom?: boolean;
  rerunActive?: boolean;
  headed?: boolean;
};

export function startDiscoveryBatchRun(jobId: string): void {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const p = job.params as DiscoveryBatchParams;

  if (!p.caseIds || p.caseIds.length === 0) {
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
    });
    jobStore.appendLog(jobId, "[run:discovery-batch] Error: no caseIds provided");
    return;
  }

  const caseIdsStr = p.caseIds.join(",");
  const args: string[] = [
    "run",
    "discovery:batch",
    "--",
    "--case-ids",
    caseIdsStr,
  ];

  if (p.appSlug) {
    args.push("--app", p.appSlug);
  }
  if (p.overwrite !== false) {
    args.push("--overwrite");
  }
  if (p.autoPromote !== false) {
    args.push("--auto-promote");
  }
  if (p.autoPom !== false) {
    args.push("--auto-pom");
  }
  if (p.rerunActive !== false) {
    args.push("--rerun-active");
  }
  if (p.headed) {
    args.push("--headed");
  }

  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";

  console.log(`[run:discovery-batch] caseIds=${caseIdsStr} appSlug=${p.appSlug ?? "N/A"}`);
  console.log(`[run:discovery-batch] command=${cmd} args=${args.join(" ")}`);
  console.log(`[run:discovery-batch] jobId=${jobId}`);
  console.log(`[run:discovery-batch] started`);

  jobStore.appendLog(jobId, `[run:discovery-batch] caseIds=${caseIdsStr} appSlug=${p.appSlug ?? "N/A"}`);
  jobStore.appendLog(jobId, `[run:discovery-batch] command=${cmd} ${args.join(" ")}`);
  jobStore.appendLog(jobId, `[run:discovery-batch] jobId=${jobId}`);
  jobStore.appendLog(jobId, `[run:discovery-batch] started`);

  const child = spawn(cmd, args, {
    shell: true,
    cwd: ROOT,
    env: process.env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  jobStore.update(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
    process: child,
    summary: {
      totalStories: 0,
      synced: 0,
      passed: 0,
      failed: 0,
      caseIds: p.caseIds,
      command: `${cmd} ${args.join(" ")}`,
    },
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
      exitCode: code ?? undefined,
    });
    jobStore.appendLog(jobId, `[run:discovery-batch] Proceso terminado — código de salida: ${code ?? "?"}`);
  });

  child.on("error", (err) => {
    jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
    jobStore.appendLog(jobId, `[run:discovery-batch] Error al iniciar proceso: ${err.message}`);
  });
}
