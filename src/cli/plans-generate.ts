import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateRuleBasedExecutionPlan, normalizeExecutionPlan, validateExecutionPlan, writeExecutionPlansToFile } from "../plans";
import type { TestScenario } from "../types/testrail.types";

type CliArgs = {
  input?: string;
  output?: string;
  includeLogin: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { includeLogin: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--include-login") {
      args.includeLogin = true;
      continue;
    }

    if ((token === "--input" || token === "--output") && (!nextValue || nextValue.startsWith("--"))) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--input") {
      args.input = nextValue;
      i += 1;
      continue;
    }

    if (token === "--output") {
      args.output = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function getDefaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`./.artifacts/plans/plans-${stamp}.json`);
}

function parseScenariosPayload(payload: unknown): TestScenario[] {
  if (Array.isArray(payload)) {
    return payload as TestScenario[];
  }
  if (typeof payload === "object" && payload !== null) {
    const maybeScenarios = (payload as { scenarios?: unknown }).scenarios;
    if (Array.isArray(maybeScenarios)) {
      return maybeScenarios as TestScenario[];
    }
  }
  throw new Error("Invalid scenarios input format. Expected TestScenario[] or { scenarios: TestScenario[] }.");
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    throw new Error("--input is required. Example: --input ./.artifacts/testrail/scenarios.json");
  }

  const rawContent = await readFile(path.resolve(args.input), "utf-8");
  const parsed = JSON.parse(rawContent) as unknown;
  const scenarios = parseScenariosPayload(parsed);

  const plans = scenarios.map((scenario) =>
    normalizeExecutionPlan(generateRuleBasedExecutionPlan(scenario, { includeLogin: args.includeLogin }))
  );

  const validations = plans.map((plan) => validateExecutionPlan(plan));
  const invalidIndexes = validations
    .map((result, index) => ({ result, index }))
    .filter((item) => !item.result.valid);

  const outputPath = args.output ? path.resolve(args.output) : getDefaultOutputPath();
  await writeExecutionPlansToFile(plans, outputPath);

  console.log(`Scenarios read: ${scenarios.length}`);
  console.log(`Plans generated: ${plans.length}`);
  console.log(`Valid plans: ${plans.length - invalidIndexes.length}`);
  console.log(`Invalid plans: ${invalidIndexes.length}`);
  console.log(`Output file: ${outputPath}`);

  if (invalidIndexes.length > 0) {
    for (const { index, result } of invalidIndexes) {
      console.log(`Plan #${index + 1} issues:`);
      for (const issue of result.issues) {
        console.log(`- [${issue.level}] ${issue.code}: ${issue.message}`);
      }
    }
    return 1;
  }

  return 0;
}

run()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:generate] ${message}`);
    process.exitCode = 1;
  });
