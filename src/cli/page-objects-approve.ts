import { approvePageObjectCandidates, parseArgs, type CliApprovalArgs } from "../automations/page-object-approval";

export { approvePageObjectCandidates, parseArgs, type CliApprovalArgs };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[page-objects:approve] App: ${args.app}`);
  console.log(`[page-objects:approve] Dry run: ${args.dryRun}`);
  if (args.only) console.log(`[page-objects:approve] Only: ${args.only}`);
  if (args.all) console.log(`[page-objects:approve] All candidates`);
  console.log(`[page-objects:approve] Overwrite active: ${args.overwriteActive}`);

  if (!args.only && !args.all) {
    console.error("[page-objects:approve] Error: Must specify --only <ClassName> or --all");
    process.exitCode = 1;
    return;
  }

  const result = await approvePageObjectCandidates(args.app, undefined, {
    onlyClassName: args.only,
    approveAll: args.all,
    overwriteActive: args.overwriteActive,
    dryRun: args.dryRun
  });

  console.log("");
  console.log("=== Page Object Approval Results ===");
  console.log(`Approved: ${result.approved}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Warnings: ${result.warnings.length}`);
  console.log("");

  for (const file of result.files) {
    const icon = file.status === "approved" ? "✓" : file.status === "skipped" ? "-" : "✗";
    console.log(`  ${icon} ${file.className} -> ${file.status}`);
  }

  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warn of result.warnings) {
      console.log(`  ⚠ ${warn}`);
    }
  }

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const err of result.errors) {
      console.log(`  ✗ ${err}`);
    }
  }

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("page-objects-approve.ts");
if (isMainModule) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[page-objects:approve] ${message}`);
      process.exitCode = 1;
    });
}
