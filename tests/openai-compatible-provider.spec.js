"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const openai_compatible_provider_1 = require("../src/ai/openai-compatible-provider");
const baseConfig = {
    enabled: true,
    provider: "openai_compatible",
    providerName: "gemini",
    baseUrl: "https://example.com/v1/",
    apiKey: "secret",
    model: "gemini-2.5-flash",
    timeoutMs: 30_000,
    requireJson: true,
    requireJsonSchema: true
};
(0, test_1.test)("construye request correcto", async () => {
    let calledUrl = "";
    let calledBody = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
        calledUrl = String(input);
        calledBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"no_safe_action\",\"reason\":\"ok\"}" } }] }), { status: 200 });
    });
    try {
        const provider = new openai_compatible_provider_1.OpenAICompatibleProvider(baseConfig);
        const result = await provider.completeJson({
            messages: [{ role: "user", content: "hi" }]
        });
        (0, test_1.expect)(calledUrl).toBe("https://example.com/v1/chat/completions");
        (0, test_1.expect)(calledBody).toContain("\"model\":\"gemini-2.5-flash\"");
        (0, test_1.expect)(result.parsedJson?.decision).toBe("no_safe_action");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("respeta timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
        await new Promise((resolve, reject) => {
            const signal = init?.signal;
            const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            if (signal?.aborted)
                onAbort();
            signal?.addEventListener("abort", onAbort);
        });
        return new Response("{}", { status: 200 });
    });
    try {
        const provider = new openai_compatible_provider_1.OpenAICompatibleProvider({ ...baseConfig, timeoutMs: 10 });
        await (0, test_1.expect)(provider.completeJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/timed out/i);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("parsea JSON válido", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"no_safe_action\",\"reason\":\"ok\"}" } }] }), { status: 200 }));
    try {
        const provider = new openai_compatible_provider_1.OpenAICompatibleProvider(baseConfig);
        const result = await provider.completeJson({ messages: [{ role: "user", content: "hi" }] });
        (0, test_1.expect)(result.parsedJson?.reason).toBe("ok");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("reporta invalid JSON", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }));
    try {
        const provider = new openai_compatible_provider_1.OpenAICompatibleProvider(baseConfig);
        await (0, test_1.expect)(provider.completeJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/invalid json/i);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("reporta HTTP error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("bad request", { status: 400 }));
    try {
        const provider = new openai_compatible_provider_1.OpenAICompatibleProvider(baseConfig);
        await (0, test_1.expect)(provider.completeJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/http error/i);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("normaliza base url con slash", () => {
    (0, test_1.expect)((0, openai_compatible_provider_1.buildChatCompletionsUrl)("https://x/y/")).toBe("https://x/y/chat/completions");
});
