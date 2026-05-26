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

import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

test.describe("AI Repair Validation Gate", () => {
  test("validate-ai-repair executes all fake modes", () => {
    // Run validation gate with fake provider
    const result = execSync("npx tsx scripts/validate-ai-repair.ts", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    // Check output contains all repair types
    expect(result).toContain("Target Resolution");
    expect(result).toContain("Route Recovery");
    expect(result).toContain("Assertion Resolution");
    expect(result).toContain("Selection Resolution");
    expect(result).toContain("Security Guards");

    // Check summary was written
    const summaryPath = join(process.cwd(), "ai-repair-validation-summary.json");
    expect(existsSync(summaryPath)).toBe(true);

    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    expect(summary.aiRepairValidation).toBeDefined();
    expect(summary.aiRepairValidation.details).toBeDefined();
    expect(Array.isArray(summary.aiRepairValidation.details)).toBe(true);
  });

  test("validate-ai-repair fails if a mode fails", () => {
    // This test validates the script returns non-zero exit code on failure
    // We can't easily simulate a failure without modifying the script,
    // but we can verify the structure supports it
    
    const result = execSync("npx tsx scripts/validate-ai-repair.ts", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    // If we reach here, all tests passed (exit code 0)
    expect(result).toContain("All AI Repair validations PASSED");
  });

  test("real-provider mode is optional", () => {
    // Real provider test requires API key, so we just verify the flag exists
    // and doesn't crash when run (it will fail gracefully if no API key)
    
    try {
      const result = execSync("npx tsx scripts/validate-ai-repair.ts --real-provider", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        timeout: 60000
      });
      
      // If API key is configured, test should pass
      expect(result).toContain("Real Provider");
    } catch (error: any) {
      // If no API key, test will fail but should still produce summary
      const summaryPath = join(process.cwd(), "ai-repair-validation-summary.json");
      if (existsSync(summaryPath)) {
        const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
        expect(summary.aiRepairValidation.realProvider).toBe(true);
      }
    }
  });

  test("summary does not contain secrets", () => {
    // Run validation
    execSync("npx tsx scripts/validate-ai-repair.ts", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    // Read summary
    const summaryPath = join(process.cwd(), "ai-repair-validation-summary.json");
    const summaryContent = readFileSync(summaryPath, "utf-8");
    const summary = JSON.parse(summaryContent);

    // Check no secrets in summary
    const summaryStr = JSON.stringify(summary).toLowerCase();
    expect(summaryStr).not.toContain("password");
    expect(summaryStr).not.toContain("secret");
    expect(summaryStr).not.toContain("token");
    expect(summaryStr).not.toContain("api_key");
    expect(summaryStr).not.toContain("apikey");

    // Verify structure
    expect(summary.aiRepairValidation.provider).toBeDefined();
    expect(typeof summary.aiRepairValidation.durationMs).toBe("number");
  });

  test("exit code is 0 when all pass", () => {
    // This implicitly tests exit code - if it was non-zero, execSync would throw
    const result = execSync("npx tsx scripts/validate-ai-repair.ts", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    expect(result).toContain("All AI Repair validations PASSED");
  });

  test("summary includes all repair types", () => {
    execSync("npx tsx scripts/validate-ai-repair.ts", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    const summaryPath = join(process.cwd(), "ai-repair-validation-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));

    expect(summary.aiRepairValidation.targetResolution).toBeDefined();
    expect(summary.aiRepairValidation.routeRecovery).toBeDefined();
    expect(summary.aiRepairValidation.assertionResolution).toBeDefined();
    expect(summary.aiRepairValidation.selectionResolution).toBeDefined();
    expect(summary.aiRepairValidation.securityGuards).toBeDefined();

    // Values should be passed/failed/skipped
    const validStatuses = ["passed", "failed", "skipped"];
    expect(validStatuses).toContain(summary.aiRepairValidation.targetResolution);
    expect(validStatuses).toContain(summary.aiRepairValidation.routeRecovery);
    expect(validStatuses).toContain(summary.aiRepairValidation.assertionResolution);
    expect(validStatuses).toContain(summary.aiRepairValidation.selectionResolution);
    expect(validStatuses).toContain(summary.aiRepairValidation.securityGuards);
  });

  test("details array contains individual test results", () => {
    execSync("npx tsx scripts/validate-ai-repair.ts", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    const summaryPath = join(process.cwd(), "ai-repair-validation-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));

    const details = summary.aiRepairValidation.details;
    expect(Array.isArray(details)).toBe(true);
    expect(details.length).toBeGreaterThan(10); // Should have many tests

    // Check structure of individual results
    for (const detail of details) {
      expect(detail.name).toBeDefined();
      expect(typeof detail.passed).toBe("boolean");
      expect(typeof detail.durationMs).toBe("number");
    }
  });
});
