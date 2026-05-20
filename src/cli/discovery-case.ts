import path from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { createAIExplorer } from "../ai/ai-explorer";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { normalizeTestRailCases } from "../testrail/testrail-normalizer";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { runCaseDiscovery, printCaseDiscoverySummary } from "../discovery/case-discovery";

type CliArgs = {
  caseId: number;
  headed: boolean;
  output?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { caseId: 0, headed: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
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

function getDefaultOutputDir(caseId: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`./.artifacts/discovery/case-${caseId}/${stamp}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const outputDir = args.output ? path.resolve(args.output) : getDefaultOutputDir(args.caseId);
  const evidenceDir = path.join(outputDir, "evidence");
  const pendingObjectsPath = path.join(outputDir, "discovered-objects.pending.json");
  const pendingPlansPath = path.join(outputDir, "discovered-plans.pending.json");

  console.log(`[discovery:case] Starting case-driven discovery for C${args.caseId}...`);
  console.log(`[discovery:case] Output directory: ${outputDir}`);

  const testRailRuntimeConfig = requireTestRailConfig(config);
  const client = new TestRailClient(testRailRuntimeConfig);

  console.log(`[discovery:case] Fetching case C${args.caseId} from TestRail...`);
  const rawCase = await client.getCase(args.caseId);
  const scenarios = normalizeTestRailCases([rawCase]);

  if (scenarios.length === 0) {
    throw new Error(`No scenario could be generated for case C${args.caseId}.`);
  }

  const scenario = scenarios[0];
  console.log(`[discovery:case] Case title: ${scenario.title}`);
  console.log(`[discovery:case] Steps: ${scenario.steps.length}`);
  for (const step of scenario.steps) {
    console.log(`  ${step.index}. ${step.action}`);
  }

  const browserType = { chromium, firefox, webkit }[config.execution.browser];
  const headless = !args.headed;

  let browser;
  try {
    browser = await browserType.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(config.execution.defaultTimeoutMs);

    const loginStrategy = getLoginStrategy(config.app.loginMode);

    console.log(`[discovery:case] Starting discovery with login mode: ${config.app.loginMode}`);

    const result = await runCaseDiscovery({
      page,
      scenario,
      evidenceDir,
      pendingObjectsPath,
      pendingPlansPath,
      appBaseUrl: config.app.baseUrl,
      testData: config.app.testData,
      loginAction: async () => {
        await loginStrategy.execute(page, config);
      },
      aiAssistedDiscovery: {
        explorer: createAIExplorer({
          provider: config.integrations.ai?.agentProvider ?? "custom"
        }),
        config: {
          enabled: config.integrations.ai?.discoveryEnabled ?? false,
          confidenceThreshold: config.integrations.ai?.discoveryConfidenceThreshold ?? 0.85,
          requireApprovalThreshold: config.integrations.ai?.discoveryRequireApprovalThreshold ?? 0.7,
          maxAttempts: config.integrations.ai?.discoveryMaxAttempts ?? 3
        }
      }
    });

    printCaseDiscoverySummary(result);

    if (result.status === "exploration_failed") {
      process.exitCode = 1;
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[discovery:case] ${message}`);
    process.exitCode = 1;
  });
