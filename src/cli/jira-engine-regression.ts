import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

type RegressionMode = "generation" | "execution" | "full";
type EventLevel = "info" | "ok" | "fail";
type RegressionState = {
  title: string; mode: "jira-engine"; jiraRegressionMode: RegressionMode; status: string; statusLabel: string; jobId: string;
  total: number; completed: number; passed: number; failed: number; promoted: number; current: Record<string, unknown> | null;
  projects: Array<{ slug: string; total: number; completed: number }>; scenarios: Array<Record<string, unknown>>; jobs: unknown[];
  events: Array<{ sequence: number; time: string; message: string; level: EventLevel }>; eventSequence: number; reportPath?: string;
};

const ROOT = process.cwd();
const GENERATION_TESTS = ["src/jira/jira-generation-evaluation.test.ts", "src/jira/jira-scenario-generator.test.ts",
  "src/jira/jira-generation-delivery-regression.test.ts", "src/jira/jira-step-delivery.test.ts"];
const EXECUTION_TESTS = ["src/jira/jira-engine-evaluation.test.ts"];

function parseArgs(argv: string[]): { mode: RegressionMode; statePath: string; artifactsRoot: string } {
  const value = (flag: string, fallback: string) => { const index = argv.indexOf(flag); return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback; };
  const mode = value("--mode", "full");
  if (!["generation", "execution", "full"].includes(mode)) throw new Error("--mode debe ser generation, execution o full");
  return { mode: mode as RegressionMode,
    statePath: path.resolve(value("--state", path.join(process.env.TEMP || process.env.TMPDIR || ".", "qa-lab-jira-regression-state.json"))),
    artifactsRoot: path.resolve(value("--artifacts-root", ".artifacts/jira-engine-regression")) };
}

function writeState(file: string, state: RegressionState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(state), "utf8");
  try { fs.renameSync(temp, file); } catch { fs.writeFileSync(file, JSON.stringify(state), "utf8"); fs.rmSync(temp, { force: true }); }
}

function event(state: RegressionState, statePath: string, message: string, level: EventLevel = "info"): void {
  state.eventSequence += 1;
  state.events.push({ sequence: state.eventSequence, time: new Date().toLocaleTimeString("es-DO", { hour12: false }), message, level });
  if (state.events.length > 1000) state.events = state.events.slice(-1000);
  writeState(statePath, state);
}

function runCommand(state: RegressionState, statePath: string, name: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, windowsHide: true });
    let pending = "";
    const consume = (chunk: Buffer, level: EventLevel) => {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) event(state, statePath, "[" + name + "] " + line.slice(0, 1800), level);
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, "info"));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, "info"));
    child.once("error", reject);
    child.once("close", code => {
      if (pending.trim()) event(state, statePath, "[" + name + "] " + pending.slice(0, 1800), code === 0 ? "info" : "fail");
      resolve(code ?? 1);
    });
  });
}

async function runStage(state: RegressionState, statePath: string, runDir: string, mode: "generation" | "execution"): Promise<boolean> {
  const scenarioId = "jira-" + mode;
  const title = mode === "generation" ? "Calidad de escenarios generados" : "Discovery y ejecución Jira";
  state.current = { projectSlug: "fixtures locales", scenarioId, title, status: "running", statusLabel: "En ejecución" };
  state.scenarios.push({ projectSlug: "fixtures locales", scenarioId, title, status: "running", promoted: false });
  state.total += 1;
  state.projects[0].total += 1;
  event(state, statePath, mode === "generation" ? "Validando generación y calidad con fixtures Jira locales."
    : "Ejecutando Discovery y spec en dos perfiles web locales.");
  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCli)) throw new Error("Falta node_modules/tsx; instala las dependencias del repositorio.");
  const commands: Array<{ name: string; args: string[] }> = [];
  if (mode === "generation") {
    commands.push({ name: "Jira generation evaluation", args: [tsxCli, "src/cli/jira-generation-evaluate.ts", "--input",
      path.join(ROOT, "evals", "jira-generation", "suite.example.json"), "--output", path.join(runDir, "generation-report.json")] });
    commands.push({ name: "Jira generation contracts", args: ["--import", "tsx", "--test", "--test-concurrency=1", ...GENERATION_TESTS] });
  } else commands.push({ name: "Jira execution fixture", args: ["--import", "tsx", "--test", "--test-concurrency=1", ...EXECUTION_TESTS] });

  for (const command of commands) {
    const exitCode = await runCommand(state, statePath, command.name, command.args);
    if (exitCode !== 0) {
      state.failed += 1; state.scenarios[state.scenarios.length - 1].status = "failed";
      state.projects[0].completed += 1; state.completed += 1;
      state.current.status = "failed"; state.current.statusLabel = "Falló " + command.name;
      event(state, statePath, command.name + " terminó con código " + exitCode + ".", "fail");
      return false;
    }
  }
  state.passed += 1; state.completed += 1; state.projects[0].completed += 1;
  state.scenarios[state.scenarios.length - 1].status = "passed";
  state.current.status = "passed"; state.current.statusLabel = "Aprobado";
  event(state, statePath, "Regresión Jira " + mode + " completada.", "ok");
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const jobId = randomUUID();
  const runDir = path.join(args.artifactsRoot, jobId);
  fs.mkdirSync(runDir, { recursive: true });
  const state: RegressionState = { title: "Regresión motor Jira", mode: "jira-engine", jiraRegressionMode: args.mode,
    status: "running", statusLabel: "Preparando fixtures", jobId, total: 0, completed: 0, passed: 0, failed: 0,
    promoted: 0, current: null, projects: [{ slug: "fixtures locales", total: 0, completed: 0 }],
    scenarios: [], jobs: [], events: [], eventSequence: 0 };
  writeState(args.statePath, state);
  event(state, args.statePath, "Job Jira " + jobId + " · modo " + args.mode + " · fixtures locales · sin Jira/TestRail ni aplicaciones externas.");
  const stages: Array<"generation" | "execution"> = args.mode === "full" ? ["generation", "execution"] : [args.mode];
  let passed = true;
  for (const stage of stages) {
    state.statusLabel = stage === "generation" ? "Evaluando generación" : "Evaluando ejecución";
    writeState(args.statePath, state);
    if (!await runStage(state, args.statePath, runDir, stage)) { passed = false; break; }
  }
  state.current = null;
  state.status = passed ? "completed" : "completed_with_failures";
  state.statusLabel = passed ? "Regresión Jira completada" : "Regresión Jira con fallos";
  const reportPath = path.join(runDir, "report.json");
  state.reportPath = reportPath;
  fs.writeFileSync(reportPath, JSON.stringify({ jobId, mode: args.mode, status: state.status,
    counts: { total: state.total, completed: state.completed, passed: state.passed, failed: state.failed },
    scope: { generation: "local deterministic Jira fixtures and current generator contracts",
      execution: "local two-profile Playwright fixture; no external app access", semanticCertification: false, jiraOrTestRailWrites: false },
    scenarios: state.scenarios, artifacts: runDir }, null, 2), "utf8");
  event(state, args.statePath, "Informe de regresión Jira: " + reportPath, passed ? "ok" : "fail");
  writeState(args.statePath, state);
  if (!passed) process.exitCode = 1;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("jira-engine-regression.ts")) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
