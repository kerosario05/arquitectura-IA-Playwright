import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { refreshHuDeclaredFromIssue } from "../src/server/routes/debug";
import type { JiraIssueSource } from "../src/scenarios/scenario-types";

const SLUG = "refresh-hu-test";
const APP_DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(APP_DIR, "app.knowledge.json");

const ISSUE: JiraIssueSource = {
  key: "HU-X",
  summary: "HU-X",
  description:
    'El usuario debe seleccionar "Destino B". Para continuar debe seleccionar el boton Entrada A.',
  acceptanceCriteria: null,
  labels: [],
  components: [],
  status: "Open",
  issueType: "Story",
};

test.afterAll(() => {
  try {
    fs.rmSync(APP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("refresh-hu: deriva hu_declared + declared_path, materializa, sin duplicar, sin AI", async () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
    origLog(...args);
  };

  let r1: Awaited<ReturnType<typeof refreshHuDeclaredFromIssue>>;
  let r2: Awaited<ReturnType<typeof refreshHuDeclaredFromIssue>>;
  try {
    r1 = await refreshHuDeclaredFromIssue(SLUG, ISSUE);
    r2 = await refreshHuDeclaredFromIssue(SLUG, ISSUE);
  } finally {
    console.log = origLog;
  }

  // Success + response shape
  expect(r1.success).toBe(true);
  expect(r1.appSlug).toBe(SLUG);
  expect(r1.issueKey).toBe("HU-X");
  expect(r1.derived).toBeGreaterThan(0);
  expect(r1.declaredPaths).toBe(1);

  // app.knowledge.json materializado
  const data = JSON.parse(fs.readFileSync(KP, "utf-8")) as { items: any[] };
  const declaredPath = data.items.find((i) => i.category === "declared_path");
  expect(declaredPath).toBeDefined();
  expect(declaredPath.steps).toHaveLength(2);
  expect(declaredPath.steps[0]).toMatchObject({
    order: 1,
    stepKind: "prerequisite",
    actionTarget: "Entrada A",
  });
  expect(declaredPath.steps[1]).toMatchObject({
    order: 2,
    stepKind: "branch_action",
    actionTarget: "Destino B",
  });

  // Authority: purely declarative
  expect(declaredPath.validationStatus).toBe("pending");
  expect(declaredPath.trustedForReuse).toBe(false);
  expect(declaredPath.executionBacked).toBe(false);
  expect(declaredPath.source).toBe("hu_declared");

  // hu_declared persisted (prerequisite item present)
  const prereq = data.items.find((i) => i.category === "prerequisite");
  expect(prereq).toBeDefined();
  expect(prereq.sourceIssueKey).toBe("HU-X");

  // Same issue regenerated → no duplication
  const data2 = JSON.parse(fs.readFileSync(KP, "utf-8")) as { items: any[] };
  expect(data2.items.filter((i) => i.category === "declared_path")).toHaveLength(1);
  expect(r2.deduped).toBeGreaterThanOrEqual(0);

  // No AI provider invoked
  expect(logs.some((l) => l.includes("[scenarios:ai]") || l.includes("[codex-cli]"))).toBe(false);

  console.log(`refresh-hu OK: derived=${r1.derived} declaredPaths=${r1.declaredPaths}`);
});