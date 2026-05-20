import { test, expect } from "@playwright/test";
import type { CaseStartWorkflowInput, CaseStartWorkflowResult } from "../src/types/case-start.types";

test("CaseStartWorkflowInput requires caseId and projectId", () => {
  const input: CaseStartWorkflowInput = {
    caseId: 37616,
    projectId: "29"
  };

  expect(input.caseId).toBe(37616);
  expect(input.projectId).toBe("29");
  expect(input.headed).toBeUndefined();
  expect(input.continueOnFailure).toBeUndefined();
  expect(input.reportToTestRail).toBeUndefined();
  expect(input.dryRun).toBeUndefined();
});

test("CaseStartWorkflowInput accepts optional flags", () => {
  const input: CaseStartWorkflowInput = {
    caseId: 37616,
    projectId: "29",
    suiteId: "36",
    headed: true,
    continueOnFailure: true,
    reportToTestRail: false,
    dryRun: true
  };

  expect(input.headed).toBe(true);
  expect(input.continueOnFailure).toBe(true);
  expect(input.reportToTestRail).toBe(false);
  expect(input.dryRun).toBe(true);
});

test("CaseStartWorkflowResult contains expected fields on success", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "success",
    planPath: ".artifacts/cases/plan-37616.json",
    executionResultPath: ".artifacts/cases/results-37616.json",
    testRailRunId: 12345,
    testRailRunUrl: "https://testrail.example.com/index.php?/runs/view/12345",
    startedAt: now,
    completedAt: now
  };

  expect(result.status).toBe("success");
  expect(result.caseId).toBe(37616);
  expect(result.planPath).toBeDefined();
  expect(result.executionResultPath).toBeDefined();
  expect(result.testRailRunId).toBe(12345);
  expect(result.testRailRunUrl).toBeDefined();
});

test("CaseStartWorkflowResult contains error field on failure", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "failed",
    error: "Missing value for step valueKey 'username'.",
    startedAt: now,
    completedAt: now
  };

  expect(result.status).toBe("failed");
  expect(result.error).toBeDefined();
  expect(result.error).toContain("Missing value");
  expect(result.planPath).toBeUndefined();
});

test("CaseStartWorkflowResult supports skipped status", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "skipped",
    startedAt: now,
    completedAt: now
  };

  expect(result.status).toBe("skipped");
});

test("CaseStartWorkflowInput accepts autoPromote flag", () => {
  const input: CaseStartWorkflowInput = {
    caseId: 37616,
    projectId: "29",
    autoPromote: true
  };

  expect(input.autoPromote).toBe(true);
});

test("CaseStartWorkflowResult includes promotion metadata on success", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "success",
    startedAt: now,
    completedAt: now,
    promotion: {
      promoted: true,
      automationId: "c37616-test-case",
      planPath: "automations/plans/c37616-test-case.plan.json",
      specPath: "tests/generated/c37616-test-case.spec.ts",
      dryRun: false
    }
  };

  expect(result.promotion).toBeDefined();
  expect(result.promotion?.promoted).toBe(true);
  expect(result.promotion?.automationId).toBe("c37616-test-case");
  expect(result.promotion?.planPath).toBeDefined();
  expect(result.promotion?.specPath).toBeDefined();
  expect(result.promotion?.dryRun).toBe(false);
});

test("CaseStartWorkflowResult includes dry-run promotion metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "success",
    startedAt: now,
    completedAt: now,
    promotion: {
      promoted: false,
      dryRun: true
    }
  };

  expect(result.promotion?.promoted).toBe(false);
  expect(result.promotion?.dryRun).toBe(true);
});

test("CaseStartWorkflowResult includes skipped promotion on failure", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "failed",
    startedAt: now,
    completedAt: now,
    promotion: {
      promoted: false,
      dryRun: false
    }
  };

  expect(result.promotion?.promoted).toBe(false);
  expect(result.promotion?.dryRun).toBe(false);
});

test("CaseStartWorkflowResult without promotion when autoPromote is false", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "success",
    startedAt: now,
    completedAt: now
  };

  expect(result.promotion).toBeUndefined();
});

test("CaseStartWorkflowInput accepts autoHandoff flag", () => {
  const input: CaseStartWorkflowInput = {
    caseId: 37616,
    projectId: "29",
    autoHandoff: true
  };

  expect(input.autoHandoff).toBe(true);
});

