import fs from "node:fs";
import path from "node:path";
import { getProjectConfigurationBySlug, type ProjectConfiguration } from "../db/project-reader";

/**
 * Project knowledge, condensed for the test design prompt.
 *
 * The knowledge is `ProjectKnowledge.knowledgeJson`, materialized on disk as
 * `automations/apps/<slug>/app.knowledge.json`. It is written by the automation pipeline: screens
 * observed at runtime (with their visible texts), validated functional routes,
 * screen transitions and behaviours declared in earlier stories. Raw, it is large
 * and full of selectors; a person designing manual cases only needs the names a
 * tester will actually see. This keeps those, prefers what was validated, and
 * caps every section so one busy project cannot drown the story in the prompt.
 */

const MAX_SCREENS = 25;
const MAX_TEXTS_PER_SCREEN = 12;
const MAX_FLOWS = 15;
const MAX_BEHAVIOURS = 30;
const MAX_CONTEXT_CHARS = 7000;

type KnowledgeItem = Record<string, unknown>;

export type KnowledgeSummary = {
  screens: number;
  flows: number;
  behaviours: number;
  total: number;
};

export type ProjectContext = {
  projectSlug: string;
  projectName: string;
  /** Prompt-ready text; null when the project has nothing worth sending. */
  text: string | null;
  summary: KnowledgeSummary;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Drops selector syntax and fragments a person would never read on screen. */
export function humanText(value: unknown): string {
  let text = str(value);
  if (!text) return "";
  const quoted = /(?:textContains|descriptionContains|text|description)\("([^"]+)"\)/.exec(text);
  if (quoted) text = quoted[1];
  if (/new UiSelector|^\/\/|^xpath=|^css=|^#[\w-]+$|^\[.+\]$/.test(text)) return "";
  text = text
    .replace(/^[^\p{L}\p{N}¿¡("]+/u, "")
    .replace(/[^\p{L}\p{N}?!.)"]+$/u, "")
    .replace(/\s*,\s*,\s*/g, ", ");
  if (text.length < 2 || text.length > 120) return "";
  if (/@[\w-]+\.\w+/.test(text)) return ""; // sample emails typed during recording
  // Values typed or masked during a run (ids, phones), not labels of the app.
  if (!/\p{L}{2,}/u.test(text)) return "";
  return text;
}

/** Drops "A, B" when A and B are already listed: accessibility labels often concatenate children. */
function withoutConcatenations(texts: string[]): string[] {
  const known = new Set(texts.map((t) => t.toLowerCase()));
  return texts.filter((t) => {
    const parts = t.split(/\s*,\s*/).filter(Boolean);
    return parts.length < 2 || !parts.every((p) => known.has(p.toLowerCase()));
  });
}

const LAUNCHER_APPS = new Set(["play store", "gmail", "photos", "youtube", "chrome", "google app", "messages", "phone"]);

/** The device home screen shows up in mobile runs; it is not part of the product. */
function isDeviceLauncher(texts: string[]): boolean {
  return texts.filter((t) => LAUNCHER_APPS.has(t.toLowerCase())).length >= 3;
}

/** "screen" / "screen_cdca129ce8" are generated keys; the screen's first text is its real title. */
function isGeneratedScreenKey(name: string): boolean {
  return /^screen(_[0-9a-f]+)?$/i.test(name);
}

function unique(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function trusted(item: KnowledgeItem): boolean {
  return item.trustedForReuse === true || item.validationStatus === "validated";
}

function byTrustFirst(a: KnowledgeItem, b: KnowledgeItem): number {
  return Number(trusted(b)) - Number(trusted(a));
}

export function parseKnowledgeItems(raw: unknown): KnowledgeItem[] {
  if (raw === null || raw === undefined) return [];
  const json = Buffer.isBuffer(raw) ? raw.toString("utf16le") : String(raw);
  try {
    const parsed = JSON.parse(json);
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    return Array.isArray(items) ? items.filter((i) => i && typeof i === "object") : [];
  } catch {
    return [];
  }
}

export function buildKnowledgeSections(items: KnowledgeItem[], excludeIssueKey?: string) {
  const screens = items
    .filter((i) => i.knowledgeKind === "route_menu_snapshot")
    .sort(byTrustFirst)
    .map((i) => {
      const texts = withoutConcatenations(
        unique([...((i.assertionTargets as unknown[]) ?? []), ...((i.clickTargets as unknown[]) ?? [])].map(humanText), 40),
      );
      let name = humanText(i.screenKey) || humanText(i.url);
      let shown = texts;
      const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/_/g, " ").toLowerCase();
      // Keys like "firma_de_documentos" are the slug of the title the screen shows: show the title.
      if (!name || isGeneratedScreenKey(name) || (texts[0] && fold(texts[0]) === fold(name))) {
        name = texts[0] ?? "";
        shown = texts.slice(1);
      } else if (name.includes("_")) {
        name = name.replace(/_/g, " ");
      }
      return { name, texts: shown.slice(0, MAX_TEXTS_PER_SCREEN), launcher: isDeviceLauncher(texts) };
    })
    .filter((s) => s.name && s.texts.length > 0 && !s.launcher);
  const screenLines = unique(
    screens.map((s) => `- ${s.name}: ${s.texts.join(" | ")}`),
    MAX_SCREENS,
  );

  const flowLines = unique(
    items
      .filter((i) => i.knowledgeKind === "route_functional_observed" && trusted(i))
      .map((i) => unique(((i.steps as unknown[]) ?? []).map(humanText), 12))
      .filter((steps) => steps.length > 0)
      .map((steps) => `- ${steps.join(" → ")}`),
    MAX_FLOWS,
  );

  const behaviourLines = unique(
    items
      .filter((i) => i.knowledgeKind === "hu_declared")
      .filter((i) => !excludeIssueKey || str(i.sourceIssueKey).toUpperCase() !== excludeIssueKey.toUpperCase())
      .sort(byTrustFirst)
      .map((i) => {
        const behaviour = str(i.expectedBehavior) || str(i.sourceText);
        const source = str(i.sourceIssueKey);
        return behaviour ? `- ${behaviour}${source ? ` (${source})` : ""}` : "";
      }),
    MAX_BEHAVIOURS,
  );

  return { screenLines, flowLines, behaviourLines };
}

function describeProject(project: Pick<ProjectConfiguration, "name" | "projectType" | "web" | "mobile">): string {
  if (project.projectType === 2 || project.mobile) {
    const app = project.mobile?.appName || project.mobile?.packageName;
    return `Aplicación móvil${app ? ` "${app}"` : ""}${project.mobile?.platform ? ` (${project.mobile.platform})` : ""}`;
  }
  return `Aplicación web${project.web?.baseUrl ? ` en ${project.web.baseUrl}` : ""}`;
}

export function buildProjectContextText(
  project: Pick<ProjectConfiguration, "name" | "projectType" | "web" | "mobile">,
  sections: ReturnType<typeof buildKnowledgeSections>,
): string {
  const parts = [`Proyecto: ${project.name} — ${describeProject(project)}.`];
  if (sections.screenLines.length > 0) {
    parts.push("", "Pantallas conocidas y los textos que muestran:", ...sections.screenLines);
  }
  if (sections.flowLines.length > 0) {
    parts.push("", "Recorridos validados en la aplicación:", ...sections.flowLines);
  }
  if (sections.behaviourLines.length > 0) {
    parts.push("", "Comportamientos definidos en otras historias del proyecto:", ...sections.behaviourLines);
  }
  const text = parts.join("\n");
  return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n[...conocimiento recortado...]` : text;
}

export function summarize(sections: ReturnType<typeof buildKnowledgeSections>): KnowledgeSummary {
  const screens = sections.screenLines.length;
  const flows = sections.flowLines.length;
  const behaviours = sections.behaviourLines.length;
  return { screens, flows, behaviours, total: screens + flows + behaviours };
}

/** automations/apps/<slug>/app.knowledge.json, the file materialized from ProjectKnowledge. */
export function knowledgeFilePath(projectSlug: string, root = process.cwd()): string {
  return path.join(root, "automations", "apps", projectSlug, "app.knowledge.json");
}

/**
 * Knowledge items for a project. ProjectKnowledge (SQL) is the source of truth;
 * app.knowledge.json is read only when SQL holds nothing for the project, the
 * same fallback the route-profile deriver uses.
 */
export function readKnowledgeItems(
  project: Pick<ProjectConfiguration, "slug" | "knowledge">,
  readFile: (file: string) => string | null = readFileOrNull,
): KnowledgeItem[] {
  const fromDb = parseKnowledgeItems(project.knowledge?.knowledgeJson);
  if (fromDb.length > 0) return fromDb;
  const file = readFile(knowledgeFilePath(project.slug));
  return file ? parseKnowledgeItems(file) : [];
}

function readFileOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function projectContextFromConfiguration(
  project: ProjectConfiguration,
  excludeIssueKey?: string,
): ProjectContext {
  const sections = buildKnowledgeSections(readKnowledgeItems(project), excludeIssueKey);
  return {
    projectSlug: project.slug,
    projectName: project.name,
    // Even without learned knowledge, naming the product and platform helps the model.
    text: buildProjectContextText(project, sections),
    summary: summarize(sections),
  };
}

export async function loadProjectContext(projectSlug: string, excludeIssueKey?: string): Promise<ProjectContext | null> {
  const project = await getProjectConfigurationBySlug(projectSlug);
  return project ? projectContextFromConfiguration(project, excludeIssueKey) : null;
}
