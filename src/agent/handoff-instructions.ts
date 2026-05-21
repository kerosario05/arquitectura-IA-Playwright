import type { AgentHandoffRequest } from "../types/agent-handoff.types";

export function buildAgentHandoffInstructions(request: AgentHandoffRequest): string {
  const contextPackLine = request.contextPackPath
    ? `- Read: \`context-pack.json\` (path: ${request.contextPackPath})`
    : "";

  const skillLine = request.selectedSkill
    ? `- Read: \`selected-skill.md\` (skill: ${request.selectedSkill.skillId})`
    : "";

  return `# Codex Agent Handoff

You are Codex acting as a web automation planner.

## Input files
- Read: \`handoff-request.json\`
- ${contextPackLine || "Optional: no context pack provided."}
${skillLine}
- Read: \`agent-response.schema.json\`
- Write: \`agent-response.json\`

## Mission
- Kind: \`${request.kind}\`
- Goal: ${request.goal}
${request.selectedSkill ? `- Selected Skill: \`${request.selectedSkill.skillId}\`` : ""}

## Rules
1. You must output valid JSON in \`agent-response.json\`.
2. Your JSON must match \`agent-response.schema.json\`.
3. Do not execute Playwright.
4. Do not modify stable Object Registry files.
5. Do not invent data.
6. Use only available data keys from \`dataContextSummary.availableKeys\` for \`valueKey\`.
7. Do not write secrets.
8. Do not generate Playwright code; write an AgentHandoffResponse JSON object, include \`recoveryDecision\`, and put repaired plans in the top-level \`plans\` array.
9. Use \`recoveryDecision: "repaired_plan"\` when you repaired or returned executable plans.
10. Use \`recoveryDecision: "no_safe_action"\` when no safe repair is possible.
11. Use \`recoveryDecision: "needs_more_context"\` when missing data or UI ambiguity blocks a safe repair.
12. If data is missing, set plan status to \`needs_data\` and add unresolvedQuestions.
13. If elements are missing/ambiguous, set \`needs_discovery\`.
14. If proposing objects, put them in \`proposedObjects\` only (never in stable registry file).
15. Prefer locator strategies in this order: role > label > placeholder > testId > text > css > xpath.
16. If confidence is low, keep noop or mark needs_discovery.
${request.selectedSkill ? `\n## Selected Skill: ${request.selectedSkill.skillId}\n- Read \`selected-skill.md\` for full constraints.\n- Your response must match the selected skill's output contract.\n- Do not use actions forbidden by the selected skill.\n` : ""}

## Important
- Framework validates your response deterministically.
- Invalid outputs will be rejected.
${request.contextPackPath ? "\n## Context pack\n- Read the context pack first and prefer reusing known promoted/pending validated plans and known objects.\n- If proposing new objects, include them as pending in proposedObjects only.\n" : ""}

## Next commands
- \`npm run agent:validate -- --response ./.artifacts/agent/.../agent-response.json\`
- \`npm run plans:execute -- --plans path\` (only after validation passes)
`;
}
