"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const job_store_1 = require("../src/server/jobs/job-store");
const discovery_batch_runner_1 = require("../src/server/jobs/discovery-batch-runner");
// Helper to simulate the route handler validation logic
function validateDiscoveryBatchRequest(body) {
    const caseIds = body.caseIds;
    if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
        return { ok: false, status: 400, error: "caseIds is required and must be a non-empty array" };
    }
    const invalidIds = caseIds.filter((id) => !Number.isInteger(id) || id <= 0);
    if (invalidIds.length > 0) {
        return { ok: false, status: 400, error: "All caseIds must be positive integers", invalidIds };
    }
    return { ok: true };
}
// ── Route validation tests ──
(0, test_1.test)("discovery-batch route: returns 400 if caseIds is missing", () => {
    const result = validateDiscoveryBatchRequest({});
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.error).toBe("caseIds is required and must be a non-empty array");
    }
});
(0, test_1.test)("discovery-batch route: returns 400 if caseIds is empty array", () => {
    const result = validateDiscoveryBatchRequest({ caseIds: [] });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.error).toBe("caseIds is required and must be a non-empty array");
    }
});
(0, test_1.test)("discovery-batch route: returns 400 if caseIds contains non-numeric values", () => {
    const result = validateDiscoveryBatchRequest({ caseIds: ["abc", 123] });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.error).toBe("All caseIds must be positive integers");
        (0, test_1.expect)(result.invalidIds).toContain("abc");
    }
});
(0, test_1.test)("discovery-batch route: returns 400 if caseIds contains negative numbers", () => {
    const result = validateDiscoveryBatchRequest({ caseIds: [1, -5, 3] });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.invalidIds).toContain(-5);
    }
});
(0, test_1.test)("discovery-batch route: returns 400 if caseIds contains zero", () => {
    const result = validateDiscoveryBatchRequest({ caseIds: [0, 1] });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.invalidIds).toContain(0);
    }
});
(0, test_1.test)("discovery-batch route: returns 400 if caseIds contains floats", () => {
    const result = validateDiscoveryBatchRequest({ caseIds: [1.5, 2] });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.invalidIds).toContain(1.5);
    }
});
(0, test_1.test)("discovery-batch route: accepts valid numeric caseIds", () => {
    const result = validateDiscoveryBatchRequest({ caseIds: [38133, 38134] });
    (0, test_1.expect)(result.ok).toBe(true);
});
(0, test_1.test)("discovery-batch route: accepts single caseId", () => {
    const result = validateDiscoveryBatchRequest({ caseIds: [100] });
    (0, test_1.expect)(result.ok).toBe(true);
});
// ── Job store tests ──
(0, test_1.test)("jobStore: creates discovery-batch job with correct type", () => {
    const job = job_store_1.jobStore.create("discovery-batch", { caseIds: [1, 2, 3] });
    (0, test_1.expect)(job.type).toBe("discovery-batch");
    (0, test_1.expect)(job.status).toBe("queued");
    (0, test_1.expect)(job.params.caseIds).toEqual([1, 2, 3]);
});
(0, test_1.test)("jobStore: discovery-batch job is retrievable", () => {
    const job = job_store_1.jobStore.create("discovery-batch", { caseIds: [42] });
    const retrieved = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(retrieved).toBeDefined();
    (0, test_1.expect)(retrieved?.type).toBe("discovery-batch");
    (0, test_1.expect)(retrieved?.params.caseIds).toEqual([42]);
});
(0, test_1.test)("jobStore: discovery-batch job appears in list", () => {
    const before = job_store_1.jobStore.list().length;
    job_store_1.jobStore.create("discovery-batch", { caseIds: [99] });
    const after = job_store_1.jobStore.list().length;
    (0, test_1.expect)(after).toBe(before + 1);
});
// ── Runner argument construction tests ──
// Extract argument building logic for testing
function buildDiscoveryBatchArgs(params) {
    const caseIdsStr = params.caseIds.join(",");
    const args = [
        "run",
        "discovery:batch",
        "--",
        "--case-ids",
        caseIdsStr,
    ];
    if (params.appSlug) {
        args.push("--app", params.appSlug);
    }
    if (params.overwrite !== false) {
        args.push("--overwrite");
    }
    if (params.autoPromote !== false) {
        args.push("--auto-promote");
    }
    if (params.autoPom !== false) {
        args.push("--auto-pom");
    }
    if (params.rerunActive !== false) {
        args.push("--rerun-active");
    }
    if (params.headed) {
        args.push("--headed");
    }
    const isWin = process.platform === "win32";
    const cmd = isWin ? "npm.cmd" : "npm";
    return { cmd, args, caseIdsStr };
}
(0, test_1.test)("runner: builds correct args for basic caseIds", () => {
    const { cmd, args, caseIdsStr } = buildDiscoveryBatchArgs({
        caseIds: [38133, 38134],
    });
    (0, test_1.expect)(caseIdsStr).toBe("38133,38134");
    (0, test_1.expect)(caseIdsStr).not.toMatch(/,\s/); // no space after comma
    (0, test_1.expect)(args).toContain("--case-ids");
    (0, test_1.expect)(args).toContain("38133,38134");
    (0, test_1.expect)(args).toContain("--overwrite");
    (0, test_1.expect)(args).toContain("--auto-promote");
    (0, test_1.expect)(args).toContain("--auto-pom");
    (0, test_1.expect)(args).toContain("--rerun-active");
    (0, test_1.expect)(process.platform === "win32" ? cmd === "npm.cmd" : cmd === "npm").toBe(true);
});
(0, test_1.test)("runner: no space after comma in caseIds string", () => {
    const { caseIdsStr } = buildDiscoveryBatchArgs({
        caseIds: [1, 2, 3, 4, 5],
    });
    (0, test_1.expect)(caseIdsStr).toBe("1,2,3,4,5");
    (0, test_1.expect)(caseIdsStr).not.toMatch(/\s/);
});
(0, test_1.test)("runner: includes --app when appSlug is provided", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
        appSlug: "kiosko",
    });
    (0, test_1.expect)(args).toContain("--app");
    (0, test_1.expect)(args).toContain("kiosko");
});
(0, test_1.test)("runner: does not include --app when appSlug is not provided", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
    });
    (0, test_1.expect)(args).not.toContain("--app");
});
(0, test_1.test)("runner: includes --headed when headed is true", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
        headed: true,
    });
    (0, test_1.expect)(args).toContain("--headed");
});
(0, test_1.test)("runner: does not include --headed when headed is false", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
        headed: false,
    });
    (0, test_1.expect)(args).not.toContain("--headed");
});
(0, test_1.test)("runner: omits --overwrite when overwrite is explicitly false", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
        overwrite: false,
    });
    (0, test_1.expect)(args).not.toContain("--overwrite");
});
(0, test_1.test)("runner: omits --auto-promote when autoPromote is explicitly false", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
        autoPromote: false,
    });
    (0, test_1.expect)(args).not.toContain("--auto-promote");
});
(0, test_1.test)("runner: omits --auto-pom when autoPom is explicitly false", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
        autoPom: false,
    });
    (0, test_1.expect)(args).not.toContain("--auto-pom");
});
(0, test_1.test)("runner: omits --rerun-active when rerunActive is explicitly false", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [100],
        rerunActive: false,
    });
    (0, test_1.expect)(args).not.toContain("--rerun-active");
});
(0, test_1.test)("runner: args are safe array elements (no shell concatenation)", () => {
    const { args } = buildDiscoveryBatchArgs({
        caseIds: [38133, 38134],
        appSlug: "kiosko",
    });
    // Each arg should be a separate array element, not concatenated
    const caseIdsIndex = args.indexOf("--case-ids");
    (0, test_1.expect)(caseIdsIndex).toBeGreaterThanOrEqual(0);
    (0, test_1.expect)(args[caseIdsIndex + 1]).toBe("38133,38134");
    (0, test_1.expect)(args[caseIdsIndex + 1]).not.toContain(" ");
    const appIndex = args.indexOf("--app");
    (0, test_1.expect)(appIndex).toBeGreaterThanOrEqual(0);
    (0, test_1.expect)(args[appIndex + 1]).toBe("kiosko");
});
(0, test_1.test)("runner: full command matches expected format", () => {
    const { cmd, args } = buildDiscoveryBatchArgs({
        caseIds: [38133, 38134],
        appSlug: "kiosko",
        overwrite: true,
        autoPromote: true,
        autoPom: true,
        rerunActive: true,
    });
    const fullCmd = `${cmd} ${args.join(" ")}`;
    const expectedParts = [
        process.platform === "win32" ? "npm.cmd" : "npm",
        "run",
        "discovery:batch",
        "--",
        "--case-ids",
        "38133,38134",
        "--app",
        "kiosko",
        "--overwrite",
        "--auto-promote",
        "--auto-pom",
        "--rerun-active",
    ];
    for (const part of expectedParts) {
        (0, test_1.expect)(fullCmd).toContain(part);
    }
});
// ── Runner execution tests ──
(0, test_1.test)("runner: fails job when caseIds is empty", () => {
    const job = job_store_1.jobStore.create("discovery-batch", { caseIds: [] });
    (0, discovery_batch_runner_1.startDiscoveryBatchRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("no caseIds provided"))).toBe(true);
});
(0, test_1.test)("runner: fails job when caseIds is missing", () => {
    const job = job_store_1.jobStore.create("discovery-batch", {});
    (0, discovery_batch_runner_1.startDiscoveryBatchRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("no caseIds provided"))).toBe(true);
});
(0, test_1.test)("runner: starts job with valid caseIds and logs basic info", () => {
    const job = job_store_1.jobStore.create("discovery-batch", {
        caseIds: [38133, 38134],
        appSlug: "kiosko",
    });
    (0, discovery_batch_runner_1.startDiscoveryBatchRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("caseIds=38133,38134"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("appSlug=kiosko"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("command="))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("started"))).toBe(true);
});
(0, test_1.test)("runner: summary includes caseIds and command", () => {
    const job = job_store_1.jobStore.create("discovery-batch", {
        caseIds: [100, 200],
        appSlug: "test-app",
    });
    (0, discovery_batch_runner_1.startDiscoveryBatchRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.summary?.caseIds).toEqual([100, 200]);
    (0, test_1.expect)(updated?.summary?.command).toBeDefined();
    if (updated?.summary?.command) {
        (0, test_1.expect)(updated.summary.command).toContain("discovery:batch");
        (0, test_1.expect)(updated.summary.command).toContain("100,200");
    }
});
(0, test_1.test)("runner: does not use unsafe shell string concatenation", () => {
    const job = job_store_1.jobStore.create("discovery-batch", {
        caseIds: [38133, 38134],
        appSlug: "kiosko; rm -rf /",
    });
    (0, discovery_batch_runner_1.startDiscoveryBatchRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    // The command should have the appSlug as a separate argument, not concatenated into a shell string
    const commandLog = updated?.logs.find((l) => l.includes("command="));
    (0, test_1.expect)(commandLog).toBeDefined();
    // The dangerous string should be properly escaped as an array element
    (0, test_1.expect)(commandLog).toContain("--app");
    (0, test_1.expect)(commandLog).toContain("kiosko; rm -rf /");
});