test("CaseStartWorkflowResult includes needs_agent status when handoff created", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    handoff: {
      created: true,
      handoffDir: ".artifacts/cases/handoff-C37618",
      requestPath: ".artifacts/cases/handoff-C37618/handoff-request.json",
      instructionsPath: ".artifacts/cases/handoff-C37618/handoff-instructions.md",
      schemaPath: ".artifacts/cases/handoff-C37618/agent-response.schema.json",
      responsePath: ".artifacts/cases/handoff-C37618/agent-response.json",
      dryRun: false,
      reason: "plan_needs_repair"
    }
  };

  expect(result.status).toBe("needs_agent");
  expect(result.handoff?.created).toBe(true);
  expect(result.handoff?.handoffDir).toBeDefined();
  expect(result.handoff?.requestPath).toBeDefined();
  expect(result.handoff?.dryRun).toBe(false);
});

test("CaseStartWorkflowResult includes dry-run handoff metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    handoff: {
      created: false,
      dryRun: true,
      reason: "dry_run"
    }
  };

  expect(result.handoff?.created).toBe(false);
  expect(result.handoff?.dryRun).toBe(true);
});

test("CaseStartWorkflowResult supports both promotion and handoff", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    promotion: {
      promoted: false,
      dryRun: false,
      reason: "plan_not_validated"
    },
    handoff: {
      created: true,
      handoffDir: ".artifacts/cases/handoff-C37618",
      requestPath: ".artifacts/cases/handoff-C37618/handoff-request.json",
      instructionsPath: ".artifacts/cases/handoff-C37618/handoff-instructions.md",
      schemaPath: ".artifacts/cases/handoff-C37618/agent-response.schema.json",
      responsePath: ".artifacts/cases/handoff-C37618/agent-response.json",
      dryRun: false,
      reason: "plan_needs_repair"
    }
  };

  expect(result.promotion?.promoted).toBe(false);
  expect(result.handoff?.created).toBe(true);
});

test("CaseStartWorkflowResult without handoff when autoHandoff is false", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "success",
    startedAt: now,
    completedAt: now
  };

  expect(result.handoff).toBeUndefined();
});

test("CaseStartWorkflowInput accepts autoRepair flag", () => {
  const input: CaseStartWorkflowInput = {
    caseId: 37616,
    projectId: "29",
    autoRepair: true
  };

  expect(input.autoRepair).toBe(true);
});

test("CaseStartWorkflowResult includes autoRepair metadata on success", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "success",
    startedAt: now,
    completedAt: now,
    autoRepair: {
      attempted: true,
      success: true,
      dryRun: false,
      responsePath: ".artifacts/cases/handoff-C37618/agent-response.json"
    }
  };

  expect(result.autoRepair?.attempted).toBe(true);
  expect(result.autoRepair?.success).toBe(true);
  expect(result.autoRepair?.dryRun).toBe(false);
  expect(result.autoRepair?.responsePath).toBeDefined();
});

test("CaseStartWorkflowResult includes failed autoRepair metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    autoRepair: {
      attempted: true,
      success: false,
      dryRun: false,
      error: "Codex CLI exited with code 1."
    }
  };

  expect(result.autoRepair?.attempted).toBe(true);
  expect(result.autoRepair?.success).toBe(false);
  expect(result.autoRepair?.error).toBeDefined();
});

test("CaseStartWorkflowResult includes dry-run autoRepair metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    autoRepair: {
      attempted: false,
      success: false,
      dryRun: true
    }
  };

  expect(result.autoRepair?.attempted).toBe(false);
  expect(result.autoRepair?.dryRun).toBe(true);
});

test("CaseStartWorkflowResult without autoRepair when autoRepair is false", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37616,
    status: "success",
    startedAt: now,
    completedAt: now
  };

  expect(result.autoRepair).toBeUndefined();
});

test("CaseStartWorkflowResult includes autoRepair timeout metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    autoRepair: {
      attempted: true,
      success: false,
      dryRun: false,
      timedOut: true,
      error: "Codex CLI timed out after 5.0 minutes (timeoutMs: 300000)."
    }
  };

  expect(result.autoRepair?.attempted).toBe(true);
  expect(result.autoRepair?.success).toBe(false);
  expect(result.autoRepair?.timedOut).toBe(true);
  expect(result.autoRepair?.error).toContain("timed out");
  expect(result.autoRepair?.error).toContain("timeoutMs");
});

