"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const agent_auto_repair_1 = require("../src/agent/agent-auto-repair");
function baseConfig() {
    return {
        app: {
            baseUrl: "https://example.com",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            missingInputBehavior: "fail"
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: "evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {
            ai: { discoveryMaxAttempts: 2 },
            codex: {
                command: "legacy-codex",
                extraArgs: "--legacy",
                autoRepairEnabled: false,
                autoRepairTimeoutMs: 111,
                autoRepairPromptMode: "compact"
            }
        }
    };
}
(0, test_1.test)("AGENT config overrides legacy CODEX config when present", () => {
    const cfg = {
        ...baseConfig(),
        integrations: {
            ...baseConfig().integrations,
            agent: {
                provider: "codex",
                command: "agent-codex",
                extraArgs: "--skip-git-repo-check",
                autoRepairEnabled: true,
                autoRepairTimeoutMs: 222,
                autoRepairPromptMode: "verbose"
            }
        }
    };
    const resolved = (0, agent_auto_repair_1.resolveAgentAutoRepairConfig)(cfg);
    (0, test_1.expect)(resolved.enabled).toBe(true);
    (0, test_1.expect)(resolved.command).toBe("agent-codex");
    (0, test_1.expect)(resolved.extraArgs).toContain("--skip-git-repo-check");
    (0, test_1.expect)(resolved.timeoutMs).toBe(222);
    (0, test_1.expect)(resolved.promptMode).toBe("verbose");
});
(0, test_1.test)("Legacy CODEX config works as fallback when AGENT config is missing", () => {
    const cfg = baseConfig();
    const resolved = (0, agent_auto_repair_1.resolveAgentAutoRepairConfig)(cfg);
    (0, test_1.expect)(resolved.command).toBe("legacy-codex");
    (0, test_1.expect)(resolved.extraArgs).toContain("--legacy");
    (0, test_1.expect)(resolved.enabled).toBe(false);
});
(0, test_1.test)("default timeoutMs es 900000 cuando no hay config en env", () => {
    const emptyCfg = {
        app: {
            baseUrl: "https://example.com",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            missingInputBehavior: "fail"
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: "evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {}
    };
    const resolved = (0, agent_auto_repair_1.resolveAgentAutoRepairConfig)(emptyCfg);
    (0, test_1.expect)(resolved.timeoutMs).toBe(900000);
});
(0, test_1.test)("resolveAgentAutoRepairConfig usa default 900000 cuando no hay config", () => {
    const emptyCfg2 = {
        app: {
            baseUrl: "https://example.com",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            missingInputBehavior: "fail"
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: "evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {}
    };
    const resolved = (0, agent_auto_repair_1.resolveAgentAutoRepairConfig)(emptyCfg2);
    (0, test_1.expect)(resolved.timeoutMs).toBe(900000);
});
(0, test_1.test)("env autoRepairTimeoutMs se usa cuando no hay repairTimeoutMs override", () => {
    const cfg = baseConfig();
    const resolved = (0, agent_auto_repair_1.resolveAgentAutoRepairConfig)(cfg);
    (0, test_1.expect)(resolved.timeoutMs).toBe(111);
});
(0, test_1.test)("compactPrompt=true usa maxAttempts default 1", () => {
    const cfg = {
        app: {
            baseUrl: "https://example.com",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            missingInputBehavior: "fail"
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: "evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {
            ai: {},
            agent: {
                provider: "codex",
                command: "codex",
                extraArgs: "--skip-git-repo-check",
                autoRepairEnabled: true,
                autoRepairTimeoutMs: 900000,
                autoRepairPromptMode: "compact",
                compactPrompt: true
            }
        }
    };
    const resolved = (0, agent_auto_repair_1.resolveAgentAutoRepairConfig)(cfg);
    (0, test_1.expect)(resolved.maxAttempts).toBe(1);
});
(0, test_1.test)("compactPrompt=false usa maxAttempts default 2", () => {
    const cfg = {
        app: {
            baseUrl: "https://example.com",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            missingInputBehavior: "fail"
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: "evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {
            ai: {},
            agent: {
                provider: "codex",
                command: "codex",
                extraArgs: "--skip-git-repo-check",
                autoRepairEnabled: true,
                autoRepairTimeoutMs: 900000,
                autoRepairPromptMode: "compact"
            }
        }
    };
    const resolved = (0, agent_auto_repair_1.resolveAgentAutoRepairConfig)(cfg);
    (0, test_1.expect)(resolved.maxAttempts).toBe(2);
});
