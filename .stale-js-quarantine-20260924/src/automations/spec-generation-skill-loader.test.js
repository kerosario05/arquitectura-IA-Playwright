"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const spec_generation_skill_loader_1 = require("./spec-generation-skill-loader");
(0, node_test_1.default)("skill loader reads versioned skill and produces stable hash without logging content", async () => {
    const logs = [];
    const first = await (0, spec_generation_skill_loader_1.loadSpecGenerationSkill)({ logger: (message) => logs.push(message) });
    const second = await (0, spec_generation_skill_loader_1.loadSpecGenerationSkill)({ logger: () => undefined });
    node_assert_1.default.strictEqual(first.loaded, true);
    node_assert_1.default.strictEqual(second.loaded, true);
    node_assert_1.default.strictEqual(first.name, "playwright-spec-generation");
    node_assert_1.default.strictEqual(first.version, "1.0.0");
    node_assert_1.default.strictEqual(first.hash, second.hash);
    node_assert_1.default.ok(first.chars > 0);
    node_assert_1.default.ok(logs.some((line) => line.includes("[spec-generation-skill] loaded name=playwright-spec-generation version=1.0.0 hash=")));
    node_assert_1.default.ok(logs.every((line) => !line.includes("Return only JSON matching the core schema")));
});
(0, node_test_1.default)("skill loader exposes default settings and stable repo-relative path", async () => {
    const settings = (0, spec_generation_skill_loader_1.resolveSpecGenerationSkillSettings)({
        AI_SPEC_SKILL_ENABLED: "true",
        AI_SPEC_SKILL_REQUIRED: "true",
        AI_SPEC_SKILL_PATH: ".ai/skills/playwright-spec-generation/SKILL.md",
        AI_SPEC_SKILL_MAX_CHARS: "30000",
    });
    node_assert_1.default.strictEqual(settings.enabled, true);
    node_assert_1.default.strictEqual(settings.required, true);
    node_assert_1.default.strictEqual(settings.relativePath, ".ai/skills/playwright-spec-generation/SKILL.md");
    node_assert_1.default.strictEqual(settings.maxChars, 30000);
    const absolutePath = (0, spec_generation_skill_loader_1.resolveSpecGenerationSkillAbsolutePath)(settings.relativePath, process.cwd());
    node_assert_1.default.ok(absolutePath.endsWith(node_path_1.default.join(".ai", "skills", "playwright-spec-generation", "SKILL.md")));
});
(0, node_test_1.default)("skill loader rejects missing path when required and tolerates it when optional", async () => {
    await node_assert_1.default.rejects((0, spec_generation_skill_loader_1.loadSpecGenerationSkill)({
        env: {
            ...process.env,
            AI_SPEC_SKILL_ENABLED: "true",
            AI_SPEC_SKILL_REQUIRED: "true",
            AI_SPEC_SKILL_PATH: ".ai/skills/playwright-spec-generation/MISSING.md",
        },
    }), /spec_generation_skill_load_failed/);
    const optional = await (0, spec_generation_skill_loader_1.loadSpecGenerationSkill)({
        env: {
            ...process.env,
            AI_SPEC_SKILL_ENABLED: "true",
            AI_SPEC_SKILL_REQUIRED: "false",
            AI_SPEC_SKILL_PATH: ".ai/skills/playwright-spec-generation/MISSING.md",
        },
    });
    node_assert_1.default.strictEqual(optional.loaded, false);
    node_assert_1.default.strictEqual(optional.reason, "not_found_optional");
});
(0, node_test_1.default)("skill loader enforces size limit and valid UTF-8", async () => {
    const tempDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "spec-skill-loader-"));
    try {
        const skillPath = node_path_1.default.join(tempDir, "SKILL.md");
        await promises_1.default.writeFile(skillPath, [
            "---",
            "name: temp-skill",
            "version: 1.0.0",
            "description: temp skill",
            "---",
            "",
            "0123456789",
        ].join("\n"), "utf-8");
        await node_assert_1.default.rejects((0, spec_generation_skill_loader_1.loadSpecGenerationSkill)({
            repoRoot: tempDir,
            env: {
                ...process.env,
                AI_SPEC_SKILL_ENABLED: "true",
                AI_SPEC_SKILL_REQUIRED: "true",
                AI_SPEC_SKILL_PATH: "SKILL.md",
                AI_SPEC_SKILL_MAX_CHARS: "8",
            },
        }), /spec_generation_skill_too_large/);
        const invalidUtf8Path = node_path_1.default.join(tempDir, "INVALID.md");
        await promises_1.default.writeFile(invalidUtf8Path, Buffer.concat([
            Buffer.from("---\nname: invalid\nversion: 1.0.0\ndescription: invalid\n---\n", "utf-8"),
            Buffer.from([0xff, 0xfe, 0xfd]),
        ]));
        await node_assert_1.default.rejects((0, spec_generation_skill_loader_1.loadSpecGenerationSkill)({
            repoRoot: tempDir,
            env: {
                ...process.env,
                AI_SPEC_SKILL_ENABLED: "true",
                AI_SPEC_SKILL_REQUIRED: "true",
                AI_SPEC_SKILL_PATH: "INVALID.md",
            },
        }), /spec_generation_skill_invalid_utf8/);
    }
    finally {
        await promises_1.default.rm(tempDir, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("frontmatter parser validates required fields", () => {
    const parsed = (0, spec_generation_skill_loader_1.parseSpecGenerationSkillFrontmatter)([
        "---",
        "name: sample-skill",
        "version: 1.2.3",
        "description: Sample description",
        "---",
        "",
        "body",
    ].join("\n"));
    node_assert_1.default.deepStrictEqual(parsed, {
        name: "sample-skill",
        version: "1.2.3",
        description: "Sample description",
    });
    node_assert_1.default.throws(() => (0, spec_generation_skill_loader_1.parseSpecGenerationSkillFrontmatter)("---\nname: x\n---\n"), /spec_generation_skill_invalid_frontmatter/);
});
