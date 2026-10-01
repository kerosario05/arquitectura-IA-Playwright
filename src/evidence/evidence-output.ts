import { execFileSync } from "node:child_process";
import type { EvidenceScenarioRecord } from "./evidence-types";
import { generateConsolidatedEvidenceDocx } from "./evidence-docx-generator";
import { generateConsolidatedEvidencePdf } from "./evidence-pdf-generator";

export type EvidenceFormat = "pdf" | "docx";

type GenerationResult = { success: boolean; error?: string; outputPath?: string };

/**
 * Which evidence documents to produce, from EVIDENCE_FORMAT:
 *   pdf  — only the PDF (Chromium; works on a server without Office)
 *   docx — only the Word document (needs Word COM on Windows)
 *   both — both
 *   auto — (default) the PDF always, plus the DOCX when Word is installed on this machine
 */
export function resolveEvidenceFormats(env: Record<string, string | undefined> = process.env): EvidenceFormat[] {
  const configured = (env.EVIDENCE_FORMAT ?? "auto").trim().toLowerCase();
  if (configured === "pdf") return ["pdf"];
  if (configured === "docx") return ["docx"];
  if (configured === "both") return ["pdf", "docx"];
  return isWordAvailable() ? ["pdf", "docx"] : ["pdf"];
}

let wordAvailable: boolean | undefined;

/** Word registers the Word.Application COM class; without it the DOCX path can only fail. */
function isWordAvailable(): boolean {
  if (wordAvailable !== undefined) return wordAvailable;
  if (process.platform !== "win32") return (wordAvailable = false);
  try {
    execFileSync("reg", ["query", "HKCR\\Word.Application\\CLSID"], { stdio: "ignore", windowsHide: true });
    wordAvailable = true;
  } catch {
    wordAvailable = false;
  }
  console.log(`[evidence] Word COM available=${wordAvailable}`);
  return wordAvailable;
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
  const results: Partial<Record<EvidenceFormat, GenerationResult>> = {};
  for (const format of formats) {
    results[format] = format === "pdf"
      ? await generateConsolidatedEvidencePdf(scenarios, templatePath, outputs.pdfPath)
      : await generateConsolidatedEvidenceDocx(scenarios, templatePath, outputs.docxPath);
  }
  return results;
}
