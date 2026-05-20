import path from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env";
import { buildDataContext } from "../data";
import { loadObjectRegistry } from "../registry";
import { buildAgentHandoffRequest, writeAgentHandoffPackage } from "../agent";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { TestScenario } from "../types/testrail.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { AgentHandoffKind } from "../types/agent-handoff.types";

type CliArgs = {
  plans?: string;
  snapshot?: string;
  scenario?: string;
  goal?: string;
  outputDir?: string;
  kind: AgentHandoffKind;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { kind: "plan_repair" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if ((token.startsWith("--") && token !== "--kind") && (!next || next.startsWith("--"))) {
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
    if (token === "--scenario") {
      args.scenario = next;
      i += 1;
      continue;
    }
    if (token === "--goal") {
      args.goal = next;
      i += 1;
      continue;
    }
    if (token === "--output-dir") {
      args.outputDir = next;
      i += 1;
      continue;
    }
    if (token === "--kind") {
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --kind");
      }
      args.kind = next as AgentHandoffKind;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function parseArrayOrWrapped<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (typeof payload === "object" && payload !== null && Array.isArray((payload as Record<string, unknown>)[key])) {
    return (payload as Record<string, unknown>)[key] as T[];
  }
  throw new Error(`Invalid file format. Expected array or { ${key}: [] }.`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.goal || !args.goal.trim()) {
    throw new Error("--goal is required.");
  }

  const dataContext = buildDataContext(config);
  const objectRegistry = await loadObjectRegistry();

  let currentPlan: ExecutionPlan | undefined;
  if (args.plans) {
    const payload = JSON.parse(await readFile(path.resolve(args.plans), "utf-8")) as unknown;
    const plans = parseArrayOrWrapped<ExecutionPlan>(payload, "plans");
    if (plans.length > 1) {
      console.log("Multiple plans detected. Using first plan for this handoff phase.");
    }
    currentPlan = plans[0];
  }

  let scenario: TestScenario | undefined;
  if (args.scenario) {
    const payload = JSON.parse(await readFile(path.resolve(args.scenario), "utf-8")) as unknown;
    const scenarios = parseArrayOrWrapped<TestScenario>(payload, "scenarios");
    if (scenarios.length > 1) {
      console.log("Multiple scenarios detected. Using first scenario for this handoff phase.");
    }
    scenario = scenarios[0];
  }

  let snapshot: PageSnapshot | undefined;
  if (args.snapshot) {
    snapshot = JSON.parse(await readFile(path.resolve(args.snapshot), "utf-8")) as PageSnapshot;
  }

  const request = buildAgentHandoffRequest({
    kind: args.kind,
    goal: args.goal,
    scenario,
    currentPlan,
    snapshot,
    objectRegistry,
    dataContext
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = args.outputDir ? path.resolve(args.outputDir) : path.resolve(`./.artifacts/agent/handoff-${stamp}`);
  const result = await writeAgentHandoffPackage({ request, outputDir });

  console.log(`Request path: ${result.requestPath}`);
  console.log(`Instructions path: ${result.instructionsPath}`);
  console.log(`Schema path: ${result.schemaPath}`);
  console.log(`Response template path: ${result.responsePath}`);
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[agent:prepare] ${message}`);
    process.exitCode = 1;
  });
