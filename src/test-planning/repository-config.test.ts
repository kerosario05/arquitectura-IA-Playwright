import assert from "node:assert/strict";
import test from "node:test";
import { authorizationHeader, buildGitEnv, parseLsRemote, redact } from "./git-cli";
import {
  isAllowedRepoUrl,
  isProtectedBranch,
  isValidBranchName,
  keyFromPlanFileName,
  normalizeRepositoryConfig,
  planFileName,
  RepositoryConfigValidationError,
} from "./repository-config";

const AZDO = "https://BMSC@dev.azure.com/BMSC/Proyecto_Genesis/_git/BSC.genesis.monorepo";

function fieldOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    assert.ok(error instanceof RepositoryConfigValidationError);
    return error.field;
  }
}

test("normalizeRepositoryConfig applies defaults", () => {
  assert.deepEqual(normalizeRepositoryConfig({ repoUrl: AZDO }), {
    repoUrl: AZDO,
    defaultBranch: "develop",
    specsPath: "docs/specs",
    filePattern: "test-plan-{key}.md",
    protectedBranches: ["main", "master", "develop"],
    credentialSecretRef: null,
    enabled: true,
  });
});

test("normalizeRepositoryConfig cleans paths and protected branch lists", () => {
  const config = normalizeRepositoryConfig({
    repoUrl: "git@github.com:org/repo.git",
    defaultBranch: "main",
    specsPath: "\\docs\\specs\\",
    protectedBranches: "main, release/*,\nmain",
    enabled: false,
  });
  assert.equal(config.specsPath, "docs/specs");
  assert.deepEqual(config.protectedBranches, ["main", "release/*"]);
  assert.equal(config.enabled, false);
});

test("normalizeRepositoryConfig rejects unsafe or malformed values", () => {
  assert.equal(fieldOf(() => normalizeRepositoryConfig({})), "repoUrl");
  for (const repoUrl of ["C:/repos/x", "file:///c/repos/x", "ext::sh -c touch% /tmp/x", "http://host/x", "-uhttps://x/y"]) {
    assert.equal(fieldOf(() => normalizeRepositoryConfig({ repoUrl })), "repoUrl", repoUrl);
  }
  assert.equal(fieldOf(() => normalizeRepositoryConfig({ repoUrl: "https://u:secret@host/x" })), "repoUrl");
  assert.equal(fieldOf(() => normalizeRepositoryConfig({ repoUrl: AZDO, defaultBranch: "--upload-pack=x" })), "defaultBranch");
  assert.equal(fieldOf(() => normalizeRepositoryConfig({ repoUrl: AZDO, specsPath: "../outside" })), "specsPath");
  assert.equal(fieldOf(() => normalizeRepositoryConfig({ repoUrl: AZDO, filePattern: "plan.md" })), "filePattern");
  assert.equal(fieldOf(() => normalizeRepositoryConfig({ repoUrl: AZDO, filePattern: "x/{key}.md" })), "filePattern");
});

test("credential refs are limited to git token variables over https", () => {
  assert.equal(normalizeRepositoryConfig({ repoUrl: AZDO, credentialSecretRef: "env:AZDO_GIT_PAT" }).credentialSecretRef, "env:AZDO_GIT_PAT");
  assert.equal(normalizeRepositoryConfig({ repoUrl: AZDO, credentialSecretRef: "  " }).credentialSecretRef, null);
  for (const ref of ["env:JIRA_API_TOKEN", "env:TESTRAIL_PASSWORD", "AZDO_GIT_PAT", "vault:x"]) {
    assert.equal(fieldOf(() => normalizeRepositoryConfig({ repoUrl: AZDO, credentialSecretRef: ref })), "credentialSecretRef", ref);
  }
  assert.equal(
    fieldOf(() => normalizeRepositoryConfig({ repoUrl: "git@host:org/x.git", credentialSecretRef: "env:AZDO_GIT_PAT" })),
    "credentialSecretRef",
  );
});

