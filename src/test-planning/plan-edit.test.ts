import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyPlanEdit, PlanEditError } from "./plan-edit";
import { parseTestPlan, type PlanScenario } from "./test-plan-markdown";
import { RepoWorkspace } from "./repo-workspace";
import type { RepositoryConfig } from "./repository-config";

const PLAN = [
  "---",
  "jira_issue: AB-7",
  "---",
  "",
  "| 1 | Scenario: Login works |",
  "",
  "```gherkin",
  "Scenario: Login works",
  "  Given a user",
  "  When they log in",
  "  Then they see the home",
  "",
  "Scenario: Broken",
  "  Given something",
  "  And, oops",
  "```",
  "",
].join("\n");

const clone = (plan = parseTestPlan(PLAN)): PlanScenario[] => structuredClone(plan.scenarios);

test("no edits means no change", () => {
  const result = applyPlanEdit(PLAN, clone());
  assert.equal(result.changed, false);
  assert.equal(result.content, PLAN);
  assert.deepEqual(result.stats, { total: 2, edited: 0, added: 0, removed: 0, reordered: false });
});

test("edits, additions and renames are applied and counted", () => {
  const scenarios = clone();
  scenarios[0].title = "Login works with valid credentials";
  scenarios[0].steps.push({ keyword: "And", text: "the menu shows their name" });
  scenarios.push({ id: "new-1", comments: [], tags: [], keyword: "", title: "Logout", steps: [{ keyword: "Given", text: "a session" }, { keyword: "Then", text: "they can log out" }], examples: [], locked: null });
  const result = applyPlanEdit(PLAN, scenarios);
  assert.equal(result.changed, true);
  assert.deepEqual(result.stats, { total: 3, edited: 1, added: 1, removed: 0, reordered: false });
  assert.ok(result.content.includes("| 1 | Scenario: Login works with valid credentials |"));
  assert.ok(result.content.includes("  And the menu shows their name\n"));
  assert.ok(result.content.includes("Scenario: Logout\n  Given a session\n  Then they can log out\n```"));
  assert.deepEqual(result.problems, []);
});

test("removing and reordering are counted; dangling coverage reported", () => {
  const [first, second] = clone();
  const result = applyPlanEdit(PLAN, [second]);
  assert.equal(result.stats.removed, 1);
  assert.deepEqual(result.danglingCoverage, ["Login works"]);
  assert.equal(applyPlanEdit(PLAN, [second, first]).stats.reordered, true);
});

test("locked scenarios cannot be edited, but can be moved or kept", () => {
  const scenarios = clone();
  assert.ok(scenarios[1].locked);
  scenarios[1].title = "Fixed";
  assert.throws(() => applyPlanEdit(PLAN, scenarios), PlanEditError);
  // Clients may send `locked: null`; the server restores the original flag.
  const untouched = clone().map((s) => ({ ...s, locked: null }));
  assert.equal(applyPlanEdit(PLAN, untouched).changed, false);
});

test("untrusted bodies are rejected", () => {
  assert.throws(() => applyPlanEdit(PLAN, "x"), PlanEditError);
  assert.throws(() => applyPlanEdit(PLAN, [{ id: "a", title: 3 }]), PlanEditError);
  const dup = clone();
  dup[1].id = dup[0].id;
  assert.throws(() => applyPlanEdit(PLAN, dup), PlanEditError);
});

test("incomplete scenarios are reported as problems", () => {
  const scenarios = clone();
  scenarios[0].steps.push({ keyword: "Then", text: "" });
  const result = applyPlanEdit(PLAN, scenarios);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].errors.join(), /vacíos/);
});

test("newlines typed into a step stay on one Gherkin line", () => {
  const scenarios = clone();
  scenarios[0].steps[0].text = "a user\nwith two lines";
  assert.ok(applyPlanEdit(PLAN, scenarios).content.includes("  Given a user with two lines\n"));
});

// --- commit + push against a local bare repository ------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).trim();
}

