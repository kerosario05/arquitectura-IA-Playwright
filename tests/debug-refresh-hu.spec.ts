import { test, expect } from "@playwright/test";
import { extractHuDeclaredItems } from "../src/knowledge/hu-declared-persister";
import { buildRequirementAccounting } from "../src/scenarios/scenario-functional-quality";
import { extractFunctionalBranchesFromHu } from "../src/scenarios/scenario-preview.service";
import type { JiraIssueSource } from "../src/scenarios/scenario-types";

const ISSUE: JiraIssueSource = {
  key: "HU-X",
  summary: "HU-X",
  description: 'El usuario debe seleccionar "Destino B". Para continuar debe seleccionar el boton Entrada A.',
  acceptanceCriteria: null,
  labels: [],
  components: [],
  status: "Open",
  issueType: "Story",
};

test("HU-derived knowledge remains declarative until runtime validation", () => {
  const huText = ISSUE.description ?? "";
  const branches = extractFunctionalBranchesFromHu(huText, [], []);
  const accounting = buildRequirementAccounting([], branches, huText, ISSUE.key);
  const items = extractHuDeclaredItems(accounting, branches, ISSUE.key);

  expect(items.length).toBeGreaterThan(0);
  expect(items.every((item) => item.source === "hu_declared")).toBe(true);
  expect(items.every((item) => item.validationStatus === "pending")).toBe(true);
  expect(items.every((item) => item.trustedForReuse === false)).toBe(true);
  expect(items.every((item) => item.executionBacked !== true)).toBe(true);
});
