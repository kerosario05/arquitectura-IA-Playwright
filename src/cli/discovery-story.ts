import { config } from "../config/env";
import { requireJiraConfig } from "../config/env";
import { JiraClient } from "../clients/jira.client";
import { normalizeJiraIssue } from "../jira/jira-normalizer";
import { runCaseDiscoveryWorkflow, printCaseDiscoverySummary } from "../discovery/case-discovery-workflow";
import type { CaseDiscoveryWorkflowOptions } from "../discovery/case-discovery-workflow";
import { resolveAppProfile, ensureAppStructure, logAppProfile } from "../automations/app-profile";
import type { AppProfile } from "../automations/app-profile";

type CliArgs = {
  issueKey: string;
  app?: string;
  headed: boolean;
  output?: string;
  autoPromote: boolean;
  promotionDryRun: boolean;
  overwrite: boolean;
  autoPom: boolean;
  autoPomThreshold?: number;
  noAutoPomValidation: boolean;
  verifyPromotedSpec: boolean;
  promotedSpecTimeoutMs?: number;
  requirePomRuntime: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    issueKey: "",
    app: undefined,
    headed: false,
    autoPromote: false,
    promotionDryRun: false,
    overwrite: false,
    autoPom: false,
    autoPomThreshold: undefined,
    noAutoPomValidation: false,
    verifyPromotedSpec: false,
    promotedSpecTimeoutMs: undefined,
    requirePomRuntime: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
      continue;
    }
    if (token === "--auto-promote") {
      args.autoPromote = true;
      continue;
    }
    if (token === "--promotion-dry-run") {
      args.promotionDryRun = true;
      continue;
    }
    if (token === "--overwrite") {
      args.overwrite = true;
      continue;
    }
    if (token === "--auto-pom") {
      args.autoPom = true;
      continue;
    }
    if (token === "--no-auto-pom-validation") {
      args.noAutoPomValidation = true;
      continue;
    }
    if (token === "--verify-promoted-spec") {
      args.verifyPromotedSpec = true;
      continue;
    }
    if (token === "--require-pom-runtime") {
      args.requirePomRuntime = true;
      continue;
    }

    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    if (token === "--issue-key") {
      args.issueKey = nextValue.trim().toUpperCase();
      i += 1;
      continue;
    }
    if (token === "--app") {
      args.app = nextValue.trim();
      i += 1;
      continue;
    }
    if (token === "--output") {
      args.output = nextValue.trim();
      i += 1;
      continue;
    }
    if (token === "--auto-pom-threshold") {
      const n = Number(nextValue);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error(`Invalid --auto-pom-threshold value: ${nextValue}. Expected a number between 0 and 1.`);
      }
      args.autoPomThreshold = n;
      i += 1;
      continue;
    }
    if (token === "--promoted-spec-timeout-ms") {
      const n = Number(nextValue);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --promoted-spec-timeout-ms value: ${nextValue}. Expected a positive number.`);
      }
      args.promotedSpecTimeoutMs = n;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.issueKey) {
    throw new Error("--issue-key is required. Usage: npm run discovery:story -- --issue-key <KEY>");
  }

  return args;
}

async function resolveAndEnsureApp(args: CliArgs): Promise<AppProfile> {
  const envAppSlug = process.env.APP_SLUG;
  const { profile, baseDir } = await resolveAppProfile({
    cliAppSlug: args.app,
    envAppSlug,
    baseUrl: config.app.baseUrl,
    appName: config.app.name
  });
  const ensured = await ensureAppStructure(baseDir);
  logAppProfile(profile, baseDir, ensured.length > 0 ? ensured : undefined);
  return profile;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[discovery:story] Starting story-driven discovery for ${args.issueKey}...`);

  const jiraConfig = requireJiraConfig(config);
  const client = new JiraClient(jiraConfig);

  console.log(`[discovery:story] Fetching Jira issue ${args.issueKey}...`);
  const rawIssue = await client.getIssue(args.issueKey);
  const scenario = normalizeJiraIssue(rawIssue, {
    acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField
  });

  console.log(`[discovery:story] Scenario: "${scenario.title}" — ${scenario.steps.length} step(s)`);

  const appProfile = await resolveAndEnsureApp(args);

  const workflowOptions: CaseDiscoveryWorkflowOptions = {
    scenario,
    headed: args.headed,
    outputDir: args.output,
    autoPromote: args.autoPromote,
    promotionDryRun: args.promotionDryRun,
    promotionStrict: false,
    requirePromotionApproval: false,
    pageObjectMode: true,
    allowPageObjectCandidates: true,
    overwrite: args.overwrite,
    autoPom: args.autoPom,
    autoPomThreshold: args.autoPomThreshold,
    noAutoPomValidation: args.noAutoPomValidation,
    verifyPromotedSpec: args.verifyPromotedSpec,
    promotedSpecTimeoutMs: args.promotedSpecTimeoutMs,
    requirePomRuntime: args.requirePomRuntime,
    config,
    appProfile
  };

  const workflowResult = await runCaseDiscoveryWorkflow(workflowOptions);
  printCaseDiscoverySummary(workflowResult.caseResult, workflowResult);

  if (workflowResult.caseResult.status === "exploration_failed") {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("discovery-story.ts");
if (isMainModule) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[discovery:story] ${message}`);
      process.exitCode = 1;
    });
}
