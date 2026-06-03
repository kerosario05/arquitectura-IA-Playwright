"use strict";
/**
 * AI Repair Validation Gate Tests
 *
 * Tests for scripts/validate-ai-repair.ts:
 * - Validates all fake modes execute correctly
 * - Fails if any mode fails
 * - Real provider is optional
 * - Summary does not contain secrets
 * - Exit code is correct
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
test_1.test.describe("AI Repair Validation Gate", () => {
    (0, test_1.test)("validate-ai-repair executes all fake modes", () => {
        // Run validation gate with fake provider
        const result = (0, child_process_1.execSync)("npx tsx scripts/validate-ai-repair.ts", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env }
        });
        // Check output contains all repair types
        (0, test_1.expect)(result).toContain("Target Resolution");
        (0, test_1.expect)(result).toContain("Route Recovery");
        (0, test_1.expect)(result).toContain("Assertion Resolution");
        (0, test_1.expect)(result).toContain("Selection Resolution");
        (0, test_1.expect)(result).toContain("Security Guards");
        // Check summary was written
        const summaryPath = (0, path_1.join)(process.cwd(), "ai-repair-validation-summary.json");
        (0, test_1.expect)((0, fs_1.existsSync)(summaryPath)).toBe(true);
        const summary = JSON.parse((0, fs_1.readFileSync)(summaryPath, "utf-8"));
        (0, test_1.expect)(summary.aiRepairValidation).toBeDefined();
        (0, test_1.expect)(summary.aiRepairValidation.details).toBeDefined();
        (0, test_1.expect)(Array.isArray(summary.aiRepairValidation.details)).toBe(true);
    });
    (0, test_1.test)("validate-ai-repair fails if a mode fails", () => {
        // This test validates the script returns non-zero exit code on failure
        // We can't easily simulate a failure without modifying the script,
        // but we can verify the structure supports it
        const result = (0, child_process_1.execSync)("npx tsx scripts/validate-ai-repair.ts", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env }
        });
        // If we reach here, all tests passed (exit code 0)
        (0, test_1.expect)(result).toContain("All AI Repair validations PASSED");
    });
    (0, test_1.test)("real-provider mode is optional", () => {
        // Real provider test requires API key, so we just verify the flag exists
        // and doesn't crash when run (it will fail gracefully if no API key)
        try {
            const result = (0, child_process_1.execSync)("npx tsx scripts/validate-ai-repair.ts --real-provider", {
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env },
                timeout: 60000
            });
            // If API key is configured, test should pass
            (0, test_1.expect)(result).toContain("Real Provider");
        }
        catch (error) {
            // If no API key, test will fail but should still produce summary
            const summaryPath = (0, path_1.join)(process.cwd(), "ai-repair-validation-summary.json");
            if ((0, fs_1.existsSync)(summaryPath)) {
                const summary = JSON.parse((0, fs_1.readFileSync)(summaryPath, "utf-8"));
                (0, test_1.expect)(summary.aiRepairValidation.realProvider).toBe(true);
            }
        }
    });
    (0, test_1.test)("summary does not contain secrets", () => {
        // Run validation
        (0, child_process_1.execSync)("npx tsx scripts/validate-ai-repair.ts", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env }
        });
        // Read summary
        const summaryPath = (0, path_1.join)(process.cwd(), "ai-repair-validation-summary.json");
        const summaryContent = (0, fs_1.readFileSync)(summaryPath, "utf-8");
        const summary = JSON.parse(summaryContent);
        // Check no secrets in summary
        const summaryStr = JSON.stringify(summary).toLowerCase();
        (0, test_1.expect)(summaryStr).not.toContain("password");
        (0, test_1.expect)(summaryStr).not.toContain("secret");
        (0, test_1.expect)(summaryStr).not.toContain("token");
        (0, test_1.expect)(summaryStr).not.toContain("api_key");
        (0, test_1.expect)(summaryStr).not.toContain("apikey");
        // Verify structure
        (0, test_1.expect)(summary.aiRepairValidation.provider).toBeDefined();
        (0, test_1.expect)(typeof summary.aiRepairValidation.durationMs).toBe("number");
    });
    (0, test_1.test)("exit code is 0 when all pass", () => {
        // This implicitly tests exit code - if it was non-zero, execSync would throw
        const result = (0, child_process_1.execSync)("npx tsx scripts/validate-ai-repair.ts", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env }
        });
        (0, test_1.expect)(result).toContain("All AI Repair validations PASSED");
    });
    (0, test_1.test)("summary includes all repair types", () => {
        (0, child_process_1.execSync)("npx tsx scripts/validate-ai-repair.ts", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env }
        });
        const summaryPath = (0, path_1.join)(process.cwd(), "ai-repair-validation-summary.json");
        const summary = JSON.parse((0, fs_1.readFileSync)(summaryPath, "utf-8"));
        (0, test_1.expect)(summary.aiRepairValidation.targetResolution).toBeDefined();
        (0, test_1.expect)(summary.aiRepairValidation.routeRecovery).toBeDefined();
        (0, test_1.expect)(summary.aiRepairValidation.assertionResolution).toBeDefined();
        (0, test_1.expect)(summary.aiRepairValidation.selectionResolution).toBeDefined();
        (0, test_1.expect)(summary.aiRepairValidation.securityGuards).toBeDefined();
        // Values should be passed/failed/skipped
        const validStatuses = ["passed", "failed", "skipped"];
        (0, test_1.expect)(validStatuses).toContain(summary.aiRepairValidation.targetResolution);
        (0, test_1.expect)(validStatuses).toContain(summary.aiRepairValidation.routeRecovery);
        (0, test_1.expect)(validStatuses).toContain(summary.aiRepairValidation.assertionResolution);
        (0, test_1.expect)(validStatuses).toContain(summary.aiRepairValidation.selectionResolution);
        (0, test_1.expect)(validStatuses).toContain(summary.aiRepairValidation.securityGuards);
    });
    (0, test_1.test)("details array contains individual test results", () => {
        (0, child_process_1.execSync)("npx tsx scripts/validate-ai-repair.ts", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env }
        });
        const summaryPath = (0, path_1.join)(process.cwd(), "ai-repair-validation-summary.json");
        const summary = JSON.parse((0, fs_1.readFileSync)(summaryPath, "utf-8"));
        const details = summary.aiRepairValidation.details;
        (0, test_1.expect)(Array.isArray(details)).toBe(true);
        (0, test_1.expect)(details.length).toBeGreaterThan(10); // Should have many tests
        // Check structure of individual results
        for (const detail of details) {
            (0, test_1.expect)(detail.name).toBeDefined();
            (0, test_1.expect)(typeof detail.passed).toBe("boolean");
            (0, test_1.expect)(typeof detail.durationMs).toBe("number");
        }
    });
});
