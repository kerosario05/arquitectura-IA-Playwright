import { AstBuilder, GherkinClassicTokenMatcher, Parser, dialects } from "@cucumber/gherkin";
import { IdGenerator, type GherkinDocument } from "@cucumber/messages";

/**
 * Round-trip parser/serializer for `test-plan-<HU>.md` files.
 *
 * The file is split into three raw regions: everything up to and including the
 * ```gherkin fence (frontmatter, coverage table), the Gherkin body, and
 * everything from the closing fence on. Only the scenarios inside the body are
 * modelled; each one keeps its original text so an unchanged scenario is written
 * back byte-for-byte and a diff only touches what the user actually edited.
 */

export type StepKind = "given" | "when" | "then" | "and" | "but";

export interface PlanStep {
  /** Literal keyword as written ("Dado", "And", "Entonces"), without trailing space. */
  keyword: string;
  text: string;
}

export interface PlanExamples {
  /** Literal keyword line suffix, e.g. "Ejemplos" or "Examples". */
  keyword: string;
  name: string;
  header: string[];
  rows: string[][];
}

export interface PlanScenario {
  id: string;
  /** Comment lines directly above the scenario, without the leading "#". */
  comments: string[];
  tags: string[];
  /** Literal scenario keyword ("Escenario", "Scenario Outline", ...). */
  keyword: string;
  title: string;
  steps: PlanStep[];
  examples: PlanExamples[];
  /** Set when the scenario contains constructs the editor cannot round-trip. */
  locked: string | null;
}

export interface ParsedTestPlan {
  eol: "\r\n" | "\n";
  frontmatter: Record<string, string>;
  /** Gherkin language of the body ("es", "en", ...). */
  language: string;
  /** Raw text up to and including the opening ```gherkin fence line (with its EOL). */
  head: string;
  /** Raw body lines before the first scenario (language header, Feature, ...). */
  preamble: string[];
  scenarios: PlanScenario[];
  /** Raw text from the closing fence to the end of the file. */
  tail: string;
  /** null when the file can be edited; otherwise why it is read-only. */
  readOnlyReason: string | null;
  layout: PlanLayout;
  /** Original block text per scenario id; not sent to clients. */
  raw: Map<string, RawBlock>;
}

export interface PlanLayout {
  scenarioIndent: string;
  stepIndent: string;
  examplesIndent: string;
  tableIndent: string;
}

interface RawBlock {
  lines: string[];
  /** Blank lines that followed the block in the original body. */
  gapAfter: number;
}

const FENCE_OPEN = /^```\s*gherkin\s*$/i;
const FENCE_CLOSE = /^```\s*$/;
const LANGUAGE_HEADER = /^\s*#\s*language\s*:\s*([\w-]+)\s*$/;

interface DialectKeywords {
  scenario: string[];
  outline: string[];
  examples: string[];
  steps: Array<{ keyword: string; kind: StepKind }>;
  blocking: string[];
}

