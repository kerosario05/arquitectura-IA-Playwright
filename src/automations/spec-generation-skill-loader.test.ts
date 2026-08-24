import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadSpecGenerationSkill,
  parseSpecGenerationSkillFrontmatter,
  resolveSpecGenerationSkillAbsolutePath,
  resolveSpecGenerationSkillSettings,
} from "./spec-generation-skill-loader";

test("skill loader reads versioned skill and produces stable hash without logging content", async () => {
  const logs: string[] = [];
  const first = await loadSpecGenerationSkill({ logger: (message) => logs.push(message) });
  const second = await loadSpecGenerationSkill({ logger: () => undefined });
  assert.strictEqual(first.loaded, true);
  assert.strictEqual(second.loaded, true);
  assert.strictEqual(first.name, "playwright-spec-generation");
  assert.strictEqual(first.version, "1.0.0");
  assert.strictEqual(first.hash, second.hash);
  assert.ok(first.chars > 0);
  assert.ok(logs.some((line) => line.includes("[spec-generation-skill] loaded name=playwright-spec-generation version=1.0.0 hash=")));
  assert.ok(logs.every((line) => !line.includes("Return only JSON matching the core schema")));
});

test("skill loader exposes default settings and stable repo-relative path", async () => {
  const settings = resolveSpecGenerationSkillSettings({
    AI_SPEC_SKILL_ENABLED: "true",
    AI_SPEC_SKILL_REQUIRED: "true",
    AI_SPEC_SKILL_PATH: ".ai/skills/playwright-spec-generation/SKILL.md",
    AI_SPEC_SKILL_MAX_CHARS: "30000",
  } as NodeJS.ProcessEnv);
  assert.strictEqual(settings.enabled, true);
  assert.strictEqual(settings.required, true);
  assert.strictEqual(settings.relativePath, ".ai/skills/playwright-spec-generation/SKILL.md");
  assert.strictEqual(settings.maxChars, 30000);
  const absolutePath = resolveSpecGenerationSkillAbsolutePath(settings.relativePath, process.cwd());
  assert.ok(absolutePath.endsWith(path.join(".ai", "skills", "playwright-spec-generation", "SKILL.md")));
});

test("skill loader rejects missing path when required and tolerates it when optional", async () => {
  await assert.rejects(
    loadSpecGenerationSkill({
      env: {
        ...process.env,
        AI_SPEC_SKILL_ENABLED: "true",
        AI_SPEC_SKILL_REQUIRED: "true",
        AI_SPEC_SKILL_PATH: ".ai/skills/playwright-spec-generation/MISSING.md",
      },
    }),
    /spec_generation_skill_load_failed/,
  );

  const optional = await loadSpecGenerationSkill({
    env: {
      ...process.env,
      AI_SPEC_SKILL_ENABLED: "true",
      AI_SPEC_SKILL_REQUIRED: "false",
      AI_SPEC_SKILL_PATH: ".ai/skills/playwright-spec-generation/MISSING.md",
    },
  });
  assert.strictEqual(optional.loaded, false);
  assert.strictEqual(optional.reason, "not_found_optional");
});

test("skill loader enforces size limit and valid UTF-8", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-skill-loader-"));
  try {
    const skillPath = path.join(tempDir, "SKILL.md");
    await fs.writeFile(skillPath, [
      "---",
      "name: temp-skill",
      "version: 1.0.0",
      "description: temp skill",
      "---",
      "",
      "0123456789",
    ].join("\n"), "utf-8");

    await assert.rejects(
      loadSpecGenerationSkill({
        repoRoot: tempDir,
        env: {
          ...process.env,
          AI_SPEC_SKILL_ENABLED: "true",
          AI_SPEC_SKILL_REQUIRED: "true",
          AI_SPEC_SKILL_PATH: "SKILL.md",
          AI_SPEC_SKILL_MAX_CHARS: "8",
        },
      }),
      /spec_generation_skill_too_large/,
    );

    const invalidUtf8Path = path.join(tempDir, "INVALID.md");
    await fs.writeFile(
      invalidUtf8Path,
      Buffer.concat([
        Buffer.from("---\nname: invalid\nversion: 1.0.0\ndescription: invalid\n---\n", "utf-8"),
        Buffer.from([0xff, 0xfe, 0xfd]),
      ]),
    );

    await assert.rejects(
      loadSpecGenerationSkill({
        repoRoot: tempDir,
        env: {
          ...process.env,
          AI_SPEC_SKILL_ENABLED: "true",
          AI_SPEC_SKILL_REQUIRED: "true",
          AI_SPEC_SKILL_PATH: "INVALID.md",
        },
      }),
      /spec_generation_skill_invalid_utf8/,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("frontmatter parser validates required fields", () => {
  const parsed = parseSpecGenerationSkillFrontmatter([
    "---",
    "name: sample-skill",
    "version: 1.2.3",
    "description: Sample description",
    "---",
    "",
    "body",
  ].join("\n"));
  assert.deepStrictEqual(parsed, {
    name: "sample-skill",
    version: "1.2.3",
    description: "Sample description",
  });
  assert.throws(
    () => parseSpecGenerationSkillFrontmatter("---\nname: x\n---\n"),
    /spec_generation_skill_invalid_frontmatter/,
  );
});
