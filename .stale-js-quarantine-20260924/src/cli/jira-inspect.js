"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("../config/env");
const jira_client_1 = require("../clients/jira.client");
const jira_normalizer_1 = require("../jira/jira-normalizer");
const scenario_writer_1 = require("../testrail/scenario-writer");
function parseArgs(argv) {
    const args = {
        maxResults: 50,
        testConnection: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--test-connection") {
            args.testConnection = true;
            continue;
        }
        if (!nextValue || nextValue.startsWith("--")) {
            throw new Error(`Missing value for argument: ${token}`);
        }
        if (token === "--issue-key") {
            args.issueKey = nextValue.trim().toUpperCase();
            i += 1;
            continue;
        }
        if (token === "--jql") {
            args.jql = nextValue.trim();
            i += 1;
            continue;
        }
        if (token === "--max-results") {
            const n = Number(nextValue);
            if (!Number.isFinite(n) || n <= 0) {
                throw new Error(`Invalid --max-results value: ${nextValue}. Expected a positive integer.`);
            }
            args.maxResults = n;
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
    return node_path_1.default.resolve(`./.artifacts/jira/scenarios-${stamp}.json`);
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const jiraConfig = (0, env_1.requireJiraConfig)(env_1.config);
    const client = new jira_client_1.JiraClient(jiraConfig);
    if (args.testConnection) {
        const result = await client.testConnection();
        console.log(`Jira connection: ${result.ok ? "ok" : "failed"}`);
        if (result.displayName)
            console.log(`Authenticated user: ${result.displayName}`);
        if (result.email)
            console.log(`User email: ${result.email}`);
        return;
    }
    let rawIssues;
    if (args.issueKey) {
        const issue = await client.getIssue(args.issueKey);
        rawIssues = [issue];
    }
    else {
        const jql = args.jql || jiraConfig.defaultJql;
        if (!jql) {
            throw new Error("A --jql query or --issue-key is required. Alternatively set JIRA_JQL in .env.");
        }
        rawIssues = await client.searchIssues(jql, undefined, args.maxResults);
    }
    const scenarios = (0, jira_normalizer_1.normalizeJiraIssues)(rawIssues, {
        acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField
    });
    const outputPath = args.output ? node_path_1.default.resolve(args.output) : buildDefaultOutputPath();
    await (0, scenario_writer_1.writeScenariosToFile)(scenarios, outputPath);
    console.log("Jira inspection completed");
    console.log(`Issues fetched: ${rawIssues.length}`);
    console.log(`Scenarios normalized: ${scenarios.length}`);
    console.log(`Output file: ${outputPath}`);
}
main()
    .then(() => {
    process.exitCode = 0;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[jira:inspect] ${message}`);
    process.exitCode = 1;
});
