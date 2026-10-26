import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNoCanonicalJiraOutputs, JiraPromotionIndexError, persistJiraSpecVerificationFailure,
  preflightJiraPromotionIndexes, resolveJiraSpecVerificationTimeoutMs } from "./jira-spec-promotion";

test("Jira promotion preflight rejects malformed app or global index before promotion writes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jira-promotion-index-preflight-"));
  try {
    const appIndexPath = path.join(root, "app-index.json");
    const globalIndexPath = path.join(root, "global-index.json");
    const malformed = '{"version":"1.0","automations":[]} trailing';
    await fs.writeFile(appIndexPath, JSON.stringify({ version: "1.0", automations: [] }), "utf8");
    await fs.writeFile(globalIndexPath, malformed, "utf8");

    await assert.rejects(preflightJiraPromotionIndexes(appIndexPath, globalIndexPath), error => {
      assert.ok(error instanceof JiraPromotionIndexError);
      assert.equal(error.code, "JIRA_PROMOTION_INDEX_INVALID");
      assert.equal(error.indexPath, path.resolve(globalIndexPath));
      assert.equal(error.reason, "invalid_json");
      return true;
    });

    assert.equal(await fs.readFile(globalIndexPath, "utf8"), malformed);
    assert.deepEqual((await fs.readdir(root)).sort(), ["app-index.json", "global-index.json"]);

    await fs.writeFile(appIndexPath, malformed, "utf8");
    await fs.writeFile(globalIndexPath, JSON.stringify({ version: "1.0", automations: [] }), "utf8");
    await assert.rejects(preflightJiraPromotionIndexes(appIndexPath, globalIndexPath), error => {
      assert.ok(error instanceof JiraPromotionIndexError);
      assert.equal(error.indexPath, path.resolve(appIndexPath));
      assert.equal(error.reason, "invalid_json");
      return true;
    });
    assert.equal(await fs.readFile(appIndexPath, "utf8"), malformed);
    assert.deepEqual((await fs.readdir(root)).sort(), ["app-index.json", "global-index.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Jira non-overwrite guard: candidate-only case dir allows promotion and keeps candidates; canonical state fails closed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-spec-guard-"));
  try {
    const canonical = ["case.spec.ts", "plan.json", "case.json", "automation.json", "case.meta.json", "promoted-data.json"]
      .map(name => path.join(dir, name));
    const candidate = path.join(dir, "case.jira-candidate-1-2.spec.ts");
    await fs.writeFile(candidate, "// candidate", "utf8");
    await assertNoCanonicalJiraOutputs(canonical);
    assert.equal(await fs.readFile(candidate, "utf8"), "// candidate");

    await fs.writeFile(canonical[0], "// promoted", "utf8");
    await assert.rejects(assertNoCanonicalJiraOutputs(canonical), /JIRA_SPEC_ALREADY_EXISTS/);
    await fs.rm(canonical[0]);

    await fs.writeFile(canonical[1], "{}", "utf8"); // partial: plan only
    await assert.rejects(assertNoCanonicalJiraOutputs(canonical), /JIRA_SPEC_ALREADY_EXISTS/);
    assert.equal(await fs.readFile(candidate, "utf8"), "// candidate");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Jira spec verification timeout scales for long semantic journeys", () => {
  assert.equal(resolveJiraSpecVerificationTimeoutMs(3), 90_000);
  assert.equal(resolveJiraSpecVerificationTimeoutMs(35), 420_000);
  assert.equal(resolveJiraSpecVerificationTimeoutMs(14, undefined, 4, 45_000), 408_000);
});

test("Jira spec verification timeout honors a configured duration within its safety cap", () => {
  assert.equal(resolveJiraSpecVerificationTimeoutMs(35, 180_000), 180_000);
  assert.equal(resolveJiraSpecVerificationTimeoutMs(35, 900_000), 600_000);
});

test("Jira spec verification timeout remains bounded for very large plans", () => {
  assert.equal(resolveJiraSpecVerificationTimeoutMs(10_000), 600_000);
});

test("Jira spec verification failure is retained per run with useful sanitized diagnostics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jira-spec-verification-"));
  try {
    const diagnosticPath = path.join(root, "run-1", "diagnostic.json");
    const persisted = await persistJiraSpecVerificationFailure({
      error: Object.assign(new Error("Playwright test failed"), { code: 1 }),
      output: "1) [chromium] case.spec.ts:42:7 › transfer › Error: expected receipt\npassword=qwerty123",
      secrets: ["qwerty123"],
      specPath: path.join(root, "case.jira-candidate.spec.ts"),
      artifactsDir: path.join(root, "run-1"),
      diagnosticPath,
    });
    const diagnostic = JSON.parse(await fs.readFile(diagnosticPath, "utf8"));
    assert.equal(persisted.category, "test_failure");
    assert.equal(diagnostic.category, "test_failure");
    assert.match(diagnostic.output, /expected receipt/);
    assert.match(diagnostic.output, /\[REDACTED\]/);
    assert.doesNotMatch(diagnostic.output, /qwerty123/);
    assert.equal(diagnostic.specPath, path.join(root, "case.jira-candidate.spec.ts"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Jira spec verification failures distinguish timeout and compilation errors", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jira-spec-verification-classify-"));
  try {
    const common = { error: new Error("failed"), secrets: [], specPath: "candidate.spec.ts", artifactsDir: root };
    const timeoutPath = path.join(root, "timeout", "diagnostic.json");
    const timeout = await persistJiraSpecVerificationFailure({ ...common, error: Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" }),
      output: "", diagnosticPath: timeoutPath });
    const compilePath = path.join(root, "compile", "diagnostic.json");
    const compile = await persistJiraSpecVerificationFailure({ ...common, output: "SyntaxError: Transform failed", diagnosticPath: compilePath });
    assert.equal(timeout.category, "timeout");
    assert.equal(compile.category, "compile");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Jira spec verification classifies failed assertions accurately and preserves short values in diagnostics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jira-spec-verification-assertion-"));
  try {
    const diagnosticPath = path.join(root, "assertion", "diagnostic.json");
    const result = await persistJiraSpecVerificationFailure({
      error: Object.assign(new Error("Playwright test failed"), { code: 1 }),
      output: "Expected: true\nReceived: false\nTimeout 15000ms exceeded; amount=10",
      secrets: ["10"], specPath: "candidate.spec.ts", artifactsDir: root, diagnosticPath,
    });
    const diagnostic = JSON.parse(await fs.readFile(diagnosticPath, "utf8"));
    assert.equal(result.category, "test_failure");
    assert.match(diagnostic.output, /15000ms/);
    assert.match(diagnostic.output, /amount=\[REDACTED\]/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