test("branch helpers", () => {
  assert.ok(isValidBranchName("spec/GEN-827-spec-autenticaci-n"));
  assert.ok(!isValidBranchName("-x"));
  assert.ok(!isValidBranchName("a..b"));
  assert.ok(!isValidBranchName("a b"));
  const config = { protectedBranches: ["main", "release/*"] };
  assert.ok(isProtectedBranch(config, "main"));
  assert.ok(isProtectedBranch(config, "release/1.2"));
  assert.ok(!isProtectedBranch(config, "spec/GEN-1"));
  assert.ok(isAllowedRepoUrl(AZDO));
});

test("plan file names round-trip through the pattern", () => {
  const config = { filePattern: "test-plan-{key}.md" };
  assert.equal(planFileName(config, "GEN-827"), "test-plan-GEN-827.md");
  assert.equal(keyFromPlanFileName(config, "test-plan-GEN-827.md"), "GEN-827");
  assert.equal(keyFromPlanFileName(config, "business-spec-GEN-827.md"), null);
  assert.equal(keyFromPlanFileName(config, "test-plan-notes.md"), null);
});

test("buildGitEnv never prompts and injects the PAT only through GIT_CONFIG_*", () => {
  const system = buildGitEnv({ auth: { repoUrl: AZDO, credentialSecretRef: null } }, {});
  assert.equal(system.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(system.env.GIT_ALLOW_PROTOCOL, "https:ssh");
  assert.equal(system.env.GIT_CONFIG_COUNT, undefined);

  // The secret resolver reads process.env.
  const previous = process.env.AZDO_GIT_PAT;
  process.env.AZDO_GIT_PAT = "s3cret";
  let withPat: ReturnType<typeof buildGitEnv>;
  try {
    withPat = buildGitEnv(
      { auth: { repoUrl: AZDO, credentialSecretRef: "env:AZDO_GIT_PAT" } },
      { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.x", GIT_CONFIG_VALUE_0: "y" },
    );
  } finally {
    if (previous === undefined) delete process.env.AZDO_GIT_PAT;
    else process.env.AZDO_GIT_PAT = previous;
  }
  assert.deepEqual(withPat.secrets, ["s3cret", authorizationHeader("s3cret").split(" ").pop()]);
  assert.equal(withPat.env.GIT_CONFIG_COUNT, "3");
  assert.equal(withPat.env.GIT_CONFIG_KEY_0, "core.x");
  assert.equal(withPat.env.GIT_CONFIG_KEY_1, "http.extraHeader");
  assert.equal(withPat.env.GIT_CONFIG_KEY_2, "credential.helper");
  assert.equal(withPat.env.GIT_CONFIG_VALUE_2, "");
});

test("buildGitEnv refuses non-git secret refs even if stored", () => {
  assert.throws(() => buildGitEnv({ auth: { repoUrl: AZDO, credentialSecretRef: "env:JIRA_API_TOKEN" } }, {}));
});

test("redact hides tokens, their base64 form and URL passwords", () => {
  const header = authorizationHeader("tok");
  const b64 = header.split(" ").pop()!;
  assert.equal(redact(`fatal: tok ${b64} https://u:pw@host/x`, ["tok", b64]), "fatal: *** *** https://u:***@host/x");
});

test("parseLsRemote reads branches and the symbolic HEAD", () => {
  const out = [
    "ref: refs/heads/main\tHEAD",
    "18330e06a6eef2638bd2c50993142b880fd8ad91\tHEAD",
    "18330e06a6eef2638bd2c50993142b880fd8ad91\trefs/heads/develop",
    "378e877a36163b6cd7c1ae6905d22b1bd4353ddb\trefs/heads/spec/GEN-827-x",
  ].join("\n");
  assert.deepEqual(parseLsRemote(out), { branches: ["develop", "spec/GEN-827-x"], head: "main" });
});