function dialectKeywords(language: string): DialectKeywords {
  const dialect = dialects[language] ?? dialects.en;
  const steps: DialectKeywords["steps"] = [];
  const add = (kind: StepKind, list: readonly string[]) => {
    for (const raw of list) {
      const keyword = raw.trim();
      if (keyword && keyword !== "*") steps.push({ keyword, kind });
    }
  };
  add("given", dialect.given);
  add("when", dialect.when);
  add("then", dialect.then);
  add("and", dialect.and);
  add("but", dialect.but);
  // Longest first so "Dados" wins over "Dado", "Scenario Outline" over "Scenario".
  steps.sort((a, b) => b.keyword.length - a.keyword.length);
  const byLength = (list: readonly string[]) => [...list].sort((a, b) => b.length - a.length);
  return {
    scenario: byLength(dialect.scenario),
    outline: byLength(dialect.scenarioOutline),
    examples: byLength(dialect.examples),
    steps,
    blocking: [...dialect.background, ...dialect.rule],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchKeywordLine(line: string, keywords: string[]): { indent: string; keyword: string; rest: string } | null {
  for (const keyword of keywords) {
    const match = new RegExp(`^(\\s*)(${escapeRegex(keyword)})\\s*:\\s?(.*)$`).exec(line);
    if (match) return { indent: match[1], keyword: match[2], rest: match[3] };
  }
  return null;
}

function matchScenarioLine(line: string, kw: DialectKeywords) {
  return matchKeywordLine(line, [...kw.outline, ...kw.scenario].sort((a, b) => b.length - a.length));
}

export function stepKind(keyword: string, language: string): StepKind | null {
  const found = dialectKeywords(language).steps.find((s) => s.keyword === keyword);
  return found ? found.kind : null;
}

/** Keywords offered by the editor for a document, in Given/When/Then/And/But order. */
export function stepKeywordOptions(language: string): Array<{ keyword: string; kind: StepKind }> {
  const dialect = dialects[language] ?? dialects.en;
  const first = (list: readonly string[]) => list.map((k) => k.trim()).find((k) => k && k !== "*") ?? "";
  return (["given", "when", "then", "and", "but"] as const).map((kind) => ({ kind, keyword: first(dialect[kind]) }));
}

function parseTableRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[i + 1];
      current += next === "n" ? "\n" : next;
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseFrontmatter(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (lines[0] !== "---") return result;
  for (let i = 1; i < lines.length && lines[i] !== "---"; i += 1) {
    const match = /^([\w-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function detectLanguage(bodyLines: string[]): string {
  for (const line of bodyLines) {
    const match = LANGUAGE_HEADER.exec(line);
    if (match && dialects[match[1]]) return match[1];
    if (line.trim() && !line.trim().startsWith("#")) break;
  }
  // No header: Gherkin defaults to English, but tolerate Spanish keywords.
  for (const language of ["en", "es"]) {
    const kw = dialectKeywords(language);
    if (bodyLines.some((line) => matchScenarioLine(line, kw))) return language;
  }
  return "en";
}

function emptyPlan(text: string, eol: ParsedTestPlan["eol"], reason: string): ParsedTestPlan {
  return {
    eol,
    frontmatter: parseFrontmatter(text.split(/\r?\n/)),
    language: "en",
    head: text,
    preamble: [],
    scenarios: [],
    tail: "",
    readOnlyReason: reason,
    layout: { scenarioIndent: "", stepIndent: "  ", examplesIndent: "  ", tableIndent: "    " },
    raw: new Map(),
  };
}

export function parseTestPlan(text: string): ParsedTestPlan {
  const eol: ParsedTestPlan["eol"] = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const open = lines.findIndex((line) => FENCE_OPEN.test(line));
  if (open < 0) return emptyPlan(text, eol, "El archivo no tiene un bloque ```gherkin.");
  let close = -1;
  for (let i = open + 1; i < lines.length; i += 1) {
    if (FENCE_CLOSE.test(lines[i])) {
      close = i;
      break;
    }
  }
  if (close < 0) return emptyPlan(text, eol, "El bloque ```gherkin no está cerrado.");

  const head = lines.slice(0, open + 1).join(eol) + eol;
  const tail = lines.slice(close).join(eol);
  const body = lines.slice(open + 1, close);
  const language = detectLanguage(body);
  const kw = dialectKeywords(language);

  // A scenario block starts at its scenario line, pulling in the comment/tag
  // lines glued directly above it.
  const starts: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    if (!matchScenarioLine(body[i], kw)) continue;
    let start = i;
    while (start > 0 && /^\s*[#@]/.test(body[start - 1]) && !LANGUAGE_HEADER.test(body[start - 1])) start -= 1;
    starts.push(start);
  }

  const preamble = body.slice(0, starts.length ? starts[0] : body.length);
  const scenarios: PlanScenario[] = [];
  const raw = new Map<string, RawBlock>();
  let readOnlyReason: string | null = null;
  const layout: PlanLayout = { scenarioIndent: "", stepIndent: "  ", examplesIndent: "  ", tableIndent: "    " };
  const layoutSeen = { scenario: false, step: false, examples: false, table: false };

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : body.length;
    const blockLines = body.slice(start, end);
    let gapAfter = 0;
    while (blockLines.length && blockLines[blockLines.length - 1].trim() === "") {
      blockLines.pop();
      gapAfter += 1;
    }
    const id = `s${index + 1}`;
    raw.set(id, { lines: blockLines, gapAfter });

    const scenario: PlanScenario = {
      id,
      comments: [],
      tags: [],
      keyword: "",
      title: "",
      steps: [],
      examples: [],
      locked: null,
    };
    let phase: "lead" | "steps" | "examples" = "lead";
    let currentExamples: PlanExamples | null = null;

    for (const line of blockLines) {
      const trimmed = line.trim();
      if (phase === "lead") {
        if (trimmed.startsWith("#")) {
          scenario.comments.push(trimmed.replace(/^#\s?/, ""));
          continue;
        }
        if (trimmed.startsWith("@")) {
          scenario.tags.push(...trimmed.split(/\s+/).filter(Boolean));
          continue;
        }
        const header = matchScenarioLine(line, kw);
        if (header) {
          scenario.keyword = header.keyword;
          scenario.title = header.rest.trim();
          if (!layoutSeen.scenario) {
            layout.scenarioIndent = header.indent;
            layoutSeen.scenario = true;
          }
          phase = "steps";
          continue;
        }
      }
      if (trimmed === "") continue;

      const examplesLine = matchKeywordLine(line, kw.examples);
      if (examplesLine && phase !== "lead") {
        currentExamples = { keyword: examplesLine.keyword, name: examplesLine.rest.trim(), header: [], rows: [] };
        scenario.examples.push(currentExamples);
        if (!layoutSeen.examples) {
          layout.examplesIndent = examplesLine.indent;
          layoutSeen.examples = true;
        }
        phase = "examples";
        continue;
      }
      if (phase === "examples" && currentExamples && trimmed.startsWith("|")) {
        const cells = parseTableRow(line);
        if (!currentExamples.header.length) currentExamples.header = cells;
        else currentExamples.rows.push(cells);
        if (!layoutSeen.table) {
          layout.tableIndent = /^(\s*)/.exec(line)![1];
          layoutSeen.table = true;
        }
        continue;
      }
      if (phase === "steps") {
        const step = kw.steps.find((s) => trimmed.startsWith(`${s.keyword} `) || trimmed === s.keyword);
        if (step) {
          scenario.steps.push({ keyword: step.keyword, text: trimmed.slice(step.keyword.length).trim() });
          if (!layoutSeen.step) {
            layout.stepIndent = /^(\s*)/.exec(line)![1];
            layoutSeen.step = true;
          }
          continue;
        }
      }
      if (kw.blocking.some((k) => matchKeywordLine(line, [k]))) {
        readOnlyReason = `El plan usa "${trimmed}", que el editor aún no soporta.`;
      }
      scenario.locked = `Línea no soportada: ${trimmed}`;
    }
    scenarios.push(scenario);
  });

  if (!scenarios.length && !readOnlyReason) readOnlyReason = "No se encontraron escenarios en el bloque Gherkin.";
  if (preamble.some((line) => kw.blocking.some((k) => matchKeywordLine(line, [k])))) {
    readOnlyReason = "El plan usa Antecedentes/Background o Reglas, que el editor aún no soporta.";
  }

  const plan: ParsedTestPlan = {
    eol,
    frontmatter: parseFrontmatter(lines),
    language,
    head,
    preamble,
    scenarios,
    tail,
    readOnlyReason,
    layout,
    raw,
  };

  // Safety net: anything that does not reproduce the original bytes is read-only.
  if (!plan.readOnlyReason && serializeTestPlan(plan, plan.scenarios) !== text) {
    plan.readOnlyReason = "El formato del archivo no se puede reescribir sin alterar contenido no editado.";
  }
  return plan;
}

/** True when `scenario` has the same content as the parsed scenario with its id. */
export function isScenarioUnchanged(base: ParsedTestPlan, scenario: PlanScenario): boolean {
  const before = base.scenarios.find((s) => s.id === scenario.id);
  return !!before && fingerprint(before) === fingerprint(scenario);
}

function fingerprint(scenario: PlanScenario): string {
  return JSON.stringify([
    scenario.comments,
    scenario.tags,
    scenario.keyword,
    scenario.title,
    scenario.steps.map((s) => [s.keyword, s.text]),
    scenario.examples.map((e) => [e.keyword, e.name, e.header, e.rows]),
  ]);
}

function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n");
}

function renderTable(rows: string[][], indent: string): string[] {
  const escaped = rows.map((row) => row.map(escapeCell));
  const widths: number[] = [];
  for (const row of escaped) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, [...cell].length)));
  const pad = (cell: string, width: number) => cell + " ".repeat(width - [...cell].length);
  return escaped.map((row) => `${indent}| ${widths.map((w, i) => pad(row[i] ?? "", w)).join(" | ")} |`);
}

function scenarioKeyword(plan: ParsedTestPlan, scenario: PlanScenario): string {
  const kw = dialectKeywords(plan.language);
  const isOutline = kw.outline.includes(scenario.keyword);
  const wantsOutline = scenario.examples.length > 0;
  if (scenario.keyword && isOutline === wantsOutline && (isOutline || kw.scenario.includes(scenario.keyword))) {
    return scenario.keyword;
  }
  // Reuse the keyword the document already uses for that kind, else the dialect default.
  const used = plan.scenarios.map((s) => s.keyword).find((k) => (wantsOutline ? kw.outline : kw.scenario).includes(k));
  const dialect = dialects[plan.language] ?? dialects.en;
  return used ?? (wantsOutline ? dialect.scenarioOutline[0] : dialect.scenario[dialect.scenario.length - 1]);
}

export function renderScenario(plan: ParsedTestPlan, scenario: PlanScenario): string[] {
  const { scenarioIndent, stepIndent, examplesIndent, tableIndent } = plan.layout;
  const out: string[] = [];
  for (const comment of scenario.comments) out.push(`${scenarioIndent}# ${comment}`.trimEnd());
  if (scenario.tags.length) out.push(`${scenarioIndent}${scenario.tags.join(" ")}`);
  out.push(`${scenarioIndent}${scenarioKeyword(plan, scenario)}: ${scenario.title.trim()}`);
  for (const step of scenario.steps) out.push(`${stepIndent}${step.keyword} ${step.text.trim()}`.trimEnd());
  const examplesKeyword = (dialects[plan.language] ?? dialects.en).examples[0];
  for (const examples of scenario.examples) {
    out.push("");
    out.push(`${examplesIndent}${examples.keyword || examplesKeyword}:${examples.name ? ` ${examples.name}` : ""}`);
    out.push(...renderTable([examples.header, ...examples.rows], tableIndent));
  }
  return out;
}

/**
 * Writes the plan back. Scenarios whose content equals the parsed original are
 * emitted verbatim; edited or new ones are rendered with the document's layout.
 */
export function serializeTestPlan(base: ParsedTestPlan, scenarios: PlanScenario[]): string {
  const original = new Map(base.scenarios.map((s) => [s.id, s]));
  const defaultGap = base.raw.size > 1 ? [...base.raw.values()][0].gapAfter : 1;
  const originalLast = base.scenarios.length ? base.raw.get(base.scenarios[base.scenarios.length - 1].id) : undefined;
  const lastGap = originalLast?.gapAfter ?? 0;
  const body: string[] = [...base.preamble];
  scenarios.forEach((scenario, index) => {
    const before = original.get(scenario.id);
    const rawBlock = base.raw.get(scenario.id);
    const unchanged = before && rawBlock && fingerprint(before) === fingerprint(scenario);
    body.push(...(unchanged ? rawBlock!.lines : renderScenario(base, scenario)));
    const isLast = index === scenarios.length - 1;
    const gap = isLast ? lastGap : rawBlock && rawBlock !== originalLast ? rawBlock.gapAfter : defaultGap;
    for (let i = 0; i < gap; i += 1) body.push("");
  });
  const bodyText = body.length ? body.join(base.eol) + base.eol : "";
  return base.head + bodyText + base.tail;
}

/**
 * Keeps the coverage table (and any bold mention) in sync when a scenario is
 * renamed: replaces "<keyword>: <old title>" and "**<old title>**" in the head.
 */
export function renameScenarioReferences(head: string, oldTitle: string, newTitle: string): string {
  if (!oldTitle || oldTitle === newTitle) return head;
  const old = escapeRegex(oldTitle);
  return head
    .replace(new RegExp(`(:\\s*)${old}(?=\\s*(?:[,;|]|\\r?\\n|$))`, "g"), (_m, prefix: string) => `${prefix}${newTitle}`)
    .replace(new RegExp(`\\*\\*${old}\\*\\*`, "g"), `**${newTitle}**`);
}

/** Titles mentioned in the coverage head that no longer exist among the scenarios. */
export function danglingCoverageTitles(plan: ParsedTestPlan, scenarios: PlanScenario[]): string[] {
  const titles = new Set(scenarios.map((s) => s.title.trim()));
  return plan.scenarios.map((s) => s.title.trim()).filter((t) => !titles.has(t) && plan.head.includes(t));
}

/** The Gherkin body of a serialized plan (between the fences). */
export function extractGherkinBody(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const open = lines.findIndex((line) => FENCE_OPEN.test(line));
  if (open < 0) return null;
  const close = lines.findIndex((line, i) => i > open && FENCE_CLOSE.test(line));
  return close < 0 ? null : lines.slice(open + 1, close).join("\n");
}

/**
 * Parses the body with the official Cucumber parser. Plans often omit the
 * Feature line, so one is synthesized (in the plan's language) when missing.
 */
export function parseGherkinStrict(body: string, language: string): GherkinDocument {
  const dialect = dialects[language] ?? dialects.en;
  const hasFeature = body.split("\n").some((line) => matchKeywordLine(line, [...dialect.feature]));
  const source = hasFeature
    ? body
    : `# language: ${language}\n${dialect.feature[0]}: plan\n${body.replace(LANGUAGE_HEADER, "")}`;
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher(language));
  return parser.parse(source);
}

function gherkinErrors(source: string, language: string): string[] {
  try {
    parseGherkinStrict(source, language);
    return [];
  } catch (error) {
    const nested = (error as { errors?: Error[] }).errors;
    if (Array.isArray(nested) && nested.length) return nested.map((e) => e.message);
    return [error instanceof Error ? error.message : String(error)];
  }
}

/**
 * Gherkin errors already present in a plan file. Shown as warnings: the source
 * files are written by another tool and may be invalid before anyone edits them.
 * Line numbers are relative to the Gherkin body.
 */
export function gherkinIssues(text: string, language: string): string[] {
  const body = extractGherkinBody(text);
  if (body === null) return ["El plan no tiene un bloque ```gherkin cerrado."];
  return gherkinErrors(body, language);
}

/**
 * Validates only the scenarios the user edited or added, so pre-existing
 * problems elsewhere in the file never block a commit.
 */
export function validateEditedScenarios(
  base: ParsedTestPlan,
  scenarios: PlanScenario[],
): Array<{ id: string; title: string; errors: string[] }> {
  const original = new Map(base.scenarios.map((s) => [s.id, s]));
  const problems: Array<{ id: string; title: string; errors: string[] }> = [];
  for (const scenario of scenarios) {
    const before = original.get(scenario.id);
    if (before && fingerprint(before) === fingerprint(scenario)) continue;
    const errors: string[] = [];
    if (!scenario.title.trim()) errors.push("El escenario no tiene título.");
    if (!scenario.steps.length) errors.push("El escenario no tiene pasos.");
    if (scenario.steps.some((s) => !s.text.trim())) errors.push("Hay pasos vacíos.");
    if (scenario.steps.some((s) => !stepKind(s.keyword, base.language))) errors.push("Hay pasos con una palabra clave no válida.");
    if (scenario.examples.some((e) => !e.header.length || e.rows.some((r) => r.length !== e.header.length))) {
      errors.push("La tabla de Ejemplos tiene filas con un número distinto de columnas.");
    }
    if (!errors.length) errors.push(...gherkinErrors(renderScenario(base, scenario).join("\n"), base.language));
    if (errors.length) problems.push({ id: scenario.id, title: scenario.title, errors });
  }
  return problems;
}
