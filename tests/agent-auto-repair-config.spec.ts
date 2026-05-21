import { test, expect } from "@playwright/test";
import { resolveAgentAutoRepairConfig } from "../src/agent/agent-auto-repair";
import type { FullConfig } from "../src/types/env.types";

function baseConfig(): FullConfig {
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

test("AGENT config overrides legacy CODEX config when present", () => {
  const cfg: FullConfig = {
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

  const resolved = resolveAgentAutoRepairConfig(cfg);
  expect(resolved.enabled).toBe(true);
  expect(resolved.command).toBe("agent-codex");
  expect(resolved.extraArgs).toContain("--skip-git-repo-check");
  expect(resolved.timeoutMs).toBe(222);
  expect(resolved.promptMode).toBe("verbose");
});

test("Legacy CODEX config works as fallback when AGENT config is missing", () => {
  const cfg = baseConfig();
  const resolved = resolveAgentAutoRepairConfig(cfg);
  expect(resolved.command).toBe("legacy-codex");
  expect(resolved.extraArgs).toContain("--legacy");
  expect(resolved.enabled).toBe(false);
});

test("default timeoutMs es 900000 cuando no hay config en env", () => {
  const emptyCfg: FullConfig = {
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

  const resolved = resolveAgentAutoRepairConfig(emptyCfg);
  expect(resolved.timeoutMs).toBe(900000);
});

test("resolveAgentAutoRepairConfig usa default 900000 cuando no hay config", () => {
  const emptyCfg2: FullConfig = {
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

  const resolved = resolveAgentAutoRepairConfig(emptyCfg2);
  expect(resolved.timeoutMs).toBe(900000);
});

test("env autoRepairTimeoutMs se usa cuando no hay repairTimeoutMs override", () => {
  const cfg = baseConfig();
  const resolved = resolveAgentAutoRepairConfig(cfg);
  expect(resolved.timeoutMs).toBe(111);
});

test("compactPrompt=true usa maxAttempts default 1", () => {
  const cfg: FullConfig = {
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
  const resolved = resolveAgentAutoRepairConfig(cfg);
  expect(resolved.maxAttempts).toBe(1);
});

test("compactPrompt=false usa maxAttempts default 2", () => {
  const cfg: FullConfig = {
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
  const resolved = resolveAgentAutoRepairConfig(cfg);
  expect(resolved.maxAttempts).toBe(2);
});

