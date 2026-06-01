import fs from "node:fs/promises";
import path from "node:path";
import { loadAutomationIndex } from "./automation-index";
import type { PromotedAutomationIndexEntry } from "../types/automation-promotion.types";

/**
 * Carga todas las entradas de automatización de todos los apps en automations/apps/*.
 * Devuelve un array plano con deduplicación por id.
 */
export async function loadAllAppAutomationEntries(): Promise<PromotedAutomationIndexEntry[]> {
  const appsDir = "automations/apps";
  const allEntries: PromotedAutomationIndexEntry[] = [];
  const seen = new Set<string>();

  // Índice global (automations/index.json) si existe
  try {
    const globalIndex = await loadAutomationIndex("automations/index.json");
    for (const entry of globalIndex.automations) {
      if (!seen.has(entry.id)) {
        allEntries.push(entry);
        seen.add(entry.id);
      }
    }
  } catch {
    // No existe índice global — normal
  }

  // Índices por app (automations/apps/<slug>/index.json)
  try {
    const appDirs = await fs.readdir(appsDir, { withFileTypes: true });
    for (const dirent of appDirs) {
      if (!dirent.isDirectory()) continue;
      const indexPath = path.join(appsDir, dirent.name, "index.json");
      try {
        const index = await loadAutomationIndex(indexPath);
        for (const entry of index.automations) {
          if (!seen.has(entry.id)) {
            allEntries.push(entry);
            seen.add(entry.id);
          }
        }
      } catch {
        // App sin índice — saltar
      }
    }
  } catch {
    // Directorio apps/ no existe todavía
  }

  return allEntries;
}
