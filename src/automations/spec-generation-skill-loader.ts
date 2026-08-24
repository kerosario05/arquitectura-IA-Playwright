import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export type SpecGenerationSkillLoadOptions = {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  logger?: (message: string) => void;
};

export type SpecGenerationSkillSettings = {
  enabled: boolean;
  required: boolean;
  relativePath: string;
  maxChars: number;
};

export type LoadedSpecGenerationSkill = {
  loaded: true;
  name: string;
  version: string;
  description: string;
  relativePath: string;
  absolutePath: string;
  hash: string;
  chars: number;
  content: string;
};

export type MissingSpecGenerationSkill = {
  loaded: false;
  relativePath: string;
  absolutePath: string;
  reason: "disabled" | "not_found_optional";
};

export type SpecGenerationSkillState = LoadedSpecGenerationSkill | MissingSpecGenerationSkill;

type ParsedSkillFrontmatter = {
  name: string;
  version: string;
  description: string;
};

const DEFAULT_SKILL_PATH = ".ai/skills/playwright-spec-generation/SKILL.md";
const DEFAULT_SKILL_MAX_CHARS = 30000;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim().toLowerCase() === "true";
}

export function resolveSpecGenerationSkillSettings(env: NodeJS.ProcessEnv = process.env): SpecGenerationSkillSettings {
  const rawMaxChars = Number(env.AI_SPEC_SKILL_MAX_CHARS ?? DEFAULT_SKILL_MAX_CHARS);
  return {
    enabled: boolFromEnv(env.AI_SPEC_SKILL_ENABLED, true),
    required: boolFromEnv(env.AI_SPEC_SKILL_REQUIRED, true),
    relativePath: (env.AI_SPEC_SKILL_PATH ?? DEFAULT_SKILL_PATH).trim() || DEFAULT_SKILL_PATH,
    maxChars: Number.isFinite(rawMaxChars) && rawMaxChars > 0 ? Math.floor(rawMaxChars) : DEFAULT_SKILL_MAX_CHARS,
  };
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSpecGenerationSkillFrontmatter(markdown: string): ParsedSkillFrontmatter {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match?.[1]) {
    throw new Error("spec_generation_skill_invalid_frontmatter:missing");
  }

  const fields = new Map<string, string>();
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = stripYamlQuotes(line.slice(separator + 1));
    fields.set(key, value);
  }

  const name = fields.get("name")?.trim();
  const version = fields.get("version")?.trim();
  const description = fields.get("description")?.trim();
  if (!name) throw new Error("spec_generation_skill_invalid_frontmatter:name");
  if (!version) throw new Error("spec_generation_skill_invalid_frontmatter:version");
  if (!description) throw new Error("spec_generation_skill_invalid_frontmatter:description");
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error("spec_generation_skill_invalid_frontmatter:name_format");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("spec_generation_skill_invalid_frontmatter:version_format");
  return { name, version, description };
}

export function resolveSpecGenerationSkillAbsolutePath(
  relativePath: string,
  repoRoot: string = process.cwd(),
): string {
  return path.isAbsolute(relativePath) ? relativePath : path.resolve(repoRoot, relativePath);
}

export async function loadSpecGenerationSkill(
  options: SpecGenerationSkillLoadOptions = {},
): Promise<SpecGenerationSkillState> {
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

  let content: string;
  try {
    content = await fs.readFile(absolutePath, "utf-8");
  } catch (error) {
    if (!settings.required && (error as NodeJS.ErrnoException)?.code === "ENOENT") {
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
  const expectedName = path.basename(path.dirname(absolutePath));
  if (metadata.name !== expectedName) {
    throw new Error(`spec_generation_skill_name_mismatch:expected=${expectedName}:actual=${metadata.name}`);
  }

  const hash = createHash("sha256").update(content, "utf-8").digest("hex");
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
