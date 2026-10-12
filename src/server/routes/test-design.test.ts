import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/**
 * HTTP test for the test design routes behind the real auth chain and route
 * policy, against a throwaway SQLite file. Jira is never called: the Jira routes
 * are only exercised on their validation paths.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-test-design-routes-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "routes.db");
process.env.AUTH_ENABLED = "true";
process.env.TEST_DESIGN_MAX_STORIES = "3";
// The suite exercises Jira publishing too, so the draft status must account for it.
process.env.TEST_DESIGN_JIRA_PUBLISH_ENABLED = "true";
delete process.env.API_KEY;
for (const key of ["AUTH_BOOTSTRAP_USERNAME", "AUTH_BOOTSTRAP_PASSWORD", "AUTH_BOOTSTRAP_FULLNAME"]) {
  delete process.env[key];
}

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
  const express = (await import("express")).default;
  const sqlConnection = await import("../../db/sql-connection");
  const { bootstrapIdentity } = await import("../../auth/bootstrap");
  const { attachPrincipal, requireFullScope } = await import("../middleware/auth");
  const { enforceRoutePolicy } = await import("../middleware/route-policy");
  const { authRouter } = await import("./auth");
  const { usersRouter } = await import("./users");
  const { testDesignRouter } = await import("./test-design");

  const conn = await sqlConnection.getConnection();

  const app = express();
  app.use(express.json());
  app.use(attachPrincipal());
  app.use(requireFullScope());
  app.use(enforceRoutePolicy());
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/test-design", testDesignRouter);
  app.use((err: unknown, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, route: string, token: string, body?: unknown) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function login(username: string, temp: string, next: string): Promise<string> {
    const first = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: temp }),
    }).then((r) => r.json());
    const changed = await fetch(`${base}/api/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ currentPassword: temp, newPassword: next }),
    }).then((r) => r.json());
    return changed.token;
  }

  // --- fixtures -----------------------------------------------------------
  await bootstrapIdentity({ username: "admin", password: "Arranque12345" });
  const adminToken = await login("admin", "Arranque12345", "ClaveMaestra12345");

  for (const slug of ["kiosko", "portal"]) {
    await conn.query(`INSERT INTO dbo.Projects (slug, name, projectType, status, enabled) VALUES (?, ?, 1, 1, 1)`, [slug, slug]);
  }
  const [kiosko] = await conn.query<{ id: string }>(`SELECT id FROM dbo.Projects WHERE slug = 'kiosko'`);
  await conn.query(`INSERT INTO dbo.ProjectJiraConfiguration (projectId, projectKey) VALUES (?, 'PAY')`, [kiosko.id]);
  await conn.query(
    `INSERT INTO dbo.ProjectTestRailConfiguration (projectId, projectIdTr, suiteId, sectionId) VALUES (?, '3', '12', '400')`,
    [kiosko.id],
  );
  const knowledge = {
    version: 1,
    items: [
      {
        knowledgeKind: "route_menu_snapshot",
        screenKey: "pago",
        assertionTargets: ["Pagar pedido", "Número de tarjeta"],
        clickTargets: ["Confirmar pago"],
        trustedForReuse: true,
      },
      { knowledgeKind: "hu_declared", expectedBehavior: "Rechazar tarjetas vencidas", sourceIssueKey: "PAY-2" },
    ],
  };
  await conn.query(`INSERT INTO dbo.ProjectKnowledge (projectId, knowledgeJson) VALUES (?, ?)`, [kiosko.id, JSON.stringify(knowledge)]);

  async function engineer(username: string, projects: { slug: string; accessLevel: number }[]) {
    const created = await call("POST", "/api/users", adminToken, {
      username,
      fullName: username,
      roles: ["qa-engineer"],
      projects,
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    return login(username, created.body.temporaryPassword, "ClaveDePrueba12345");
  }
  const anaToken = await engineer("ana", [{ slug: "kiosko", accessLevel: 2 }]);
  const luisToken = await engineer("luis", [{ slug: "kiosko", accessLevel: 1 }]);
  const evaToken = await engineer("eva", [{ slug: "portal", accessLevel: 2 }]);

  const scenario = {
    title: "Pago con tarjeta válida",
    preconditions: "Sesión iniciada",
    steps: [{ action: "Pagar", expected: "Pago aprobado" }],
    expectedResult: "Pago registrado",
  };

  // ------------------------------------------------------------------------
  console.log("\nborradores");

  let draftId = "";
  let storyId = "";

  await test("creates a draft for several stories", async () => {
    const res = await call("POST", "/api/test-design/drafts", anaToken, {
      jiraProjectKey: "pay",
      projectSlug: "kiosko",
      testRail: { projectId: 3, suiteId: 12, sectionId: 400 },
      issues: [{ issueKey: "PAY-1", issueSummary: "Pagar" }, "pay-2"],
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    draftId = res.body.draft.id;
    storyId = res.body.draft.stories[0].id;
    assert.deepStrictEqual(res.body.draft.stories.map((s: any) => s.issueKey), ["PAY-1", "PAY-2"]);
    assert.strictEqual(res.body.draft.createdByName, "ana");
  });

  await test("rejects stories from another project, bad keys and too many stories", async () => {
    const other = await call("POST", "/api/test-design/drafts", anaToken, { projectSlug: "kiosko", jiraProjectKey: "PAY", issues: ["OPS-1"] });
    assert.strictEqual(other.status, 400);
    assert.match(other.body.message, /no pertenece/);

    const bad = await call("POST", "/api/test-design/drafts", anaToken, { projectSlug: "kiosko", jiraProjectKey: "PAY", issues: ["PAY"] });
    assert.strictEqual(bad.status, 400);

    const empty = await call("POST", "/api/test-design/drafts", anaToken, { projectSlug: "kiosko", jiraProjectKey: "PAY", issues: [] });
    assert.strictEqual(empty.status, 400);

    const many = await call("POST", "/api/test-design/drafts", anaToken, {
      projectSlug: "kiosko",
      jiraProjectKey: "PAY",
      issues: ["PAY-1", "PAY-2", "PAY-3", "PAY-4"],
    });
    assert.strictEqual(many.status, 400);
    assert.match(many.body.message, /máximo 3/);
  });

  await test("refuses a draft for a project the user was not granted", async () => {
    const res = await call("POST", "/api/test-design/drafts", anaToken, {
      jiraProjectKey: "PAY",
      projectSlug: "portal",
      issues: ["PAY-1"],
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "project_forbidden");
  });

  await test("saves edited scenarios and keeps independent destination selections", async () => {
    const res = await call("PUT", `/api/test-design/drafts/${draftId}/stories/${storyId}/scenarios`, anaToken, {
      scenarios: [
        { ...scenario, id: "a" },
        { ...scenario, id: "b", title: "Tarjeta vencida", selectedForTestRail: false, selectedForJira: true },
      ],
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const [a, b] = res.body.story.scenarios;
    assert.strictEqual(a.selectedForTestRail, true);
    assert.strictEqual(b.selectedForTestRail, false);
    assert.strictEqual(b.selectedForJira, true);
    assert.strictEqual(a.origin, "manual");
  });

  await test("marks a changed scenario as edited, but not a selection-only change", async () => {
    const res = await call("PUT", `/api/test-design/drafts/${draftId}/stories/${storyId}/scenarios`, anaToken, {
      scenarios: [
        { ...scenario, id: "a", selectedForJira: false },
        { ...scenario, id: "b", title: "Tarjeta vencida (rechazo)" },
      ],
    });
    const [a, b] = res.body.story.scenarios;
    assert.strictEqual(a.edited, false);
    assert.strictEqual(b.edited, true);
  });

  await test("the panel cannot attach a TestRail case id to a scenario", async () => {
    const res = await call("PUT", `/api/test-design/drafts/${draftId}/stories/${storyId}/scenarios`, anaToken, {
      scenarios: [{ ...scenario, id: "c", testRailCaseId: 555 }],
    });
    assert.strictEqual(res.body.story.scenarios[0].testRailCaseId, null);
  });

  await test("rejects malformed scenarios with a 400", async () => {
    const res = await call("PUT", `/api/test-design/drafts/${draftId}/stories/${storyId}/scenarios`, anaToken, {
      scenarios: [{ title: 5 }],
    });
    assert.strictEqual(res.status, 400);
  });

  await test("updates the destination and the story list", async () => {
    const res = await call("PUT", `/api/test-design/drafts/${draftId}`, anaToken, {
      testRail: { sectionId: 401 },
      addIssues: ["PAY-3"],
      removeStoryIds: [],
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.draft.testRail.sectionId, 401);
    assert.strictEqual(res.body.draft.stories.length, 3);

    const tooMany = await call("PUT", `/api/test-design/drafts/${draftId}`, anaToken, { addIssues: ["PAY-4"] });
    assert.strictEqual(tooMany.status, 400);

    const removeId = res.body.draft.stories[2].id;
    const removed = await call("PUT", `/api/test-design/drafts/${draftId}`, anaToken, { removeStoryIds: [removeId] });
    assert.strictEqual(removed.body.draft.stories.length, 2);
  });

  // ------------------------------------------------------------------------
  console.log("\nvisibilidad");

  await test("a read-only member of the project sees the draft but cannot edit it", async () => {
    assert.strictEqual((await call("GET", `/api/test-design/drafts/${draftId}`, luisToken)).status, 200);
    const edit = await call("PUT", `/api/test-design/drafts/${draftId}`, luisToken, { title: "x" });
    assert.strictEqual(edit.status, 403);
  });

  await test("a user outside the project gets a 404 and an empty list", async () => {
    assert.strictEqual((await call("GET", `/api/test-design/drafts/${draftId}`, evaToken)).status, 404);
    const list = await call("GET", "/api/test-design/drafts", evaToken);
    assert.deepStrictEqual(list.body.drafts, []);
  });

  await test("a draft always names its project, and only members of that project see it", async () => {
    const missing = await call("POST", "/api/test-design/drafts", adminToken, { jiraProjectKey: "PAY", issues: ["PAY-1"] });
    assert.strictEqual(missing.status, 400);
    assert.match(missing.body.message, /proyecto/);

    const created = await call("POST", "/api/test-design/drafts", evaToken, { projectSlug: "portal", jiraProjectKey: "OPS", issues: ["OPS-1"] });
    assert.strictEqual(created.status, 201);
    const id = created.body.draft.id;
    assert.strictEqual((await call("GET", `/api/test-design/drafts/${id}`, anaToken)).status, 404);
    assert.strictEqual((await call("GET", `/api/test-design/drafts/${id}`, adminToken)).status, 200);

    const mine = await call("GET", "/api/test-design/drafts?mine=true", evaToken);
    assert.deepStrictEqual(mine.body.drafts.map((d: any) => d.id), [id]);
  });

  await test("archiving hides the draft and blocks further edits", async () => {
    assert.strictEqual((await call("DELETE", `/api/test-design/drafts/${draftId}`, anaToken)).status, 200);
    const list = await call("GET", "/api/test-design/drafts", anaToken);
    assert.ok(!list.body.drafts.some((d: any) => d.id === draftId));
    const edit = await call("PUT", `/api/test-design/drafts/${draftId}`, anaToken, { title: "x" });
    assert.strictEqual(edit.status, 409);
  });

  // ------------------------------------------------------------------------
  console.log("\nproyecto");

  await test("lists only the projects the user may access, with their defaults and knowledge", async () => {
    const res = await call("GET", "/api/test-design/projects", anaToken);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.projects.map((p: any) => p.slug), ["kiosko"]);
    const [project] = res.body.projects;
    assert.strictEqual(project.jiraProjectKey, "PAY");
    assert.deepStrictEqual(project.testRail, { projectId: 3, suiteId: 12, sectionId: 400 });
    assert.deepStrictEqual(project.knowledge, { screens: 1, flows: 0, behaviours: 1, total: 2 });

    const all = await call("GET", "/api/test-design/projects", adminToken);
    assert.deepStrictEqual(all.body.projects.map((p: any) => p.slug).sort(), ["kiosko", "portal"]);
  });

  await test("a new draft takes Jira and TestRail from the project configuration", async () => {
    const res = await call("POST", "/api/test-design/drafts", anaToken, { projectSlug: "kiosko", issues: ["PAY-40"] });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.draft.jiraProjectKey, "PAY");
    assert.deepStrictEqual(res.body.draft.testRail, { projectId: 3, suiteId: 12, sectionId: 400 });
  });

  await test("a project without Jira configured needs the Jira project explicitly", async () => {
    const res = await call("POST", "/api/test-design/drafts", adminToken, { projectSlug: "portal", issues: ["PAY-41"] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Jira/);
  });

  // ------------------------------------------------------------------------
  console.log("\ngeneración");

  const { setGenerationDepsForTesting } = await import("./test-design");
  const { INTERRUPTED_MESSAGE } = await import("../../test-design/test-design-generation-runner");
  const repo = await import("../../db/test-design-repository");

  let release: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  const holdGeneration = () => {
    gate = new Promise<void>((resolve) => (release = resolve));
  };
  const aiTitles: Record<string, string[]> = {
    "PAY-5": ["Pagar con tarjeta vigente", "Rechazar tarjeta vencida"],
    "PAY-6": ["Emitir reembolso total"],
  };
  const { loadProjectContext } = await import("../../test-design/project-knowledge-context");
  const prompts: string[] = [];
  setGenerationDepsForTesting({
    loadProjectContext: async (slug, issueKey) => (await loadProjectContext(slug, issueKey))?.text ?? null,
    loadIssue: async (key) => {
      await gate;
      if (key === "PAY-404") throw new Error("Issue does not exist");
      return { key, summary: `Resumen de ${key}`, description: "d", acceptanceCriteria: null, labels: [], components: [], status: "", issueType: "Story" };
    },
    createProvider: async () => ({
      providerType: "fake",
      providerName: "fake",
      model: "fake",
      async completeJson(request) {
        await gate;
        prompts.push(request.messages[1].content);
        const key = /Historia: (\S+)/.exec(request.messages[1].content)?.[1] ?? "";
        const titles = aiTitles[key] ?? ["Caso genérico"];
        const parsedJson = {
          scenarios: titles.map((title) => ({ title, steps: [{ action: "Hacer", expected: "Ocurre" }], expectedResult: "Ok" })),
        };
        return { rawText: JSON.stringify(parsedJson), parsedJson, model: "fake", providerName: "fake", durationMs: 1 };
      },
    }),
  });

  async function waitForGeneration(id: string) {
    for (let i = 0; i < 100; i += 1) {
      const res = await call("GET", `/api/test-design/drafts/${id}`, anaToken);
      if (!res.body.draft.stories.some((s: any) => s.generationStatus === "generating")) return res.body.draft;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("generation did not finish");
  }

  let genDraftId = "";
  await test("generates every pending story, isolating a failure to its own story", async () => {
    const created = await call("POST", "/api/test-design/drafts", anaToken, {
      jiraProjectKey: "PAY",
      projectSlug: "kiosko",
      issues: ["PAY-5", "PAY-6", "PAY-404"],
    });
    genDraftId = created.body.draft.id;
    const started = await call("POST", `/api/test-design/drafts/${genDraftId}/generate`, anaToken, {});
    assert.strictEqual(started.status, 202, JSON.stringify(started.body));

    const draft = await waitForGeneration(genDraftId);
    const byKey = Object.fromEntries(draft.stories.map((s: any) => [s.issueKey, s]));
    assert.strictEqual(byKey["PAY-5"].generationStatus, "ready");
    assert.deepStrictEqual(byKey["PAY-5"].scenarios.map((s: any) => s.title), aiTitles["PAY-5"]);
    assert.strictEqual(byKey["PAY-5"].issueSummary, "Resumen de PAY-5");
    assert.strictEqual(byKey["PAY-5"].scenarios[0].origin, "ai");
    assert.strictEqual(byKey["PAY-6"].generationStatus, "ready");
    assert.strictEqual(byKey["PAY-404"].generationStatus, "failed");
    assert.match(byKey["PAY-404"].generationError, /does not exist/);
  });

  await test("the prompt carries the project knowledge, before the story", async () => {
    const prompt = prompts.find((p) => p.includes("Historia: PAY-5"));
    assert.ok(prompt, "PAY-5 was generated");
    assert.match(prompt!, /Conocimiento del proyecto/);
    assert.match(prompt!, /pago: Pagar pedido \| Número de tarjeta \| Confirmar pago/);
    assert.match(prompt!, /Rechazar tarjetas vencidas \(PAY-2\)/);
    assert.ok(prompt!.indexOf("Conocimiento del proyecto") < prompt!.indexOf("Historia: PAY-5"));
  });

  await test("a second generate only retries the failed story", async () => {
    holdGeneration();
    const res = await call("POST", `/api/test-design/drafts/${genDraftId}/generate`, anaToken, {});
    assert.strictEqual(res.status, 202);
    const generatingKeys = res.body.draft.stories.filter((s: any) => s.generationStatus === "generating").map((s: any) => s.issueKey);
    release();
    assert.deepStrictEqual(generatingKeys, ["PAY-404"]);
    await waitForGeneration(genDraftId);
  });

  await test("blocks edits and a second run while a story is generating", async () => {
    holdGeneration();
    const draft = (await call("GET", `/api/test-design/drafts/${genDraftId}`, anaToken)).body.draft;
    const story = draft.stories.find((s: any) => s.issueKey === "PAY-5");
    const first = await call("POST", `/api/test-design/drafts/${genDraftId}/stories/${story.id}/regenerate`, anaToken, {});
    assert.strictEqual(first.status, 202);

    const again = await call("POST", `/api/test-design/drafts/${genDraftId}/stories/${story.id}/regenerate`, anaToken, {});
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.error, "generation_in_progress");

    const save = await call("PUT", `/api/test-design/drafts/${genDraftId}/stories/${story.id}/scenarios`, anaToken, { scenarios: [] });
    assert.strictEqual(save.status, 409);

    const remove = await call("PUT", `/api/test-design/drafts/${genDraftId}`, anaToken, { removeStoryIds: [story.id] });
    assert.strictEqual(remove.status, 409);

    release();
    await waitForGeneration(genDraftId);
  });

  await test("regeneration keeps the scenarios a person edited", async () => {
    let draft = (await call("GET", `/api/test-design/drafts/${genDraftId}`, anaToken)).body.draft;
    const story = draft.stories.find((s: any) => s.issueKey === "PAY-5");
    const edited = story.scenarios.map((s: any, i: number) => (i === 0 ? { ...s, title: "Pagar con tarjeta vigente y CVV" } : s));
    await call("PUT", `/api/test-design/drafts/${genDraftId}/stories/${story.id}/scenarios`, anaToken, { scenarios: edited });

    await call("POST", `/api/test-design/drafts/${genDraftId}/stories/${story.id}/regenerate`, anaToken, {});
    draft = await waitForGeneration(genDraftId);
    const titles = draft.stories.find((s: any) => s.issueKey === "PAY-5").scenarios.map((s: any) => s.title);
    assert.deepStrictEqual(titles, ["Pagar con tarjeta vigente y CVV", ...aiTitles["PAY-5"]]);
  });

  await test("a story left generating by a restart is reported as interrupted", async () => {
    const draft = (await call("GET", `/api/test-design/drafts/${genDraftId}`, anaToken)).body.draft;
    const story = draft.stories.find((s: any) => s.issueKey === "PAY-6");
    await repo.setStoryGeneration(genDraftId, story.id, { status: "generating" });
    const reread = (await call("GET", `/api/test-design/drafts/${genDraftId}`, anaToken)).body.draft;
    const settled = reread.stories.find((s: any) => s.issueKey === "PAY-6");
    assert.strictEqual(settled.generationStatus, "failed");
    assert.strictEqual(settled.generationError, INTERRUPTED_MESSAGE);
  });

  await test("a read-only user cannot start a generation", async () => {
    const res = await call("POST", `/api/test-design/drafts/${genDraftId}/generate`, luisToken, {});
    assert.strictEqual(res.status, 403);
  });

  setGenerationDepsForTesting(null);

  // ------------------------------------------------------------------------
  console.log("\npublicación");

  const { setPublishDepsForTesting } = await import("./test-design");
  const { clearSubtaskTypeCache } = await import("../../test-design/jira-subtask-type");

  type FakeCase = { id: number; title: string; section_id: number; payload: any };
  const tr = {
    cases: new Map<number, FakeCase>(),
    nextId: 1000,
    calls: [] as string[],
    failTitles: new Set<string>(),
    commitThen500Titles: new Set<string>(),
  };
  const fakeTestRail = {
    async addCase(sectionId: string, input: any) {
      tr.calls.push(`add:${input.title}`);
      if (tr.failTitles.has(input.title)) throw Object.assign(new Error("TestRail API error (HTTP 400): bad field"), { status: 400 });
      const created = { id: tr.nextId++, title: input.title, section_id: Number(sectionId), payload: input };
      tr.cases.set(created.id, created);
      if (tr.commitThen500Titles.has(input.title)) {
        throw Object.assign(new Error("TestRail API error (HTTP 500): hook failed"), { status: 500 });
      }
      return created;
    },
    async updateCase(caseId: number, input: any) {
      tr.calls.push(`update:${caseId}`);
      const existing = tr.cases.get(caseId);
      if (!existing) throw Object.assign(new Error("TestRail API error (HTTP 400): Field :case_id is not a valid test case."), { status: 400 });
      existing.payload = input;
      existing.title = input.title;
      return existing;
    },
    async getCases(_projectId: string, _suiteId?: string, sectionId?: string) {
      return [...tr.cases.values()].filter((c) => String(c.section_id) === sectionId);
    },
    async getPriorities() {
      return [
        { id: 1, name: "Low", priority: 1 },
        { id: 2, name: "Medium", priority: 2 },
        { id: 3, name: "High", priority: 3 },
        { id: 4, name: "Critical", priority: 4 },
      ];
    },
  };

  const jr = { issues: new Map<string, any>(), next: 500, calls: [] as string[] };
  const fakeJira = {
    async getSubtaskIssueTypes() {
      return [{ id: "10003", name: "Sub-task", subtask: true }, { id: "10915", name: "Plan de pruebas", subtask: true }];
    },
    async createIssueWithFields(fields: any) {
      const key = `${fields.project.key}-${jr.next++}`;
      jr.calls.push(`create:${key}:parent=${fields.parent.key}:type=${fields.issuetype.id}`);
      jr.issues.set(key, fields);
      return { key, id: key };
    },
    async updateIssueFields(key: string, fields: any) {
      jr.calls.push(`update:${key}`);
      jr.issues.set(key, { ...jr.issues.get(key), ...fields });
    },
    async issueExists(key: string) {
      return jr.issues.has(key);
    },
    browseUrl: (key: string) => `https://jira.example.com/browse/${key}`,
  };
  clearSubtaskTypeCache();
  setPublishDepsForTesting({ testRail: () => ({ client: fakeTestRail, baseUrl: "https://tr.example.com" }), jira: () => fakeJira });

  const ok = (title: string, over: Record<string, unknown> = {}) => ({
    title,
    steps: [{ action: "Hacer", expected: "Ocurre" }],
    expectedResult: "Listo",
    ...over,
  });

  let pubDraftId = "";
  let pubStories: any[] = [];
  await test("prepares a draft with scenarios for both destinations", async () => {
    const created = await call("POST", "/api/test-design/drafts", adminToken, {
      projectSlug: "portal",
      jiraProjectKey: "PAY",
      testRail: { projectId: 3, sectionId: 400 },
      issues: ["PAY-20", "PAY-21"],
    });
    pubDraftId = created.body.draft.id;
    pubStories = created.body.draft.stories;
    await call("PUT", `/api/test-design/drafts/${pubDraftId}/stories/${pubStories[0].id}/scenarios`, adminToken, {
      scenarios: [
        ok("Caso A", { id: "a", priority: "critical" }),
        ok("Caso B", { id: "b", selectedForJira: false }),
        ok("Solo Jira", { id: "c", selectedForTestRail: false }),
      ],
    });
    await call("PUT", `/api/test-design/drafts/${pubDraftId}/stories/${pubStories[1].id}/scenarios`, adminToken, {
      scenarios: [ok("Caso D", { id: "d", selectedForJira: false })],
    });
  });

  await test("an engineer without publish permissions gets a 403", async () => {
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/testrail`, anaToken, {});
    assert.strictEqual(res.status, 403);
  });

  await test("refuses to publish an incomplete selected scenario, naming the problem", async () => {
    await call("PUT", `/api/test-design/drafts/${pubDraftId}/stories/${pubStories[1].id}/scenarios`, adminToken, {
      scenarios: [ok("Caso D", { id: "d", selectedForJira: false }), { id: "e", title: "", steps: [] }],
    });
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/testrail`, adminToken, {});
    assert.strictEqual(res.status, 422);
    assert.deepStrictEqual(res.body.issues.map((i: any) => [i.issueKey, i.problem]).slice(0, 2), [
      ["PAY-21", "sin título"],
      ["PAY-21", "sin pasos"],
    ]);
    assert.strictEqual(tr.calls.length, 0, "nothing was sent");
    await call("PUT", `/api/test-design/drafts/${pubDraftId}/stories/${pubStories[1].id}/scenarios`, adminToken, {
      scenarios: [ok("Caso D", { id: "d", selectedForJira: false }), { id: "e", title: "", steps: [], selectedForTestRail: false, selectedForJira: false }],
    });
  });

  await test("creates one TestRail case per selected scenario and stores the ids", async () => {
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/testrail`, adminToken, {});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const outcomes = res.body.results.flatMap((r: any) => r.scenarios.map((s: any) => [s.title, s.status]));
    assert.deepStrictEqual(outcomes, [["Caso A", "created"], ["Caso B", "created"], ["Caso D", "created"]]);
    const story0 = res.body.draft.stories.find((s: any) => s.issueKey === "PAY-20");
    const byId = Object.fromEntries(story0.scenarios.map((s: any) => [s.id, s.testRailCaseId]));
    assert.ok(byId.a && byId.b);
    assert.strictEqual(byId.c, null, "not selected for TestRail");
    assert.strictEqual(res.body.draft.status, "partially_published");
    const caseA = tr.cases.get(byId.a)!;
    assert.strictEqual(caseA.payload.refs, "PAY-20");
    assert.strictEqual(caseA.payload.priorityId, 4);
    assert.deepStrictEqual(caseA.payload.stepsSeparated, [{ content: "Hacer", expected: "Ocurre" }]);
  });

  await test("publishing again updates the same cases and recreates a deleted one", async () => {
    const draft = (await call("GET", `/api/test-design/drafts/${pubDraftId}`, adminToken)).body.draft;
    const idB = draft.stories[0].scenarios.find((s: any) => s.id === "b").testRailCaseId;
    tr.cases.delete(idB);
    tr.calls = [];
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/testrail`, adminToken, {});
    const outcomes = res.body.results.flatMap((r: any) => r.scenarios.map((s: any) => [s.title, s.status]));
    assert.deepStrictEqual(outcomes, [["Caso A", "updated"], ["Caso B", "recreated"], ["Caso D", "updated"]]);
    assert.strictEqual(tr.calls.filter((c) => c.startsWith("add:")).length, 1);
  });

  await test("recovers a case TestRail committed before answering 500, and isolates real failures", async () => {
    const story = pubStories[1];
    await call("PUT", `/api/test-design/drafts/${pubDraftId}/stories/${story.id}/scenarios`, adminToken, {
      scenarios: [ok("Caso D", { id: "d", selectedForJira: false }), ok("Con 500", { id: "f" }), ok("Rechazado", { id: "g" })],
    });
    tr.commitThen500Titles.add("Con 500");
    tr.failTitles.add("Rechazado");
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/testrail`, adminToken, { storyIds: [story.id] });
    const result = res.body.results[0];
    assert.strictEqual(result.status, "partial");
    const byTitle = Object.fromEntries(result.scenarios.map((s: any) => [s.title, s]));
    assert.strictEqual(byTitle["Con 500"].status, "created");
    assert.ok(byTitle["Con 500"].caseId);
    assert.strictEqual(byTitle["Rechazado"].status, "failed");
    assert.match(byTitle["Rechazado"].message, /bad field/);
    tr.failTitles.clear();
  });

  await test("creates one Jira sub-task per story under it, with the preferred type", async () => {
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/jira`, adminToken, {});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const byKey = Object.fromEntries(res.body.results.map((r: any) => [r.issueKey, r]));
    assert.strictEqual(byKey["PAY-20"].status, "created");
    assert.strictEqual(byKey["PAY-20"].issueType, "Plan de pruebas");
    assert.strictEqual(byKey["PAY-20"].scenarioCount, 2, "Caso A and Solo Jira");
    assert.match(jr.calls[0], /parent=PAY-20:type=10915/);
    const fields = jr.issues.get(byKey["PAY-20"].subtaskKey);
    assert.strictEqual(fields.summary, "Casos de prueba – PAY-20");
    const doc = JSON.stringify(fields.description);
    assert.ok(doc.includes("Solo Jira") && doc.includes("Caso A") && !doc.includes("Caso B"));
    assert.ok(doc.includes("https://tr.example.com/index.php?/cases/view/"), "links the published TestRail case");

    assert.strictEqual(byKey["PAY-21"].status, "created", "Con 500 and Rechazado are selected for Jira");
    const story = res.body.draft.stories.find((s: any) => s.issueKey === "PAY-20");
    assert.strictEqual(story.jiraSubtaskKey, byKey["PAY-20"].subtaskKey);
  });

  await test("publishing to Jira again updates the sub-task; a deleted one is recreated", async () => {
    const draft = (await call("GET", `/api/test-design/drafts/${pubDraftId}`, adminToken)).body.draft;
    const [first, second] = draft.stories;
    jr.issues.delete(second.jiraSubtaskKey);
    jr.calls = [];
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/jira`, adminToken, {});
    const statuses = res.body.results.map((r: any) => [r.issueKey, r.status]);
    assert.deepStrictEqual(statuses, [["PAY-20", "updated"], ["PAY-21", "recreated"]]);
    assert.strictEqual(jr.calls.filter((c) => c.startsWith("create:")).length, 1);
    assert.ok(jr.calls.includes(`update:${first.jiraSubtaskKey}`));
  });

  await test("the draft stays partial while a selected case failed, and is published once it uploads", async () => {
    let draft = (await call("GET", `/api/test-design/drafts/${pubDraftId}`, adminToken)).body.draft;
    assert.strictEqual(draft.status, "partially_published", "Rechazado never reached TestRail");
    const res = await call("POST", `/api/test-design/drafts/${pubDraftId}/publish/testrail`, adminToken, { storyIds: [pubStories[1].id] });
    assert.strictEqual(res.body.results[0].status, "published");
    draft = res.body.draft;
    assert.strictEqual(draft.status, "published");
  });

  await test("TestRail publishing needs a section on the draft", async () => {
    const created = await call("POST", "/api/test-design/drafts", adminToken, { projectSlug: "portal", jiraProjectKey: "PAY", testRail: {}, issues: ["PAY-30"] });
    const res = await call("POST", `/api/test-design/drafts/${created.body.draft.id}/publish/testrail`, adminToken, {});
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /sección/);
  });

  await test("reports the sub-task type a project would use", async () => {
    const res = await call("GET", "/api/test-design/jira/subtask-type?projectKey=PAY", anaToken);
    assert.strictEqual(res.body.issueType.name, "Plan de pruebas");
  });

  setPublishDepsForTesting(null);

  // ------------------------------------------------------------------------
  console.log("\nfiltro por proyecto");

  await test("drafts can be filtered by project, only within the projects the user was granted", async () => {
    const mineKiosko = await call("GET", "/api/test-design/drafts?projectSlug=kiosko", anaToken);
    assert.strictEqual(mineKiosko.status, 200);
    assert.ok(mineKiosko.body.drafts.length > 0);
    assert.ok(mineKiosko.body.drafts.every((d: any) => d.projectSlug === "kiosko"));

    const forbidden = await call("GET", "/api/test-design/drafts?projectSlug=portal", anaToken);
    assert.strictEqual(forbidden.status, 403);
    assert.strictEqual(forbidden.body.error, "project_forbidden");

    // A read-only member of kiosko sees its drafts, including ones other people created.
    const luis = await call("GET", "/api/test-design/drafts?projectSlug=kiosko", luisToken);
    assert.deepStrictEqual(
      luis.body.drafts.map((d: any) => d.id).sort(),
      mineKiosko.body.drafts.map((d: any) => d.id).sort(),
    );

    const portal = await call("GET", "/api/test-design/drafts?projectSlug=portal", adminToken);
    assert.ok(portal.body.drafts.length > 0);
    assert.ok(portal.body.drafts.every((d: any) => d.projectSlug === "portal"));
  });

  await test("each project reports how many active drafts it has", async () => {
    const all = await call("GET", "/api/test-design/drafts", adminToken);
    const expected: Record<string, number> = {};
    for (const d of all.body.drafts) expected[d.projectSlug] = (expected[d.projectSlug] ?? 0) + 1;
    const projects = (await call("GET", "/api/test-design/projects", adminToken)).body.projects;
    for (const p of projects) assert.strictEqual(p.draftCount, expected[p.slug] ?? 0, p.slug);
  });

  const { normalizeScenarios: normalizeForTest } = await import("../../test-design/test-design.validation");
  const normalize = (raw: unknown[], origin: "ai" | "manual") => normalizeForTest(raw, { origin });

  // ------------------------------------------------------------------------
  console.log("\nmétricas");

  await test("a legacy draft without history is rebuilt once into the metrics", async () => {
    // Created straight in the repository, as drafts made before the event log were.
    const { normalizeScenarios } = await import("../../test-design/test-design.validation");
    const legacy = await repo.createDraft({
      jiraProjectKey: "PAY",
      projectSlug: "kiosko",
      createdBy: null,
      createdByName: "legado",
      issues: [{ issueKey: "PAY-77" }],
    });
    const story = legacy.stories[0];
    const [published] = normalizeScenarios([{ title: "Caso heredado", steps: ["Hacer"], expectedResult: "Ok" }], { origin: "ai" });
    await repo.setStoryGeneration(legacy.id, story.id, { status: "ready", scenarios: [published] });
    await repo.markStoryPublished(legacy.id, story.id, {
      destination: "testrail",
      scenarios: [{ ...published, testRailCaseId: 777 }],
    });

    const first = await call("GET", "/api/test-design/metrics", adminToken);
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    const occurrences = (m: any) => m.recent.filter((r: any) => r.caseId === 777).length;
    assert.strictEqual(occurrences(first.body.metrics), 1);

    const second = await call("GET", "/api/test-design/metrics", adminToken);
    assert.strictEqual(occurrences(second.body.metrics), 1, "the backfill runs once");
  });

  await test("metrics count what reached TestRail and how the AI contributed", async () => {
    const res = await call("GET", "/api/test-design/metrics?days=30", adminToken);
    const m = res.body.metrics;
    assert.strictEqual(m.period.days, 30);
    assert.ok(m.testRail.casesNew >= 5, JSON.stringify(m.testRail));
    assert.ok(m.testRail.casesUpdated >= 3);
    assert.ok(m.testRail.casesFailed >= 1, "the rejected case is counted");
    assert.strictEqual(m.ai.unchanged + m.ai.edited + m.ai.manual, m.testRail.casesNew);
    assert.ok(m.ai.generated > 0, "generations were recorded");
    assert.ok(m.usage.drafts > 0 && m.usage.people > 0);
    const portal = m.byProject.find((p: any) => p.projectSlug === "portal");
    assert.ok(portal && portal.casesNew > 0);
  });

  await test("a scoped user only sees metrics of its projects", async () => {
    const mine = await call("GET", "/api/test-design/metrics", anaToken);
    assert.strictEqual(mine.status, 200);
    assert.ok(mine.body.metrics.byProject.every((p: any) => p.projectSlug === "kiosko"));
    assert.ok(mine.body.metrics.usage.drafts > 0);

    const other = await call("GET", "/api/test-design/metrics?projectSlug=portal", anaToken);
    assert.strictEqual(other.status, 403);
  });

  await test("removing an unpublished scenario is recorded as discarded", async () => {
    const before = (await call("GET", "/api/test-design/metrics", adminToken)).body.metrics.ai.discarded;
    const created = await call("POST", "/api/test-design/drafts", anaToken, { projectSlug: "kiosko", issues: ["PAY-78"] });
    const draft = created.body.draft;
    const story = draft.stories[0];
    await repo.setStoryGeneration(draft.id, story.id, {
      status: "ready",
      scenarios: normalize([{ id: "x1", title: "Uno", steps: ["a"] }, { id: "x2", title: "Dos", steps: ["b"] }], "ai"),
    });
    await call("PUT", `/api/test-design/drafts/${draft.id}/stories/${story.id}/scenarios`, anaToken, {
      scenarios: [{ id: "x1", title: "Uno", steps: ["a"], origin: "ai" }],
    });
    const after = (await call("GET", "/api/test-design/metrics", adminToken)).body.metrics.ai.discarded;
    assert.strictEqual(after, before + 1);
  });

  // ------------------------------------------------------------------------
  console.log("\njira");

  await test("story search requires a valid project key", async () => {
    const res = await call("GET", "/api/test-design/jira/issues/search?projectKey=pay%22%20OR", anaToken);
    assert.strictEqual(res.status, 400);
  });

  await test("story detail requires a valid issue key", async () => {
    const res = await call("GET", "/api/test-design/jira/issues/not-a-key", anaToken);
    assert.strictEqual(res.status, 400);
  });

  // ------------------------------------------------------------------------
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All test design route tests passed.\n");
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
