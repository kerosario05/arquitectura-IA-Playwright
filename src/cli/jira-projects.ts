import { config, requireJiraConfig } from "../config/env";
import { JiraClient } from "../clients/jira.client";
import type { JiraProject, JiraBoard, JiraSprint } from "../types/jira.types";

type CliArgs = {
  projectKey?: string;
  showClosed: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { showClosed: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--show-closed") {
      args.showClosed = true;
      continue;
    }
    if (token === "--project-key") {
      if (!nextValue || nextValue.startsWith("--")) throw new Error("Missing value for --project-key");
      args.projectKey = nextValue.trim().toUpperCase();
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

async function printProjectSprints(
  client: JiraClient,
  project: JiraProject,
  showClosed: boolean
): Promise<{ boardId?: number; activeSprintId?: number; activeSprintName?: string }> {
  let boards: JiraBoard[];
  try {
    boards = await client.getBoards(project.key);
  } catch {
    console.log(`  (sin boards configurados o acceso denegado a la Agile API)`);
    return {};
  }

  if (boards.length === 0) {
    console.log(`  (sin boards)`);
    return {};
  }

  let activeSprintId: number | undefined;
  let activeSprintName: string | undefined;
  let firstBoardId: number | undefined;

  for (const board of boards) {
    console.log(`  Board: ${board.name} (id: ${board.id}, tipo: ${board.type})`);

    let sprints: JiraSprint[];
    try {
      const states: Array<"active" | "future" | "closed"> = showClosed
        ? ["active", "future", "closed"]
        : ["active", "future"];
      sprints = await client.getSprints(board.id, states);
    } catch {
      console.log(`    (no se pudieron obtener los sprints)`);
      continue;
    }

    if (sprints.length === 0) {
      console.log(`    (sin sprints)`);
      continue;
    }

    for (const sprint of sprints) {
      const isActive = sprint.state === "active";
      const isFuture = sprint.state === "future";
      const marker = isActive ? "★ ACTIVO " : isFuture ? "  FUTURO " : "  CERRADO";
      const name = padEnd(sprint.name, 40);
      const dates =
        sprint.startDate && sprint.endDate
          ? `${formatDate(sprint.startDate)} → ${formatDate(sprint.endDate)}`
          : sprint.startDate
          ? `desde ${formatDate(sprint.startDate)}`
          : "";

      console.log(`    [${marker}]  ${name}  id: ${sprint.id}  ${dates}`);

      if (isActive && !activeSprintId) {
        activeSprintId = sprint.id;
        activeSprintName = sprint.name;
        firstBoardId = board.id;
      }
    }
  }

  return { boardId: firstBoardId, activeSprintId, activeSprintName };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const jiraConfig = requireJiraConfig(config);
  const client = new JiraClient(jiraConfig);

  console.log("Obteniendo proyectos Jira accesibles...\n");

  let projects = await client.getProjects();

  if (args.projectKey) {
    projects = projects.filter((p) => p.key === args.projectKey);
    if (projects.length === 0) {
      throw new Error(`No se encontró el proyecto con key: ${args.projectKey}`);
    }
  }

  if (projects.length === 0) {
    console.log("No se encontraron proyectos accesibles.");
    return;
  }

  console.log("=".repeat(60));

  const suggestions: string[] = [];

  for (const project of projects) {
    console.log(`\n[${project.key}] ${project.name}  (id: ${project.id})`);

    const { activeSprintId, activeSprintName } = await printProjectSprints(
      client,
      project,
      args.showClosed
    );

    if (activeSprintId) {
      suggestions.push(
        `  # Sprint activo: "${activeSprintName}" (id: ${activeSprintId})\n` +
        `  npm run discovery:sprint -- --project-key ${project.key} --active-sprint --status "To Do"\n` +
        `  npm run discovery:sprint -- --project-key ${project.key} --sprint-id ${activeSprintId} --status "To Do"`
      );
    }
  }

  console.log("\n" + "=".repeat(60));

  if (suggestions.length > 0) {
    console.log("\nComandos sugeridos para correr el pipeline:\n");
    for (const s of suggestions) {
      console.log(s);
    }
  }

  console.log(
    "\nOpciones de --status comunes: \"To Do\"  \"In Progress\"  \"Done\"  \"Desestimado\"\n" +
    "Agregar --dry-run para ver los escenarios sin ejecutar discovery.\n" +
    "Agregar --auto-promote para promover a spec si el discovery pasa.\n"
  );
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[jira:projects] ${message}`);
    process.exitCode = 1;
  });
