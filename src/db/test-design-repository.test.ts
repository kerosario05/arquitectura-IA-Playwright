import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Integration test for the test design draft repository against a throwaway
 * SQLite file. The datasource is pinned before the db modules load (see
 * identity-repository.test.ts for why the imports are dynamic).
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-test-design-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "test-design.db");

const failures: string[] = [];

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const sqlConnection = await import("./sql-connection");
  const repo = await import("./test-design-repository");
  const { normalizeScenarios } = await import("../test-design/test-design.validation");

  const scenario = (title: string, over: Record<string, unknown> = {}) =>
    normalizeScenarios([
      {
        title,
        preconditions: "Usuario con sesión iniciada",
        steps: [{ action: "Abrir el menú de pagos", expected: "Se muestra el menú" }],
        expectedResult: "El pago queda registrado",
        ...over,
      },
    ])[0];

  console.log("\nborradores");

  let draftId = "";
  await test("creates a draft with its stories in order, uppercasing keys and skipping duplicates", async () => {
    const draft = await repo.createDraft({
      jiraProjectKey: "pay",
      projectSlug: "kiosko",
      testRail: { projectId: 3, suiteId: 12, sectionId: 400 },
      instructions: "  incluir casos de error  ",
      createdBy: "user-1",
      createdByName: "Ana Quintero",
      issues: [
        { issueKey: "pay-10", issueSummary: "Pagar con tarjeta" },
        { issueKey: "PAY-11", issueSummary: "Reembolso" },
        { issueKey: "PAY-10", issueSummary: "repetida" },
      ],
    });
    draftId = draft.id;
    assert.strictEqual(draft.jiraProjectKey, "PAY");
    assert.strictEqual(draft.status, "draft");
    assert.strictEqual(draft.instructions, "incluir casos de error");
    assert.deepStrictEqual(draft.testRail, { projectId: 3, suiteId: 12, sectionId: 400 });
    assert.deepStrictEqual(
      draft.stories.map((s) => [s.issueKey, s.position, s.generationStatus]),
      [
        ["PAY-10", 0, "pending"],
        ["PAY-11", 1, "pending"],
      ],
    );
    assert.deepStrictEqual(draft.stories[0].scenarios, []);
  });

  await test("adds stories after the existing ones and ignores keys already present", async () => {
    const added = await repo.addStories(draftId, [{ issueKey: "PAY-11" }, { issueKey: "PAY-12", issueSummary: "Recibo" }]);
    assert.strictEqual(added, 1);
    const draft = await repo.getDraft(draftId);
    assert.deepStrictEqual(
      draft!.stories.map((s) => [s.issueKey, s.position]),
      [
        ["PAY-10", 0],
        ["PAY-11", 1],
        ["PAY-12", 2],
      ],
    );
  });

  await test("round-trips scenarios with accents through the JSON column", async () => {
    const draft = await repo.getDraft(draftId);
    const story = draft!.stories[0];
    const saved = await repo.saveStoryScenarios(draftId, story.id, [
      scenario("Pago con tarjeta válida — señal de éxito"),
      scenario("Tarjeta vencida", { type: "negative", selectedForJira: false }),
    ]);
    assert.ok(saved);
    const reread = await repo.getStory(draftId, story.id);
    assert.strictEqual(reread!.scenarios.length, 2);
    assert.strictEqual(reread!.scenarios[0].title, "Pago con tarjeta válida — señal de éxito");
    assert.strictEqual(reread!.scenarios[1].selectedForJira, false);
    assert.strictEqual(reread!.scenarios[1].selectedForTestRail, true);
  });

  await test("refuses to save scenarios into a story of another draft", async () => {
    const other = await repo.createDraft({ jiraProjectKey: "OPS", issues: [{ issueKey: "OPS-1" }] });
    const draft = await repo.getDraft(draftId);
    const saved = await repo.saveStoryScenarios(other.id, draft!.stories[0].id, [scenario("x")]);
    assert.strictEqual(saved, null);
  });

  await test("tracks generation status, error and result per story", async () => {
    const draft = await repo.getDraft(draftId);
    const story = draft!.stories[1];
    await repo.setStoryGeneration(draftId, story.id, { status: "generating" });
    assert.strictEqual((await repo.getStory(draftId, story.id))!.generationStatus, "generating");

    await repo.setStoryGeneration(draftId, story.id, { status: "failed", error: "timeout de IA" });
    let reread = await repo.getStory(draftId, story.id);
    assert.strictEqual(reread!.generationStatus, "failed");
    assert.strictEqual(reread!.generationError, "timeout de IA");

    await repo.setStoryGeneration(draftId, story.id, {
      status: "ready",
      scenarios: [scenario("Reembolso total", { origin: "ai" })],
      issueSummary: "Reembolso de un pago",
    });
    reread = await repo.getStory(draftId, story.id);
    assert.strictEqual(reread!.generationStatus, "ready");
    assert.strictEqual(reread!.generationError, null);
    assert.strictEqual(reread!.issueSummary, "Reembolso de un pago");
    assert.strictEqual(reread!.scenarios[0].title, "Reembolso total");
  });

  await test("records TestRail case ids and the Jira sub-task key on publish", async () => {
    const draft = await repo.getDraft(draftId);
    const story = draft!.stories[0];
    const withIds = story.scenarios.map((s, i) => ({ ...s, testRailCaseId: 9000 + i }));
    await repo.markStoryPublished(draftId, story.id, { destination: "testrail", scenarios: withIds });
    await repo.markStoryPublished(draftId, story.id, { destination: "jira", subtaskKey: "pay-99" });
    const reread = await repo.getStory(draftId, story.id);
    assert.deepStrictEqual(reread!.scenarios.map((s) => s.testRailCaseId), [9000, 9001]);
    assert.ok(reread!.testRailPublishedAt);
    assert.strictEqual(reread!.jiraSubtaskKey, "PAY-99");
    assert.ok(reread!.jiraPublishedAt);
  });

  await test("removes a story and leaves the others", async () => {
    const draft = await repo.getDraft(draftId);
    const removed = await repo.removeStory(draftId, draft!.stories[2].id);
    assert.strictEqual(removed, true);
    assert.strictEqual((await repo.getDraft(draftId))!.stories.length, 2);
    assert.strictEqual(await repo.removeStory(draftId, "no-existe"), false);
  });

  await test("updates the TestRail destination and other fields independently", async () => {
    const updated = await repo.updateDraft(draftId, { testRail: { sectionId: 401 }, title: "Pagos sprint 14" });
    assert.deepStrictEqual(updated!.testRail, { projectId: 3, suiteId: 12, sectionId: 401 });
    assert.strictEqual(updated!.title, "Pagos sprint 14");
    assert.strictEqual(updated!.instructions, "incluir casos de error");
    assert.strictEqual(await repo.updateDraft("no-existe", { title: "x" }), null);
  });

  await test("lists drafts with counts, filtered by author and project, hiding archived ones", async () => {
    const mine = await repo.listDrafts({ createdBy: "user-1" });
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0].storyCount, 2);
    assert.strictEqual(mine[0].scenarioCount, 3);
    assert.deepStrictEqual(mine[0].issueKeys, ["PAY-10", "PAY-11"]);

    assert.strictEqual((await repo.listDrafts({ jiraProjectKey: "ops" })).length, 1);
    assert.strictEqual((await repo.listDrafts()).length, 2);

    assert.strictEqual(await repo.archiveDraft(draftId), true);
    assert.strictEqual((await repo.listDrafts()).length, 1);
    assert.strictEqual((await repo.listDrafts({ includeArchived: true })).length, 2);
    assert.strictEqual((await repo.getDraft(draftId))!.status, "archived");
  });

  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All test design repository tests passed.\n");
  }
}

main().catch((err) => {
  console.error(err);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
  process.exitCode = 1;
});
