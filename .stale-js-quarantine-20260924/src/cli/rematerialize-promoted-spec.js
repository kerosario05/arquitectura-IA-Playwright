"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRematerializationArgs = parseRematerializationArgs;
exports.rematerializePersistedPromotedSpec = rematerializePersistedPromotedSpec;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
const app_profile_1 = require("../automations/app-profile");
const promote_plan_1 = require("../automations/promote-plan");
const spec_execution_contract_1 = require("../automations/spec-execution-contract");
const automation_promotion_types_1 = require("../types/automation-promotion.types");
function parseRematerializationArgs(argv) {
    const read = (name) => {
        const index = argv.indexOf(name);
        const value = index >= 0 ? argv[index + 1] : undefined;
        if (!value)
            throw new Error(`Missing ${name}`);
        return value;
    };
    const caseId = Number(read("--case-id"));
    if (!Number.isInteger(caseId) || caseId <= 0)
        throw new Error("Invalid --case-id");
    return { caseId, appSlug: read("--app"), sectionSlug: read("--section") };
}
async function findCaseDir(appSlug, sectionSlug, caseId) {
    const root = node_path_1.default.resolve(process.cwd(), "automations", "apps", appSlug, "sections", sectionSlug, "cases");
    const entries = await promises_1.default.readdir(root, { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(`c${caseId}-`));
    if (!match)
        throw new Error("REMATERIALIZATION_CASE_NOT_FOUND");
    return node_path_1.default.join(root, match.name);
}
async function rematerializePersistedPromotedSpec(args) {
    const caseDir = await findCaseDir(args.appSlug, args.sectionSlug, args.caseId);
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    const plan = JSON.parse(await promises_1.default.readFile(planPath, "utf8"));
    if (!plan.sourceScenario || !plan.executionContract)
        throw new Error("REMATERIALIZATION_PLAN_INCOMPLETE");
    if (String(plan.scenario?.caseId ?? "") !== String(args.caseId))
        throw new Error("REMATERIALIZATION_IDENTITY_MISMATCH");
    const automation = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(caseDir, "automation.json"), "utf8"));
    if (automation.appSlug !== args.appSlug || String(automation.caseId) !== String(args.caseId)) {
        throw new Error("REMATERIALIZATION_IDENTITY_MISMATCH");
    }
    const config = (0, app_profile_1.loadPromotedAppConfigSync)({ appSlug: args.appSlug });
    if (!config)
        throw new Error("REMATERIALIZATION_APP_CONFIG_MISSING");
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
        executionContract: (0, spec_execution_contract_1.buildSpecExecutionContract)(plan, sourceScenario, {
            appSlug: args.appSlug,
            sectionSlug: args.sectionSlug,
        }),
    };
    process.env.AI_SPEC_GENERATION_ENABLED = "false";
    process.env.AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED = "false";
    process.env.AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK = "false";
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan: rematerializationPlan,
        sourcePlanPath: planPath,
        source: "manual",
        overwrite: true,
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY,
        appProfileObject: (0, app_profile_1.deriveAppProfile)({
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
async function main() {
    await rematerializePersistedPromotedSpec(parseRematerializationArgs(process.argv.slice(2)));
}
if (process.argv[1] && node_path_1.default.resolve(process.argv[1]) === node_path_1.default.resolve((0, node_url_1.fileURLToPath)(import.meta.url))) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
