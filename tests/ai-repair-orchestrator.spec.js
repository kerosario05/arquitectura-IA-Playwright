"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const ai_repair_orchestrator_1 = require("../src/ai/repair/ai-repair-orchestrator");
function withEnv(values, fn) {
    const previous = {};
    for (const key of Object.keys(values)) {
        previous[key] = process.env[key];
        if (values[key] === undefined)
            delete process.env[key];
        else
            process.env[key] = values[key];
    }
    const restore = () => {
        for (const key of Object.keys(values)) {
            if (previous[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = previous[key];
        }
    };
    const result = fn();
    if (result && typeof result.then === "function") {
        return result.finally(restore);
    }
    restore();
}
const input = {
    appSlug: "app",
    failure: "target_not_found",
    currentStep: "click",
    currentUrl: "https://x",
    candidates: [{ candidateId: "c1", visible: true, clickable: true, enabled: true, sensitive: false }]
};
(0, test_1.test)("provider disabled", async () => {
    await withEnv({ AI_REPAIR_ENABLED: "false" }, async () => {
        const r = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)(input);
        (0, test_1.expect)(r.status).toBe("provider_disabled");
    });
});
(0, test_1.test)("provider error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); });
    await withEnv({
        AI_REPAIR_ENABLED: "true",
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_PROVIDER_NAME: "gemini",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: "key",
        AI_MODEL: "model"
    }, async () => {
        const r = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)(input);
        (0, test_1.expect)(r.status).toBe("provider_error");
    });
    globalThis.fetch = originalFetch;
});
(0, test_1.test)("invalid response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"repaired_plan\",\"reason\":\"x\"}" } }] }), { status: 200 }));
    await withEnv({
        AI_REPAIR_ENABLED: "true",
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_PROVIDER_NAME: "gemini",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: "key",
        AI_MODEL: "model"
    }, async () => {
        const r = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)(input);
        (0, test_1.expect)(r.status).toBe("invalid_response");
    });
    globalThis.fetch = originalFetch;
});
(0, test_1.test)("no_safe_action válido", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"no_safe_action\",\"reason\":\"x\"}" } }] }), { status: 200 }));
    await withEnv({
        AI_REPAIR_ENABLED: "true",
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_PROVIDER_NAME: "gemini",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: "key",
        AI_MODEL: "model"
    }, async () => {
        const r = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)(input);
        (0, test_1.expect)(r.status).toBe("no_safe_action");
    });
    globalThis.fetch = originalFetch;
});
(0, test_1.test)("repaired_plan válido", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"repaired_plan\",\"reason\":\"x\",\"candidateId\":\"c1\"}" } }] }), { status: 200 }));
    await withEnv({
        AI_REPAIR_ENABLED: "true",
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_PROVIDER_NAME: "gemini",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: "key",
        AI_MODEL: "model"
    }, async () => {
        const r = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)(input);
        (0, test_1.expect)(r.status).toBe("repaired_plan");
    });
    globalThis.fetch = originalFetch;
});
(0, test_1.test)("repaired_plan bloqueado por candidate inválido", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"repaired_plan\",\"reason\":\"x\",\"candidateId\":\"missing\"}" } }] }), { status: 200 }));
    await withEnv({
        AI_REPAIR_ENABLED: "true",
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_PROVIDER_NAME: "gemini",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: "key",
        AI_MODEL: "model"
    }, async () => {
        const r = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)(input);
        (0, test_1.expect)(r.status).toBe("invalid_response");
    });
    globalThis.fetch = originalFetch;
});
