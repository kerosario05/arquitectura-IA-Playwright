import { config } from "../config/env";
import { runCaseDiscoveryWorkflow, printCaseDiscoverySummary } from "../discovery/case-discovery-workflow";
import type { CaseDiscoveryWorkflowOptions } from "../discovery/case-discovery-workflow";
import { resolveAppProfile, ensureAppStructure, logAppProfile } from "../automations/app-profile";
import type { AppProfile } from "../automations/app-profile";

type CliArgs = {
  caseId: number;
  app?: string;
  headed: boolean;
  output?: string;
  autoPromote: boolean;
  promotionDryRun: boolean;
  promotionStrict: boolean;
  requirePromotionApproval: boolean;
  pageObjectMode: boolean;
  inlineDebugSpec: boolean;
  allowPageObjectCandidates: boolean;
  overwrite: boolean;
  autoPom: boolean;
  autoPomThreshold?: number;
  noAutoPomValidation: boolean;
  verifyPromotedSpec: boolean;
  promotedSpecTimeoutMs?: number;
  requirePomRuntime: boolean;
};

export function parseDiscoveryCaseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    caseId: 0,
    app: undefined,
    headed: false,
    autoPromote: false,
    promotionDryRun: false,
    promotionStrict: false,
    requirePromotionApproval: false,
    pageObjectMode: true,
    inlineDebugSpec: false,
    allowPageObjectCandidates: true,
    overwrite: false,
    autoPom: false,
    autoPomThreshold: undefined,
    noAutoPomValidation: false,
    verifyPromotedSpec: false,
    promotedSpecTimeoutMs: undefined
    ,requirePomRuntime: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
      continue;
    }
    if (token === "--app") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --app");
      }
      args.app = nextValue;
      i += 1;
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
    if (token === "--promotion-strict") {
      args.promotionStrict = true;
      continue;
    }
    if (token === "--require-promotion-approval") {
      args.requirePromotionApproval = true;
      continue;
    }
    if (token === "--overwrite") {
      args.overwrite = true;
      continue;
    }
    if (token === "--page-object-mode") {
      args.pageObjectMode = true;
      continue;
    }
    if (token === "--inline-debug-spec") {
      args.inlineDebugSpec = true;
      continue;
    }
    if (token === "--allow-page-object-candidates") {
      args.allowPageObjectCandidates = true;
      continue;
    }
    if (token === "--no-page-object-mode") {
      args.pageObjectMode = false;
      continue;
    }
    if (token === "--no-page-object-candidates") {
      args.allowPageObjectCandidates = false;
      continue;
    }
    if (token === "--auto-pom") {
      args.autoPom = true;
      continue;
    }
    if (token === "--auto-pom-threshold") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --auto-pom-threshold");
      }
      args.autoPomThreshold = Number(nextValue);
      if (!Number.isFinite(args.autoPomThreshold) || args.autoPomThreshold < 0 || args.autoPomThreshold > 1) {
        throw new Error(`Invalid --auto-pom-threshold value: ${nextValue}. Expected a number between 0 and 1.`);
      }
      i += 1;
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
    if (token === "--promoted-spec-timeout-ms") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --promoted-spec-timeout-ms");
      }
      args.promotedSpecTimeoutMs = Number(nextValue);
      if (!Number.isFinite(args.promotedSpecTimeoutMs) || args.promotedSpecTimeoutMs <= 0) {
        throw new Error(`Invalid --promoted-spec-timeout-ms value: ${nextValue}. Expected a positive number.`);
      }
      i += 1;
      continue;
    }
    if (token === "--require-pom-runtime") {
      args.requirePomRuntime = true;
      continue;
    }
    if (token === "--case-id") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --case-id");
      }
      args.caseId = Number(nextValue);
      if (!Number.isFinite(args.caseId) || args.caseId <= 0) {
        throw new Error(`Invalid --case-id value: ${nextValue}. Expected a positive integer.`);
      }
      i += 1;
      continue;
    }
    if (token === "--output") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --output");
      }
      args.output = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.caseId <= 0) {
    throw new Error("--case-id is required. Usage: npm run discovery:case -- --case-id <number>");
  }

  return args;
}

async function resolveAndEnsureApp(args: CliArgs): Promise<AppProfile> {
  const envAppSlug = process.env.APP_SLUG;

  const testRailProjectId = config.integrations?.testRail?.projectId;
  const testRailBaseUrl = config.integrations?.testRail?.url;
  const testRailEmail = config.integrations?.testRail?.email;
  const testRailApiKey = config.integrations?.testRail?.apiKey;

  const { profile, baseDir } = await resolveAppProfile({
    cliAppSlug: args.app,
    envAppSlug,
    testRailProjectId,
    testRailBaseUrl,
    testRailEmail,
    testRailApiKey,
    baseUrl: config.app.baseUrl,
    appName: config.app.name
  });

  const ensured = await ensureAppStructure(baseDir);

  logAppProfile(profile, baseDir, ensured.length > 0 ? ensured : undefined);

  return profile;
}

async function main(): Promise<void> {
  const args = parseDiscoveryCaseArgs(process.argv.slice(2));

  console.log(`[discovery:case] Starting case-driven discovery for C${args.caseId}...`);
  console.log(`[discovery:case] Overwrite enabled: ${args.overwrite}`);

  const appProfile = await resolveAndEnsureApp(args);

  const workflowOptions: CaseDiscoveryWorkflowOptions = {
    caseId: args.caseId,
    headed: args.headed,
    outputDir: args.output,
    autoPromote: args.autoPromote,
    promotionDryRun: args.promotionDryRun,
    promotionStrict: args.promotionStrict,
    requirePromotionApproval: args.requirePromotionApproval,
    pageObjectMode: args.pageObjectMode,
    inlineDebugSpec: args.inlineDebugSpec,
    allowPageObjectCandidates: args.allowPageObjectCandidates,
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

  const { caseResult } = workflowResult;

  printCaseDiscoverySummary(caseResult, workflowResult);

  if (caseResult.status === "exploration_failed") {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("discovery-case.ts");
if (isMainModule) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[discovery:case] ${message}`);
      process.exitCode = 1;
    });
}
