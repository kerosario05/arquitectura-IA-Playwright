"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const env_1 = require("../config/env");
const data_1 = require("../data");
const registry_1 = require("../registry");
const agent_1 = require("../agent");
function parseArgs(argv) {
    const args = { kind: "plan_repair" };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];
        if ((token.startsWith("--") && token !== "--kind") && (!next || next.startsWith("--"))) {
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
        if (token === "--scenario") {
            args.scenario = next;
            i += 1;
            continue;
        }
        if (token === "--goal") {
            args.goal = next;
            i += 1;
            continue;
        }
        if (token === "--output-dir") {
            args.outputDir = next;
            i += 1;
            continue;
        }
        if (token === "--kind") {
            if (!next || next.startsWith("--")) {
                throw new Error("Missing value for --kind");
            }
            args.kind = next;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function parseArrayOrWrapped(payload, key) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (typeof payload === "object" && payload !== null && Array.isArray(payload[key])) {
        return payload[key];
    }
    throw new Error(`Invalid file format. Expected array or { ${key}: [] }.`);
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.goal || !args.goal.trim()) {
        throw new Error("--goal is required.");
    }
    const dataContext = (0, data_1.buildDataContext)(env_1.config);
    const objectRegistry = await (0, registry_1.loadObjectRegistry)();
    let currentPlan;
    if (args.plans) {
        const payload = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.resolve(args.plans), "utf-8"));
        const plans = parseArrayOrWrapped(payload, "plans");
        if (plans.length > 1) {
            console.log("Multiple plans detected. Using first plan for this handoff phase.");
        }
        currentPlan = plans[0];
    }
    let scenario;
    if (args.scenario) {
        const payload = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.resolve(args.scenario), "utf-8"));
        const scenarios = parseArrayOrWrapped(payload, "scenarios");
        if (scenarios.length > 1) {
            console.log("Multiple scenarios detected. Using first scenario for this handoff phase.");
        }
        scenario = scenarios[0];
    }
    let snapshot;
    if (args.snapshot) {
        snapshot = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.resolve(args.snapshot), "utf-8"));
    }
    const request = (0, agent_1.buildAgentHandoffRequest)({
        kind: args.kind,
        goal: args.goal,
        scenario,
        currentPlan,
        snapshot,
        objectRegistry,
        dataContext
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = args.outputDir ? node_path_1.default.resolve(args.outputDir) : node_path_1.default.resolve(`./.artifacts/agent/handoff-${stamp}`);
    const result = await (0, agent_1.writeAgentHandoffPackage)({ request, outputDir });
    console.log(`Request path: ${result.requestPath}`);
    console.log(`Instructions path: ${result.instructionsPath}`);
    console.log(`Schema path: ${result.schemaPath}`);
    console.log(`Response template path: ${result.responsePath}`);
}
run()
    .then(() => {
    process.exitCode = 0;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[agent:prepare] ${message}`);
    process.exitCode = 1;
});
