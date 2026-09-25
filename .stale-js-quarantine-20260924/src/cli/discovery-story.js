"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("../config/env");
const env_2 = require("../config/env");
const jira_client_1 = require("../clients/jira.client");
const jira_normalizer_1 = require("../jira/jira-normalizer");
const case_discovery_workflow_1 = require("../discovery/case-discovery-workflow");
const app_profile_1 = require("../automations/app-profile");
function parseArgs(argv) {
    const args = {
        issueKey: "",
        app: undefined,
        headed: false,
        autoPromote: false,
        promotionDryRun: false,
        overwrite: false,
        autoPom: false,
        autoPomThreshold: undefined,
        noAutoPomValidation: false,
        verifyPromotedSpec: false,
        promotedSpecTimeoutMs: undefined,
        requirePomRuntime: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--headed") {
            args.headed = true;
            continue;
        }
        if (token === "--auto-promote") {
            args.autoPromote = true;
            continue;
        }
        if (token === "--promotion-dry-run") {
            args.promotionDryRun = true;
            continue;
        }
        if (token === "--overwrite") {
            args.overwrite = true;
            continue;
        }
        if (token === "--auto-pom") {
            args.autoPom = true;
            continue;
        }
        if (token === "--no-auto-pom-validation") {
            args.noAutoPomValidation = true;
            continue;
        }
        if (token === "--verify-promoted-spec") {
            args.verifyPromotedSpec = true;
            continue;
        }
        if (token === "--require-pom-runtime") {
            args.requirePomRuntime = true;
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
        if (token === "--app") {
            args.app = nextValue.trim();
            i += 1;
            continue;
        }
        if (token === "--output") {
            args.output = nextValue.trim();
            i += 1;
            continue;
        }
        if (token === "--auto-pom-threshold") {
            const n = Number(nextValue);
            if (!Number.isFinite(n) || n < 0 || n > 1) {
                throw new Error(`Invalid --auto-pom-threshold value: ${nextValue}. Expected a number between 0 and 1.`);
            }
            args.autoPomThreshold = n;
            i += 1;
            continue;
        }
        if (token === "--promoted-spec-timeout-ms") {
            const n = Number(nextValue);
            if (!Number.isFinite(n) || n <= 0) {
                throw new Error(`Invalid --promoted-spec-timeout-ms value: ${nextValue}. Expected a positive number.`);
            }
            args.promotedSpecTimeoutMs = n;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    if (!args.issueKey) {
        throw new Error("--issue-key is required. Usage: npm run discovery:story -- --issue-key <KEY>");
    }
    return args;
}
async function resolveAndEnsureApp(args) {
    const envAppSlug = process.env.APP_SLUG;
    const { profile, baseDir } = await (0, app_profile_1.resolveAppProfile)({
        cliAppSlug: args.app,
        envAppSlug,
        baseUrl: env_1.config.app.baseUrl,
        appName: env_1.config.app.name
    });
    const ensured = await (0, app_profile_1.ensureAppStructure)(baseDir);
    (0, app_profile_1.logAppProfile)(profile, baseDir, ensured.length > 0 ? ensured : undefined);
    return profile;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    console.log(`[discovery:story] Starting story-driven discovery for ${args.issueKey}...`);
    const jiraConfig = (0, env_2.requireJiraConfig)(env_1.config);
    const client = new jira_client_1.JiraClient(jiraConfig);
    console.log(`[discovery:story] Fetching Jira issue ${args.issueKey}...`);
    const rawIssue = await client.getIssue(args.issueKey);
    const scenario = (0, jira_normalizer_1.normalizeJiraIssue)(rawIssue, {
        acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField
    });
    console.log(`[discovery:story] Scenario: "${scenario.title}" — ${scenario.steps.length} step(s)`);
    const appProfile = await resolveAndEnsureApp(args);
    const workflowOptions = {
        scenario,
        headed: args.headed,
        outputDir: args.output,
        autoPromote: args.autoPromote,
        promotionDryRun: args.promotionDryRun,
        promotionStrict: false,
        requirePromotionApproval: false,
        pageObjectMode: true,
        allowPageObjectCandidates: true,
        overwrite: args.overwrite,
        autoPom: args.autoPom,
        autoPomThreshold: args.autoPomThreshold,
        noAutoPomValidation: args.noAutoPomValidation,
        verifyPromotedSpec: args.verifyPromotedSpec,
        promotedSpecTimeoutMs: args.promotedSpecTimeoutMs,
        requirePomRuntime: args.requirePomRuntime,
        config: env_1.config,
        appProfile
    };
    const workflowResult = await (0, case_discovery_workflow_1.runCaseDiscoveryWorkflow)(workflowOptions);
    (0, case_discovery_workflow_1.printCaseDiscoverySummary)(workflowResult.caseResult, workflowResult);
    if (workflowResult.caseResult.status === "exploration_failed") {
        process.exitCode = 1;
    }
}
const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("discovery-story.ts");
if (isMainModule) {
    main()
        .then(() => {
        process.exitCode = 0;
    })
        .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[discovery:story] ${message}`);
        process.exitCode = 1;
    });
}
