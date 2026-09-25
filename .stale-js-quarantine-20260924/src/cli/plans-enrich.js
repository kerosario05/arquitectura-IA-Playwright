"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("../config/env");
const data_1 = require("../data");
const plans_1 = require("../plans");
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];
        if ((token === "--plans" || token === "--snapshot" || token === "--output") && (!next || next.startsWith("--"))) {
            throw new Error(`Missing value for ${token}`);
        }
        if (token === "--plans") {
            args.plans = next;
            i += 1;
            continue;
        }
        if (token === "--snapshot") {
            args.snapshot = next;
            i += 1;
            continue;
        }
        if (token === "--output") {
            args.output = next;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function parsePlansPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (typeof payload === "object" && payload !== null) {
        const plans = payload.plans;
        if (Array.isArray(plans)) {
            return plans;
        }
    }
    throw new Error("Invalid plans file format. Expected ExecutionPlan[] or { plans: ExecutionPlan[] }.");
}
function getDefaultOutputPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return node_path_1.default.resolve(`./.artifacts/plans/enriched-plans-${stamp}.json`);
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.plans || !args.snapshot) {
        throw new Error("--plans and --snapshot are required.");
    }
    const dataContext = (0, data_1.buildDataContext)(env_1.config);
    const plansPayload = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.resolve(args.plans), "utf-8"));
    const snapshot = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.resolve(args.snapshot), "utf-8"));
    const plans = parsePlansPayload(plansPayload);
    const results = plans.map((plan) => (0, plans_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext,
        aliases: env_1.config.app.testDataAliases,
        missingInputBehavior: env_1.config.app.missingInputBehavior
    }));
    const enrichedPlans = results.map((result) => result.plan);
    const outputPath = args.output ? node_path_1.default.resolve(args.output) : getDefaultOutputPath();
    await (0, plans_1.writeExecutionPlansToFile)(enrichedPlans, outputPath);
    const convertedSteps = results.reduce((acc, result) => acc + result.summary.convertedSteps, 0);
    const missingData = results.reduce((acc, result) => acc + result.summary.missingData, 0);
    const needsDiscoveryCount = results.filter((result) => result.summary.needsDiscovery).length;
    let invalid = 0;
    for (const plan of enrichedPlans) {
        if (!(0, plans_1.validateExecutionPlan)(plan).valid) {
            invalid += 1;
        }
    }
    console.log(`Plans read: ${plans.length}`);
    console.log(`Converted steps: ${convertedSteps}`);
    console.log(`Missing data entries: ${missingData}`);
    console.log(`Plans needing discovery: ${needsDiscoveryCount}`);
    console.log(`Output file: ${outputPath}`);
    return invalid > 0 ? 1 : 0;
}
run()
    .then((exitCode) => {
    process.exitCode = exitCode;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:enrich] ${message}`);
    process.exitCode = 1;
});
