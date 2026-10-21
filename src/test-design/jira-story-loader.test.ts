import assert from "node:assert/strict";
import test from "node:test";
import { mapJiraIssueForTestDesign } from "./jira-story-loader";
import type { RawJiraIssue } from "../types/jira.types";

test("maps Jira story content for Test Design without the scenario-source module", () => {
  const issue: RawJiraIssue = {
    id: "123",
    key: "PAY-42",
    fields: {
      summary: "  Transferir fondos  ",
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Descripción de la historia" }] }],
      },
      acceptance_criteria: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Validar confirmación" }] }],
      },
      labels: ["pagos", 4],
      components: [{ name: "Transferencias" }, {}, { name: " " }],
      status: { name: "Ready" },
      issuetype: { name: "Story" },
    },
  };

  assert.deepEqual(mapJiraIssueForTestDesign(issue, "acceptance_criteria"), {
    key: "PAY-42",
    summary: "Transferir fondos",
    description: "Descripción de la historia",
    acceptanceCriteria: "Validar confirmación",
    labels: ["pagos"],
    components: ["Transferencias"],
    status: "Ready",
    issueType: "Story",
  });
});