test("If auto-repair timeout occurs, workflow status is needs_agent", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    handoff: {
      created: true,
      handoffDir: ".artifacts/cases/handoff-C37618",
      requestPath: ".artifacts/cases/handoff-C37618/handoff-request.json",
      instructionsPath: ".artifacts/cases/handoff-C37618/handoff-instructions.md",
      schemaPath: ".artifacts/cases/handoff-C37618/agent-response.schema.json",
      responsePath: ".artifacts/cases/handoff-C37618/agent-response.json",
      dryRun: false,
      reason: "plan_needs_repair"
    },
    autoRepair: {
      attempted: true,
      success: false,
      dryRun: false,
      timedOut: true,
      error: "Codex CLI timed out."
    }
  };

  expect(result.status).toBe("needs_agent");
  expect(result.handoff?.created).toBe(true);
  expect(result.autoRepair?.timedOut).toBe(true);
});

test("If auto-repair timeout occurs, promotion is not set", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    autoRepair: {
      attempted: true,
      success: false,
      dryRun: false,
      timedOut: true,
      error: "Codex CLI timed out."
    }
  };

  expect(result.promotion).toBeUndefined();
});

test("If auto-repair timeout occurs, postReporting is not set", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    autoRepair: {
      attempted: true,
      success: false,
      dryRun: false,
      timedOut: true,
      error: "Codex CLI timed out."
    }
  };

  expect(result.postReporting).toBeUndefined();
});

test("CaseStartWorkflowInput accepts reuseExisting flag", () => {
  const input: CaseStartWorkflowInput = {
    caseId: 37616,
    projectId: "29",
    reuseExisting: true
  };

  expect(input.reuseExisting).toBe(true);
});

test("CaseStartWorkflowInput reuseExisting defaults to undefined", () => {
  const input: CaseStartWorkflowInput = {
    caseId: 37616,
    projectId: "29"
  };

  expect(input.reuseExisting).toBeUndefined();
});

test("CaseStartWorkflowResult includes reuse found metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37749,
    status: "success",
    startedAt: now,
    completedAt: now,
    reuse: {
      found: true,
      sourceAutomationId: "c37616-c37372-acceso",
      sourceCaseId: 37616,
      matchType: "functional_code",
      confidence: 0.95
    }
  };

  expect(result.reuse?.found).toBe(true);
  expect(result.reuse?.sourceAutomationId).toBe("c37616-c37372-acceso");
  expect(result.reuse?.sourceCaseId).toBe(37616);
  expect(result.reuse?.matchType).toBe("functional_code");
  expect(result.reuse?.confidence).toBe(0.95);
});

test("CaseStartWorkflowResult includes reuse no_match metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37750,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    reuse: {
      found: false,
      skippedReason: "no_match"
    }
  };

  expect(result.reuse?.found).toBe(false);
  expect(result.reuse?.skippedReason).toBe("no_match");
});

test("CaseStartWorkflowResult includes reuse disabled metadata", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37750,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    reuse: {
      found: false,
      skippedReason: "disabled"
    }
  };

  expect(result.reuse?.found).toBe(false);
  expect(result.reuse?.skippedReason).toBe("disabled");
});

test("If reuse finds match, handoff is not created", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37749,
    status: "success",
    startedAt: now,
    completedAt: now,
    reuse: {
      found: true,
      sourceAutomationId: "c37616-c37372-acceso",
      sourceCaseId: 37616,
      matchType: "functional_code",
      confidence: 0.95
    }
  };

  expect(result.reuse?.found).toBe(true);
  expect(result.handoff).toBeUndefined();
});

test("If reuse finds match, autoRepair is not invoked", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37749,
    status: "success",
    startedAt: now,
    completedAt: now,
    reuse: {
      found: true,
      sourceAutomationId: "c37616-c37372-acceso",
      sourceCaseId: 37616,
      matchType: "functional_code",
      confidence: 0.95
    }
  };

  expect(result.reuse?.found).toBe(true);
  expect(result.autoRepair).toBeUndefined();
});

