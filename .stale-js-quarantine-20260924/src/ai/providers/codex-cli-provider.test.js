"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const codex_cli_provider_1 = require("./codex-cli-provider");
const codex_cli_runner_1 = require("../../agent/codex-cli-runner");
function buildScenarioRequest() {
    return {
        purpose: "scenario_generation",
        requireJson: true,
        messages: [
            { role: "system", content: "Generate scenarios." },
            { role: "user", content: "Return a JSON object with scenarios." },
        ],
    };
}
function buildSpecGenerationRequest() {
    return {
        purpose: "spec_generation",
        requireJson: true,
        messages: [
            { role: "system", content: "Generate Playwright spec." },
            { role: "user", content: "Return a JSON object with specContent and coverage." },
        ],
    };
}
function buildProviderConfig() {
    return {
        providerName: "codex-test",
        model: "mock-model",
        timeoutMs: 5000,
        command: "codex",
        extraArgs: [],
    };
}
function buildProvider() {
    return new codex_cli_provider_1.CodexCliProvider(buildProviderConfig());
}
function buildJsonRequest() {
    return {
        purpose: "general",
        requireJson: true,
        messages: [
            { role: "system", content: "Return JSON." },
            { role: "user", content: "Return a JSON object." },
        ],
    };
}
function buildSemanticRequest() {
    return {
        purpose: "scenario_data_semantic_enrichment",
        requireJson: true,
        messages: [
            { role: "system", content: "Return status and confidence." },
            { role: "user", content: "Return the semantic JSON object." },
        ],
    };
}
async function writeScenarioFile(cwd) {
    const outputPath = path.join(cwd, "scenario-generation-result.json");
    await fs.writeFile(outputPath, JSON.stringify({ scenarios: [] }), "utf-8");
}
async function writeSpecGenerationFile(cwd) {
    const outputPath = path.join(cwd, "spec-generation-result.json");
    await fs.writeFile(outputPath, JSON.stringify({
        specContent: "import { test } from '@playwright/test';\ntest('x', async () => {});",
        coveredStepIndexes: [1],
        coveredAssertions: [],
        usedPageObjects: [],
        declaredIdentifiers: [],
        unresolvedRequirements: [],
        warnings: []
    }), "utf-8");
}
function baseRunnerResult() {
    return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        durationMs: 1500,
    };
}
(0, node_test_1.default)("CodexCliProvider usage bridge", async (t) => {
    await t.test("adds the configured reasoning effort only to spec generation", async () => {
        const provider = new codex_cli_provider_1.CodexCliProvider({ ...buildProviderConfig(), purpose: "spec_generation", reasoningEffort: "medium" });
        let receivedInput;
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
            receivedInput = input;
            await writeSpecGenerationFile(input.cwd);
            return baseRunnerResult();
        });
        try {
            await provider.completeJson(buildSpecGenerationRequest());
            node_assert_1.default.deepEqual(receivedInput?.extraArgs.slice(-2), ["-c", "model_reasoning_effort=medium"]);
        }
        finally {
            (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
        }
    });
    await t.test("passes taskType=generation when purpose is scenario_generation", async () => {
        const provider = buildProvider();
        let receivedInput;
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
            receivedInput = input;
            await writeScenarioFile(input.cwd);
            return {
                ...baseRunnerResult(),
                usage: {
                    timestamp: "2026-01-01T00:00:00.000Z",
                    provider: "codex_cli",
                    model: "mock-model",
                    taskType: "generation",
                    inputTokens: 100,
                    cachedInputTokens: 60,
                    cacheWriteInputTokens: 0,
                    nonCachedInputTokens: 40,
                    outputTokens: 20,
                    reasoningOutputTokens: 5,
                    totalPhysicalTokens: 120,
                    durationMs: 1500,
                    exitCode: 0,
                    success: true,
                },
            };
        });
        try {
            await provider.completeJson(buildScenarioRequest());
            node_assert_1.default.strictEqual(receivedInput?.taskType, "generation");
        }
        finally {
            (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
        }
    });
    await t.test("passes taskType=generation when purpose is spec_generation", async () => {
        const provider = buildProvider();
        let receivedInput;
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
            receivedInput = input;
            await writeSpecGenerationFile(input.cwd);
            return {
                ...baseRunnerResult(),
            };
        });
        try {
            await provider.completeJson(buildSpecGenerationRequest());
            node_assert_1.default.strictEqual(receivedInput?.taskType, "generation");
        }
        finally {
            (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
        }
    });
    await t.test("propagates full usage metrics without recomputing totals", async () => {
        const provider = buildProvider();
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
            await writeScenarioFile(input.cwd);
            return {
                ...baseRunnerResult(),
                usage: {
                    timestamp: "2026-01-01T00:00:00.000Z",
                    provider: "codex_cli",
                    model: "mock-model",
                    taskType: "generation",
                    inputTokens: 100,
                    cachedInputTokens: 60,
                    cacheWriteInputTokens: 0,
                    nonCachedInputTokens: 40,
                    outputTokens: 20,
                    reasoningOutputTokens: 5,
                    totalPhysicalTokens: 120,
                    durationMs: 1500,
                    exitCode: 0,
                    success: true,
                },
            };
        });
        try {
            const response = await provider.completeJson(buildScenarioRequest());
            node_assert_1.default.strictEqual(response.usage?.inputTokens, 100);
            node_assert_1.default.strictEqual(response.usage?.cachedInputTokens, 60);
            node_assert_1.default.strictEqual(response.usage?.cacheWriteInputTokens, 0);
            node_assert_1.default.strictEqual(response.usage?.nonCachedInputTokens, 40);
            node_assert_1.default.strictEqual(response.usage?.outputTokens, 20);
            node_assert_1.default.strictEqual(response.usage?.reasoningOutputTokens, 5);
            node_assert_1.default.strictEqual(response.usage?.totalPhysicalTokens, 120);
            node_assert_1.default.strictEqual(response.usage?.durationMs, 1500);
            node_assert_1.default.strictEqual(response.usage?.success, true);
        }
        finally {
            (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
        }
    });
    await t.test("keeps partial usage fields without inventing values", async () => {
        const provider = buildProvider();
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
            await writeScenarioFile(input.cwd);
            return {
                ...baseRunnerResult(),
                usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                },
            };
        });
        try {
            const response = await provider.completeJson(buildScenarioRequest());
            node_assert_1.default.strictEqual(response.usage?.inputTokens, 100);
            node_assert_1.default.strictEqual(response.usage?.outputTokens, 20);
            node_assert_1.default.strictEqual(response.usage?.cachedInputTokens, undefined);
            node_assert_1.default.strictEqual(response.usage?.nonCachedInputTokens, undefined);
            node_assert_1.default.strictEqual(response.usage?.totalPhysicalTokens, undefined);
            node_assert_1.default.strictEqual(Number.isNaN(response.usage?.cachedInputTokens), false);
        }
        finally {
            (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
        }
    });
    await t.test("preserves usage on non-zero exit when JSON is valid", async () => {
        const provider = buildProvider();
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
            await writeScenarioFile(input.cwd);
            return {
                ...baseRunnerResult(),
                exitCode: 17,
                stderr: "simulated warning",
                usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                    totalPhysicalTokens: 120,
                    success: false,
                },
            };
        });
        try {
            const response = await provider.completeJson(buildScenarioRequest());
            node_assert_1.default.strictEqual(response.diagnostics?.warning, "ai_provider_exited_non_zero_but_output_valid");
            node_assert_1.default.strictEqual(response.diagnostics?.exitCode, 17);
            node_assert_1.default.strictEqual(response.usage?.inputTokens, 100);
            node_assert_1.default.strictEqual(response.usage?.outputTokens, 20);
            node_assert_1.default.strictEqual(response.usage?.totalPhysicalTokens, 120);
            node_assert_1.default.strictEqual(response.usage?.success, false);
        }
        finally {
            (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
        }
    });
});
const VALID_SPEC_OUTPUT = {
    specContent: "import { test } from '@playwright/test';\ntest('y', async () => {});",
    coveredStepIndexes: [1],
    coveredAssertions: [],
    usedPageObjects: [],
    declaredIdentifiers: [],
    unresolvedRequirements: [],
    warnings: [],
};
async function captureConsoleLogs(fn) {
    const logs = [];
    const original = console.log;
    console.log = (...args) => {
        logs.push(args.map(String).join(" "));
    };
    try {
        await fn();
    }
    finally {
        console.log = original;
    }
    return logs;
}
(0, node_test_1.default)("C7 spec generation resolves structured output from result file with result_file log", async () => {
    const provider = buildProvider();
    let runCount = 0;
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
        runCount += 1;
        await writeSpecGenerationFile(input.cwd);
        return baseRunnerResult();
    });
    try {
        const logs = await captureConsoleLogs(async () => {
            const response = await provider.completeJson(buildSpecGenerationRequest());
            node_assert_1.default.strictEqual(typeof response.parsedJson?.specContent, "string");
            node_assert_1.default.ok(String(response.parsedJson?.specContent).includes("test('x'"));
        });
        node_assert_1.default.strictEqual(runCount, 1);
        node_assert_1.default.ok(logs.some((line) => line.includes("[codex-output] source=result_file schemaValid=true")));
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("C8 recovers valid JSON from stdout when result file is missing, without an extra AI invocation", async () => {
    const provider = buildProvider();
    let runCount = 0;
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async () => {
        runCount += 1;
        return { ...baseRunnerResult(), stdout: JSON.stringify(VALID_SPEC_OUTPUT) };
    });
    try {
        const logs = await captureConsoleLogs(async () => {
            const response = await provider.completeJson(buildSpecGenerationRequest());
            node_assert_1.default.strictEqual(response.parsedJson?.specContent, VALID_SPEC_OUTPUT.specContent);
            node_assert_1.default.strictEqual(response.diagnostics, undefined);
        });
        node_assert_1.default.strictEqual(runCount, 1);
        node_assert_1.default.ok(logs.some((line) => line.includes("[codex-output] source=stdout schemaValid=true")));
        node_assert_1.default.ok(logs.some((line) => line.includes("[codex-output] recovered=true extraAiInvocation=false")));
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("C9 fails with ai_provider_output_missing when neither file nor parseable stdout exists", async () => {
    const provider = buildProvider();
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async () => ({
        ...baseRunnerResult(),
        stdout: "Wrote [spec-generation-result.json](some-path) but I did not include JSON.",
    }));
    try {
        await node_assert_1.default.rejects(provider.completeJson(buildSpecGenerationRequest()), (err) => {
            node_assert_1.default.strictEqual(err.code, "ai_provider_output_missing");
            return true;
        });
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("C10 fails closed with ai_provider_invalid_json when output JSON has an invalid spec shape", async () => {
    const provider = buildProvider();
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
        await fs.writeFile(path.join(input.cwd, "spec-generation-result.json"), JSON.stringify({ greeting: "hello" }), "utf-8");
        return baseRunnerResult();
    });
    try {
        await node_assert_1.default.rejects(provider.completeJson(buildSpecGenerationRequest()), (err) => {
            node_assert_1.default.strictEqual(err.code, "ai_provider_invalid_json");
            return true;
        });
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("C11 stdout recovery performs exactly one provider invocation (aiAttempts stays one)", async () => {
    const provider = buildProvider();
    let runCount = 0;
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async () => {
        runCount += 1;
        return { ...baseRunnerResult(), stdout: JSON.stringify({ ...VALID_SPEC_OUTPUT, specContent: `call${runCount}` }) };
    });
    try {
        const response = await provider.completeJson(buildSpecGenerationRequest());
        node_assert_1.default.strictEqual(runCount, 1);
        node_assert_1.default.strictEqual(response.parsedJson?.specContent, "call1");
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("C12 stdout recovery is transport-level and does not consume the repair budget", async () => {
    const provider = buildProvider();
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async () => ({
        ...baseRunnerResult(),
        stdout: JSON.stringify(VALID_SPEC_OUTPUT),
    }));
    try {
        const logs = await captureConsoleLogs(async () => {
            const response = await provider.completeJson(buildSpecGenerationRequest());
            // Clean success: no warning, no non-zero exit, no repair-flavored diagnostics.
            node_assert_1.default.strictEqual(response.diagnostics, undefined);
            node_assert_1.default.strictEqual(response.usage?.exitCode, undefined);
        });
        node_assert_1.default.ok(logs.some((line) => line.includes("recovered=true extraAiInvocation=false")));
        node_assert_1.default.ok(!logs.some((line) => line.includes("repair")));
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("Codex JSONL transport envelopes are never returned as assistant JSON", async () => {
    const provider = buildProvider();
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async () => ({
        ...baseRunnerResult(),
        exitCode: 1,
        stdout: [
            JSON.stringify({ type: "thread.started", thread_id: "safe" }),
            JSON.stringify({ type: "item.completed", item: { type: "error", message: "provider failure" } }),
            JSON.stringify({ type: "turn.failed", error: { message: "provider failure" } }),
        ].join("\n"),
    }));
    try {
        await node_assert_1.default.rejects(provider.completeJson(buildJsonRequest()), (err) => {
            node_assert_1.default.strictEqual(err.code, "ai_provider_execution_failed");
            return true;
        });
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("Codex JSONL extracts JSON only from an assistant event", async () => {
    const provider = buildProvider();
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async () => ({
        ...baseRunnerResult(),
        exitCode: 1,
        stdout: [
            JSON.stringify({ type: "thread.started", thread_id: "safe" }),
            JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{\"answer\":\"ok\"}" } }),
            JSON.stringify({ type: "turn.failed", error: { message: "provider warning" } }),
        ].join("\n"),
    }));
    try {
        const response = await provider.completeJson(buildJsonRequest());
        node_assert_1.default.deepStrictEqual(response.parsedJson, { answer: "ok" });
        node_assert_1.default.strictEqual(response.diagnostics?.warning, "ai_provider_exited_non_zero_but_output_valid");
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("Semantic Enrichment uses generic JSON output instead of the repair contract", async () => {
    const provider = buildProvider();
    let prompt = "";
    let repairSchemaExists = true;
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
        prompt = await fs.readFile(path.join(input.cwd, "prompt.txt"), "utf-8");
        repairSchemaExists = await fs.access(path.join(input.cwd, "repair-decision.schema.json")).then(() => true).catch(() => false);
        return { ...baseRunnerResult(), stdout: JSON.stringify({ status: "unresolved", confidence: "low", semanticEvidence: [] }) };
    });
    try {
        const response = await provider.completeJson(buildSemanticRequest());
        node_assert_1.default.deepStrictEqual(response.parsedJson, { status: "unresolved", confidence: "low", semanticEvidence: [] });
        node_assert_1.default.equal(repairSchemaExists, false);
        node_assert_1.default.equal(prompt.includes("repair-decision.schema.json"), false);
        node_assert_1.default.equal(prompt.includes("decision and reason"), false);
        node_assert_1.default.equal(prompt.includes('"decision"'), false);
        node_assert_1.default.equal(prompt.includes("Return status and confidence."), true);
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("Unknown Codex purpose fails explicitly instead of silently using repair", async () => {
    const provider = buildProvider();
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async () => baseRunnerResult());
    try {
        await node_assert_1.default.rejects(provider.completeJson({ ...buildJsonRequest(), purpose: "future_task" }), (err) => {
            node_assert_1.default.equal(err.code, "ai_provider_unsupported");
            return true;
        });
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
(0, node_test_1.default)("Repair purpose retains the repair decision result contract", async () => {
    const provider = buildProvider();
    let schemaExists = false;
    let prompt = "";
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
        schemaExists = await fs.access(path.join(input.cwd, "repair-decision.schema.json")).then(() => true).catch(() => false);
        prompt = await fs.readFile(path.join(input.cwd, "prompt.txt"), "utf-8");
        await fs.writeFile(path.join(input.cwd, "repair-decision.json"), JSON.stringify({ decision: "no_safe_action", reason: "fixture" }), "utf-8");
        return baseRunnerResult();
    });
    try {
        const response = await provider.completeJson({ ...buildJsonRequest(), purpose: "repair" });
        node_assert_1.default.equal(schemaExists, true);
        node_assert_1.default.equal(prompt.includes('"decision"'), true);
        node_assert_1.default.deepStrictEqual(response.parsedJson, { decision: "no_safe_action", reason: "fixture" });
    }
    finally {
        (0, codex_cli_provider_1.__setRunCodexCliForTesting)(codex_cli_runner_1.runCodexCli);
    }
});
