"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("../config/env");
const testrail_client_1 = require("../clients/testrail.client");
const testrail_normalizer_1 = require("../testrail/testrail-normalizer");
const scenario_writer_1 = require("../testrail/scenario-writer");
function parseCaseIds(value) {
    const ids = value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => Number(part));
    if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        throw new Error("Invalid --case-ids. Use comma-separated positive integers, e.g. 123,124,125.");
    }
    return ids;
}
function parseArgs(argv) {
    const args = {
        includeRaw: false,
        testConnection: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--include-raw") {
            args.includeRaw = true;
            continue;
        }
        if (token === "--test-connection") {
            args.testConnection = true;
            continue;
        }
        if (!nextValue || nextValue.startsWith("--")) {
            throw new Error(`Missing value for argument: ${token}`);
        }
        if (token === "--case-ids") {
            args.caseIds = parseCaseIds(nextValue);
            i += 1;
            continue;
        }
        if (token === "--project-id") {
            args.projectId = nextValue.trim();
            i += 1;
            continue;
        }
        if (token === "--suite-id") {
            args.suiteId = nextValue.trim();
            i += 1;
            continue;
        }
        if (token === "--section-id") {
            args.sectionId = nextValue.trim();
            i += 1;
            continue;
        }
        if (token === "--output") {
            args.output = nextValue.trim();
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function buildDefaultOutputPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return node_path_1.default.resolve(`./.artifacts/testrail/scenarios-${stamp}.json`);
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const testRailRuntimeConfig = (0, env_1.requireTestRailConfig)(env_1.config);
    const client = new testrail_client_1.TestRailClient(testRailRuntimeConfig);
    if (args.testConnection) {
        const result = await client.testConnection();
        console.log(`TestRail connection: ${result.ok ? "ok" : "failed"}`);
        if (result.userEmail) {
            console.log(`Authenticated user email: ${result.userEmail}`);
        }
        return;
    }
    let rawCases;
    if (args.caseIds && args.caseIds.length > 0) {
        rawCases = await client.getCasesByIds(args.caseIds);
    }
    else {
        const projectId = args.projectId || env_1.config.integrations.testRail?.projectId;
        const suiteId = args.suiteId || env_1.config.integrations.testRail?.suiteId;
        const sectionId = args.sectionId || env_1.config.integrations.testRail?.sectionId;
        if (!projectId) {
            throw new Error("projectId is required. Use --project-id or set TESTRAIL_PROJECT_ID in .env.");
        }
        rawCases = await client.getCases(projectId, suiteId, sectionId);
    }
    const scenarios = (0, testrail_normalizer_1.normalizeTestRailCases)(rawCases);
    const outputPath = args.output ? node_path_1.default.resolve(args.output) : buildDefaultOutputPath();
    await (0, scenario_writer_1.writeScenariosToFile)(scenarios, outputPath, { includeRaw: args.includeRaw });
    console.log("TestRail inspection completed");
    console.log(`Cases fetched: ${rawCases.length}`);
    console.log(`Scenarios normalized: ${scenarios.length}`);
    console.log(`Output file: ${outputPath}`);
}
main()
    .then(() => {
    process.exitCode = 0;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[testrail:inspect] ${message}`);
    process.exitCode = 1;
});
