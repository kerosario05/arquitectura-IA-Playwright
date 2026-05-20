import type { SnapshotElement } from "../types/page-snapshot.types";
import type { RegistryObjectType, RegistryLocator } from "../types/object-registry.types";
import type { ProposedObjectCandidate } from "../types/discovery.types";

const STOP_WORDS = new Set(["de", "la", "el", "los", "las", "un", "una", "y", "o", "en", "por", "para", "con", "sin", "al", "del", "se", "su", "es", "son", "the", "a", "an", "is", "are", "to", "for", "on", "in", "at", "by"]);

function sanitizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function extractMeaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function inferObjectType(element: SnapshotElement): RegistryObjectType {
  switch (element.type) {
    case "button":
      return "button";
    case "link":
      return "link";
    case "input":
      return "input";
    case "textarea":
      return "input";
    case "select":
      return "select";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "table":
      return "table";
    case "heading":
      return "section";
    case "dialog":
      return "modal";
    case "card":
      return "card";
    case "section":
      return "section";
    case "text":
      return "text";
    default:
      return "unknown";
  }
}

function buildObjectKey(element: SnapshotElement, objType: RegistryObjectType): string {
  const text = element.text || element.label || element.placeholder || element.name || "";
  const words = extractMeaningfulWords(text);
  const prefix = objType !== "unknown" ? objType : element.type;

  if (words.length > 0) {
    return `${prefix}_${words.slice(0, 3).join("_")}`;
  }

  if (element.tagName) {
    return `${prefix}_${element.tagName}`;
  }

  return `${prefix}_unnamed`;
}

function buildObjectName(element: SnapshotElement, objType: RegistryObjectType): string {
  const text = element.text || element.label || element.placeholder || element.name || "";
  if (text) {
    return text.slice(0, 80);
  }

  const typeLabels: Record<string, string> = {
    button: "Button",
    link: "Link",
    input: "Input field",
    select: "Select dropdown",
    checkbox: "Checkbox",
    radio: "Radio button",
    table: "Table",
    heading: "Section heading",
    dialog: "Dialog",
    modal: "Modal",
    card: "Card",
    section: "Section",
    text: "Text element",
    unknown: "Unknown element"
  };

  return typeLabels[objType] || typeLabels[element.type] || "Element";
}

function pickBestLocator(element: SnapshotElement): { locator: RegistryLocator; confidence: number } {
  if (element.candidateLocators.length === 0) {
    return {
      locator: { strategy: "text", value: element.text || element.name || "unknown", exact: false },
      confidence: 0.3
    };
  }

  const best = element.candidateLocators[0];

  let locator: RegistryLocator;
  switch (best.strategy) {
    case "testId":
      locator = { strategy: "testId", value: best.value };
      break;
    case "role":
      locator = { strategy: "role", role: best.role, name: best.name, exact: best.exact };
      break;
    case "label":
      locator = { strategy: "label", value: best.value, exact: best.exact };
      break;
    case "placeholder":
      locator = { strategy: "placeholder", value: best.value, exact: best.exact };
      break;
    case "text":
      locator = { strategy: "text", value: best.value, exact: best.exact };
      break;
    case "css":
      locator = { strategy: "css", value: best.value };
      break;
    default:
      locator = { strategy: "text", value: element.text || "unknown", exact: false };
  }

  return { locator, confidence: best.confidence };
}

function buildDescription(element: SnapshotElement, objType: RegistryObjectType): string {
  const parts: string[] = [];

  if (element.text) {
    parts.push(`Text: "${element.text.slice(0, 50)}"`);
  }
  if (element.label) {
    parts.push(`Label: "${element.label.slice(0, 50)}"`);
  }
  if (element.placeholder) {
    parts.push(`Placeholder: "${element.placeholder.slice(0, 50)}"`);
  }
  if (element.tagName) {
    parts.push(`Tag: <${element.tagName}>`);
  }
  if (element.required) {
    parts.push("Required");
  }
  if (element.disabled) {
    parts.push("Disabled");
  }

  return parts.join(" | ") || `Discovered ${objType} element`;
}

function buildAliases(element: SnapshotElement): string[] {
  const aliases: string[] = [];
  const texts = [element.text, element.label, element.placeholder, element.name].filter(Boolean) as string[];

  for (const text of texts) {
    const normalized = text.toLowerCase().trim();
    if (normalized.length > 2) {
      aliases.push(normalized);
    }
  }

  return [...new Set(aliases)];
}

export function buildProposedObject(element: SnapshotElement): ProposedObjectCandidate {
  const objType = inferObjectType(element);
  const key = buildObjectKey(element, objType);
  const name = buildObjectName(element, objType);
  const { locator, confidence } = pickBestLocator(element);
  const description = buildDescription(element, objType);
  const aliases = buildAliases(element);

  const reason = element.disabled
    ? "Element is disabled, may need state handling"
    : element.required
      ? "Required field, critical for form completion"
      : confidence >= 0.8
        ? "High confidence locator available"
        : confidence >= 0.6
          ? "Moderate confidence locator, may need refinement"
          : "Low confidence locator, requires manual review";

  return {
    element,
    type: objType,
    key,
    name,
    locator,
    confidence,
    reason
  };
}

export function buildProposedObjects(elements: SnapshotElement[]): ProposedObjectCandidate[] {
  const actionableTypes = new Set<SnapshotElement["type"]>([
    "button",
    "link",
    "input",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "table",
    "heading",
    "dialog",
    "card"
  ]);

  const filtered = elements.filter((el) => actionableTypes.has(el.type));
  const seenKeys = new Set<string>();
  const proposed: ProposedObjectCandidate[] = [];

  for (const element of filtered) {
    const candidate = buildProposedObject(element);

    if (seenKeys.has(candidate.key)) {
      let suffix = 1;
      let newKey = `${candidate.key}_${suffix}`;
      while (seenKeys.has(newKey)) {
        suffix += 1;
        newKey = `${candidate.key}_${suffix}`;
      }
      candidate.key = newKey;
    }

    seenKeys.add(candidate.key);
    proposed.push(candidate);
  }

  return proposed;
}
