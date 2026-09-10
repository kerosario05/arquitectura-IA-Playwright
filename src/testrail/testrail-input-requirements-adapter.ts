import type { RawTestRailCase } from "../types/testrail.types";
import {
  parseTestRailInputRequirements,
  type ParsedTestRailInputRequirements,
} from "./testrail-input-requirements-parser";

function appendFieldText(parts: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendFieldText(parts, item);
    return;
  }
  if (value && typeof value === "object") {
    const step = value as Record<string, unknown>;
    for (const key of ["content", "expected", "additional_info"]) {
      appendFieldText(parts, step[key]);
    }
  }
}

function stripContractMarkup(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/ol\s*>|<ol[^>]*>/gi, "\n")
    .replace(/<\/ul\s*>|<ul[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r\n?/g, "\n");
}

function contractText(rawCase: RawTestRailCase): string {
  const parts: string[] = [];
  appendFieldText(parts, rawCase.custom_preconds);
  appendFieldText(parts, rawCase.custom_steps);
  appendFieldText(parts, rawCase.custom_expected);
  appendFieldText(parts, rawCase.custom_steps_separated);
  return parts.join("\n");
}

export function extractTestRailInputRequirements(
  rawCase: RawTestRailCase,
): ParsedTestRailInputRequirements {
  return parseTestRailInputRequirements(stripContractMarkup(contractText(rawCase)));
}
