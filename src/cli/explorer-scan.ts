import path from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { config } from "../config/env";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { scanCurrentPage } from "../explorer/page-scanner";
import { writePageSnapshot } from "../explorer/snapshot-writer";

type CliArgs = {
  output?: string;
  screenshot: boolean;
  noLogin: boolean;
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

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function getDefaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`./.artifacts/explorer/snapshot-${stamp}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const browserType = { chromium, firefox, webkit }[config.execution.browser];
  const outputPath = args.output ? path.resolve(args.output) : getDefaultOutputPath();

  let browser;
  try {
    browser = await browserType.launch({ headless: config.execution.headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(config.execution.defaultTimeoutMs);

    if (args.noLogin) {
      await page.goto(config.app.baseUrl, { waitUntil: "domcontentloaded" });
    } else {
      const loginStrategy = getLoginStrategy(config.app.loginMode);
      await loginStrategy.execute(page, config);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: config.execution.defaultTimeoutMs });

    const snapshot = await scanCurrentPage(page);
    await writePageSnapshot(snapshot, outputPath);

    if (args.screenshot) {
      const screenshotPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, ".json")}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot path: ${screenshotPath}`);
    }

    console.log(`URL: ${snapshot.url}`);
    console.log(`Title: ${snapshot.title}`);
    console.log(`Total elements: ${snapshot.summary.totalElements}`);
    console.log(
      `Counts: buttons=${snapshot.summary.buttons}, links=${snapshot.summary.links}, inputs=${snapshot.summary.inputs}, selects=${snapshot.summary.selects}, tables=${snapshot.summary.tables}, dialogs=${snapshot.summary.dialogs}, headings=${snapshot.summary.headings}`
    );
    console.log(`Snapshot path: ${outputPath}`);
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
    console.error(`[explorer:scan] ${message}`);
    process.exitCode = 1;
  });
