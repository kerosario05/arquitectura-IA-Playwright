/**
 * AI Repair Validation Gate
 * 
 * Validates all AI Repair repair types before running real cases.
 * Executes smoke tests for:
 * - target_resolution (via test-ai-repair-runtime.ts)
 * - route_recovery
 * - assertion_resolution
 * - selection_resolution
 * 
 * Usage:
 *   npx tsx scripts/validate-ai-repair.ts
 *   npx tsx scripts/validate-ai-repair.ts --real-provider
 * 
 * Exit codes:
 *   0 - All validations passed
 *   1 - One or more validations failed
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

type ValidationResult = {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
};

type ValidationSummary = {
  aiRepairValidation: {
    provider: string;
    realProvider: boolean;
    targetResolution: "passed" | "failed" | "skipped";
    routeRecovery: "passed" | "failed" | "skipped";
    assertionResolution: "passed" | "failed" | "skipped";
    selectionResolution: "passed" | "failed" | "skipped";
    securityGuards: "passed" | "failed" | "skipped";
    durationMs: number;
    details: ValidationResult[];
  };
};

function runCommand(command: string, description: string): { success: boolean; output: string; durationMs: number } {
  console.log(`\n>>> Running: ${description}`);
  console.log(`    Command: ${command}`);
  
  const start = Date.now();
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    }).trim();
    const durationMs = Date.now() - start;
    console.log(`    Duration: ${durationMs}ms`);
    return { success: true, output, durationMs };
  } catch (error: any) {
    const durationMs = Date.now() - start;
    const output = error.stdout?.toString() ?? error.message;
    console.log(`    Failed after ${durationMs}ms`);
    return { success: false, output, durationMs };
  }
}

async function runFakeProviderTests(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  // Target resolution tests
  const targetModes = [
    "repaired_plan_valid",
    "no_safe_action",
    "invalid_json",
    "unknown_candidate",
    "invented_selector",
    "sensitive_candidate"
  ];
  
  for (const mode of targetModes) {
    const result = runCommand(
      `npx tsx scripts/test-ai-repair-runtime.ts --mode ${mode}`,
      `Target Resolution: ${mode}`
    );
    results.push({
      name: `target_resolution:${mode}`,
      passed: result.success,
      durationMs: result.durationMs,
      error: result.success ? undefined : result.output.slice(-200)
    });
  }
  
  // Route recovery tests
  const routeModes = [
    "route_recovery_valid",
    "route_recovery_no_safe_action",
    "route_recovery_failed_candidate"
  ];
  
  for (const mode of routeModes) {
    const result = runCommand(
      `npx tsx scripts/test-ai-repair-runtime.ts --mode ${mode}`,
      `Route Recovery: ${mode}`
    );
    results.push({
      name: `route_recovery:${mode}`,
      passed: result.success,
      durationMs: result.durationMs,
      error: result.success ? undefined : result.output.slice(-200)
    });
  }
  
  // Assertion resolution tests
  const assertionModes = [
    "assertion_resolution_valid",
    "assertion_resolution_no_safe_action",
    "assertion_resolution_unknown_evidence",
    "assertion_resolution_sensitive_evidence"
  ];
  
  for (const mode of assertionModes) {
    const result = runCommand(
      `npx tsx scripts/test-ai-repair-runtime.ts --mode ${mode}`,
      `Assertion Resolution: ${mode}`
    );
    results.push({
      name: `assertion_resolution:${mode}`,
      passed: result.success,
      durationMs: result.durationMs,
      error: result.success ? undefined : result.output.slice(-200)
    });
  }
  
  // Selection resolution tests
  const selectionModes = [
    "selection_resolution_valid",
    "selection_resolution_no_safe_action",
    "selection_resolution_unknown_candidate",
    "selection_resolution_sensitive_candidate"
  ];
  
  for (const mode of selectionModes) {
    const result = runCommand(
      `npx tsx scripts/test-ai-repair-runtime.ts --mode ${mode}`,
      `Selection Resolution: ${mode}`
    );
    results.push({
      name: `selection_resolution:${mode}`,
      passed: result.success,
      durationMs: result.durationMs,
      error: result.success ? undefined : result.output.slice(-200)
    });
  }
  
  return results;
}

async function runRealProviderTest(): Promise<ValidationResult> {
  const result = runCommand(
    "npx tsx scripts/test-ai-repair-runtime.ts --real-provider",
    "Real Provider Test (Gemini)"
  );
  
  return {
    name: "real_provider:gemini",
    passed: result.success,
    durationMs: result.durationMs,
    error: result.success ? undefined : result.output.slice(-200)
  };
}

function assessCategory(results: ValidationResult[], category: string): "passed" | "failed" | "skipped" {
  const categoryResults = results.filter(r => r.name.startsWith(category));
  if (categoryResults.length === 0) return "skipped";
  const allPassed = categoryResults.every(r => r.passed);
  return allPassed ? "passed" : "failed";
}

function assessSecurityGuards(results: ValidationResult[]): "passed" | "failed" | "skipped" {
  const securityTests = [
    "target_resolution:invented_selector",
    "target_resolution:sensitive_candidate",
    "assertion_resolution:assertion_resolution_sensitive_evidence",
    "selection_resolution:selection_resolution_sensitive_candidate"
  ];
  
  const securityResults = results.filter(r => securityTests.some(s => r.name.includes(s)));
  if (securityResults.length === 0) return "skipped";
  const allPassed = securityResults.every(r => r.passed);
  return allPassed ? "passed" : "failed";
}

async function main() {
  const args = process.argv.slice(2);
  const realProvider = args.includes("--real-provider");
  
  console.log("\n" + "=".repeat(70));
  console.log("AI REPAIR VALIDATION GATE");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Mode: ${realProvider ? "real-provider" : "fake-provider"}`);
  console.log(`AI_PROVIDER: ${process.env.AI_PROVIDER ?? "undefined"}`);
  console.log(`AI_REPAIR_ENABLED: ${process.env.AI_REPAIR_ENABLED ?? "undefined"}`);
  console.log(`AI_MODEL: ${process.env.AI_MODEL ?? "undefined"}`);
  
  const startTime = Date.now();
  const allResults: ValidationResult[] = [];
  
  // Run fake provider tests (always)
  const fakeResults = await runFakeProviderTests();
  allResults.push(...fakeResults);
  
  // Run real provider test (optional)
  let realResult: ValidationResult | null = null;
  if (realProvider) {
    realResult = await runRealProviderTest();
    allResults.push(realResult);
  }
  
  const totalDurationMs = Date.now() - startTime;
  
  // Build summary
  const summary: ValidationSummary = {
    aiRepairValidation: {
      provider: process.env.AI_PROVIDER_NAME ?? process.env.AI_PROVIDER ?? "unknown",
      realProvider,
      targetResolution: assessCategory(allResults, "target_resolution"),
      routeRecovery: assessCategory(allResults, "route_recovery"),
      assertionResolution: assessCategory(allResults, "assertion_resolution"),
      selectionResolution: assessCategory(allResults, "selection_resolution"),
      securityGuards: assessSecurityGuards(allResults),
      durationMs: totalDurationMs,
      details: allResults
    }
  };
  
  // Print summary
  console.log("\n" + "=".repeat(70));
  console.log("VALIDATION SUMMARY");
  console.log("=".repeat(70));
  console.log(`Provider: ${summary.aiRepairValidation.provider}`);
  console.log(`Real Provider: ${summary.aiRepairValidation.realProvider}`);
  console.log(`Target Resolution: ${summary.aiRepairValidation.targetResolution}`);
  console.log(`Route Recovery: ${summary.aiRepairValidation.routeRecovery}`);
  console.log(`Assertion Resolution: ${summary.aiRepairValidation.assertionResolution}`);
  console.log(`Selection Resolution: ${summary.aiRepairValidation.selectionResolution}`);
  console.log(`Security Guards: ${summary.aiRepairValidation.securityGuards}`);
  console.log(`Total Duration: ${totalDurationMs}ms`);
  
  console.log("\nDetailed Results:");
  for (const result of allResults) {
    const icon = result.passed ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${result.name} (${result.durationMs}ms)`);
  }
  
  const passed = allResults.filter(r => r.passed).length;
  const total = allResults.length;
  console.log(`\nTotal: ${passed}/${total} passed`);
  
  // Write JSON summary
  const summaryPath = join(process.cwd(), "ai-repair-validation-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nJSON summary written to: ${summaryPath}`);
  
  // Print JSON for CI/CD
  console.log("\n" + "=".repeat(70));
  console.log("JSON SUMMARY");
  console.log("=".repeat(70));
  console.log(JSON.stringify(summary.aiRepairValidation, null, 2));
  
  // Determine exit code
  const allPassed = allResults.every(r => r.passed);
  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  
  if (allPassed) {
    console.log("\n✅ All AI Repair validations PASSED");
    process.exit(0);
  } else {
    console.log("\n❌ Some AI Repair validations FAILED");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
