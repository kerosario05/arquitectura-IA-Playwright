import { PRIORITY_LABELS, TYPE_LABELS } from "./test-design-labels";
import { describeTestData, renderWithData } from "./test-data";
import type { TestDesignScenario } from "./test-design.types";

/**
 * Renders a story's test cases as the Atlassian Document Format description of
 * its Jira sub-task: a summary line, then per case a heading (linked to its
 * TestRail case when published), type and priority, preconditions, a steps table
 * (#, Acción, Resultado esperado) and the final expected result.
 *
 * ADF rejects empty text nodes, so every text goes through `text()`, which
 * drops empties and turns line breaks into hardBreak nodes.
 */

type AdfNode = Record<string, unknown>;

export const SUMMARY_MAX = 255;

function text(value: string, marks?: AdfNode[]): AdfNode[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const nodes: AdfNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) nodes.push({ type: "hardBreak" });
    if (line) nodes.push(marks ? { type: "text", text: line, marks } : { type: "text", text: line });
  });
  return nodes;
}

const strong = (value: string) => text(value, [{ type: "strong" }]);

function paragraph(...content: AdfNode[][]): AdfNode {
  return { type: "paragraph", content: content.flat() };
}

function cell(kind: "tableHeader" | "tableCell", value: string): AdfNode {
  return { type: kind, attrs: {}, content: [paragraph(text(value))] };
}

function stepsTable(scenario: TestDesignScenario): AdfNode {
  const header = {
    type: "tableRow",
    content: [cell("tableHeader", "#"), cell("tableHeader", "Acción"), cell("tableHeader", "Resultado esperado")],
  };
  const rows = scenario.steps.map((step, i) => ({
    type: "tableRow",
    content: [cell("tableCell", String(i + 1)), cell("tableCell", step.action), cell("tableCell", step.expected)],
  }));
  return { type: "table", attrs: { isNumberColumnEnabled: false, layout: "default" }, content: [header, ...rows] };
}

export type SubtaskContext = {
  issueKey: string;
  issueSummary: string;
  /** e.g. https://empresa.testrail.io — used to link published cases. */
  testRailBaseUrl?: string | null;
  testRailSectionLabel?: string | null;
  updatedBy?: string | null;
  updatedAt?: Date;
};

export function buildSubtaskSummary(issueKey: string, issueSummary: string): string {
  const summary = `Casos de prueba – ${issueKey}${issueSummary ? ` ${issueSummary}` : ""}`.replace(/\s+/g, " ").trim();
  return summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary;
}

export function testRailCaseUrl(baseUrl: string, caseId: number): string {
  return `${baseUrl.replace(/\/+$/, "")}/index.php?/cases/view/${caseId}`;
}

export function buildSubtaskDescription(scenarios: TestDesignScenario[], ctx: SubtaskContext): AdfNode {
  const when = (ctx.updatedAt ?? new Date()).toISOString().slice(0, 16).replace("T", " ");
  const content: AdfNode[] = [
    paragraph(
      text(`Casos de prueba de la historia ${ctx.issueKey}${ctx.issueSummary ? ` — ${ctx.issueSummary}` : ""}.`),
      [{ type: "hardBreak" }],
      strong("Total: "),
      text(`${scenarios.length} ${scenarios.length === 1 ? "caso" : "casos"}`),
      ctx.testRailSectionLabel ? [{ type: "hardBreak" }, ...strong("TestRail: "), ...text(ctx.testRailSectionLabel)] : [],
      [{ type: "hardBreak" }],
      text(`Actualizado ${when} UTC${ctx.updatedBy ? ` por ${ctx.updatedBy}` : ""} desde QA Lab.`, [{ type: "em" }]),
    ),
  ];

  scenarios.forEach((source, index) => {
    // Placeholders become their values; sensitive ones stay as <Label>.
    const render = (value: string) => renderWithData(value, source.data);
    const scenario = {
      ...source,
      preconditions: render(source.preconditions),
      expectedResult: render(source.expectedResult),
      steps: source.steps.map((step) => ({ action: render(step.action), expected: render(step.expected) })),
    };
    const heading: AdfNode[] = text(`${index + 1}. ${scenario.title}`);
    if (scenario.testRailCaseId !== null) {
      const label = `C${scenario.testRailCaseId}`;
      heading.push({ type: "text", text: "  " });
      heading.push(
        ctx.testRailBaseUrl
          ? { type: "text", text: label, marks: [{ type: "link", attrs: { href: testRailCaseUrl(ctx.testRailBaseUrl, scenario.testRailCaseId) } }] }
          : { type: "text", text: label },
      );
    }
    content.push({ type: "heading", attrs: { level: 3 }, content: heading });
    content.push(
      paragraph(
        strong("Tipo: "),
        text(TYPE_LABELS[scenario.type]),
        text("   "),
        strong("Prioridad: "),
        text(PRIORITY_LABELS[scenario.priority]),
      ),
    );
    if (scenario.preconditions) content.push(paragraph(strong("Precondiciones: "), text(scenario.preconditions)));
    if (scenario.data.length > 0) {
      content.push(paragraph(strong("Datos de prueba:"), [{ type: "hardBreak" }], text(describeTestData(scenario.data).join("\n"))));
    }
    if (scenario.steps.length > 0) content.push(stepsTable(scenario));
    if (scenario.expectedResult) content.push(paragraph(strong("Resultado esperado: "), text(scenario.expectedResult)));
  });

  return { type: "doc", version: 1, content };
}