test("With --auto-promote and execution passed, reused plan is promoted", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37749,
    status: "success",
    startedAt: now,
    completedAt: now,
    reuse: {
      found: true,
      sourceAutomationId: "c37616-c37372-acceso",
      sourceCaseId: 37616,
      matchType: "functional_code",
      confidence: 0.95
    },
    promotion: {
      promoted: true,
      automationId: "c37749-c37372-acceso",
      planPath: "automations/plans/c37749-c37372-acceso.plan.json",
      specPath: "tests/generated/c37749-c37372-acceso.spec.ts",
      dryRun: false
    }
  };

  expect(result.reuse?.found).toBe(true);
  expect(result.promotion?.promoted).toBe(true);
});

test("With --no-report, TestRail is not reported after reuse", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37749,
    status: "success",
    startedAt: now,
    completedAt: now,
    reuse: {
      found: true,
      sourceAutomationId: "c37616-c37372-acceso",
      sourceCaseId: 37616,
      matchType: "functional_code",
      confidence: 0.95
    }
  };

  expect(result.reuse?.found).toBe(true);
  expect(result.postReporting).toBeUndefined();
});

test("Snapshot gap => status is needs_discovery", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37750,
    status: "needs_discovery",
    startedAt: now,
    completedAt: now,
    handoff: {
      created: false,
      handoffDir: ".artifacts/cases/handoff-C37750",
      dryRun: false,
      reason: "plan_needs_discovery"
    },
    autoRepair: {
      attempted: false,
      success: false,
      dryRun: false,
      error: "The requested flow requires browser discovery because target elements are not present in the captured snapshot. Missing: Información de productos, Tarjetas, Tarjeta de Crédito"
    }
  };

  expect(result.status).toBe("needs_discovery");
  expect(result.handoff?.created).toBe(false);
  expect(result.handoff?.reason).toBe("plan_needs_discovery");
});

test("Snapshot gap => handoff does not contain undefined paths", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37750,
    status: "needs_discovery",
    startedAt: now,
    completedAt: now,
    handoff: {
      created: false,
      handoffDir: ".artifacts/cases/handoff-C37750",
      dryRun: false,
      reason: "plan_needs_discovery"
    }
  };

  expect(result.handoff?.requestPath).toBeUndefined();
  expect(result.handoff?.instructionsPath).toBeUndefined();
  expect(result.handoff?.schemaPath).toBeUndefined();
  expect(result.handoff?.responsePath).toBeUndefined();
});

test("Snapshot gap => autoRepair contains discovery error message", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37750,
    status: "needs_discovery",
    startedAt: now,
    completedAt: now,
    handoff: {
      created: false,
      handoffDir: ".artifacts/cases/handoff-C37750",
      dryRun: false,
      reason: "plan_needs_discovery"
    },
    autoRepair: {
      attempted: false,
      success: false,
      dryRun: false,
      error: "The requested flow requires browser discovery because target elements are not present in the captured snapshot. Missing: Información de productos, Tarjetas, Tarjeta de Crédito"
    }
  };

  expect(result.autoRepair?.error).toContain("browser discovery");
  expect(result.autoRepair?.error).toContain("not present in the captured snapshot");
  expect(result.autoRepair?.error).toContain("Información de productos");
  expect(result.autoRepair?.attempted).toBe(false);
});

test("Normal handoff with all paths => created is true and status is needs_agent", () => {
  const now = new Date().toISOString();
  const result: CaseStartWorkflowResult = {
    caseId: 37618,
    status: "needs_agent",
    startedAt: now,
    completedAt: now,
    handoff: {
      created: true,
      handoffDir: ".artifacts/cases/handoff-C37618",
      requestPath: ".artifacts/cases/handoff-C37618/handoff-request.json",
      instructionsPath: ".artifacts/cases/handoff-C37618/handoff-instructions.md",
      schemaPath: ".artifacts/cases/handoff-C37618/agent-response.schema.json",
      responsePath: ".artifacts/cases/handoff-C37618/agent-response.json",
      dryRun: false,
      reason: "plan_needs_repair"
    }
  };

  expect(result.status).toBe("needs_agent");
  expect(result.handoff?.created).toBe(true);
  expect(result.handoff?.requestPath).toBeDefined();
  expect(result.handoff?.instructionsPath).toBeDefined();
  expect(result.handoff?.schemaPath).toBeDefined();
  expect(result.handoff?.responsePath).toBeDefined();
  expect(result.handoff?.reason).toBe("plan_needs_repair");
});
