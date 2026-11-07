import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { defaultRunTypeScriptValidation } from "./spec-generation-hybrid";

test("TypeScript candidate validation preserves the Playwright page returned for recorded tabs", async () => {
  const scratchParent = path.resolve(process.cwd(), ".artifacts", "tmp");
  await fs.mkdir(scratchParent, { recursive: true });
  const scratchDir = await fs.mkdtemp(path.join(scratchParent, "spec-type-validation-"));
  const specPath = path.join(scratchDir, "candidate.spec.ts");

  try {
    await fs.writeFile(specPath, [
      'import { test } from "@playwright/test";',
      'import { createPromotedSpecRuntime } from "./promoted-spec-runtime";',
      "test('recorded tab page remains usable', async ({ page }) => {",
      "  const promotedRuntime = createPromotedSpecRuntime(page);",
      '  const recordingPage = await promotedRuntime.selectRecordedPage("tab-1", false);',
      '  await recordingPage.goto("/requests");',
      '  await recordingPage.getByRole("button", { name: "Continue" }).click();',
      "});",
      "",
    ].join("\n"), "utf8");

    const result = await defaultRunTypeScriptValidation(specPath);
    assert.equal(result.ok, true, `${result.stdout}\n${result.stderr}`);
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
});
