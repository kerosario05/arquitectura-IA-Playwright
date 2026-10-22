import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { createJiraPlaywrightPort, discoverJiraScenario } from "./jira-semantic-executor";
import { compileJiraSpec } from "./jira-spec-compiler";

/** The fixture server owns the success oracle; an agent/plan cannot declare a commit. */
test("independent outcome oracle checks fresh Discovery, compiled replay and a later server fault", { timeout: 180000 }, async () => {
  const states = new Map<string, { fail: boolean; attempts: number; committed: number }>();
  for (const profile of ["ledger", "warehouse"]) states.set(profile, { fail: false, attempts: 0, committed: 0 });
  const server = createServer((req, res) => {
    const [profile, operation] = (req.url ?? "").split("/").filter(Boolean);
    const state = states.get(profile);
    if (!state) { res.writeHead(404).end(); return; }
    if (operation === "commit") {
      state.attempts++;
      if (state.fail) { res.writeHead(500).end("Operation rejected"); return; }
      state.committed++;
      res.end("Operación completada");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const button = `<button id="commit" onclick="fetch('/${profile}/commit').then(r=>{if(r.ok)r.text().then(t=>document.getElementById('result').textContent=t)})">Procesar</button>`;
    const decoy = `<button id="decoy" onclick="document.getElementById('result').textContent='Acción equivocada'">Ver historial</button>`;
    res.end(`<main>${profile === "ledger" ? button + decoy : decoy + button}<div id="result" role="status">Preparado</div></main>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  await fs.mkdir(path.resolve(".artifacts/jira-engine-evaluation"), { recursive: true });
  const dir = await fs.mkdtemp(path.resolve(".artifacts/jira-engine-evaluation/run-"));
  const browser = await chromium.launch({ headless: true });
  const results: Array<{ profile: string; discovery: string; replay: string; faultReplay: string; faultDiscovery: string; falseApprovals: number }> = [];
  try {
    for (const [profile, state] of states) {
      const url = `${base}/${profile}`;
      const page = await browser.newPage();
      const scenario = { scenarioId: `EVAL-${profile}`, sourceIssueKey: "EVAL-1", title: `Operación ${profile}`,
        steps: ['Presionar "Procesar"', 'Validar que se muestre "Operación completada"'], expectedResult: "" };
      const discovered = await discoverJiraScenario(scenario, createJiraPlaywrightPort(page, url));
      assert.equal(state.committed, 1, "fixture server must independently confirm Discovery's effect");
      const profileDir = path.join(dir, profile);
      await fs.mkdir(profileDir);
      const specPath = path.join(profileDir, "case.spec.ts");
      const compiled = compileJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario,
        appSlug: `eval-${profile}`, sectionSlug: "synthetic", automationId: profile, specPath });
      assert.deepEqual(compiled.unsupported, []);
      await fs.writeFile(specPath, compiled.source);
      const configPath = path.join(profileDir, "playwright.config.ts");
      await fs.writeFile(configPath, `export default { testDir: ${JSON.stringify(profileDir)}, outputDir: ${JSON.stringify(path.join(profileDir, "test-results"))}, timeout: 20000, workers: 1, retries: 0, use: { headless: true } };`);
      const replay = () => promisify(execFile)(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config", configPath], {
        cwd: process.cwd(), timeout: 45000, maxBuffer: 1024 * 1024,
        env: { ...process.env, APP_BASE_URL: url, HEADLESS: "true", EVIDENCE_PER_SCENARIO_DOCX: "false",
          EVIDENCE_APP_SLUG: `eval-${profile}`, EVIDENCE_SECTION_SLUG: "synthetic", EVIDENCE_RUN_ID: path.basename(dir),
          EVIDENCE_SCENARIO_ID: profile },
      });
      const healthy = await replay();
      assert.match(healthy.stdout, /1 passed/);
      assert.equal(state.committed, 2, "a generated spec must reproduce the real effect");
      state.fail = true;
      await assert.rejects(replay(), (error: unknown) => {
        const output = error as { stdout?: string; stderr?: string };
        assert.match(`${output.stdout ?? ""}${output.stderr ?? ""}`, /JIRA_APPLICATION_HTTP_SERVER_ERROR:500 GET/);
        return true;
      });
      assert.equal(state.committed, 2, "faulty replay cannot manufacture a server commit");
      await assert.rejects(discoverJiraScenario(scenario, createJiraPlaywrightPort(page, url)), /JIRA_APPLICATION_HTTP_SERVER_ERROR:500 GET/);
      assert.equal(state.attempts, 4, "one dispatch per Discovery/replay; no duplicate recovery submit");
      assert.equal(state.committed, 2);
      results.push({ profile, discovery: "passed", replay: "passed", faultReplay: "correctly_rejected",
        faultDiscovery: "correctly_rejected", falseApprovals: 0 });
      await page.close();
    }
  } finally {
    await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify({ complete: results.length === states.size,
      oracle: "independent_fixture_server_state", results, scope: "synthetic_local_no_external_publication" }, null, 2));
    console.log(`[jira-evaluation] report=${path.join(dir, "summary.json")}`);
    await browser.close();
    server.close();
    await once(server, "close");
  }
});
