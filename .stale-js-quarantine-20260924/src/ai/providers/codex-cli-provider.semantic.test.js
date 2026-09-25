"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const codex_cli_provider_1 = require("./codex-cli-provider");
(0, node_test_1.default)("routes canonical semantic normalization through generic JSON output without repair schema", async () => {
    let receivedPurpose = "";
    (0, codex_cli_provider_1.__setRunCodexCliForTesting)(async (input) => {
        receivedPurpose = input.purpose ?? "";
        return { stdout: JSON.stringify({ status: "resolved", confidence: "high", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [] }), stderr: "", exitCode: 0, timedOut: false };
    });
    const provider = new codex_cli_provider_1.CodexCliProvider({
        enabled: true,
        provider: "codex_cli",
        providerName: "codex",
        baseUrl: "",
        apiKey: "",
        model: "",
        timeoutMs: 1000,
        requireJson: true,
        requireJsonSchema: true,
        command: "codex",
    });
    const response = await provider.completeJson({
        purpose: "canonical_scenario_semantic_normalization",
        messages: [{ role: "system", content: "Return JSON" }, { role: "user", content: "{}" }],
    });
    strict_1.default.equal(receivedPurpose, "canonical_scenario_semantic_normalization");
    strict_1.default.equal(response.parsedJson?.status, "resolved");
});
