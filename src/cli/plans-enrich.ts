import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env";
import { buildDataContext } from "../data";
import { enrichExecutionPlanWithSnapshot, validateExecutionPlan, writeExecutionPlansToFile } from "../plans";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PageSnapshot } from "../types/page-snapshot.types";

type CliArgs = { plans?: string; snapshot?: string; output?: string };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if ((token === "--plans" || token === "--snapshot" || token === "--output") && (!next || next.startsWith("--"))) {
      throw new Error(`Missing value for ${token}`);
    }
    if (token === "--plans") {
      args.plans = next;
      i += 1;
      continue;
    }
    if (token === "--snapshot") {
      args.snapshot = next;
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
  if (typeof payload === "object" && payload !== null) {
    const plans = (payload as { plans?: unknown }).plans;
    if (Array.isArray(plans)) {
      return plans as ExecutionPlan[];
    }
  }
  throw new Error("Invalid plans file format. Expected ExecutionPlan[] or { plans: ExecutionPlan[] }.");
}

function getDefaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`./.artifacts/plans/enriched-plans-${stamp}.json`);
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plans || !args.snapshot) {
    throw new Error("--plans and --snapshot are required.");
  }

  const dataContext = buildDataContext(config);
  const plansPayload = JSON.parse(await readFile(path.resolve(args.plans), "utf-8")) as unknown;
  const snapshot = JSON.parse(await readFile(path.resolve(args.snapshot), "utf-8")) as PageSnapshot;
  const plans = parsePlansPayload(plansPayload);

  const results = plans.map((plan) =>
    enrichExecutionPlanWithSnapshot({
      plan,
      snapshot,
      dataContext,
      aliases: config.app.testDataAliases,
      missingInputBehavior: config.app.missingInputBehavior
    })
  );

  const enrichedPlans = results.map((result) => result.plan);
  const outputPath = args.output ? path.resolve(args.output) : getDefaultOutputPath();
  await writeExecutionPlansToFile(enrichedPlans, outputPath);

  const convertedSteps = results.reduce((acc, result) => acc + result.summary.convertedSteps, 0);
  const missingData = results.reduce((acc, result) => acc + result.summary.missingData, 0);
  const needsDiscoveryCount = results.filter((result) => result.summary.needsDiscovery).length;

  let invalid = 0;
  for (const plan of enrichedPlans) {
    if (!validateExecutionPlan(plan).valid) {
      invalid += 1;
    }
  }

  console.log(`Plans read: ${plans.length}`);
  console.log(`Converted steps: ${convertedSteps}`);
  console.log(`Missing data entries: ${missingData}`);
  console.log(`Plans needing discovery: ${needsDiscoveryCount}`);
  console.log(`Output file: ${outputPath}`);

  return invalid > 0 ? 1 : 0;
}

run()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:enrich] ${message}`);
    process.exitCode = 1;
  });
