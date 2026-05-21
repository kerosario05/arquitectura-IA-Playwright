import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateAgentHandoffResponse } from "../agent";
import { assertValidExecutionPlan, writeExecutionPlansToFile } from "../plans";
import type { AgentHandoffRequest, AgentHandoffResponse } from "../types/agent-handoff.types";

type CliArgs = {
  response?: string;
  request?: string;
  outputPlans?: string;
  handoffDir?: string;
  help: boolean;
};

function printHelp(): void {
  console.log(`Usage: agent:validate [options]

Options:
  --response <path>       Path to agent-response.json file (required unless --handoff-dir is used)
  --request <path>        Path to handoff-request.json file (optional, provides data context)
  --output-plans <path>   Path to write validated plans
  --handoff-dir <path>    Path to handoff directory. Automatically resolves:
                            <dir>/agent-response.json
                            <dir>/handoff-request.json
  --help, -h              Show this help message

Examples:
  npm run agent:validate -- --response .artifacts/agent/handoff/agent-response.json
  npm run agent:validate -- --handoff-dir .artifacts/agent/handoff-2026-05-20
  npm run agent:validate -- --response response.json --request request.json --output-plans plans.json
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    const requiresValue = ["--response", "--request", "--output-plans", "--handoff-dir"];
    if (requiresValue.includes(token) && (!next || next.startsWith("--"))) {
      throw new Error(`Missing value for ${token}`);
    }
    if (token === "--response") {
      args.response = next;
      i += 1;
      continue;
    }
    if (token === "--request") {
      args.request = next;
      i += 1;
      continue;
    }
    if (token === "--output-plans") {
      args.outputPlans = next;
      i += 1;
      continue;
    }
    if (token === "--handoff-dir") {
      args.handoffDir = next;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  let responsePath = args.response;
  let requestPath = args.request;

  if (args.handoffDir) {
    const dir = path.resolve(args.handoffDir);
    responsePath = responsePath ?? path.join(dir, "agent-response.json");
    requestPath = requestPath ?? path.join(dir, "handoff-request.json");
  }

  if (!responsePath) {
    throw new Error("--response or --handoff-dir is required.");
  }

  const response = JSON.parse(await readFile(path.resolve(responsePath), "utf-8")) as unknown;
  let availableDataKeys: string[] | undefined;

  if (requestPath) {
    try {
      const request = JSON.parse(await readFile(path.resolve(requestPath), "utf-8")) as AgentHandoffRequest;
      availableDataKeys = request.dataContextSummary.availableKeys.map((entry) => entry.key);
    } catch {
      // Request file may not exist, that's OK
    }
  }

  const validation = validateAgentHandoffResponse(response, { availableDataKeys });
  const typed = response as AgentHandoffResponse;

  const plansCount = Array.isArray(typed.plans) ? typed.plans.length : 0;
  const proposedObjectsCount = Array.isArray(typed.proposedObjects) ? typed.proposedObjects.length : 0;
  const unresolvedCount = Array.isArray(typed.unresolvedQuestions) ? typed.unresolvedQuestions.length : 0;
  const rationaleCount = Array.isArray(typed.rationale) ? typed.rationale.length : 0;

  console.log(`Valid: ${validation.valid}`);
  console.log(`Plans: ${plansCount}`);
  console.log(`Proposed objects: ${proposedObjectsCount}`);
  console.log(`Unresolved questions: ${unresolvedCount}`);
  console.log(`Rationale: ${rationaleCount}`);

  if (plansCount === 0 && proposedObjectsCount === 0 && unresolvedCount === 0 && rationaleCount === 0) {
    console.log("");
    console.log("WARNING: agent-response.json was found but is not actionable.");
    console.log("All sections are empty. The agent did not produce any useful output.");
  }

  if (validation.issues.length > 0) {
    for (const issue of validation.issues) {
      console.log(
        `- [${issue.level}] ${issue.code}: ${issue.message}${issue.planIndex !== undefined ? ` (plan ${issue.planIndex})` : ""}`
      );
    }
  }

  if (!validation.valid) {
    return 1;
  }

  for (const plan of typed.plans) {
    assertValidExecutionPlan(plan);
  }

  if (args.outputPlans) {
    await writeExecutionPlansToFile(typed.plans, path.resolve(args.outputPlans));
    console.log(`Output plans path: ${path.resolve(args.outputPlans)}`);
  }

  return 0;
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[agent:validate] ${message}`);
    process.exitCode = 1;
  });
