"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSpecGenerationSkillSettings = resolveSpecGenerationSkillSettings;
exports.parseSpecGenerationSkillFrontmatter = parseSpecGenerationSkillFrontmatter;
exports.resolveSpecGenerationSkillAbsolutePath = resolveSpecGenerationSkillAbsolutePath;
exports.loadSpecGenerationSkill = loadSpecGenerationSkill;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const DEFAULT_SKILL_PATH = ".ai/skills/playwright-spec-generation/SKILL.md";
const DEFAULT_SKILL_MAX_CHARS = 30000;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function boolFromEnv(value, fallback) {
    if (typeof value !== "string" || value.trim().length === 0)
        return fallback;
    return value.trim().toLowerCase() === "true";
}
function resolveSpecGenerationSkillSettings(env = process.env) {
    const rawMaxChars = Number(env.AI_SPEC_SKILL_MAX_CHARS ?? DEFAULT_SKILL_MAX_CHARS);
    return {
        enabled: boolFromEnv(env.AI_SPEC_SKILL_ENABLED, true),
        required: boolFromEnv(env.AI_SPEC_SKILL_REQUIRED, true),
        relativePath: (env.AI_SPEC_SKILL_PATH ?? DEFAULT_SKILL_PATH).trim() || DEFAULT_SKILL_PATH,
        maxChars: Number.isFinite(rawMaxChars) && rawMaxChars > 0 ? Math.floor(rawMaxChars) : DEFAULT_SKILL_MAX_CHARS,
    };
}
function stripYamlQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
function parseSpecGenerationSkillFrontmatter(markdown) {
    const match = markdown.match(FRONTMATTER_PATTERN);
    if (!match?.[1]) {
        throw new Error("spec_generation_skill_invalid_frontmatter:missing");
    }
    const fields = new Map();
    for (const rawLine of match[1].split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        const separator = line.indexOf(":");
        if (separator <= 0)
            continue;
        const key = line.slice(0, separator).trim();
        const value = stripYamlQuotes(line.slice(separator + 1));
        fields.set(key, value);
    }
    const name = fields.get("name")?.trim();
    const version = fields.get("version")?.trim();
    const description = fields.get("description")?.trim();
    if (!name)
        throw new Error("spec_generation_skill_invalid_frontmatter:name");
    if (!version)
        throw new Error("spec_generation_skill_invalid_frontmatter:version");
    if (!description)
        throw new Error("spec_generation_skill_invalid_frontmatter:description");
    if (!/^[a-z0-9-]{1,64}$/.test(name))
        throw new Error("spec_generation_skill_invalid_frontmatter:name_format");
    if (!/^\d+\.\d+\.\d+$/.test(version))
        throw new Error("spec_generation_skill_invalid_frontmatter:version_format");
    return { name, version, description };
}
function resolveSpecGenerationSkillAbsolutePath(relativePath, repoRoot = process.cwd()) {
    return node_path_1.default.isAbsolute(relativePath) ? relativePath : node_path_1.default.resolve(repoRoot, relativePath);
}
async function loadSpecGenerationSkill(options = {}) {
    const env = options.env ?? process.env;
    const repoRoot = options.repoRoot ?? process.cwd();
    const logger = options.logger ?? console.log;
    const settings = resolveSpecGenerationSkillSettings(env);
    const absolutePath = resolveSpecGenerationSkillAbsolutePath(settings.relativePath, repoRoot);
    if (!settings.enabled) {
        return {
            loaded: false,
            relativePath: settings.relativePath,
            absolutePath,
            reason: "disabled",
        };
    }
    let content;
    try {
        content = await promises_1.default.readFile(absolutePath, "utf-8");
    }
    catch (error) {
        if (!settings.required && error?.code === "ENOENT") {
            return {
                loaded: false,
                relativePath: settings.relativePath,
                absolutePath,
                reason: "not_found_optional",
            };
        }
        throw new Error(`spec_generation_skill_load_failed:path=${settings.relativePath}:reason=${error instanceof Error ? error.message : String(error)}`);
    }
    if (content.includes("\uFFFD")) {
        throw new Error("spec_generation_skill_invalid_utf8");
    }
    if (content.length > settings.maxChars) {
        throw new Error(`spec_generation_skill_too_large:max=${settings.maxChars}:actual=${content.length}`);
    }
    const metadata = parseSpecGenerationSkillFrontmatter(content);
    const expectedName = node_path_1.default.basename(node_path_1.default.dirname(absolutePath));
    if (metadata.name !== expectedName) {
        throw new Error(`spec_generation_skill_name_mismatch:expected=${expectedName}:actual=${metadata.name}`);
    }
    const hash = (0, node_crypto_1.createHash)("sha256").update(content, "utf-8").digest("hex");
    logger(`[spec-generation-skill] loaded name=${metadata.name} version=${metadata.version} hash=${hash} chars=${content.length}`);
    return {
        loaded: true,
        name: metadata.name,
        version: metadata.version,
        description: metadata.description,
        relativePath: settings.relativePath,
        absolutePath,
        hash,
        chars: content.length,
        content,
    };
}
