import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { buildAgentHandoffRequest } from "../src/agent/handoff-builder";
import { writeAgentHandoffPackage } from "../src/agent/handoff-writer";
import { buildAgentHandoffInstructions } from "../src/agent/handoff-instructions";
import { validateAgentHandoffResponse } from "../src/agent/agent-response-validator";
import type { FullConfig } from "../src/types/env.types";
import { buildDataContext } from "../src/data/data-context";

const tmpDir = path.resolve("./.tmp-test-handoff-context-pack");

function minimalConfig(): FullConfig {
  return {
    app: {
      baseUrl: "https://example.com",
      loginMode: "no_login",
      testData: {},
      testDataAliases: {},
      missingInputBehavior: "fail",
      appProfile: "default"
    },
    execution: {
      browser: "chromium",
      headless: true,
      evidenceDir: "evidence",
      defaultTimeoutMs: 30000
    },
    integrations: {}
  };
}

test.beforeAll(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

test.afterAll(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
  }
});

test("handoff-request references contextPackPath and instructions mention it", async () => {
  const config = minimalConfig();
  const dataContext = buildDataContext(config);
  const out = path.join(tmpDir, "handoff1");
  const contextPackPath = path.join(out, "context-pack.json");
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(contextPackPath, JSON.stringify({ version: "1.0" }, null, 2), "utf-8");

  const request = buildAgentHandoffRequest({
    kind: "plan_repair",
    goal: "Test",
    contextPackPath,
    dataContext
  });

  const pkg = await writeAgentHandoffPackage({ request, outputDir: out });
  const reqContent = await fs.readFile(pkg.requestPath, "utf-8");
  expect(reqContent).toContain("contextPackPath");
  expect(reqContent).toContain("context-pack.json");

  const instructions = buildAgentHandoffInstructions(request);
  expect(instructions.toLowerCase()).toContain("context pack");
  expect(instructions).toContain("context-pack.json");
});

test("handoff writer seeds agent-response.json with a valid needs_more_context response", async () => {
  const config = minimalConfig();
  const dataContext = buildDataContext(config);
  const out = path.join(tmpDir, "handoff-seeded-response");
  await fs.mkdir(out, { recursive: true });

  const request = buildAgentHandoffRequest({
    kind: "plan_repair",
    goal: "Seed a valid response template",
    dataContext
  });

  const pkg = await writeAgentHandoffPackage({ request, outputDir: out });
  const response = JSON.parse(await fs.readFile(pkg.responsePath, "utf-8")) as unknown;
  const validation = validateAgentHandoffResponse(response, { promptMode: "compact-route-recovery" });

  expect(validation.valid).toBe(true);
  expect((response as { recoveryDecision: string }).recoveryDecision).toBe("needs_more_context");
});
