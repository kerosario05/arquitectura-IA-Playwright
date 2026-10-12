import assert from "node:assert/strict";
import test from "node:test";
import { buildSubtaskDescription, buildSubtaskSummary, SUMMARY_MAX } from "./jira-subtask-formatter";
import { chooseSubtaskType, SubtaskTypeNotFoundError } from "./jira-subtask-type";
import { computeDraftStatus, mapPriorities, toCaseInput } from "./test-design-publisher";
import { normalizeScenario } from "./test-design.validation";
import type { TestDesignDraftStory, TestDesignDraftWithStories } from "./test-design.types";

const scenario = (over: Record<string, unknown> = {}) =>
  normalizeScenario(
    {
      title: "Pagar con tarjeta",
      preconditions: "Sesión iniciada\nPedido pendiente",
      steps: [
        { action: "Abrir el pedido", expected: "Se ve el detalle" },
        { action: "Pagar", expected: "" },
      ],
      expectedResult: "Pedido pagado",
      priority: "high",
      type: "negative",
      ...over,
    },
    0,
  );

function collectTextNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => collectTextNodes(n, out));
  else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    if (n.type === "text") out.push(n);
    collectTextNodes(n.content, out);
  }
  return out;
}

test("sub-task summary names the story and stays within Jira's limit", () => {
  assert.equal(buildSubtaskSummary("PAY-1", "Pagar"), "Casos de prueba – PAY-1 Pagar");
  const long = buildSubtaskSummary("PAY-1", "x".repeat(400));
  assert.equal(long.length, SUMMARY_MAX);
  assert.ok(long.endsWith("…"));
});

test("the ADF description has a heading, steps table and expected result per case", () => {
  const doc = buildSubtaskDescription([scenario({ testRailCaseId: 77 }), scenario({ title: "Otro" })], {
    issueKey: "PAY-1",
    issueSummary: "Pagar",
    testRailBaseUrl: "https://tr.example.com/",
    testRailSectionLabel: "sección 400",
    updatedBy: "ana",
  }) as { type: string; content: Record<string, any>[] };

  assert.equal(doc.type, "doc");
  const headings = doc.content.filter((n) => n.type === "heading");
  assert.equal(headings.length, 2);
  const link = collectTextNodes(headings[0]).find((n) => n.text === "C77") as any;
  assert.equal(link.marks[0].attrs.href, "https://tr.example.com/index.php?/cases/view/77");

  const tables = doc.content.filter((n) => n.type === "table");
  assert.equal(tables.length, 2);
  assert.equal(tables[0].content.length, 3, "header + 2 steps");
  const headerTexts = collectTextNodes(tables[0].content[0]).map((n) => n.text);
  assert.deepEqual(headerTexts, ["#", "Acción", "Resultado esperado"]);

  const all = collectTextNodes(doc);
  assert.ok(all.every((n) => typeof n.text === "string" && (n.text as string).length > 0), "ADF forbids empty text nodes");
  assert.ok(all.some((n) => n.text === "Negativo"));
  assert.ok(all.some((n) => n.text === "Pedido pagado"));
  assert.ok(JSON.stringify(doc).includes('"hardBreak"'), "multi-line preconditions keep their breaks");
});

test("sub-task type: configured name wins, then Plan de pruebas, then the generic sub-task", () => {
  const types = [
    { id: "1", name: "Defecto" },
    { id: "2", name: "Sub-task" },
    { id: "3", name: "Plan de pruebas" },
  ];
  assert.equal(chooseSubtaskType("PAY", types).id, "3");
  assert.equal(chooseSubtaskType("PAY", types.slice(0, 2)).id, "2");
  assert.equal(chooseSubtaskType("PAY", [{ id: "9", name: "Subtarea" }]).id, "9");
  assert.equal(chooseSubtaskType("PAY", types, "sub-TASK").id, "2");
  assert.throws(() => chooseSubtaskType("PAY", types, "Inexistente"), SubtaskTypeNotFoundError);
  assert.throws(() => chooseSubtaskType("PAY", [{ id: "1", name: "Defecto" }]), /Defecto/);
});

