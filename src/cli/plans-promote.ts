import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config/env";
import { promoteExecutionPlan } from "../automations";
import type { ExecutionPlan } from "../types/execution-plan.types";

interface CliArgs {
  plan: string;
  from?: string;
  result?: string;
  source?: "agent_handoff" | "manual" | "rule_based" | "discovery";
  overwrite: boolean;
  allowDraft: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let plan = "";
  let from: string | undefined;
  let result: string | undefined;
  let source: CliArgs["source"];
  let overwrite = false;
  let allowDraft = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--overwrite") {
      overwrite = true;
      continue;
    }
    if (token === "--allow-draft") {
      allowDraft = true;
      continue;
    }

    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    if (token === "--plan") {
      plan = next;
      i += 1;
      continue;
    }
    if (token === "--from") {
      from = next;
      i += 1;
      continue;
    }
    if (token === "--result") {
      result = next;
      i += 1;
      continue;
    }
    if (token === "--source") {
      const validSources = new Set(["agent_handoff", "manual", "rule_based", "discovery"]);
      if (!validSources.has(next)) {
        throw new Error(
          `Invalid --source '${next}'. Allowed: ${[...validSources].join(", ")}`
        );
      }
      source = next as CliArgs["source"];
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!plan && !from) {
    throw new Error("--plan or --from is required. Usage: npm run plans:promote -- --plan <path> OR --from <discovery-output-dir>");
  }

  return { plan, from, result, source, overwrite, allowDraft };
}

interface ParsedPlanInput {
  plans: ExecutionPlan[];
  sourcePlanPath: string;
}

async function loadPlanInput(planArg: string): Promise<ParsedPlanInput> {
  const resolved = path.resolve(planArg);
  const content = await fs.readFile(resolved, "utf-8");
  const parsed = JSON.parse(content);

  const plans: ExecutionPlan[] = [];

  if (Array.isArray(parsed)) {
    plans.push(...(parsed as ExecutionPlan[]));
  } else if (parsed.plans && Array.isArray(parsed.plans)) {
    plans.push(...(parsed.plans as ExecutionPlan[]));
  } else if (parsed.version === "1.0") {
    plans.push(parsed as ExecutionPlan);
  } else {
    throw new Error(
      "Plan file must be an ExecutionPlan, { plans: [...] }, or [ExecutionPlan, ...]"
    );
  }

  return { plans, sourcePlanPath: resolved };
}

async function loadPlanFromDiscoveryOutput(fromArg: string): Promise<ParsedPlanInput> {
  const discoveryDir = path.resolve(fromArg);
  const pendingPath = path.join(discoveryDir, "discovered-plans.pending.json");
  return loadPlanInput(pendingPath);
}

async function promoteAll(
  plans: ExecutionPlan[],
  sourcePlanPath: string,
  resultPath: string | undefined,
  source: CliArgs["source"],
  overwrite: boolean,
  allowDraft: boolean
): Promise<void> {
  const promoted: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const plan of plans) {
    const label = plan.scenario.externalId
      ? String(plan.scenario.externalId)
      : plan.scenario.caseId !== undefined
      ? `case-${plan.scenario.caseId}`
      : plan.scenario.title;

    try {
      const entry = await promoteExecutionPlan(
        {
          plan,
          sourcePlanPath,
          lastExecutionResultPath: resultPath ?? undefined,
          source,
          overwrite,
          fullConfig: config
        },
        allowDraft
      );
      promoted.push(`${label} -> ${entry.id}`);
      console.log(`  [OK] ${label}`);
      if (entry.appSlug) {
        console.log(`       app:     ${entry.appSlug}`);
      }
      console.log(`       plan:    ${entry.planPath}`);
      console.log(`       spec:    ${entry.specPath}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("already exists") ||
        msg.includes("not eligible") ||
        msg.includes("status is 'draft'")
      ) {
        skipped.push(`${label}: ${msg}`);
        console.log(`  [SKIP] ${label}`);
        console.log(`         ${msg}`);
      } else {
        errors.push(`${label}: ${msg}`);
        console.log(`  [ERROR] ${label}`);
        console.log(`          ${msg}`);
      }
    }
  }

  console.log("\nSummary:");
  console.log(`  Promoted: ${promoted.length}`);
  console.log(`  Skipped:  ${skipped.length}`);
  console.log(`  Errors:   ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const e of errors) {
      console.log(`  - ${e}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const sourceRef = args.plan ? path.resolve(args.plan) : path.resolve(args.from ?? ".");
  console.log("Loading plan(s) from:", sourceRef);

  const { plans, sourcePlanPath } = args.plan
    ? await loadPlanInput(args.plan)
    : await loadPlanFromDiscoveryOutput(args.from ?? ".");

  console.log(`Found ${plans.length} plan(s)\n`);

  await promoteAll(
    plans,
    sourcePlanPath,
    args.result,
    args.source,
    args.overwrite,
    args.allowDraft
  );

  console.log("\nAutomation index: automations/index.json");
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:promote] ${message}`);
    process.exitCode = 1;
  });
