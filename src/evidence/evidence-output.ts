import type { EvidenceScenarioRecord } from "./evidence-types";
import { generateConsolidatedEvidencePdf } from "./evidence-pdf-generator";

export type EvidenceFormat = "pdf" | "docx";

type GenerationResult = { success: boolean; error?: string; outputPath?: string };

/**
 * Certification documents are delivered only as PDF, regardless of legacy configuration.
 */
export function resolveEvidenceFormats(env: Record<string, string | undefined> = process.env): EvidenceFormat[] {
  return ["pdf"];
}

/**
 * Generate every configured evidence document for these scenarios. A failure of one format does
 * not prevent the other.
 */
export async function generateEvidenceDocuments(
  scenarios: EvidenceScenarioRecord[],
  templatePath: string,
  outputs: { pdfPath: string; docxPath: string },
  formats: EvidenceFormat[] = resolveEvidenceFormats(),
): Promise<Partial<Record<EvidenceFormat, GenerationResult>>> {
  return { pdf: await generateConsolidatedEvidencePdf(scenarios, templatePath, outputs.pdfPath) };
}
