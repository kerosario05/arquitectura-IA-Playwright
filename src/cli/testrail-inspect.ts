import path from "node:path";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { normalizeTestRailCases } from "../testrail/testrail-normalizer";
import { writeScenariosToFile } from "../testrail/scenario-writer";

type CliArgs = {
  caseIds?: number[];
  projectId?: string;
  suiteId?: string;
  sectionId?: string;
  output?: string;
  includeRaw: boolean;
  testConnection: boolean;
};

function parseCaseIds(value: string): number[] {
  const ids = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));

  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("Invalid --case-ids. Use comma-separated positive integers, e.g. 123,124,125.");
  }

  return ids;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    includeRaw: false,
    testConnection: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--include-raw") {
      args.includeRaw = true;
      continue;
    }

    if (token === "--test-connection") {
      args.testConnection = true;
      continue;
    }

    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    if (token === "--case-ids") {
      args.caseIds = parseCaseIds(nextValue);
      i += 1;
      continue;
    }
    if (token === "--project-id") {
      args.projectId = nextValue.trim();
      i += 1;
      continue;
    }
    if (token === "--suite-id") {
      args.suiteId = nextValue.trim();
      i += 1;
      continue;
    }
    if (token === "--section-id") {
      args.sectionId = nextValue.trim();
      i += 1;
      continue;
    }
    if (token === "--output") {
      args.output = nextValue.trim();
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function buildDefaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`./.artifacts/testrail/scenarios-${stamp}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const testRailRuntimeConfig = requireTestRailConfig(config);
  const client = new TestRailClient(testRailRuntimeConfig);

  if (args.testConnection) {
    const result = await client.testConnection();
    console.log(`TestRail connection: ${result.ok ? "ok" : "failed"}`);
    if (result.userEmail) {
      console.log(`Authenticated user email: ${result.userEmail}`);
    }
    return;
  }

  let rawCases;
  if (args.caseIds && args.caseIds.length > 0) {
    rawCases = await client.getCasesByIds(args.caseIds);
  } else {
    const projectId = args.projectId || config.integrations.testRail?.projectId;
    const suiteId = args.suiteId || config.integrations.testRail?.suiteId;
    const sectionId = args.sectionId || config.integrations.testRail?.sectionId;

    if (!projectId) {
      throw new Error("projectId is required. Use --project-id or set TESTRAIL_PROJECT_ID in .env.");
    }

    rawCases = await client.getCases(projectId, suiteId, sectionId);
  }

  const scenarios = normalizeTestRailCases(rawCases);
  const outputPath = args.output ? path.resolve(args.output) : buildDefaultOutputPath();
  await writeScenariosToFile(scenarios, outputPath, { includeRaw: args.includeRaw });

  console.log("TestRail inspection completed");
  console.log(`Cases fetched: ${rawCases.length}`);
  console.log(`Scenarios normalized: ${scenarios.length}`);
  console.log(`Output file: ${outputPath}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[testrail:inspect] ${message}`);
    process.exitCode = 1;
  });
