"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const agent_1 = require("../agent");
const plans_1 = require("../plans");
function extractAvailableDataKeys(request) {
    const entries = request.dataContextSummary?.availableKeys;
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries
        .map((entry) => (typeof entry === "string" ? entry : entry?.key))
        .filter((key) => typeof key === "string" && key.trim().length > 0);
}
function printHelp() {
    console.log(`Usage: agent:validate [options]

Options:
  --response <path>       Path to agent-response.json file (required unless --handoff-dir is used)
  --request <path>        Path to handoff-request.json file (optional, provides data context)
  --output-plans <path>   Path to write validated plans
  --handoff-dir <path>    Path to handoff directory. Automatically resolves:
                            <dir>/agent-response.json
                            <dir>/handoff-request.json
  --help, -h              Show this help message

Examples:
  npm run agent:validate -- --response .artifacts/agent/handoff/agent-response.json
  npm run agent:validate -- --handoff-dir .artifacts/agent/handoff-2026-05-20
  npm run agent:validate -- --response response.json --request request.json --output-plans plans.json
`);
}
function parseArgs(argv) {
    const args = { help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];
        if (token === "--help" || token === "-h") {
            args.help = true;
            continue;
        }
        const requiresValue = ["--response", "--request", "--output-plans", "--handoff-dir"];
        if (requiresValue.includes(token) && (!next || next.startsWith("--"))) {
            throw new Error(`Missing value for ${token}`);
        }
        if (token === "--response") {
            args.response = next;
            i += 1;
            continue;
        }
        if (token === "--request") {
            args.request = next;
            i += 1;
            continue;
        }
        if (token === "--output-plans") {
            args.outputPlans = next;
            i += 1;
            continue;
        }
        if (token === "--handoff-dir") {
            args.handoffDir = next;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return 0;
    }
    let responsePath = args.response;
    let requestPath = args.request;
    if (args.handoffDir) {
        const dir = node_path_1.default.resolve(args.handoffDir);
        responsePath = responsePath ?? node_path_1.default.join(dir, "agent-response.json");
        requestPath = requestPath ?? node_path_1.default.join(dir, "handoff-request.json");
    }
    if (!responsePath) {
        throw new Error("--response or --handoff-dir is required.");
    }
    const absoluteResponsePath = node_path_1.default.resolve(responsePath);
    const responseRaw = JSON.parse(await (0, promises_1.readFile)(absoluteResponsePath, "utf-8"));
    const response = (0, agent_1.repairAgentHandoffResponse)(responseRaw);
    if (response !== responseRaw) {
        await (0, promises_1.writeFile)(absoluteResponsePath, JSON.stringify(response, null, 2), "utf-8");
    }
    let availableDataKeys;
    if (requestPath) {
        try {
            const request = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.resolve(requestPath), "utf-8"));
            availableDataKeys = extractAvailableDataKeys(request);
        }
        catch {
            // Request file may not exist, that's OK
        }
    }
    const validation = (0, agent_1.validateAgentHandoffResponse)(response, { availableDataKeys });
    const typed = response;
    const plansCount = Array.isArray(typed.plans) ? typed.plans.length : 0;
    const proposedObjectsCount = Array.isArray(typed.proposedObjects) ? typed.proposedObjects.length : 0;
    const unresolvedCount = Array.isArray(typed.unresolvedQuestions) ? typed.unresolvedQuestions.length : 0;
    const rationaleCount = Array.isArray(typed.rationale) ? typed.rationale.length : 0;
    console.log(`Valid: ${validation.valid}`);
    console.log(`Plans: ${plansCount}`);
    console.log(`Proposed objects: ${proposedObjectsCount}`);
    console.log(`Unresolved questions: ${unresolvedCount}`);
    console.log(`Rationale: ${rationaleCount}`);
    if (plansCount === 0 && proposedObjectsCount === 0 && unresolvedCount === 0 && rationaleCount === 0) {
        console.log("");
        console.log("WARNING: agent-response.json was found but is not actionable.");
        console.log("All sections are empty. The agent did not produce any useful output.");
    }
    if (validation.issues.length > 0) {
        for (const issue of validation.issues) {
            console.log(`- [${issue.level}] ${issue.code}: ${issue.message}${issue.planIndex !== undefined ? ` (plan ${issue.planIndex})` : ""}`);
        }
    }
    if (!validation.valid) {
        return 1;
    }
    for (const plan of typed.plans) {
        (0, plans_1.assertValidExecutionPlan)(plan);
    }
    if (args.outputPlans) {
        await (0, plans_1.writeExecutionPlansToFile)(typed.plans, node_path_1.default.resolve(args.outputPlans));
        console.log(`Output plans path: ${node_path_1.default.resolve(args.outputPlans)}`);
    }
    return 0;
}
run()
    .then((code) => {
    process.exitCode = code;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[agent:validate] ${message}`);
    process.exitCode = 1;
});
