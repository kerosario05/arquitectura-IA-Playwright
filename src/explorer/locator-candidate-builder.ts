import type { CandidateLocator } from "../types/page-snapshot.types";

type BuildInput = {
  tagName?: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  testId?: string;
  inputType?: string;
};

function hasText(value?: string): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildCandidateLocators(input: BuildInput): CandidateLocator[] {
  const candidates: CandidateLocator[] = [];

  if (hasText(input.testId)) {
    candidates.push({ strategy: "testId", value: input.testId.trim(), confidence: 0.95 });
  }
  if (hasText(input.role) && hasText(input.name)) {
    candidates.push({ strategy: "role", role: input.role.trim(), name: input.name.trim(), exact: false, confidence: 0.9 });
  }
  if (hasText(input.label)) {
    candidates.push({ strategy: "label", value: input.label.trim(), exact: false, confidence: 0.85 });
  }
  if (hasText(input.placeholder)) {
    candidates.push({ strategy: "placeholder", value: input.placeholder.trim(), exact: false, confidence: 0.8 });
  }
  if (hasText(input.text)) {
    candidates.push({ strategy: "text", value: input.text.trim(), exact: false, confidence: 0.75 });
  }
  if (hasText(input.id)) {
    candidates.push({ strategy: "css", value: `#${input.id.trim()}`, confidence: 0.55 });
  }
  if (hasText(input.name)) {
    candidates.push({ strategy: "css", value: `[name="${input.name.trim()}"]`, confidence: 0.5 });
  }

  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = `${item.strategy}|${item.value ?? ""}|${item.role ?? ""}|${item.name ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
