import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { getCaseAutomationStatus } from "../cases/case-automation-status";
import type { CaseAutomationStatus } from "../types/case-automation-status.types";

type NormalizedStatus = "all" | "automated" | "not_automated";

function normalizeStatusFilter(value: string | undefined): NormalizedStatus {
  if (!value || value === "all") return "all";
  if (value === "automated") return "automated";
  if (value === "not-automated" || value === "not_automated") return "not_automated";
  throw new Error("Invalid status. Expected one of: all, automated, not-automated, not_automated");
}

interface CliArgs {
  projectId?: string;
  suiteId?: string;
  sectionId?: string;
  statusFilter: NormalizedStatus;
  json: boolean;
  allApps: boolean;
  app?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { statusFilter: "all", json: false, allApps: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--json") {
      args.json = true;
      continue;
    }

    if (token === "--all-apps") {
      args.allApps = true;
      continue;
    }

    if (
      (token === "--project-id" || token === "--suite-id" || token === "--section-id" || token === "--status" || token === "--app") &&
      (!nextValue || nextValue.startsWith("--"))
    ) {
      throw new Error(`Missing value for ${token}`);
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
    if (token === "--section-id") {
      args.sectionId = nextValue;
      i += 1;
      continue;
    }
    if (token === "--status") {
      args.statusFilter = normalizeStatusFilter(nextValue);
      i += 1;
      continue;
    }
    if (token === "--app") {
      args.app = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function formatStatus(status: string): string {
  const colors: Record<string, string> = {
    not_automated: "[NOT AUTOMATED]",
    draft: "[DRAFT]",
    active: "[ACTIVE]",
    disabled: "[DISABLED]",
    different_profile: "[OTHER PROFILE]"
  };
  return colors[status] ?? `[${status.toUpperCase()}]`;
}

function matchesStatusFilter(status: CaseAutomationStatus, filter: NormalizedStatus): boolean {
  if (filter === "all") return true;
  if (filter === "automated") return status !== "not_automated" && status !== "different_profile";
  return status === filter;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const testRailRuntimeConfig = requireTestRailConfig(config);
  const client = new TestRailClient(testRailRuntimeConfig);

  const projectId = args.projectId ?? config.integrations.testRail?.projectId;
  if (!projectId) {
    throw new Error("--project-id is required or set TESTRAIL_PROJECT_ID in .env.");
  }

  const suiteId = args.suiteId ?? config.integrations.testRail?.suiteId;
  const sectionId = args.sectionId ?? config.integrations.testRail?.sectionId;

  console.log(`[cases:list] Fetching cases from TestRail (project=${projectId}, suite=${suiteId ?? "default"}, section=${sectionId ?? "all"})...`);

  const rawCases = await client.getCases(projectId, suiteId, sectionId);
  console.log(`[cases:list] Found ${rawCases.length} cases.`);

  const result = await getCaseAutomationStatus(rawCases, undefined, {
    allApps: args.allApps,
    appSlug: args.app
  });

  if (args.json) {
    const filtered = result.cases.filter((c) => matchesStatusFilter(c.automationStatus, args.statusFilter));
    console.log(JSON.stringify({ ...result, cases: filtered }, null, 2));
    return;
  }

  console.log("");
  console.log("=== CASE AUTOMATION STATUS ===");
  console.log(`Total: ${result.totalCount}`);
  console.log(`Automated: ${result.automatedCount}`);
  console.log(`Not automated: ${result.notAutomatedCount}`);
  console.log(`Fetched at: ${result.fetchedAt}`);
  console.log("");

  const filteredCases = result.cases.filter((c) => matchesStatusFilter(c.automationStatus, args.statusFilter));

  console.log("CASES:");
  for (const testCase of filteredCases) {
    const statusLabel = formatStatus(testCase.automationStatus);
    const idLabel = testCase.externalId ?? `C${testCase.caseId}`;
    const profileInfo = testCase.appProfile ? ` (profile: ${testCase.appProfile})` : "";
    console.log(`  ${statusLabel} ${idLabel} - ${testCase.title}${profileInfo}`);
    if (testCase.specPath) {
      console.log(`    Spec: ${testCase.specPath}`);
    }
    if (testCase.automationStatus === "different_profile" && testCase.currentProfile) {
      console.log(`    Current profile: ${testCase.currentProfile}`);
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cases:list] ${message}`);
    process.exitCode = 1;
  });
