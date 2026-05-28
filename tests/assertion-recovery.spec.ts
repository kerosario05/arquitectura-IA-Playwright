/**
 * Assertion Recovery Tests
 * 
 * Tests for transient assertion failure recovery.
 * Verifies that assertions that fail temporarily but are recovered later
 * don't block promotion.
 */

import { test, expect } from "@playwright/test";
import { evaluatePromotionGate } from "../src/automations/promotion-gate";
import type { CaseDiscoveryResult, DiscoveryStepResult } from "../src/types/discovery.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

test.describe("Assertion Recovery - Promotion Gate", () => {
  function createDiscoveryResult(steps: DiscoveryStepResult[], status: string = "discovered_passed"): CaseDiscoveryResult {
    return {
      version: "1.0",
      caseId: 12345,
      caseTitle: "Test Case",
      discoveredAt: new Date().toISOString(),
      status: status as any,
      steps,
      discoveredObjects: [],
      pendingObjectsPath: undefined,
      pendingPlansPath: undefined,
      evidenceDir: ".artifacts/test",
      failedAtStep: undefined,
      failedTarget: undefined,
      failedReason: undefined,
      aiRepairSummary: {
        enabled: false,
        invocations: 0,
        providerName: null,
        model: null,
        decisionCounts: {
          repaired_plan: 0,
          no_safe_action: 0,
          needs_more_context: 0,
          invalid_response: 0,
          provider_error: 0,
          provider_disabled: 0
        },
        validationCounts: {
          valid: 0,
          blocked: 0,
          invalid: 0,
          error: 0
        },
        repairTypeCounts: {
          target_resolution: 0,
          route_recovery: 0,
          assertion_resolution: 0,
          pom_method_missing: 0,
          selection_resolution: 0,
          missing_intermediate_step: 0,
          unknown: 0
        },
        appliedRepairs: 0,
        blockedRepairs: 0,
        avgDurationMs: 0,
        maxDurationMs: 0,
        targets: []
      }
    };
  }

  function createPlan(steps: DiscoveryStepResult[], status: ExecutionPlan["status"] = "validated"): ExecutionPlan {
    return {
      version: "1.0",
      source: "discovery_generated",
      status,
      scenario: { source: "testrail", caseId: 12345, title: "Test" },
      requiredData: [],
      steps: steps.map(s => ({
        index: s.index,
        action: s.action as any,
        description: s.targetText,
        target: s.targetText ? { strategy: "text" as const, value: s.targetText } : undefined
      })),
      createdAt: new Date().toISOString()
    };
  }

  test("recovered assertion (recoveryStatus=recovered) is not blocking", () => {
    const steps: DiscoveryStepResult[] = [
      {
        index: 1,
        action: "click",
        status: "found",
        targetText: "Home"
      },
      {
        index: 2,
        action: "assertVisible",
        status: "not_found",
        targetText: "Target X",
        error: "Not visible",
        assertionClassification: "literal_observable",
        recoveryStatus: "recovered",
        recoveredBy: "later_success",
        recoveryMetadata: {
          originalFailureReason: "Not visible",
          recoveredAfterStep: 3,
          recoveredBecause: "target_used_successfully_later",
          blocking: false
        }
      },
      {
        index: 3,
        action: "click",
        status: "found",
        targetText: "Target X"
      }
    ];

    const result = createDiscoveryResult(steps);
    const plan = createPlan(steps);

    const gate = evaluatePromotionGate({
      discoveryResult: result,
      candidatePlan: plan
    });

    // Should be allowed because assertion was recovered
    expect(gate.allowed).toBe(true);
    expect(gate.status).toBe("passed");
    expect(gate.reasons).toEqual([]);
  });

  test("unrecovered assertion (status=not_found) is blocking", () => {
    const steps: DiscoveryStepResult[] = [
      {
        index: 1,
        action: "click",
        status: "found",
        targetText: "Home"
      },
      {
        index: 2,
        action: "assertVisible",
        status: "not_found",
        targetText: "Target X",
        error: "Not visible",
        assertionClassification: "literal_observable"
      },
      {
        index: 3,
        action: "click",
        status: "found",
        targetText: "Target Y"
      }
    ];

    const result = createDiscoveryResult(steps);
    // Use needs_discovery status to indicate unrecovered failures
    const plan = createPlan(steps, "needs_discovery");

    const gate = evaluatePromotionGate({
      discoveryResult: result,
      candidatePlan: plan
    });

    // Should be blocked because Target X was never recovered and plan status is needs_discovery
    expect(gate.allowed).toBe(false);
    expect(gate.status).toBe("blocked");
    expect(gate.reasons.some(r => r.includes("Blocking"))).toBe(true);
  });

  test("recovered assertion with recoveredBy=auth_flow is not blocking", () => {
    const steps: DiscoveryStepResult[] = [
      {
        index: 1,
        action: "click",
        status: "found",
        targetText: "Login"
      },
      {
        index: 2,
        action: "assertVisible",
        status: "not_found",
        targetText: "Dashboard",
        error: "Not visible before auth",
        assertionClassification: "literal_observable",
        recoveryStatus: "recovered",
        recoveredBy: "auth_flow",
        recoveryMetadata: {
          originalFailureReason: "Not visible before auth",
          recoveredAfterStep: 3,
          recoveredBecause: "auth_gate_completed",
          blocking: false
        }
      },
      {
        index: 3,
        action: "click",
        status: "found",
        targetText: "Dashboard",
        recoveredBy: "auth_flow"
      }
    ];

    const result = createDiscoveryResult(steps);
    const plan = createPlan(steps);

    const gate = evaluatePromotionGate({
      discoveryResult: result,
      candidatePlan: plan
    });

    // Should be allowed because assertion was recovered by auth_flow
    expect(gate.allowed).toBe(true);
    expect(gate.status).toBe("passed");
  });

  test("recoveryMetadata preserves original failure for diagnostics", () => {
    const steps: DiscoveryStepResult[] = [
      {
        index: 1,
        action: "assertVisible",
        status: "not_found",
        targetText: "Target X",
        error: "Original failure message",
        assertionClassification: "literal_observable",
        recoveryStatus: "recovered",
        recoveredBy: "auth_flow",
        recoveryMetadata: {
          originalFailureReason: "Original failure message",
          recoveredAfterStep: 2,
          recoveredBecause: "auth_gate_completed",
          blocking: false
        }
      },
      {
        index: 2,
        action: "click",
        status: "found",
        targetText: "Target X",
        recoveredBy: "auth_flow"
      }
    ];

    const result = createDiscoveryResult(steps);
    const recoveredStep = result.steps[0];

    expect(recoveredStep.recoveryMetadata?.originalFailureReason).toBe("Original failure message");
    expect(recoveredStep.recoveryMetadata?.recoveredAfterStep).toBe(2);
    expect(recoveredStep.recoveryMetadata?.recoveredBecause).toBe("auth_gate_completed");
    expect(recoveredStep.recoveryMetadata?.blocking).toBe(false);
  });
});
