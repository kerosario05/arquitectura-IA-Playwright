"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
function parseArgs(argv) {
    const args = {
        caseId: 0,
        headed: false,
        continueOnFailure: false,
        noReport: false,
        dryRun: false,
        json: false,
        autoPromote: false,
        autoHandoff: false,
        autoRepair: false,
        reuseExisting: true
    };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--headed") {
            args.headed = true;
            continue;
        }
        if (token === "--continue-on-failure") {
            args.continueOnFailure = true;
            continue;
        }
        if (token === "--no-report") {
            args.noReport = true;
            continue;
        }
        if (token === "--dry-run") {
            args.dryRun = true;
            continue;
        }
        if (token === "--json") {
            args.json = true;
            continue;
        }
        if (token === "--auto-promote" || token === "--promote") {
            args.autoPromote = true;
            continue;
        }
        if (token === "--auto") {
            args.autoHandoff = true;
            args.autoPromote = true;
            continue;
        }
        if (token === "--auto-repair") {
            args.autoRepair = true;
            continue;
        }
        if (token === "--reuse-existing") {
            args.reuseExisting = true;
            continue;
        }
        if (token === "--no-reuse-existing") {
            args.reuseExisting = false;
            continue;
        }
        if ((token === "--case-id" || token === "--project-id" || token === "--suite-id") &&
            (!nextValue || nextValue.startsWith("--"))) {
            throw new Error(`Missing value for ${token}`);
        }
        if (token === "--case-id") {
            args.caseId = Number(nextValue);
            if (!Number.isFinite(args.caseId) || args.caseId <= 0) {
                throw new Error(`Invalid --case-id value: ${nextValue}. Expected a positive integer.`);
            }
            i += 1;
            continue;
        }
        if (token === "--project-id") {
            args.projectId = nextValue;
            i += 1;
            continue;
        }
        if (token === "--suite-id") {
            args.suiteId = nextValue;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    if (args.caseId <= 0) {
        throw new Error("--case-id is required. Usage: npm run cases:start -- --case-id <number>");
    }
    return args;
}
(0, test_1.test)("--auto-promote is parsed correctly", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-promote"]);
    (0, test_1.expect)(args.autoPromote).toBe(true);
});
(0, test_1.test)("--promote is parsed as alias for --auto-promote", () => {
    const args = parseArgs(["--case-id", "37619", "--promote"]);
    (0, test_1.expect)(args.autoPromote).toBe(true);
});
(0, test_1.test)("without --auto-promote, autoPromote is false", () => {
    const args = parseArgs(["--case-id", "37618"]);
    (0, test_1.expect)(args.autoPromote).toBe(false);
});
(0, test_1.test)("--auto-promote combined with --dry-run", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-promote", "--dry-run"]);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.dryRun).toBe(true);
});
(0, test_1.test)("--auto-promote combined with --no-report", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-promote", "--no-report"]);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.noReport).toBe(true);
});
(0, test_1.test)("--promote combined with --dry-run and --no-report", () => {
    const args = parseArgs(["--case-id", "37619", "--promote", "--dry-run", "--no-report"]);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.dryRun).toBe(true);
    (0, test_1.expect)(args.noReport).toBe(true);
});
(0, test_1.test)("all flags together work correctly", () => {
    const args = parseArgs([
        "--case-id", "37618",
        "--headed",
        "--auto-promote",
        "--no-report",
        "--dry-run",
        "--json"
    ]);
    (0, test_1.expect)(args.caseId).toBe(37618);
    (0, test_1.expect)(args.headed).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.noReport).toBe(true);
    (0, test_1.expect)(args.dryRun).toBe(true);
    (0, test_1.expect)(args.json).toBe(true);
});
(0, test_1.test)("--auto enables both autoHandoff and autoPromote", () => {
    const args = parseArgs(["--case-id", "37618", "--auto"]);
    (0, test_1.expect)(args.autoHandoff).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
});
(0, test_1.test)("--auto combined with --dry-run", () => {
    const args = parseArgs(["--case-id", "37618", "--auto", "--dry-run"]);
    (0, test_1.expect)(args.autoHandoff).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.dryRun).toBe(true);
});
(0, test_1.test)("--auto combined with --no-report", () => {
    const args = parseArgs(["--case-id", "37618", "--auto", "--no-report"]);
    (0, test_1.expect)(args.autoHandoff).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.noReport).toBe(true);
});
(0, test_1.test)("--auto combined with all other flags", () => {
    const args = parseArgs([
        "--case-id", "37618",
        "--auto",
        "--headed",
        "--no-report",
        "--dry-run",
        "--json"
    ]);
    (0, test_1.expect)(args.autoHandoff).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.headed).toBe(true);
    (0, test_1.expect)(args.noReport).toBe(true);
    (0, test_1.expect)(args.dryRun).toBe(true);
    (0, test_1.expect)(args.json).toBe(true);
});
(0, test_1.test)("without --auto, autoHandoff is false", () => {
    const args = parseArgs(["--case-id", "37618"]);
    (0, test_1.expect)(args.autoHandoff).toBe(false);
});
(0, test_1.test)("--auto-promote alone does not enable autoHandoff", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-promote"]);
    (0, test_1.expect)(args.autoHandoff).toBe(false);
    (0, test_1.expect)(args.autoPromote).toBe(true);
});
(0, test_1.test)("--auto-repair is parsed correctly", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-repair"]);
    (0, test_1.expect)(args.autoRepair).toBe(true);
});
(0, test_1.test)("--auto-repair does not enable autoHandoff or autoPromote", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-repair"]);
    (0, test_1.expect)(args.autoRepair).toBe(true);
    (0, test_1.expect)(args.autoHandoff).toBe(false);
    (0, test_1.expect)(args.autoPromote).toBe(false);
});
(0, test_1.test)("--auto-repair combined with --auto and --auto-promote", () => {
    const args = parseArgs(["--case-id", "37618", "--auto", "--auto-repair"]);
    (0, test_1.expect)(args.autoRepair).toBe(true);
    (0, test_1.expect)(args.autoHandoff).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
});
(0, test_1.test)("--auto-repair combined with --dry-run", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-repair", "--dry-run"]);
    (0, test_1.expect)(args.autoRepair).toBe(true);
    (0, test_1.expect)(args.dryRun).toBe(true);
});
(0, test_1.test)("--auto-repair combined with --no-report", () => {
    const args = parseArgs(["--case-id", "37618", "--auto-repair", "--no-report"]);
    (0, test_1.expect)(args.autoRepair).toBe(true);
    (0, test_1.expect)(args.noReport).toBe(true);
});
(0, test_1.test)("without --auto-repair, autoRepair is false", () => {
    const args = parseArgs(["--case-id", "37618"]);
    (0, test_1.expect)(args.autoRepair).toBe(false);
});
(0, test_1.test)("reuseExisting is true by default", () => {
    const args = parseArgs(["--case-id", "37618"]);
    (0, test_1.expect)(args.reuseExisting).toBe(true);
});
(0, test_1.test)("--reuse-existing is parsed correctly", () => {
    const args = parseArgs(["--case-id", "37618", "--reuse-existing"]);
    (0, test_1.expect)(args.reuseExisting).toBe(true);
});
(0, test_1.test)("--no-reuse-existing is parsed correctly", () => {
    const args = parseArgs(["--case-id", "37618", "--no-reuse-existing"]);
    (0, test_1.expect)(args.reuseExisting).toBe(false);
});
(0, test_1.test)("--auto enables reuseExisting by default", () => {
    const args = parseArgs(["--case-id", "37618", "--auto"]);
    (0, test_1.expect)(args.reuseExisting).toBe(true);
});
(0, test_1.test)("--no-reuse-existing combined with --auto", () => {
    const args = parseArgs(["--case-id", "37618", "--auto", "--no-reuse-existing"]);
    (0, test_1.expect)(args.autoHandoff).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.reuseExisting).toBe(false);
});
function formatHandoffOutput(handoff, autoRepair) {
    const lines = [];
    if (handoff.dryRun) {
        lines.push("[cases:start] Dry-run: would create agent handoff if plan was not validated.");
    }
    else if (handoff.reason === "plan_needs_discovery") {
        lines.push("");
        lines.push("=== SNAPSHOT GAP DETECTED ===");
        if (handoff.handoffDir) {
            lines.push(`Handoff directory: ${handoff.handoffDir}`);
        }
        lines.push("");
        lines.push("The requested flow requires browser discovery because target elements are not present in the captured snapshot.");
        lines.push("Codex cannot resolve locators for elements not visible in the snapshot without executing Playwright.");
        lines.push("");
        lines.push("Next steps:");
        lines.push("");
        lines.push(`npm.cmd run discovery:case -- --case-id ${handoff.handoffDir?.split("handoff-C")[1] ?? "37750"} --headed`);
    }
    else if (handoff.created && !autoRepair?.attempted) {
        const hasAllPaths = handoff.requestPath
            && handoff.instructionsPath
            && handoff.schemaPath
            && handoff.responsePath;
        if (!hasAllPaths) {
            lines.push("");
            lines.push("[cases:start] Handoff was created but some file paths are missing. Check the handoff directory for available files.");
            if (handoff.handoffDir) {
                lines.push(`Handoff directory: ${handoff.handoffDir}`);
            }
        }
        else {
            lines.push("");
            lines.push("=== AGENT HANDOFF PREPARED ===");
            lines.push(`Handoff directory: ${handoff.handoffDir}`);
            lines.push(`Request: ${handoff.requestPath}`);
            lines.push(`Instructions: ${handoff.instructionsPath}`);
            lines.push(`Schema: ${handoff.schemaPath}`);
            lines.push(`Response template: ${handoff.responsePath}`);
            lines.push("");
            lines.push("Next steps:");
            lines.push("");
            lines.push("1. Have Codex fill in the response template:");
            lines.push(`   Open ${handoff.instructionsPath} in VS Code with Codex`);
            lines.push("");
            lines.push("2. Validate the agent response and generate repaired plans:");
            lines.push(`   npm.cmd run agent:validate -- --response "${handoff.responsePath}" --request "${handoff.requestPath}" --output-plans .artifacts/plans/agent-plans.json`);
            lines.push("");
            lines.push("3. Execute the repaired plans:");
            lines.push(`   npm.cmd run plans:execute -- --plans .artifacts/plans/agent-plans.json --headed`);
        }
    }
    return lines.join("\n");
}
(0, test_1.test)("snapshot gap => does not print AGENT HANDOFF PREPARED", () => {
    const handoff = {
        created: false,
        handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
        dryRun: false,
        reason: "plan_needs_discovery"
    };
    const output = formatHandoffOutput(handoff);
    (0, test_1.expect)(output).not.toContain("AGENT HANDOFF PREPARED");
    (0, test_1.expect)(output).toContain("SNAPSHOT GAP DETECTED");
});
(0, test_1.test)("snapshot gap => does not print undefined paths", () => {
    const handoff = {
        created: false,
        handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
        dryRun: false,
        reason: "plan_needs_discovery"
    };
    const output = formatHandoffOutput(handoff);
    (0, test_1.expect)(output).not.toContain("undefined");
    (0, test_1.expect)(output).not.toContain("Request: undefined");
    (0, test_1.expect)(output).not.toContain("Instructions: undefined");
    (0, test_1.expect)(output).not.toContain("Schema: undefined");
    (0, test_1.expect)(output).not.toContain("Response template: undefined");
});
(0, test_1.test)("snapshot gap => status needs_discovery message is shown", () => {
    const handoff = {
        created: false,
        handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
        dryRun: false,
        reason: "plan_needs_discovery"
    };
    const output = formatHandoffOutput(handoff);
    (0, test_1.expect)(output).toContain("browser discovery");
    (0, test_1.expect)(output).toContain("target elements are not present in the captured snapshot");
    (0, test_1.expect)(output).toContain("Codex cannot resolve locators");
});
(0, test_1.test)("snapshot gap => next steps suggest discovery:case not Codex", () => {
    const handoff = {
        created: false,
        handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
        dryRun: false,
        reason: "plan_needs_discovery"
    };
    const output = formatHandoffOutput(handoff);
    (0, test_1.expect)(output).toContain("discovery:case");
    (0, test_1.expect)(output).toContain("--case-id 37750");
    (0, test_1.expect)(output).not.toContain("agent:validate");
    (0, test_1.expect)(output).not.toContain("Have Codex fill in");
});
(0, test_1.test)("normal handoff with all paths prints real paths", () => {
    const handoff = {
        created: true,
        handoffDir: "C:\\artifacts\\cases\\handoff-C37618",
        requestPath: "C:\\artifacts\\cases\\handoff-C37618\\handoff-request.json",
        instructionsPath: "C:\\artifacts\\cases\\handoff-C37618\\handoff-instructions.md",
        schemaPath: "C:\\artifacts\\cases\\handoff-C37618\\agent-response.schema.json",
        responsePath: "C:\\artifacts\\cases\\handoff-C37618\\agent-response.json",
        dryRun: false,
        reason: "plan_needs_repair"
    };
    const output = formatHandoffOutput(handoff);
    (0, test_1.expect)(output).toContain("AGENT HANDOFF PREPARED");
    (0, test_1.expect)(output).toContain("handoff-request.json");
    (0, test_1.expect)(output).toContain("handoff-instructions.md");
    (0, test_1.expect)(output).toContain("agent-response.schema.json");
    (0, test_1.expect)(output).toContain("agent-response.json");
    (0, test_1.expect)(output).not.toContain("undefined");
});
(0, test_1.test)("handoff with missing paths shows error not undefined", () => {
    const handoff = {
        created: true,
        handoffDir: "C:\\artifacts\\cases\\handoff-C37618",
        dryRun: false,
        reason: "plan_needs_repair"
    };
    const output = formatHandoffOutput(handoff);
    (0, test_1.expect)(output).not.toContain("undefined");
    (0, test_1.expect)(output).toContain("some file paths are missing");
    (0, test_1.expect)(output).toContain("handoff-C37618");
});
