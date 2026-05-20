import path from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { config } from "../config/env";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { runDiscoveryScan, printDiscoverySummary } from "../discovery/discovery-scanner";

type CliArgs = {
  output?: string;
  screenshot: boolean;
  noLogin: boolean;
  url?: string;
  minConfidence?: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { screenshot: false, noLogin: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--screenshot") {
      args.screenshot = true;
      continue;
    }
    if (token === "--no-login") {
      args.noLogin = true;
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
    if (token === "--url") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --url");
      }
      args.url = nextValue;
      i += 1;
      continue;
    }
    if (token === "--min-confidence") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --min-confidence");
      }
      args.minConfidence = parseFloat(nextValue);
      if (isNaN(args.minConfidence) || args.minConfidence < 0 || args.minConfidence > 1) {
        throw new Error("--min-confidence must be a number between 0 and 1");
      }
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function getDefaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`./.artifacts/discovery/scan-${stamp}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const browserType = { chromium, firefox, webkit }[config.execution.browser];
  const outputPath = args.output ? path.resolve(args.output) : getDefaultOutputPath();
  const targetUrl = args.url || config.app.baseUrl;

  let browser;
  try {
    browser = await browserType.launch({ headless: config.execution.headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(config.execution.defaultTimeoutMs);

    if (args.noLogin) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    } else {
      const loginStrategy = getLoginStrategy(config.app.loginMode);
      await loginStrategy.execute(page, config);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: config.execution.defaultTimeoutMs });

    const screenshotPath = args.screenshot
      ? path.join(path.dirname(outputPath), `${path.basename(outputPath, ".json")}.png`)
      : undefined;

    const result = await runDiscoveryScan({
      page,
      outputPath,
      screenshotPath,
      minConfidence: args.minConfidence
    });

    printDiscoverySummary(result);

    console.log(`\nDiscovery result saved to: ${outputPath}`);
    if (screenshotPath) {
      console.log(`Screenshot saved to: ${screenshotPath}`);
    }
    console.log(`\nTo review proposed objects, run: npm run registry:inspect`);
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
    console.error(`[discovery:scan] ${message}`);
    process.exitCode = 1;
  });
