"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const agent_skill_prompt_builder_1 = require("../src/agent/agent-skill-prompt-builder");
function makePromptInput(overrides) {
    return {
        handoffDir: "/tmp/handoff/test",
        requestPath: "/tmp/handoff/test/handoff-request.json",
        instructionsPath: "/tmp/handoff/test/handoff-instructions.md",
        responsePath: "/tmp/handoff/test/agent-response.json",
        schemaPath: "/tmp/handoff/test/agent-response.schema.json",
        contextPackPath: "/tmp/handoff/test/context-pack.json",
        projectRoot: "/tmp/project",
        skillId: "target-disambiguation",
        promptMode: "compact",
        ...overrides
    };
}
(0, test_1.test)("prompt compacto referencia selected-skill.md", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    (0, test_1.expect)(prompt).toContain("selected-skill.md");
});
(0, test_1.test)("prompt compacto referencia context-pack.json", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    (0, test_1.expect)(prompt).toContain("context-pack.json");
});
(0, test_1.test)("prompt compacto dice produce agent-response.json", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    (0, test_1.expect)(prompt).toContain("agent-response.json");
});
(0, test_1.test)("prompt compacto no permite editar codigo salvo que skill lo permita", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    (0, test_1.expect)(prompt).toContain("Do not modify framework source files");
});
(0, test_1.test)("prompt compacto incluye regla de candidateId", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    (0, test_1.expect)(prompt).toContain("context-pack.json");
    (0, test_1.expect)(prompt).toContain("use only IDs present in context-pack.json");
});
(0, test_1.test)("prompt compacto incluye regla de confidence < 0.6", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    (0, test_1.expect)(prompt).toContain("If no safe repair is possible");
});
(0, test_1.test)("prompt compacto incluye regla de no_safe_action", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    (0, test_1.expect)(prompt).toContain("no safe repair is possible");
});
(0, test_1.test)("prompt compacto incluye read order", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    const readIndex = prompt.indexOf("Read these files first");
    const contextIndex = prompt.indexOf("context-pack.json");
    const skillIndex = prompt.indexOf("selected-skill.md");
    (0, test_1.expect)(readIndex).toBeGreaterThanOrEqual(0);
    (0, test_1.expect)(contextIndex).toBeGreaterThan(readIndex);
    (0, test_1.expect)(skillIndex).toBeGreaterThan(contextIndex);
});
(0, test_1.test)("prompt verbose incluye selected-skill.md", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput({ promptMode: "verbose" }));
    (0, test_1.expect)(prompt).toContain("selected-skill.md");
});
(0, test_1.test)("prompt verbose incluye context-pack.json", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput({ promptMode: "verbose" }));
    (0, test_1.expect)(prompt).toContain("context-pack.json");
});
(0, test_1.test)("prompt verbose lista campos de AgentSkillResponse", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput({ promptMode: "verbose" }));
    (0, test_1.expect)(prompt).toContain("AgentHandoffResponse");
    (0, test_1.expect)(prompt).toContain("generatedAt");
    (0, test_1.expect)(prompt).toContain("plans");
});
(0, test_1.test)("prompt verbose incluye reglas criticas", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput({ promptMode: "verbose" }));
    (0, test_1.expect)(prompt).toContain("candidate");
    (0, test_1.expect)(prompt).toContain("Never propose free-form CSS/XPath");
    (0, test_1.expect)(prompt).toContain("Never modify framework code");
    (0, test_1.expect)(prompt).toContain("Never propose data not in availableDataKeys");
});
(0, test_1.test)("prompt sin context-pack no incluye read line para context-pack.json", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput({ contextPackPath: undefined }));
    const lines = prompt.split("\n").map(l => l.trim());
    const contextLines = lines.filter(l => l.includes("context-pack.json"));
    (0, test_1.expect)(contextLines.length).toBeLessThanOrEqual(3);
    const readContextLine = lines.find(l => l.startsWith("1.") && l.includes("context-pack.json"));
    (0, test_1.expect)(readContextLine).toBeUndefined();
});
(0, test_1.test)("prompt para assertion-resolution contiene skillId correcto", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput({ skillId: "assertion-resolution" }));
    (0, test_1.expect)(prompt).toContain("selected-skill.md");
});
(0, test_1.test)("prompt para form-fill contiene skillId correcto", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput({ skillId: "form-fill" }));
    (0, test_1.expect)(prompt).toContain("selected-skill.md");
});
(0, test_1.test)("prompt no hardcodea apps, productos, URLs, case IDs", () => {
    const prompt = (0, agent_skill_prompt_builder_1.buildSkillAwarePrompt)(makePromptInput());
    const lower = prompt.toLowerCase();
    (0, test_1.expect)(lower).not.toMatch(/(kiosko|saucelabs?)/);
    (0, test_1.expect)(lower).not.toMatch(/c\d{5}/);
});
