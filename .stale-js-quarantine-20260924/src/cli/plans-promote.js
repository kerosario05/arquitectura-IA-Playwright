"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const env_1 = require("../config/env");
const automations_1 = require("../automations");
function parseArgs(argv) {
    let plan = "";
    let from;
    let result;
    let source;
    let sectionSlug;
    let overwrite = false;
    let allowDraft = false;
    let requirePomRuntime = false;
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];
        if (token === "--overwrite") {
            overwrite = true;
            continue;
        }
        if (token === "--allow-draft") {
            allowDraft = true;
            continue;
        }
        if (token === "--require-pom-runtime") {
            requirePomRuntime = true;
            continue;
        }
        if (!next || next.startsWith("--")) {
            throw new Error(`Missing value for argument: ${token}`);
        }
        if (token === "--plan") {
            plan = next;
            i += 1;
            continue;
        }
        if (token === "--from") {
            from = next;
            i += 1;
            continue;
        }
        if (token === "--result") {
            result = next;
            i += 1;
            continue;
        }
        if (token === "--source") {
            const validSources = new Set(["agent_handoff", "manual", "rule_based", "discovery"]);
            if (!validSources.has(next)) {
                throw new Error(`Invalid --source '${next}'. Allowed: ${[...validSources].join(", ")}`);
            }
            source = next;
            i += 1;
            continue;
        }
        if (token === "--section") {
            sectionSlug = next;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    if (!plan && !from) {
        throw new Error("--plan or --from is required. Usage: npm run plans:promote -- --plan <path> OR --from <discovery-output-dir>");
    }
    return { plan, from, result, source, sectionSlug, overwrite, allowDraft, requirePomRuntime };
}
function inferSectionSlug(sourcePlanPath) {
    const normalized = node_path_1.default.resolve(sourcePlanPath).split(node_path_1.default.sep);
    const sectionIndex = normalized.findIndex((segment) => segment.toLowerCase() === "sections");
    const sectionSlug = sectionIndex >= 0 ? normalized[sectionIndex + 1] : undefined;
    return sectionSlug && sectionSlug.toLowerCase() !== "cases" ? sectionSlug : undefined;
}
async function loadPlanInput(planArg) {
    const resolved = node_path_1.default.resolve(planArg);
    const content = await promises_1.default.readFile(resolved, "utf-8");
    const parsed = JSON.parse(content);
    const plans = [];
    if (Array.isArray(parsed)) {
        plans.push(...parsed);
    }
    else if (parsed.plans && Array.isArray(parsed.plans)) {
        plans.push(...parsed.plans);
    }
    else if (parsed.version === "1.0") {
        plans.push(parsed);
    }
    else {
        throw new Error("Plan file must be an ExecutionPlan, { plans: [...] }, or [ExecutionPlan, ...]");
    }
    return { plans, sourcePlanPath: resolved };
}
async function loadPlanFromDiscoveryOutput(fromArg) {
    const discoveryDir = node_path_1.default.resolve(fromArg);
    const pendingPath = node_path_1.default.join(discoveryDir, "discovered-plans.pending.json");
    return loadPlanInput(pendingPath);
}
async function promoteAll(plans, sourcePlanPath, resultPath, source, overwrite, allowDraft, requirePomRuntime, sectionSlug) {
    const promoted = [];
    const skipped = [];
    const errors = [];
    for (const plan of plans) {
        const label = plan.scenario.externalId
            ? String(plan.scenario.externalId)
            : plan.scenario.caseId !== undefined
                ? `case-${plan.scenario.caseId}`
                : plan.scenario.title;
        try {
            const entry = await (0, automations_1.promoteExecutionPlan)({
                plan,
                sourcePlanPath,
                lastExecutionResultPath: resultPath ?? undefined,
                source,
                overwrite,
                fullConfig: env_1.config,
                requirePomRuntime,
                sectionSlug
            }, allowDraft);
            const promotionSucceeded = entry.status === "active";
            if (promotionSucceeded) {
                promoted.push(`${label} -> ${entry.id}`);
                console.log(`  [OK] ${label}`);
            }
            else {
                errors.push(`${label}: promotion_not_allowed:${entry.status}`);
                console.log(`  [BLOCKED] ${label}`);
                console.log(`           promotion_not_allowed:${entry.status}`);
            }
            if (entry.appSlug) {
                console.log(`       app:     ${entry.appSlug}`);
            }
            console.log(`       plan:    ${entry.planPath}`);
            console.log(`       spec:    ${entry.specPath}`);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes("already exists") ||
                msg.includes("not eligible") ||
                msg.includes("status is 'draft'")) {
                skipped.push(`${label}: ${msg}`);
                console.log(`  [SKIP] ${label}`);
                console.log(`         ${msg}`);
            }
            else {
                errors.push(`${label}: ${msg}`);
                console.log(`  [ERROR] ${label}`);
                console.log(`          ${msg}`);
            }
        }
    }
    console.log("\nSummary:");
    console.log(`  Promoted: ${promoted.length}`);
    console.log(`  Skipped:  ${skipped.length}`);
    console.log(`  Errors:   ${errors.length}`);
    if (errors.length > 0) {
        console.log("\nErrors:");
        for (const e of errors) {
            console.log(`  - ${e}`);
        }
    }
    return errors.length === 0;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const sourceRef = args.plan ? node_path_1.default.resolve(args.plan) : node_path_1.default.resolve(args.from ?? ".");
    console.log("Loading plan(s) from:", sourceRef);
    const { plans, sourcePlanPath } = args.plan
        ? await loadPlanInput(args.plan)
        : await loadPlanFromDiscoveryOutput(args.from ?? ".");
    console.log(`Found ${plans.length} plan(s)\n`);
    const allPromoted = await promoteAll(plans, sourcePlanPath, args.result, args.source, args.overwrite, args.allowDraft, args.requirePomRuntime, args.sectionSlug ?? inferSectionSlug(sourcePlanPath));
    console.log("\nAutomation index: automations/index.json");
    return allPromoted;
}
main()
    .then((success) => {
    process.exitCode = success ? 0 : 1;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:promote] ${message}`);
    process.exitCode = 1;
});
