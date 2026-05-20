import { applyRegistryPromotion, buildRegistryPromotionReport } from "../registry/registry-promoter";
import { promoteDiscoveryAutomation } from "../automations/automation-promoter";
import type { RegistryPromotionOptions } from "../types/registry-promotion.types";

type CliArgs = RegistryPromotionOptions;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    fromDir: "",
    dryRun: false,
    approve: false,
    confidenceThreshold: 0.75,
    promoteObjects: false,
    promotePlan: false,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    if (token === "--from") {
      if (!nextValue || nextValue.startsWith("--")) throw new Error("Missing value for --from");
      args.fromDir = nextValue;
      index += 1;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--approve") {
      args.approve = true;
      continue;
    }
    if (token === "--confidence-threshold") {
      if (!nextValue || nextValue.startsWith("--")) throw new Error("Missing value for --confidence-threshold");
      const parsed = Number(nextValue);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error("Invalid --confidence-threshold. Expected number between 0 and 1.");
      }
      args.confidenceThreshold = parsed;
      index += 1;
      continue;
    }
    if (token === "--promote-objects") {
      args.promoteObjects = true;
      continue;
    }
    if (token === "--promote-plan") {
      args.promotePlan = true;
      continue;
    }
    if (token === "--promote-automation") {
      args.promoteAutomation = true;
      continue;
    }
    if (token === "--include-sections") {
      args.includeSections = true;
      continue;
    }
    if (token === "--exclude-global-navigation") {
      args.excludeGlobalNavigation = true;
      continue;
    }
    if (token === "--case-id") {
      if (!nextValue || nextValue.startsWith("--")) throw new Error("Missing value for --case-id");
      args.caseId = Number(nextValue);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.fromDir) {
    throw new Error("--from is required.");
  }

  if (!args.promoteObjects && !args.promotePlan && !args.promoteAutomation) {
    args.promoteObjects = true;
    args.promotePlan = true;
  }

  if (args.approve && args.dryRun) {
    throw new Error("--approve and --dry-run cannot be used together.");
  }

  if (!args.approve) {
    args.dryRun = true;
  }

  return args;
}

function printReport(report: Awaited<ReturnType<typeof buildRegistryPromotionReport>>): void {
  console.log("Registry promotion");
  console.log("------------------");
  console.log(`Mode: ${report.mode}`);
  console.log(`From: ${report.fromDir}`);
  console.log(`Registry path: ${report.registryPath}`);
  console.log(`Objects to promote: ${report.objectsToPromote.length}`);
  for (const object of report.objectsToPromote) {
    console.log(`- promote ${object.key} (${object.type})`);
  }
  console.log(`Objects skipped: ${report.objectsSkipped.length}`);
  for (const skipped of report.objectsSkipped) {
    console.log(`- skip ${skipped.object.key}: ${skipped.reason}`);
  }
  console.log(`Duplicates merged: ${report.duplicatesMerged.length}`);
  for (const merged of report.duplicatesMerged) {
    console.log(`- merge ${merged.keptKey}: ${merged.reason} [${merged.droppedKeys.join(", ")}]`);
  }
  console.log(`Conflicts: ${report.conflicts.length}`);
  for (const conflict of report.conflicts) {
    console.log(`- conflict ${conflict.key}: ${conflict.reason}`);
  }
  if (report.planToPromote) {
    console.log(`Plan to promote: case ${report.planToPromote.scenario.caseId} - ${report.planToPromote.scenario.title}`);
  }
  if (report.automationToCreate) {
    console.log(`Automation to create: ${report.automationToCreate.caseId ?? "n/a"} - ${report.automationToCreate.title}`);
  }
  console.log(`Warnings: ${report.warnings.length}`);
  for (const warning of report.warnings) {
    console.log(`- ${warning}`);
  }
  if (report.registryWritten) {
    console.log(`Registry updated: yes`);
    if (report.backupPath) console.log(`Registry backup: ${report.backupPath}`);
  } else {
    console.log(`Registry updated: no`);
  }
  if (report.promotedAutomation) {
    console.log(`Automation promoted: ${report.promotedAutomation.id}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let report = await buildRegistryPromotionReport(args);

  if (args.approve) {
    if (args.promoteObjects) {
      report = await applyRegistryPromotion(report);
    }
    if (args.promoteAutomation && report.planToPromote) {
      const promotedAutomation = await promoteDiscoveryAutomation({
        plan: report.planToPromote,
        discoveryDir: report.fromDir,
        promotedObjects: report.objectsToPromote
      });
      report = {
        ...report,
        promotedAutomation
      };
    }
  }

  printReport(report);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[registry:promote] ${message}`);
    process.exitCode = 1;
  });
