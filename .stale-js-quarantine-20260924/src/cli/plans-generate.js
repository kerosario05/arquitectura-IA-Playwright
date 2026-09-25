"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const plans_1 = require("../plans");
function parseArgs(argv) {
    const args = { includeLogin: false };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--include-login") {
            args.includeLogin = true;
            continue;
        }
        if ((token === "--input" || token === "--output") && (!nextValue || nextValue.startsWith("--"))) {
            throw new Error(`Missing value for ${token}`);
        }
        if (token === "--input") {
            args.input = nextValue;
            i += 1;
            continue;
        }
        if (token === "--output") {
            args.output = nextValue;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function getDefaultOutputPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return node_path_1.default.resolve(`./.artifacts/plans/plans-${stamp}.json`);
}
function parseScenariosPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (typeof payload === "object" && payload !== null) {
        const maybeScenarios = payload.scenarios;
        if (Array.isArray(maybeScenarios)) {
            return maybeScenarios;
        }
    }
    throw new Error("Invalid scenarios input format. Expected TestScenario[] or { scenarios: TestScenario[] }.");
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.input) {
        throw new Error("--input is required. Example: --input ./.artifacts/testrail/scenarios.json");
    }
    const rawContent = await (0, promises_1.readFile)(node_path_1.default.resolve(args.input), "utf-8");
    const parsed = JSON.parse(rawContent);
    const scenarios = parseScenariosPayload(parsed);
    const plans = scenarios.map((scenario) => (0, plans_1.normalizeExecutionPlan)((0, plans_1.generateRuleBasedExecutionPlan)(scenario, { includeLogin: args.includeLogin })));
    const validations = plans.map((plan) => (0, plans_1.validateExecutionPlan)(plan));
    const invalidIndexes = validations
        .map((result, index) => ({ result, index }))
        .filter((item) => !item.result.valid);
    const outputPath = args.output ? node_path_1.default.resolve(args.output) : getDefaultOutputPath();
    await (0, plans_1.writeExecutionPlansToFile)(plans, outputPath);
    console.log(`Scenarios read: ${scenarios.length}`);
    console.log(`Plans generated: ${plans.length}`);
    console.log(`Valid plans: ${plans.length - invalidIndexes.length}`);
    console.log(`Invalid plans: ${invalidIndexes.length}`);
    console.log(`Output file: ${outputPath}`);
    if (invalidIndexes.length > 0) {
        for (const { index, result } of invalidIndexes) {
            console.log(`Plan #${index + 1} issues:`);
            for (const issue of result.issues) {
                console.log(`- [${issue.level}] ${issue.code}: ${issue.message}`);
            }
        }
        return 1;
    }
    return 0;
}
run()
    .then((exitCode) => {
    process.exitCode = exitCode;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:generate] ${message}`);
    process.exitCode = 1;
});
