import { spawn } from "node:child_process";
import path from "node:path";

function printUsage(): void {
  console.log(`
Usage: npm run test:promoted -- [options]

Options:
  --app <slug>        App slug (e.g., arquitectura-automatizacion)
  --section <slug>    Section slug (e.g., regresion-kiosko)
  --case-id <id>      TestRail case ID (e.g., 38260)
  --headed            Run tests in headed mode (visible browser)
  --parallel          Run tests in parallel (default: serial with workers=1)
  --workers <n>       Number of workers (default: 1 for serial execution)
  --timeout <ms>      Test timeout in milliseconds (default: 90000)
  --project <name>    Playwright project name (chromium, firefox, webkit)
  --grep <pattern>    Filter tests by name pattern
  --help              Show this help message

Examples:
  # Run all promoted specs
  npm run test:promoted

  # Run specific case
  npm run test:promoted -- --case-id 38260 --headed

  # Run specific section
  npm run test:promoted -- --app arquitectura-automatizacion --section regresion-kiosko

  # Run with custom timeout
  npm run test:promoted -- --case-id 38260 --timeout 120000

  # Run in parallel (faster, but may have race conditions)
  npm run test:promoted -- --parallel

Environment Variables:
  PROMOTED_SPEC_TIMEOUT_MS    Override default timeout (default: 90000)
  BROWSER                     Browser to use (default: chromium)
  HEADLESS                    Run in headless mode (default: false when using --headed)
`);
}

function parseArgs(args: string[]): {
  app?: string;
  section?: string;
  caseId?: string;
  headed: boolean;
  parallel: boolean;
  workers: number;
  timeout: number;
  project?: string;
  grep?: string;
  help: boolean;
} {
  const result = {
    app: undefined as string | undefined,
    section: undefined as string | undefined,
    caseId: undefined as string | undefined,
    headed: false,
    parallel: false,
    workers: 1,
    timeout: 90000,
    project: undefined as string | undefined,
    grep: undefined as string | undefined,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--app":
        result.app = next;
        i++;
        break;
      case "--section":
        result.section = next;
        i++;
        break;
      case "--case-id":
        result.caseId = next;
        i++;
        break;
      case "--headed":
        result.headed = true;
        break;
      case "--parallel":
        result.parallel = true;
        result.workers = 0; // 0 = auto parallel
        break;
      case "--workers":
        result.workers = parseInt(next, 10);
        i++;
        break;
      case "--timeout":
        result.timeout = parseInt(next, 10);
        i++;
        break;
      case "--project":
        result.project = next;
        i++;
        break;
      case "--grep":
        result.grep = next;
        i++;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

function buildTestPath(options: { app?: string; section?: string; caseId?: string }): string | null {
  if (options.caseId) {
    if (options.app && options.section) {
      // Specific path without glob
      return `automations/apps/${options.app}/sections/${options.section}/cases/c${options.caseId}`;
    }
    // For case-id only, use grep to filter by case ID in test name
    return null;
  }

  if (options.app && options.section) {
    return `automations/apps/${options.app}/sections/${options.section}/cases`;
  }

  if (options.app) {
    return `automations/apps/${options.app}`;
  }

  // Default: all promoted specs
  return 'automations/apps';
}

function main(): void {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const testPath = buildTestPath(options);
  const timeout = process.env.PROMOTED_SPEC_TIMEOUT_MS 
    ? parseInt(process.env.PROMOTED_SPEC_TIMEOUT_MS, 10) 
    : options.timeout;
  const workers = options.parallel ? 0 : options.workers;

  const playwrightArgs: string[] = [];

  // Add test path if specified
  if (testPath) {
    playwrightArgs.push(testPath);
  } else {
    playwrightArgs.push("automations/apps");
  }

  // Add grep filter for case-id search across all apps/sections
  if (options.caseId && !options.app && !options.section) {
    playwrightArgs.push(`--grep=C${options.caseId}`);
    console.log(`[test:promoted] Filtering by case ID: ${options.caseId}`);
  }

  // Add workers configuration
  if (workers === 0) {
    // Parallel mode - don't set workers flag, let Playwright auto-detect
    console.log("[test:promoted] Running in parallel mode");
  } else {
    playwrightArgs.push(`--workers=${workers}`);
    if (workers === 1) {
      console.log("[test:promoted] Running in serial mode (workers=1)");
    } else {
      console.log(`[test:promoted] Running with ${workers} workers`);
    }
  }

  // Add timeout
  playwrightArgs.push(`--timeout=${timeout}`);
  console.log(`[test:promoted] Using timeout: ${timeout}ms`);

  // Add headed mode
  if (options.headed) {
    playwrightArgs.push("--headed");
    console.log("[test:promoted] Running in headed mode");
  }

  // Add project/browser
  if (options.project) {
    playwrightArgs.push(`--project=${options.project}`);
    console.log(`[test:promoted] Using project: ${options.project}`);
  }

  // Add grep filter
  if (options.grep) {
    playwrightArgs.push(`--grep=${options.grep}`);
    console.log(`[test:promoted] Filtering by: ${options.grep}`);
  }

  // Build full command
  const cliPath = path.resolve(process.cwd(), "node_modules/.bin/playwright");
  const command = process.platform === "win32" ? `${cliPath}.cmd` : cliPath;

  console.log(`[test:promoted] Executing: playwright test ${playwrightArgs.join(" ")}\n`);

  // Spawn Playwright process
  const child = spawn(command, ["test", ...playwrightArgs], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  child.on("close", (code) => {
    process.exit(code ?? 1);
  });

  child.on("error", (err) => {
    console.error("[test:promoted] Failed to start Playwright:", err);
    process.exit(1);
  });
}

main();