test("priorities map onto the instance's own levels by weight", () => {
  const priorities = [
    { id: 4, name: "Critical", priority: 4 },
    { id: 1, name: "Low", priority: 1 },
    { id: 3, name: "High", priority: 3 },
    { id: 2, name: "Medium", priority: 2 },
  ];
  assert.deepEqual(mapPriorities(priorities), { low: 1, medium: 2, high: 3, critical: 4 });
  assert.deepEqual(mapPriorities([{ id: 7, name: "Única", priority: 1 }]), { low: 7, medium: 7, high: 7, critical: 7 });
  assert.deepEqual(mapPriorities([]), {});
});

test("the TestRail case carries steps with their expected results and the story as reference", () => {
  const input = toCaseInput(scenario(), "PAY-1", { requiredCustomFields: { custom_area: "QA" }, caseOracle: "QA" }, 3);
  assert.equal(input.refs, "PAY-1");
  assert.equal(input.priorityId, 3);
  assert.deepEqual(input.stepsSeparated, [
    { content: "Abrir el pedido", expected: "Se ve el detalle" },
    { content: "Pagar", expected: undefined },
  ]);
  assert.equal(input.customExpected, "Pedido pagado");
  assert.equal(input.preconditions, "Sesión iniciada\nPedido pendiente");
  assert.deepEqual(input.customFields, { custom_area: "QA" });
});

test("draft status follows what each story still has to publish", () => {
  const story = (over: Partial<TestDesignDraftStory>): TestDesignDraftStory => ({
    id: "s",
    draftId: "d",
    issueKey: "PAY-1",
    issueSummary: "",
    position: 0,
    generationStatus: "ready",
    generationError: null,
    scenarios: [scenario()],
    jiraSubtaskKey: null,
    jiraPublishedAt: null,
    testRailPublishedAt: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  });
  const draft = (stories: TestDesignDraftStory[], status: TestDesignDraftWithStories["status"] = "draft") =>
    ({ id: "d", status, stories }) as TestDesignDraftWithStories;

  const withJira = { jira: true };
  assert.equal(computeDraftStatus(draft([story({})]), withJira), "draft");
  assert.equal(computeDraftStatus(draft([story({ testRailPublishedAt: "x" })]), withJira), "partially_published");
  const published = { testRailPublishedAt: "x", jiraPublishedAt: "y" };
  assert.equal(
    computeDraftStatus(draft([story({ ...published, scenarios: [scenario({ testRailCaseId: 5 })] })]), withJira),
    "published",
  );
  // A selected scenario whose case failed to upload keeps the draft partial.
  assert.equal(computeDraftStatus(draft([story(published)]), withJira), "partially_published");
  const jiraOnly = story({ scenarios: [scenario({ selectedForTestRail: false })], jiraPublishedAt: "y" });
  assert.equal(computeDraftStatus(draft([jiraOnly]), withJira), "published");
  assert.equal(computeDraftStatus(draft([jiraOnly], "archived"), withJira), "archived");
});

test("with Jira publishing off, a draft whose cases are all in TestRail is published", () => {
  // The case that showed "Publicado en parte": every case in TestRail, Jira still selected by default.
  const story = {
    id: "s",
    draftId: "d",
    issueKey: "AA-97",
    issueSummary: "",
    position: 0,
    generationStatus: "ready",
    generationError: null,
    scenarios: [scenario({ testRailCaseId: 5, selectedForJira: true })],
    jiraSubtaskKey: null,
    jiraPublishedAt: null,
    testRailPublishedAt: "x",
    createdAt: "",
    updatedAt: "",
  } as TestDesignDraftStory;
  const draft = { id: "d", status: "partially_published", stories: [story] } as TestDesignDraftWithStories;
  assert.equal(computeDraftStatus(draft, { jira: false }), "published");
  assert.equal(computeDraftStatus(draft, { jira: true }), "partially_published");
});
