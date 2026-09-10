import type { InputRequirement } from "../db/project-case-input-requirement-service";
import type { RawTestRailCase } from "../types/testrail.types";

const SECTION_TITLE = "Datos de ejecución requeridos:";
const SECTION_START = "<!-- qa-lab:input-requirements:start -->";
const SECTION_END = "<!-- qa-lab:input-requirements:end -->";

function serializeRequirement(requirement: InputRequirement): string {
  if (!requirement.key || !requirement.controlType) {
    throw new Error("input requirement key and controlType are required");
  }
  const flags: string[] = [];
  if (requirement.required === true) flags.push("required");
  if (requirement.sensitive === true) flags.push("sensitive");
  const label = requirement.label?.trim() || requirement.key;
  return `${label} (${requirement.key}, ${requirement.controlType}, ${flags.join(", ")})`;
}

export function buildInputRequirementsContractSection(requirements: InputRequirement[]): string {
  return [
    SECTION_TITLE,
    SECTION_START,
    ...requirements.map(serializeRequirement),
    SECTION_END,
  ].join("\n");
}

export function applyInputRequirementsToPreconditions(
  rawCase: Pick<RawTestRailCase, "custom_preconds">,
  requirements: InputRequirement[],
): string {
  const existing = rawCase.custom_preconds?.trim() ?? "";
  const section = buildInputRequirementsContractSection(requirements);
  const markedSection = new RegExp(
    `(?:^|\\n)${SECTION_TITLE}\\n${SECTION_START}[\\s\\S]*?${SECTION_END}`,
  );
  if (markedSection.test(existing)) {
    return existing.replace(markedSection, (match) => `${match.startsWith("\n") ? "\n" : ""}${section}`);
  }

  const titleIndex = existing.indexOf(SECTION_TITLE);
  if (titleIndex >= 0) {
    const before = existing.slice(0, titleIndex).trimEnd();
    const afterTitle = existing.slice(titleIndex + SECTION_TITLE.length).replace(/^\s*\n?/, "");
    const lines = afterTitle.split("\n");
    let consumed = 0;
    while (consumed < lines.length && (lines[consumed].trim() === "" || /\(.+, .+(?:, .+)?\)$/.test(lines[consumed].trim()))) {
      consumed += 1;
    }
    const after = lines.slice(consumed).join("\n").trim();
    return [before, section, after].filter(Boolean).join("\n\n");
  }

  return existing ? `${existing}\n\n${section}` : section;
}
