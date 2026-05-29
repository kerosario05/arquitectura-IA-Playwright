import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import type { TestRailProject, TestRailSection, TestRailSuite } from "../types/testrail.types";

type CliArgs = {
  projectId?: string;
  showSections: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { showSections: true };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--no-sections") { args.showSections = false; continue; }
    if (token === "--project-id") {
      if (!nextValue || nextValue.startsWith("--")) throw new Error("Missing value for --project-id");
      args.projectId = nextValue.trim();
      i += 1; continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function suiteModLabel(mode: 1 | 2 | 3): string {
  if (mode === 1) return "suite única";
  if (mode === 2) return "suite única + baselines";
  return "múltiples suites";
}

function buildSectionTree(
  sections: TestRailSection[],
  parentId: number | null = null,
  indent = "    "
): string[] {
  const children = sections
    .filter((s) => s.parent_id === parentId)
    .sort((a, b) => a.display_order - b.display_order);

  const lines: string[] = [];
  for (let i = 0; i < children.length; i += 1) {
    const s = children[i];
    const isLast = i === children.length - 1;
    const branch = isLast ? "└─" : "├─";
    lines.push(`${indent}${branch} [${s.id}] ${s.name}`);
    const childLines = buildSectionTree(sections, s.id, indent + (isLast ? "   " : "│  "));
    lines.push(...childLines);
  }
  return lines;
}

async function printProject(
  client: TestRailClient,
  project: TestRailProject,
  showSections: boolean,
  currentProjectId?: string,
  currentSuiteId?: string,
  currentSectionId?: string
): Promise<void> {
  const isCurrent = currentProjectId === String(project.id);
  const marker = isCurrent ? " ◄ CONFIGURADO" : "";
  const completed = project.is_completed ? "  [completado]" : "";
  console.log(`\n[${project.id}] ${project.name}${completed}${marker}`);
  console.log(`      URL: ${project.url ?? "—"}`);
  console.log(`      Modo: ${suiteModLabel(project.suite_mode)}`);

  let suites: TestRailSuite[] = [];
  try {
    suites = await client.getSuites(String(project.id));
  } catch {
    console.log(`      (no se pudieron obtener las suites)`);
    return;
  }

  if (suites.length === 0) {
    console.log(`      (sin suites)`);
    return;
  }

  for (const suite of suites) {
    const isSuiteCurrent = isCurrent && currentSuiteId === String(suite.id);
    const suiteMarker = isSuiteCurrent ? " ◄ CONFIGURADO" : "";
    const masterTag = suite.is_master ? " [master]" : "";

    let countLabel = "";
    try {
      const { count, hasMore } = await client.getCaseCount(String(project.id), String(suite.id));
      countLabel = `  ${hasMore ? `${count}+` : count} caso(s)`;
    } catch { /* ignore */ }

    console.log(`\n      Suite: ${padEnd(suite.name, 35)} id: ${suite.id}${masterTag}${countLabel}${suiteMarker}`);

    if (!showSections) continue;

    let sections: TestRailSection[] = [];
    try {
      sections = await client.getSections(String(project.id), String(suite.id));
    } catch {
      console.log(`        (no se pudieron obtener las secciones)`);
      continue;
    }

    if (sections.length === 0) {
      console.log(`        (sin secciones)`);
      continue;
    }

    const topLevel = sections.filter((s) => s.parent_id === null);
    if (topLevel.length === 0) {
      console.log(`        (${sections.length} sección/es)`);
      continue;
    }

    const tree = buildSectionTree(sections, null, "        ");
    for (const line of tree) {
      const sectionId = line.match(/\[(\d+)\]/)?.[1];
      const isSectionCurrent = isCurrent && isSuiteCurrent && currentSectionId === sectionId;
      console.log(line + (isSectionCurrent ? " ◄" : ""));
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const trConfig = requireTestRailConfig(config);
  const client = new TestRailClient(trConfig);

  const currentProjectId = config.integrations.testRail?.projectId;
  const currentSuiteId = config.integrations.testRail?.suiteId;
  const currentSectionId = config.integrations.testRail?.sectionId;

  console.log("Obteniendo proyectos TestRail...\n");
  console.log("=".repeat(60));

  let projects = await client.getProjects();

  if (args.projectId) {
    projects = projects.filter((p) => String(p.id) === args.projectId);
    if (projects.length === 0) throw new Error(`No se encontró proyecto con id: ${args.projectId}`);
  }

  if (projects.length === 0) {
    console.log("No se encontraron proyectos accesibles.");
    return;
  }

  for (const project of projects) {
    await printProject(client, project, args.showSections, currentProjectId, currentSuiteId, currentSectionId);
  }

  console.log("\n" + "=".repeat(60));
  console.log("\nConfiguración actual (.env):");
  console.log(`  TESTRAIL_PROJECT_ID = ${currentProjectId ?? "(no configurado)"}`);
  console.log(`  TESTRAIL_SUITE_ID   = ${currentSuiteId ?? "(no configurado)"}`);
  console.log(`  TESTRAIL_SECTION_ID = ${currentSectionId ?? "(no configurado)"}`);
  console.log(`\nOpciones:`);
  console.log(`  --project-id <id>   Filtra un proyecto específico`);
  console.log(`  --no-sections       Omite el árbol de secciones (más rápido)\n`);
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[testrail:projects] ${message}`);
    process.exitCode = 1;
  });
