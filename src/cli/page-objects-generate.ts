import { generatePageObjectCandidateFiles } from "../automations/page-object-codegen";
import type { PageObjectCodegenOptions } from "../automations/page-object-codegen";

type CliArgs = {
  app: string;
  dryRun: boolean;
  only?: string;
  overwriteCandidates: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    app: "default",
    dryRun: false,
    only: undefined,
    overwriteCandidates: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--overwrite-candidates") {
      args.overwriteCandidates = true;
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
    if (token === "--only") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --only");
      }
      args.only = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[page-objects:generate] App: ${args.app}`);
  console.log(`[page-objects:generate] Dry run: ${args.dryRun}`);
  if (args.only) console.log(`[page-objects:generate] Only: ${args.only}`);
  console.log(`[page-objects:generate] Overwrite candidates: ${args.overwriteCandidates}`);

  const options: PageObjectCodegenOptions = {
    appSlug: args.app,
    dryRun: args.dryRun,
    onlyClassName: args.only,
    overwriteCandidates: args.overwriteCandidates
  };

  const result = await generatePageObjectCandidateFiles(options);

  console.log("");
  console.log("=== Page Object Codegen Results ===");
  console.log(`Generated: ${result.generated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Warnings: ${result.warnings.length}`);
  console.log("");

  for (const file of result.files) {
    const icon = file.status === "generated" ? "✓" : file.status === "skipped" ? "-" : "✗";
    console.log(`  ${icon} ${file.className} -> ${file.filePath}`);
  }

  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings (methods filtered by intent):");
    for (const warn of result.warnings) {
      console.log(`  ⚠ ${warn}`);
    }
  }

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("page-objects-generate.ts");
if (isMainModule) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[page-objects:generate] ${message}`);
      process.exitCode = 1;
    });
}
