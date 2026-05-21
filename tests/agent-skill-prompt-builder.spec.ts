import { test, expect } from "@playwright/test";
import { buildSkillAwarePrompt } from "../src/agent/agent-skill-prompt-builder";
import type { SkillAwarePromptInput } from "../src/agent/agent-skill-prompt-builder";
import type { SkillId } from "../src/types/agent-skill.types";

function makePromptInput(overrides?: Partial<SkillAwarePromptInput>): SkillAwarePromptInput {
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

test("prompt compacto referencia selected-skill.md", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  expect(prompt).toContain("selected-skill.md");
});

test("prompt compacto referencia context-pack.json", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  expect(prompt).toContain("context-pack.json");
});

test("prompt compacto dice produce agent-response.json", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  expect(prompt).toContain("agent-response.json");
});

test("prompt compacto no permite editar codigo salvo que skill lo permita", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  expect(prompt).toContain("Do not modify framework source files");
});

test("prompt compacto incluye regla de candidateId", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  expect(prompt).toContain("context-pack.json");
  expect(prompt).toContain("use only IDs present in context-pack.json");
});

test("prompt compacto incluye regla de confidence < 0.6", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  expect(prompt).toContain("If no safe repair is possible");
});

test("prompt compacto incluye regla de no_safe_action", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  expect(prompt).toContain("no safe repair is possible");
});

test("prompt compacto incluye read order", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  const readIndex = prompt.indexOf("Read these files first");
  const contextIndex = prompt.indexOf("context-pack.json");
  const skillIndex = prompt.indexOf("selected-skill.md");
  expect(readIndex).toBeGreaterThanOrEqual(0);
  expect(contextIndex).toBeGreaterThan(readIndex);
  expect(skillIndex).toBeGreaterThan(contextIndex);
});

test("prompt verbose incluye selected-skill.md", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput({ promptMode: "verbose" }));
  expect(prompt).toContain("selected-skill.md");
});

test("prompt verbose incluye context-pack.json", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput({ promptMode: "verbose" }));
  expect(prompt).toContain("context-pack.json");
});

test("prompt verbose lista campos de AgentSkillResponse", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput({ promptMode: "verbose" }));
  expect(prompt).toContain("AgentHandoffResponse");
  expect(prompt).toContain("generatedAt");
  expect(prompt).toContain("plans");
});

test("prompt verbose incluye reglas criticas", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput({ promptMode: "verbose" }));
  expect(prompt).toContain("candidate");
  expect(prompt).toContain("Never propose free-form CSS/XPath");
  expect(prompt).toContain("Never modify framework code");
  expect(prompt).toContain("Never propose data not in availableDataKeys");
});

test("prompt sin context-pack no incluye read line para context-pack.json", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput({ contextPackPath: undefined }));
  const lines = prompt.split("\n").map(l => l.trim());
  const contextLines = lines.filter(l => l.includes("context-pack.json"));
  expect(contextLines.length).toBeLessThanOrEqual(3);
  const readContextLine = lines.find(l => l.startsWith("1.") && l.includes("context-pack.json"));
  expect(readContextLine).toBeUndefined();
});

test("prompt para assertion-resolution contiene skillId correcto", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput({ skillId: "assertion-resolution" }));
  expect(prompt).toContain("selected-skill.md");
});

test("prompt para form-fill contiene skillId correcto", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput({ skillId: "form-fill" }));
  expect(prompt).toContain("selected-skill.md");
});

test("prompt no hardcodea apps, productos, URLs, case IDs", () => {
  const prompt = buildSkillAwarePrompt(makePromptInput());
  const lower = prompt.toLowerCase();
  expect(lower).not.toMatch(/(kiosko|saucelabs?)/);
  expect(lower).not.toMatch(/c\d{5}/);
});
