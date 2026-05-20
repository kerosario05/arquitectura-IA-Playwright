import path from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { config } from "../config/env";
import { buildDataContext } from "../data";
import { readFile } from "node:fs/promises";
import type { ExecutionPlan } from "../types/execution-plan.types";
import { assertValidExecutionPlan } from "../plans";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { executeExecutionPlan } from "../runner/execution-plan-executor";
import { writePlanExecutionResults } from "../runner/plan-execution-writer";
import type { PlansExecutionSummary } from "../types/plan-execution.types";

type CliArgs = {
  plans?: string;
  output?: string;
  continueOnFailure: boolean;
  headed: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { continueOnFailure: false, headed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--continue-on-failure") {
      args.continueOnFailure = true;
      continue;
    }
    if (token === "--headed") {
      args.headed = true;
      continue;
    }
    if ((token === "--plans" || token === "--output") && (!next || next.startsWith("--"))) {
      throw new Error(`Missing value for ${token}`);
    }
    if (token === "--plans") {
      args.plans = next;
      i += 1;
      continue;
    }
    if (token === "--output") {
      args.output = next;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function parsePlansPayload(payload: unknown): ExecutionPlan[] {
  if (Array.isArray(payload)) {
    return payload as ExecutionPlan[];
  }
  if (typeof payload === "object" && payload !== null && Array.isArray((payload as { plans?: unknown }).plans)) {
    return (payload as { plans: ExecutionPlan[] }).plans;
  }
  throw new Error("Invalid plans file format. Expected ExecutionPlan[] or { plans: ExecutionPlan[] }.");
}

function safeName(plan: ExecutionPlan): string {
  const base = plan.scenario.externalId || String(plan.scenario.caseId || "scenario");
  const title = plan.scenario.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base}-${title}`;
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plans) {
    throw new Error("--plans is required.");
  }

  const plansPayload = JSON.parse(await readFile(path.resolve(args.plans), "utf-8")) as unknown;
  const plans = parsePlansPayload(plansPayload);
  plans.forEach((plan) => assertValidExecutionPlan(plan));

  const dataContext = buildDataContext(config);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseExecutionDir = path.resolve(`./.artifacts/executions/${timestamp}`);
  const outputPath = args.output ? path.resolve(args.output) : path.resolve(`./.artifacts/executions/results-${timestamp}.json`);

  const browserType = { chromium, firefox, webkit }[config.execution.browser];
  const browser = await browserType.launch({ headless: args.headed ? false : config.execution.headless });

  const results: PlansExecutionSummary["results"] = [];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(config.execution.defaultTimeoutMs);

    const loginStrategy = getLoginStrategy(config.app.loginMode);
    await loginStrategy.execute(page, config);

    for (const plan of plans) {
      const evidenceDir = path.join(baseExecutionDir, safeName(plan));
      const result = await executeExecutionPlan({
        page,
        plan,
        dataContext,
        evidenceDir,
        continueOnFailure: args.continueOnFailure,
        appBaseUrl: config.app.baseUrl
      });
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  const summary: PlansExecutionSummary = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    partial: results.filter((r) => r.status === "partial").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results
  };

  await writePlanExecutionResults(summary, outputPath);

  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Partial: ${summary.partial}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Results path: ${outputPath}`);

  return summary.failed > 0 ? 1 : 0;
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:execute] ${message}`);
    process.exitCode = 1;
  });
