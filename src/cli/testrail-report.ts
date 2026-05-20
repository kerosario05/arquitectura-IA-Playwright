import path from "node:path";
import fs from "node:fs/promises";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { reportToTestRail } from "../testrail/testrail-reporter";
import type { PlansExecutionSummary } from "../types/plan-execution.types";

interface CliArgs {
  results: string;
  runName?: string;
  projectId?: string;
  suiteId?: string;
  runDescription?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let results = "";
  let runName: string | undefined;
  let projectId: string | undefined;
  let suiteId: string | undefined;
  let runDescription: string | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    if (token === "--results") {
      results = next;
      i += 1;
      continue;
    }
    if (token === "--run-name") {
      runName = next;
      i += 1;
      continue;
    }
    if (token === "--project-id") {
      projectId = next;
      i += 1;
      continue;
    }
    if (token === "--suite-id") {
      suiteId = next;
      i += 1;
      continue;
    }
    if (token === "--run-description") {
      runDescription = next;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!results) {
    throw new Error("--results is required. Usage: npm run testrail:report -- --results <path>");
  }

  return { results, runName, projectId, suiteId, runDescription, dryRun };
}

function buildDefaultRunName(summary: PlansExecutionSummary): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const caseIds = summary.results
    .filter((r) => r.scenario.source === "testrail" && r.scenario.caseId != null)
    .map((r) => r.scenario.externalId ?? `C${r.scenario.caseId}`);

  return `Automation Run ${stamp} [${caseIds.join(", ")}]`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const resolvedResultsPath = path.resolve(args.results);
  const content = await fs.readFile(resolvedResultsPath, "utf-8");
  const summary: PlansExecutionSummary = JSON.parse(content);

  console.log(`[testrail:report] Results file: ${resolvedResultsPath}`);
  console.log(`[testrail:report] Plans executed: ${summary.total}`);
  console.log(`[testrail:report] Passed: ${summary.passed}, Failed: ${summary.failed}, Partial: ${summary.partial}, Skipped: ${summary.skipped}`);

  const testrailResults = summary.results.filter(
    (r) => r.scenario.source === "testrail" && r.scenario.caseId != null
  );

  if (testrailResults.length === 0) {
    throw new Error("No TestRail cases found in results. Only 'testrail' source results can be reported.");
  }

  const testRailRuntimeConfig = requireTestRailConfig(config);
  const client = new TestRailClient(testRailRuntimeConfig);

  const projectId = args.projectId ?? config.integrations.testRail?.projectId;
  if (!projectId) {
    throw new Error("projectId is required. Use --project-id or set TESTRAIL_PROJECT_ID in .env.");
  }

  const suiteId = args.suiteId ?? config.integrations.testRail?.suiteId;
  const runName = args.runName ?? buildDefaultRunName(summary);

  const output = await reportToTestRail(client, {
    resultsSummary: summary,
    projectId,
    suiteId,
    runName,
    runDescription: args.runDescription,
    dryRun: args.dryRun
  });

  console.log("");
  if (output.dryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log(`Run name: ${output.runName}`);
    console.log(`Project ID: ${projectId}`);
    if (suiteId) console.log(`Suite ID: ${suiteId}`);
    console.log(`Cases to report: ${output.caseIds.length}`);
    console.log(`Results to send: ${output.resultsCount}`);
    console.log("");
    console.log("Results:");
    for (const r of output.results) {
      console.log(`  ${r.externalId} -> ${r.status} (status_id: ${r.statusId})`);
      if (r.comment) {
        console.log(`    ${r.comment}`);
      }
    }
    console.log("");
    console.log("No TestRun was created. Remove --dry-run to report for real.");
  } else {
    console.log("=== REPORT SUCCESSFUL ===");
    console.log(`Run ID: ${output.runId}`);
    console.log(`Run name: ${output.runName}`);
    if (output.runUrl) console.log(`Run URL: ${output.runUrl}`);
    console.log(`Results sent: ${output.resultsCount}`);
    console.log("");
    console.log("Results:");
    for (const r of output.results) {
      console.log(`  ${r.externalId} -> ${r.status}`);
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[testrail:report] ${message}`);
    process.exitCode = 1;
  });