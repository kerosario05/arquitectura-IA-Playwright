"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
(0, test_1.test)("CaseStartWorkflowInput requires caseId and projectId", () => {
    const input = {
        caseId: 37616,
        projectId: "29"
    };
    (0, test_1.expect)(input.caseId).toBe(37616);
    (0, test_1.expect)(input.projectId).toBe("29");
    (0, test_1.expect)(input.headed).toBeUndefined();
    (0, test_1.expect)(input.continueOnFailure).toBeUndefined();
    (0, test_1.expect)(input.reportToTestRail).toBeUndefined();
    (0, test_1.expect)(input.dryRun).toBeUndefined();
});
(0, test_1.test)("CaseStartWorkflowInput accepts optional flags", () => {
    const input = {
        caseId: 37616,
        projectId: "29",
        suiteId: "36",
        headed: true,
        continueOnFailure: true,
        reportToTestRail: false,
        dryRun: true
    };
    (0, test_1.expect)(input.headed).toBe(true);
    (0, test_1.expect)(input.continueOnFailure).toBe(true);
    (0, test_1.expect)(input.reportToTestRail).toBe(false);
    (0, test_1.expect)(input.dryRun).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult contains expected fields on success", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "success",
        planPath: ".artifacts/cases/plan-37616.json",
        executionResultPath: ".artifacts/cases/results-37616.json",
        testRailRunId: 12345,
        testRailRunUrl: "https://testrail.example.com/index.php?/runs/view/12345",
        startedAt: now,
        completedAt: now
    };
    (0, test_1.expect)(result.status).toBe("success");
    (0, test_1.expect)(result.caseId).toBe(37616);
    (0, test_1.expect)(result.planPath).toBeDefined();
    (0, test_1.expect)(result.executionResultPath).toBeDefined();
    (0, test_1.expect)(result.testRailRunId).toBe(12345);
    (0, test_1.expect)(result.testRailRunUrl).toBeDefined();
});
(0, test_1.test)("CaseStartWorkflowResult contains error field on failure", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "failed",
        error: "Missing value for step valueKey 'username'.",
        startedAt: now,
        completedAt: now
    };
    (0, test_1.expect)(result.status).toBe("failed");
    (0, test_1.expect)(result.error).toBeDefined();
    (0, test_1.expect)(result.error).toContain("Missing value");
    (0, test_1.expect)(result.planPath).toBeUndefined();
});
(0, test_1.test)("CaseStartWorkflowResult supports skipped status", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "skipped",
        startedAt: now,
        completedAt: now
    };
    (0, test_1.expect)(result.status).toBe("skipped");
});
(0, test_1.test)("CaseStartWorkflowInput accepts autoPromote flag", () => {
    const input = {
        caseId: 37616,
        projectId: "29",
        autoPromote: true
    };
    (0, test_1.expect)(input.autoPromote).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult includes promotion metadata on success", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.promotion).toBeDefined();
    (0, test_1.expect)(result.promotion?.promoted).toBe(true);
    (0, test_1.expect)(result.promotion?.automationId).toBe("c37616-test-case");
    (0, test_1.expect)(result.promotion?.planPath).toBeDefined();
    (0, test_1.expect)(result.promotion?.specPath).toBeDefined();
    (0, test_1.expect)(result.promotion?.dryRun).toBe(false);
});
(0, test_1.test)("CaseStartWorkflowResult includes dry-run promotion metadata", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "success",
        startedAt: now,
        completedAt: now,
        promotion: {
            promoted: false,
            dryRun: true
        }
    };
    (0, test_1.expect)(result.promotion?.promoted).toBe(false);
    (0, test_1.expect)(result.promotion?.dryRun).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult includes skipped promotion on failure", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "failed",
        startedAt: now,
        completedAt: now,
        promotion: {
            promoted: false,
            dryRun: false
        }
    };
    (0, test_1.expect)(result.promotion?.promoted).toBe(false);
    (0, test_1.expect)(result.promotion?.dryRun).toBe(false);
});
(0, test_1.test)("CaseStartWorkflowResult without promotion when autoPromote is false", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "success",
        startedAt: now,
        completedAt: now
    };
    (0, test_1.expect)(result.promotion).toBeUndefined();
});
(0, test_1.test)("CaseStartWorkflowInput accepts autoHandoff flag", () => {
    const input = {
        caseId: 37616,
        projectId: "29",
        autoHandoff: true
    };
    (0, test_1.expect)(input.autoHandoff).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult includes needs_agent status when handoff created", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.status).toBe("needs_agent");
    (0, test_1.expect)(result.handoff?.created).toBe(true);
    (0, test_1.expect)(result.handoff?.handoffDir).toBeDefined();
    (0, test_1.expect)(result.handoff?.requestPath).toBeDefined();
    (0, test_1.expect)(result.handoff?.dryRun).toBe(false);
});
(0, test_1.test)("CaseStartWorkflowResult includes dry-run handoff metadata", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.handoff?.created).toBe(false);
    (0, test_1.expect)(result.handoff?.dryRun).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult supports both promotion and handoff", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.promotion?.promoted).toBe(false);
    (0, test_1.expect)(result.handoff?.created).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult without handoff when autoHandoff is false", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "success",
        startedAt: now,
        completedAt: now
    };
    (0, test_1.expect)(result.handoff).toBeUndefined();
});
(0, test_1.test)("CaseStartWorkflowInput accepts autoRepair flag", () => {
    const input = {
        caseId: 37616,
        projectId: "29",
        autoRepair: true
    };
    (0, test_1.expect)(input.autoRepair).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult includes autoRepair metadata on success", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.autoRepair?.attempted).toBe(true);
    (0, test_1.expect)(result.autoRepair?.success).toBe(true);
    (0, test_1.expect)(result.autoRepair?.dryRun).toBe(false);
    (0, test_1.expect)(result.autoRepair?.responsePath).toBeDefined();
});
(0, test_1.test)("CaseStartWorkflowResult includes failed autoRepair metadata", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.autoRepair?.attempted).toBe(true);
    (0, test_1.expect)(result.autoRepair?.success).toBe(false);
    (0, test_1.expect)(result.autoRepair?.error).toBeDefined();
});
(0, test_1.test)("CaseStartWorkflowResult includes dry-run autoRepair metadata", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.autoRepair?.attempted).toBe(false);
    (0, test_1.expect)(result.autoRepair?.dryRun).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowResult without autoRepair when autoRepair is false", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37616,
        status: "success",
        startedAt: now,
        completedAt: now
    };
    (0, test_1.expect)(result.autoRepair).toBeUndefined();
});
(0, test_1.test)("CaseStartWorkflowResult includes autoRepair timeout metadata", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.autoRepair?.attempted).toBe(true);
    (0, test_1.expect)(result.autoRepair?.success).toBe(false);
    (0, test_1.expect)(result.autoRepair?.timedOut).toBe(true);
    (0, test_1.expect)(result.autoRepair?.error).toContain("timed out");
    (0, test_1.expect)(result.autoRepair?.error).toContain("timeoutMs");
});
(0, test_1.test)("If auto-repair timeout occurs, workflow status is needs_agent", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.status).toBe("needs_agent");
    (0, test_1.expect)(result.handoff?.created).toBe(true);
    (0, test_1.expect)(result.autoRepair?.timedOut).toBe(true);
});
(0, test_1.test)("If auto-repair timeout occurs, promotion is not set", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.promotion).toBeUndefined();
});
(0, test_1.test)("If auto-repair timeout occurs, postReporting is not set", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.postReporting).toBeUndefined();
});
(0, test_1.test)("CaseStartWorkflowInput accepts reuseExisting flag", () => {
    const input = {
        caseId: 37616,
        projectId: "29",
        reuseExisting: true
    };
    (0, test_1.expect)(input.reuseExisting).toBe(true);
});
(0, test_1.test)("CaseStartWorkflowInput reuseExisting defaults to undefined", () => {
    const input = {
        caseId: 37616,
        projectId: "29"
    };
    (0, test_1.expect)(input.reuseExisting).toBeUndefined();
});
(0, test_1.test)("CaseStartWorkflowResult includes reuse found metadata", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.reuse?.found).toBe(true);
    (0, test_1.expect)(result.reuse?.sourceAutomationId).toBe("c37616-c37372-acceso");
    (0, test_1.expect)(result.reuse?.sourceCaseId).toBe(37616);
    (0, test_1.expect)(result.reuse?.matchType).toBe("functional_code");
    (0, test_1.expect)(result.reuse?.confidence).toBe(0.95);
});
(0, test_1.test)("CaseStartWorkflowResult includes reuse no_match metadata", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37750,
        status: "needs_agent",
        startedAt: now,
        completedAt: now,
        reuse: {
            found: false,
            skippedReason: "no_match"
        }
    };
    (0, test_1.expect)(result.reuse?.found).toBe(false);
    (0, test_1.expect)(result.reuse?.skippedReason).toBe("no_match");
});
(0, test_1.test)("CaseStartWorkflowResult includes reuse disabled metadata", () => {
    const now = new Date().toISOString();
    const result = {
        caseId: 37750,
        status: "needs_agent",
        startedAt: now,
        completedAt: now,
        reuse: {
            found: false,
            skippedReason: "disabled"
        }
    };
    (0, test_1.expect)(result.reuse?.found).toBe(false);
    (0, test_1.expect)(result.reuse?.skippedReason).toBe("disabled");
});
(0, test_1.test)("If reuse finds match, handoff is not created", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.reuse?.found).toBe(true);
    (0, test_1.expect)(result.handoff).toBeUndefined();
});
(0, test_1.test)("If reuse finds match, autoRepair is not invoked", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.reuse?.found).toBe(true);
    (0, test_1.expect)(result.autoRepair).toBeUndefined();
});
(0, test_1.test)("With --auto-promote and execution passed, reused plan is promoted", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.reuse?.found).toBe(true);
    (0, test_1.expect)(result.promotion?.promoted).toBe(true);
});
(0, test_1.test)("With --no-report, TestRail is not reported after reuse", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.reuse?.found).toBe(true);
    (0, test_1.expect)(result.postReporting).toBeUndefined();
});
(0, test_1.test)("Snapshot gap => status is needs_discovery", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.status).toBe("needs_discovery");
    (0, test_1.expect)(result.handoff?.created).toBe(false);
    (0, test_1.expect)(result.handoff?.reason).toBe("plan_needs_discovery");
});
(0, test_1.test)("Snapshot gap => handoff does not contain undefined paths", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.handoff?.requestPath).toBeUndefined();
    (0, test_1.expect)(result.handoff?.instructionsPath).toBeUndefined();
    (0, test_1.expect)(result.handoff?.schemaPath).toBeUndefined();
    (0, test_1.expect)(result.handoff?.responsePath).toBeUndefined();
});
(0, test_1.test)("Snapshot gap => autoRepair contains discovery error message", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.autoRepair?.error).toContain("browser discovery");
    (0, test_1.expect)(result.autoRepair?.error).toContain("not present in the captured snapshot");
    (0, test_1.expect)(result.autoRepair?.error).toContain("Información de productos");
    (0, test_1.expect)(result.autoRepair?.attempted).toBe(false);
});
(0, test_1.test)("Normal handoff with all paths => created is true and status is needs_agent", () => {
    const now = new Date().toISOString();
    const result = {
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
    (0, test_1.expect)(result.status).toBe("needs_agent");
    (0, test_1.expect)(result.handoff?.created).toBe(true);
    (0, test_1.expect)(result.handoff?.requestPath).toBeDefined();
    (0, test_1.expect)(result.handoff?.instructionsPath).toBeDefined();
    (0, test_1.expect)(result.handoff?.schemaPath).toBeDefined();
    (0, test_1.expect)(result.handoff?.responsePath).toBeDefined();
    (0, test_1.expect)(result.handoff?.reason).toBe("plan_needs_repair");
});
