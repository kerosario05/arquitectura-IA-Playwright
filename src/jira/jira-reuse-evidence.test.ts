import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { jiraReuseEvidenceOptions, failedJiraSpecStep } from "./jira-reuse-evidence";
import { buildEvidencePaths } from "../evidence/evidence-paths";
import { consolidateRunEvidenceForExecution } from "../server/jobs/discovery-batch-runner";
import JiraReuseEvidenceReporter from "./jira-reuse-evidence-reporter";
import type { TestCase, TestResult } from "@playwright/test/reporter";

test("awaited reporter shutdown drains evidence writes even for the final single case", async () => {
  const reporter = new JiraReuseEvidenceReporter();
  let release!: () => void;
  const io = new Promise<void>(resolve => { release = resolve; });
  let saved = false;
  Object.defineProperty(reporter, "saveTestEvidence", { value: async () => { await io; saved = true; } });
  assert.equal(reporter.onTestEnd({} as TestCase, {} as TestResult), undefined);
  let ended = false;
  const end = reporter.onEnd().then(() => { ended = true; });
  await Promise.resolve();
  assert.equal(saved, false);
  assert.equal(ended, false);
  release();
  await end;
  assert.equal(saved, true);
});

test("reporter never promotes an older step capture to final when the final capture is missing", async () => {
  const root = await fs.mkdtemp(path.resolve(".artifacts/tmp/jira-reuse-nofinal-"));
  const specPath = path.join(root, "case.spec.ts");
  await fs.writeFile(specPath, "// 1. Open\n// 2. Modify\n");
  await fs.writeFile(path.join(root, "plan.json"), JSON.stringify({
    scenario: { source: "jira", externalId: "DEMO-2:jira:1" },
    steps: [{ index: 1, action: "navigate", description: "Open" }, { index: 2, action: "click", description: "Modify" }],
  }));
  const context = { appSlug: "fixture-nofinal", sectionSlug: "selected-section", runId: `nofinal-${Date.now()}`, caseId: 720, specPath };
  const paths = buildEvidencePaths({ ...context, scenarioId: "C720", scenarioTitle: "NoFinal" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const reporter = new JiraReuseEvidenceReporter() as unknown as {
    context: unknown; saveTestEvidence(t: TestCase, r: TestResult): Promise<void>;
  };
  reporter.context = context;
  await reporter.saveTestEvidence(
    { title: "NoFinal", location: { file: specPath } } as TestCase,
    { status: "passed", errors: [], attachments: [{ name: "jira-step-001", contentType: "image/png", body: png }] } as unknown as TestResult,
  );
  const record = JSON.parse(await fs.readFile(paths.evidenceJsonPath, "utf8"));
  assert.equal(record.captureStatus, "failed");
  assert.equal(record.finalScreenEvidence.captured, false);
  assert.equal(record.finalScreenEvidence.path, null);
  assert.ok(record.steps[0].screenshotPath.endsWith("step-001.png"));
  assert.equal(record.steps[1].screenshotPath, undefined);
});

test("only Jira exact-job reuse receives isolated evidence configuration", () => {
  const context = { appSlug: "fixture", sectionSlug: "selected-section", runId: "job-one", caseId: 11, specPath: "fixture.spec.ts" };
  assert.equal(jiraReuseEvidenceOptions('import { test } from "@playwright/test";', context), undefined);
  assert.equal(jiraReuseEvidenceOptions('import { fill } from "../jira-spec-runtime";', undefined), undefined);
  const options = jiraReuseEvidenceOptions('import { fill } from "../jira-spec-runtime";', context)!;
  assert.match(options.outputDir, /job-one[\\/]scenarios[\\/]C11[\\/]playwright$/);
  assert.equal(JSON.parse(options.contextJson).sectionSlug, "selected-section");
});

test("failure mapping requires the exact spec frame, not an unrelated runtime line", () => {
  const spec = path.resolve("fixture.spec.ts");
  assert.equal(failedJiraSpecStep('// 1. Open\nawait open();\n// 2. Verify\nawait verify();', spec, [`at ${spec}:4:2`]), 2);
  assert.equal(failedJiraSpecStep('// 1. Open', spec, ['at runtime.ts:50:2']), undefined);
});

test("real Playwright pass/failure attachments survive the next profile and feed evidence records", { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.resolve(".artifacts/tmp/jira-reuse-evidence-"));
  const runId = `fixture-${Date.now()}`;
  const screenshotPaths: string[] = [];
  for (const [position, appSlug] of ["fixture-access", "fixture-catalog"].entries()) {
    const caseId = 700 + position;
    const dir = path.join(root, appSlug);
    await fs.mkdir(dir);
    const specPath = path.join(dir, "case.spec.ts");
    const succeeds = position === 1;
    const importPath = path.resolve("node_modules/@playwright/test/index.mjs").replace(/\\/g, "/");
    await fs.writeFile(specPath, `import {test,expect} from ${JSON.stringify(importPath)};
test('Fixture observed state', async ({page}) => {
  // 1. Open fixture
  await page.setContent('<h1>Observed screen</h1>');
  // 2. Check expected screen
  await expect(page.getByRole('heading', {name: '${succeeds ? "Observed screen" : "Different screen"}'})).toBeVisible({timeout:100});
});`);
    await fs.writeFile(path.join(dir, "plan.json"), JSON.stringify({
      scenario: { source: "jira", externalId: "DEMO-1:jira:1" },
      steps: [{ index: 1, action: "navigate", description: "Open fixture" }, { index: 2, action: "assertVisible", description: "Check expected screen" }],
    }));
    const context = { appSlug, sectionSlug: "selected-section", runId, caseId, specPath };
    const paths = buildEvidencePaths({ ...context, scenarioId: `C${caseId}`, scenarioTitle: "Fixture" });
    const configPath = path.join(dir, "playwright.config.ts");
    const baseConfig = path.resolve("playwright.config.jira-reuse.ts").replace(/\\/g, "/");
    await fs.writeFile(configPath, `import base from ${JSON.stringify(baseConfig)};
export default {...base, testDir: ${JSON.stringify(dir)}, testMatch: ['case.spec.ts'], workers: 1,
  reporter: [['list'], [${JSON.stringify(path.resolve("src/jira/jira-reuse-evidence-reporter.ts").replace(/\\/g, "/"))}]],
  outputDir: ${JSON.stringify(path.resolve(paths.scenarioDir, "playwright"))},
  use: {...base.use, headless:true, baseURL:undefined}};`);
    const result = spawnSync(process.execPath, [path.resolve("node_modules/@playwright/test/cli.js"), "test", `--config=${configPath}`], {
      encoding: "utf8", timeout: 25000,
      env: { ...process.env, JIRA_REUSE_EVIDENCE_CONTEXT: JSON.stringify(context) },
    });
    assert.equal(result.status, succeeds ? 0 : 1, result.stdout + result.stderr);
    assert.match(result.stdout, /\[evidence\] initialized mode=jira_promoted_reuse/);
    const record = JSON.parse(await fs.readFile(paths.evidenceJsonPath, "utf8"));
    assert.equal(record.functionalStatus, succeeds ? "passed" : "failed");
    assert.equal(record.steps[1].status, succeeds ? "passed" : "failed");
    assert.equal(record.requirement, "DEMO-1");
    assert.equal(record.captureStatus, "success");
    screenshotPaths.push(record.finalScreenEvidence.path);
    const previousFormat = process.env.EVIDENCE_FORMAT;
    process.env.EVIDENCE_FORMAT = "pdf";
    try {
      const document = await consolidateRunEvidenceForExecution(runId, appSlug, "selected-section", "Fixture");
      assert.equal(document.generated, true, document.error);
      assert.equal(document.scenarioEvidenceCount, 1);
      assert.match(document.documentPath!, /evidencia\.pdf$/);
      assert.ok((await fs.stat(document.documentPath!)).size > 1000);
    } finally {
      if (previousFormat === undefined) delete process.env.EVIDENCE_FORMAT;
      else process.env.EVIDENCE_FORMAT = previousFormat;
    }
  }
  for (const screenshotPath of screenshotPaths) assert.ok((await fs.stat(screenshotPath)).size > 0);
});
