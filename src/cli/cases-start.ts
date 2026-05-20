import { config, requireTestRailConfig } from "../config/env";
import { startCaseAutomationWorkflow } from "../cases/case-start-workflow";
import type { CaseStartWorkflowInput } from "../types/case-start.types";

interface CliArgs {
  caseId: number;
  projectId?: string;
  suiteId?: string;
  headed: boolean;
  continueOnFailure: boolean;
  noReport: boolean;
  dryRun: boolean;
  json: boolean;
  autoPromote: boolean;
  autoHandoff: boolean;
  autoRepair: boolean;
  reuseExisting: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    caseId: 0,
    headed: false,
    continueOnFailure: false,
    noReport: false,
    dryRun: false,
    json: false,
    autoPromote: false,
    autoHandoff: false,
    autoRepair: false,
    reuseExisting: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
      continue;
    }
    if (token === "--continue-on-failure") {
      args.continueOnFailure = true;
      continue;
    }
    if (token === "--no-report") {
      args.noReport = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--auto-promote" || token === "--promote") {
      args.autoPromote = true;
      continue;
    }
    if (token === "--auto") {
      args.autoHandoff = true;
      args.autoPromote = true;
      continue;
    }
    if (token === "--auto-repair") {
      args.autoRepair = true;
      continue;
    }
    if (token === "--reuse-existing") {
      args.reuseExisting = true;
      continue;
    }
    if (token === "--no-reuse-existing") {
      args.reuseExisting = false;
      continue;
    }

    if (
      (token === "--case-id" || token === "--project-id" || token === "--suite-id") &&
      (!nextValue || nextValue.startsWith("--"))
    ) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--case-id") {
      args.caseId = Number(nextValue);
      if (!Number.isFinite(args.caseId) || args.caseId <= 0) {
        throw new Error(`Invalid --case-id value: ${nextValue}. Expected a positive integer.`);
      }
      i += 1;
      continue;
    }
    if (token === "--project-id") {
      args.projectId = nextValue;
      i += 1;
      continue;
    }
    if (token === "--suite-id") {
      args.suiteId = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.caseId <= 0) {
    throw new Error("--case-id is required. Usage: npm run cases:start -- --case-id <number>");
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const projectId = args.projectId ?? config.integrations.testRail?.projectId;
  if (!projectId) {
    throw new Error("--project-id is required or set TESTRAIL_PROJECT_ID in .env.");
  }

  const suiteId = args.suiteId ?? config.integrations.testRail?.suiteId;

  console.log(`[cases:start] Starting automation for case C${args.caseId}...`);
  console.log(`[cases:start] Project: ${projectId}, Suite: ${suiteId ?? "default"}`);
  if (args.headed) console.log("[cases:start] Headed mode enabled.");
  if (args.continueOnFailure) console.log("[cases:start] Continue on failure enabled.");
  if (args.noReport) console.log("[cases:start] TestRail reporting disabled.");
  if (args.dryRun) console.log("[cases:start] Dry-run mode enabled.");
  if (args.autoPromote) console.log("[cases:start] Auto-promote enabled.");
  if (args.autoHandoff) console.log("[cases:start] Auto-handoff enabled.");
  if (args.autoRepair) console.log("[cases:start] Auto-repair enabled.");
  if (args.reuseExisting) console.log("[cases:start] Automation reuse enabled.");

  const input: CaseStartWorkflowInput = {
    caseId: args.caseId,
    projectId,
    suiteId,
    headed: args.headed,
    continueOnFailure: args.continueOnFailure,
    reportToTestRail: !args.noReport,
    dryRun: args.dryRun,
    autoPromote: args.autoPromote,
    autoHandoff: args.autoHandoff,
    autoRepair: args.autoRepair,
    reuseExisting: args.reuseExisting
  };

  const result = await startCaseAutomationWorkflow(input);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("");
  console.log("=== CASE AUTOMATION RESULT ===");
  console.log(`Case: C${result.caseId}`);
  console.log(`Status: ${result.status}`);
  console.log(`Started: ${result.startedAt}`);
  console.log(`Completed: ${result.completedAt}`);

  if (result.planPath) {
    console.log(`Plan: ${result.planPath}`);
  }
  if (result.executionResultPath) {
    console.log(`Results: ${result.executionResultPath}`);
  }
  if (result.testRailRunId) {
    console.log(`TestRail Run ID: ${result.testRailRunId}`);
  }
  if (result.testRailRunUrl) {
    console.log(`TestRail Run URL: ${result.testRailRunUrl}`);
  }

  if (result.promotion) {
    if (result.promotion.dryRun) {
      console.log("[cases:start] Dry-run: would promote if execution passed and plan is validated.");
    } else if (result.promotion.promoted) {
      console.log("");
      console.log("[cases:start] Promoting successful automation...");
      console.log("[cases:start] Promotion completed.");
      console.log(`Automation ID: ${result.promotion.automationId}`);
      console.log(`Plan: ${result.promotion.planPath}`);
      console.log(`Spec: ${result.promotion.specPath}`);
    } else if (result.promotion.reason === "execution_failed") {
      console.log("[cases:start] Auto-promote skipped because execution did not pass.");
    } else if (result.promotion.reason === "plan_not_validated") {
      console.log("[cases:start] Auto-promote skipped because plan status is not 'validated'.");
      console.log("[cases:start] Run plans:enrich first to resolve data and element mappings.");
    }
  }

  if (result.handoff) {
    if (result.handoff.dryRun) {
      console.log("[cases:start] Dry-run: would create agent handoff if plan was not validated.");
    } else if (result.handoff.reason === "plan_needs_discovery") {
      console.log("");
      console.log("=== SNAPSHOT GAP DETECTED ===");
      if (result.handoff.handoffDir) {
        console.log(`Handoff directory: ${result.handoff.handoffDir}`);
      }
      console.log("");
      console.log("The requested flow requires browser discovery because target elements are not present in the captured snapshot.");
      console.log("Codex cannot resolve locators for elements not visible in the snapshot without executing Playwright.");
      console.log("");
      console.log("Next steps:");
      console.log("");
      console.log(`npm.cmd run discovery:case -- --case-id ${result.caseId} --headed`);
    } else if (result.handoff.created && !result.autoRepair?.attempted) {
      const hasAllPaths = result.handoff.requestPath
        && result.handoff.instructionsPath
        && result.handoff.schemaPath
        && result.handoff.responsePath;

      if (!hasAllPaths) {
        console.log("");
        console.log("[cases:start] Handoff was created but some file paths are missing. Check the handoff directory for available files.");
        if (result.handoff.handoffDir) {
          console.log(`Handoff directory: ${result.handoff.handoffDir}`);
        }
      } else {
        console.log("");
        console.log("=== AGENT HANDOFF PREPARED ===");
        console.log(`Handoff directory: ${result.handoff.handoffDir}`);
        console.log(`Request: ${result.handoff.requestPath}`);
        console.log(`Instructions: ${result.handoff.instructionsPath}`);
        console.log(`Schema: ${result.handoff.schemaPath}`);
        console.log(`Response template: ${result.handoff.responsePath}`);
        console.log("");
        console.log("Next steps:");
        console.log("");
        console.log("1. Have Codex fill in the response template:");
        console.log(`   Open ${result.handoff.instructionsPath} in VS Code with Codex`);
        console.log("");
        console.log("2. Validate the agent response and generate repaired plans:");
        console.log(`   npm.cmd run agent:validate -- --response "${result.handoff.responsePath}" --request "${result.handoff.requestPath}" --output-plans .artifacts/plans/agent-plans.json`);
        console.log("");
        console.log("3. Execute the repaired plans:");
        console.log(`   npm.cmd run plans:execute -- --plans .artifacts/plans/agent-plans.json --headed`);
      }
    }
  }

  if (result.autoRepair) {
    if (result.autoRepair.dryRun) {
      console.log("[cases:start] Dry-run: would invoke Codex CLI for auto-repair.");
    } else if (result.autoRepair.success) {
      console.log("");
      console.log("[cases:start] Codex auto-repair completed.");
      console.log(`Response: ${result.autoRepair.responsePath}`);
    } else if (result.autoRepair.attempted) {
      console.log("[cases:start] Auto-repair failed; manual handoff remains available.");
      if (result.autoRepair.error) {
        console.log(`Error: ${result.autoRepair.error}`);
      }
    }
  }

  if (result.reuse) {
    if (result.reuse.found) {
      console.log(`[cases:start] Reusing automation from case C${result.reuse.sourceCaseId} for case C${result.caseId} (${result.reuse.matchType}, confidence: ${(result.reuse.confidence ?? 0).toFixed(2)}).`);
    } else if (result.reuse.skippedReason === "no_match") {
      console.log("[cases:start] Reuse skipped: no matching automation found.");
    } else if (result.reuse.skippedReason === "disabled") {
      console.log("[cases:start] Reuse skipped: --no-reuse-existing flag was used.");
    } else if (result.reuse.skippedReason === "invalid_plan") {
      console.log("[cases:start] Reuse skipped: existing automation plan is not valid.");
    }
  }

  if (result.postReporting) {
    console.log("");
    console.log("=== POST-EXECUTION REPORTING ===");
    if (result.postReporting.testRailRunId) {
      console.log(`TestRail Run ID: ${result.postReporting.testRailRunId}`);
    }
    console.log(`Jira attached: ${result.postReporting.jiraAttached ? "Yes" : "No"}`);
  }

  if (result.error) {
    console.log("");
    console.error(`Error: ${result.error}`);
    process.exitCode = 1;
  } else if (result.status === "failed") {
    process.exitCode = 1;
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cases:start] ${message}`);
    process.exitCode = 1;
  });
