import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAppProfile, loadPromotedAppConfigSync } from "../automations/app-profile";
import { promoteExecutionPlan } from "../automations/promote-plan";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";

type RematerializationArgs = { caseId: number; appSlug: string; sectionSlug: string };

export function parseRematerializationArgs(argv: string[]): RematerializationArgs {
  const read = (name: string): string => {
    const index = argv.indexOf(name);
    const value = index >= 0 ? argv[index + 1] : undefined;
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const caseId = Number(read("--case-id"));
  if (!Number.isInteger(caseId) || caseId <= 0) throw new Error("Invalid --case-id");
  return { caseId, appSlug: read("--app"), sectionSlug: read("--section") };
}

async function findCaseDir(appSlug: string, sectionSlug: string, caseId: number): Promise<string> {
  const root = path.resolve(process.cwd(), "automations", "apps", appSlug, "sections", sectionSlug, "cases");
  const entries = await fs.readdir(root, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(`c${caseId}-`));
  if (!match) throw new Error("REMATERIALIZATION_CASE_NOT_FOUND");
  return path.join(root, match.name);
}

export async function rematerializePersistedPromotedSpec(args: RematerializationArgs): Promise<void> {
  const caseDir = await findCaseDir(args.appSlug, args.sectionSlug, args.caseId);
  const planPath = path.join(caseDir, "plan.json");
  const plan = JSON.parse(await fs.readFile(planPath, "utf8")) as any;
  if (!plan.sourceScenario || !plan.executionContract) throw new Error("REMATERIALIZATION_PLAN_INCOMPLETE");
  if (String(plan.scenario?.caseId ?? "") !== String(args.caseId)) throw new Error("REMATERIALIZATION_IDENTITY_MISMATCH");
  const automation = JSON.parse(await fs.readFile(path.join(caseDir, "automation.json"), "utf8")) as any;
  if (automation.appSlug !== args.appSlug || String(automation.caseId) !== String(args.caseId)) {
    throw new Error("REMATERIALIZATION_IDENTITY_MISMATCH");
  }
  const config = loadPromotedAppConfigSync({ appSlug: args.appSlug });
  if (!config) throw new Error("REMATERIALIZATION_APP_CONFIG_MISSING");
  // Legacy promotion artifacts may contain observable oracles created before
  // polarity was part of the canonical semantic payload. Keep such oracles
  // unresolved. Rematerialization must never infer polarity from free text.
  const sourceScenario = {
    ...plan.sourceScenario,
    observableOracles: plan.sourceScenario.observableOracles ?? [],
  };
  const rematerializationPlan = {
    ...plan,
    sourceScenario,
    executionContract: buildSpecExecutionContract(plan, sourceScenario, {
      appSlug: args.appSlug,
      sectionSlug: args.sectionSlug,
    }),
  };
  process.env.AI_SPEC_GENERATION_ENABLED = "false";
  process.env.AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED = "false";
  process.env.AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK = "false";
  await promoteExecutionPlan({
    plan: rematerializationPlan,
    sourcePlanPath: planPath,
    source: "manual",
    overwrite: true,
    promotionPolicy: DEFAULT_PROMOTION_POLICY,
    appProfileObject: deriveAppProfile({
      appProfile: args.appSlug,
      appName: config.name,
      baseUrl: config.baseUrl,
    }),
    sectionSlug: args.sectionSlug,
    sourceScenario,
    skipExistingSpecAdmission: false,
    persistAppConfig: false,
    verifySpec: false,
  });
}

async function main(): Promise<void> {
  await rematerializePersistedPromotedSpec(parseRematerializationArgs(process.argv.slice(2)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
