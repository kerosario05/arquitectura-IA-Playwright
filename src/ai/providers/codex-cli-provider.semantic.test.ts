import assert from "node:assert/strict";
import test from "node:test";
import { CodexCliProvider, __setRunCodexCliForTesting } from "./codex-cli-provider";

test("routes canonical semantic normalization through generic JSON output without repair schema", async () => {
  let receivedPurpose = "";
  __setRunCodexCliForTesting(async (input) => {
    receivedPurpose = input.purpose ?? "";
    return { stdout: JSON.stringify({ status: "resolved", confidence: "high", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [] }), stderr: "", exitCode: 0, timedOut: false };
  });
  const provider = new CodexCliProvider({
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
  assert.equal(receivedPurpose, "canonical_scenario_semantic_normalization");
  assert.equal(response.parsedJson?.status, "resolved");
});