test("commitFiles pushes a commit on top of the remote head and detects conflicts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-plan-commit-"));
  const previousProtocol = process.env.QA_LAB_GIT_ALLOW_PROTOCOL;
  const previousDir = process.env.GIT_REPOS_DIR;
  process.env.QA_LAB_GIT_ALLOW_PROTOCOL = "file";
  process.env.GIT_REPOS_DIR = path.join(root, "clones");
  try {
    // A "remote" with one plan on branch spec/AB-7.
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    git(root, "init", "--bare", "--quiet", remote);
    git(root, "init", "--quiet", "-b", "main", seed);
    fs.mkdirSync(path.join(seed, "docs/specs/AB-7-login"), { recursive: true });
    fs.writeFileSync(path.join(seed, "docs/specs/AB-7-login/test-plan-AB-7.md"), PLAN);
    fs.writeFileSync(path.join(seed, "README.md"), "seed\n");
    git(seed, "add", ".");
    git(seed, "-c", "user.name=Seed", "-c", "user.email=seed@x", "commit", "--quiet", "-m", "seed");
    git(seed, "push", "--quiet", remote, "main:refs/heads/spec/AB-7");

    const config: RepositoryConfig = {
      repoUrl: `file://${remote.replace(/\\/g, "/")}`,
      defaultBranch: "spec/AB-7",
      specsPath: "docs/specs",
      filePattern: "test-plan-{key}.md",
      protectedBranches: ["main"],
      credentialSecretRef: null,
      enabled: true,
    };
    const ws = new RepoWorkspace("test-project", config);
    await ws.fetchAll();
    const branch = "spec/AB-7";
    const { plans } = await ws.listPlans(branch);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].matchesBranch, true);
    const { text, file } = await ws.readPlan(branch, plans[0].path);
    assert.equal(text, PLAN);

    const scenarios = clone();
    scenarios[0].steps.push({ keyword: "And", text: "a welcome message" });
    const edit = applyPlanEdit(text, scenarios);
    const diff = await ws.diffBlobs(file.blobSha, await ws.writeBlob(edit.content), file.path);
    assert.match(diff, /^\+\+\+ b\/docs\/specs\/AB-7-login\/test-plan-AB-7\.md$/m);
    assert.match(diff, /^\+ {2}And a welcome message$/m);

    const result = await ws.commitFiles({
      branch,
      files: [{ path: file.path, content: edit.content, baseBlobSha: file.blobSha }],
      message: "test(AB-7): add a step",
      author: { name: "Ana QA", email: "ana@example.com" },
    });
    assert.equal(git(remote, "rev-parse", `refs/heads/${branch}`), result.commitSha);
    assert.equal(git(remote, "show", `${result.commitSha}:${file.path}`), edit.content.trimEnd());
    assert.equal(git(remote, "log", "-1", "--format=%an <%ae>|%s", result.commitSha), "Ana QA <ana@example.com>|test(AB-7): add a step");
    // Untouched files survive in the new tree.
    assert.equal(git(remote, "show", `${result.commitSha}:README.md`), "seed");
    assert.equal(await ws.headOf(branch), result.commitSha);

    // Same base again: the file moved on, so this is a conflict.
    await assert.rejects(
      ws.commitFiles({
        branch,
        files: [{ path: file.path, content: PLAN.replace("Login works", "Other"), baseBlobSha: file.blobSha }],
        message: "stale",
        author: { name: "Bob", email: "bob@example.com" },
      }),
      (err: { code?: string }) => err.code === "git_conflict",
    );

    // Someone else pushes an unrelated change: our commit is rebuilt on top of it.
    git(seed, "fetch", "--quiet", remote, `refs/heads/${branch}:refs/remotes/r/x`);
    git(seed, "reset", "--quiet", "--hard", "refs/remotes/r/x");
    fs.writeFileSync(path.join(seed, "README.md"), "other change\n");
    git(seed, "-c", "user.name=Other", "-c", "user.email=o@x", "commit", "--quiet", "-am", "unrelated");
    git(seed, "push", "--quiet", remote, `HEAD:refs/heads/${branch}`);
    const latest = await ws.readPlan(branch, file.path).catch(() => null);
    assert.ok(latest);
    const second = await ws.commitFiles({
      branch,
      files: [{ path: file.path, content: latest!.text.replace("a welcome message", "a greeting"), baseBlobSha: latest!.file.blobSha }],
      message: "test(AB-7): reword",
      author: { name: "Ana QA", email: "ana@example.com" },
    });
    assert.equal(git(remote, "show", `${second.commitSha}:README.md`), "other change");
    assert.equal(git(remote, "rev-parse", `${second.commitSha}^`), git(seed, "rev-parse", "HEAD"));
  } finally {
    if (previousProtocol === undefined) delete process.env.QA_LAB_GIT_ALLOW_PROTOCOL;
    else process.env.QA_LAB_GIT_ALLOW_PROTOCOL = previousProtocol;
    if (previousDir === undefined) delete process.env.GIT_REPOS_DIR;
    else process.env.GIT_REPOS_DIR = previousDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
