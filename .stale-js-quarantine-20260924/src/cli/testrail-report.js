"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const env_1 = require("../config/env");
const testrail_client_1 = require("../clients/testrail.client");
const testrail_reporter_1 = require("../testrail/testrail-reporter");
function parseArgs(argv) {
    let results = "";
    let runName;
    let projectId;
    let suiteId;
    let runDescription;
    let dryRun = false;
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];
        if (token === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (!next || next.startsWith("--")) {
            throw new Error(`Missing value for argument: ${token}`);
        }
        if (token === "--results") {
            results = next;
            i += 1;
            continue;
        }
        if (token === "--run-name") {
            runName = next;
            i += 1;
            continue;
        }
        if (token === "--project-id") {
            projectId = next;
            i += 1;
            continue;
        }
        if (token === "--suite-id") {
            suiteId = next;
            i += 1;
            continue;
        }
        if (token === "--run-description") {
            runDescription = next;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    if (!results) {
        throw new Error("--results is required. Usage: npm run testrail:report -- --results <path>");
    }
    return { results, runName, projectId, suiteId, runDescription, dryRun };
}
function buildDefaultRunName(summary) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const caseIds = summary.results
        .filter((r) => r.scenario.source === "testrail" && r.scenario.caseId != null)
        .map((r) => r.scenario.externalId ?? `C${r.scenario.caseId}`);
    return `Automation Run ${stamp} [${caseIds.join(", ")}]`;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const resolvedResultsPath = node_path_1.default.resolve(args.results);
    const content = await promises_1.default.readFile(resolvedResultsPath, "utf-8");
    const summary = JSON.parse(content);
    console.log(`[testrail:report] Results file: ${resolvedResultsPath}`);
    console.log(`[testrail:report] Plans executed: ${summary.total}`);
    console.log(`[testrail:report] Passed: ${summary.passed}, Failed: ${summary.failed}, Partial: ${summary.partial}, Skipped: ${summary.skipped}`);
    const testrailResults = summary.results.filter((r) => r.scenario.source === "testrail" && r.scenario.caseId != null);
    if (testrailResults.length === 0) {
        throw new Error("No TestRail cases found in results. Only 'testrail' source results can be reported.");
    }
    const testRailRuntimeConfig = (0, env_1.requireTestRailConfig)(env_1.config);
    const client = new testrail_client_1.TestRailClient(testRailRuntimeConfig);
    const projectId = args.projectId ?? env_1.config.integrations.testRail?.projectId;
    if (!projectId) {
        throw new Error("projectId is required. Use --project-id or set TESTRAIL_PROJECT_ID in .env.");
    }
    const suiteId = args.suiteId ?? env_1.config.integrations.testRail?.suiteId;
    const runName = args.runName ?? buildDefaultRunName(summary);
    const output = await (0, testrail_reporter_1.reportToTestRail)(client, {
        resultsSummary: summary,
        projectId,
        suiteId,
        runName,
        runDescription: args.runDescription,
        dryRun: args.dryRun
    });
    console.log("");
    if (output.dryRun) {
        console.log("=== DRY RUN MODE ===");
        console.log(`Run name: ${output.runName}`);
        console.log(`Project ID: ${projectId}`);
        if (suiteId)
            console.log(`Suite ID: ${suiteId}`);
        console.log(`Cases to report: ${output.caseIds.length}`);
        console.log(`Results to send: ${output.resultsCount}`);
        console.log("");
        console.log("Results:");
        for (const r of output.results) {
            console.log(`  ${r.externalId} -> ${r.status} (status_id: ${r.statusId})`);
            if (r.comment) {
                console.log(`    ${r.comment}`);
            }
        }
        console.log("");
        console.log("No TestRun was created. Remove --dry-run to report for real.");
    }
    else {
        console.log("=== REPORT SUCCESSFUL ===");
        console.log(`Run ID: ${output.runId}`);
        console.log(`Run name: ${output.runName}`);
        if (output.runUrl)
            console.log(`Run URL: ${output.runUrl}`);
        console.log(`Results sent: ${output.resultsCount}`);
        console.log("");
        console.log("Results:");
        for (const r of output.results) {
            console.log(`  ${r.externalId} -> ${r.status}`);
        }
    }
}
main()
    .then(() => {
    process.exitCode = 0;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[testrail:report] ${message}`);
    process.exitCode = 1;
});
