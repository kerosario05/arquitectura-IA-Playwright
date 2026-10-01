import * as fs from "node:fs";
import * as path from "node:path";
import type { EvidenceScenarioRecord } from "./evidence-types";

/**
 * Format-independent content of an evidence document: the global header fields and, per
 * scenario, the title/status and the ordered screenshots. Both renderers (Word COM → DOCX and
 * Chromium → PDF) consume this, so a PDF and a DOCX of the same run carry the same images.
 */
export type EvidenceDocumentImage = { path: string; stepText: string };

export type EvidenceDocumentScenario = {
  scenarioId: string;
  title: string;
  status: string;
  images: EvidenceDocumentImage[];
  finalImagePath: string | null;
  finalIncluded: boolean;
  finalIsLast: boolean;
  validateFinalImage: boolean;
};

export type EvidenceDocumentModel = {
  requerimiento: string;
  analista: string;
  fecha: string;
  scenarios: EvidenceDocumentScenario[];
};

type CandidateImage = { path: string; stepText: string; stepIndex?: number };

export function buildEvidenceDocumentModel(scenarios: EvidenceScenarioRecord[]): EvidenceDocumentModel {
  const firstScenario = scenarios[0];
  const fecha = firstScenario?.date || new Date().toLocaleDateString("es-ES");

  // Requerimiento priority: explicit requirement, sectionName, sectionSlug, appSlug, fallback.
  let requerimiento = firstScenario?.requirement?.trim() || "";
  if (!requerimiento && firstScenario?.sectionName) {
    requerimiento = `${firstScenario.sectionName} - Ejecución Automatizada`;
  } else if (!requerimiento && firstScenario?.sectionSlug) {
    requerimiento = `${firstScenario.sectionSlug} - Ejecución Automatizada`;
  } else if (!requerimiento && firstScenario?.appSlug) {
    requerimiento = `${firstScenario.appSlug} - Ejecución Automatizada`;
  }
  if (!requerimiento) {
    requerimiento = "Ejecución Automatizada";
  }

  const analista = firstScenario?.analyst?.trim() || "Automatización";

  return {
    requerimiento,
    analista,
    fecha,
    scenarios: scenarios.map(buildEvidenceDocumentScenario),
  };
}

function buildEvidenceDocumentScenario(sc: EvidenceScenarioRecord): EvidenceDocumentScenario {
  const scenarioTitle = sc.scenarioTitle || sc.scenarioId || "Sin título";
  // Override status if detail evidence was required but not captured
  let scenarioStatus: string = sc.status || "Exitoso";
  if (sc.detailEvidence?.required && !sc.detailEvidence?.captured) {
    scenarioStatus = "Fallido";
    console.log(
      `[evidence-docx] scenario has invalid detailEvidence required=true captured=false target=${sc.detailEvidence.target || "unknown"}`,
    );
  }

  // Get functional step screenshots (exclude validation steps, deduplicate by path)
  const seenFuncPaths = new Set<string>();
  const functionalScreenshots: CandidateImage[] = sc.steps
    .filter(step => {
      if (!step.screenshotPath || !isImageFile(step.screenshotPath)) return false;
      if (!fs.existsSync(step.screenshotPath)) return false;
      if (/^\s*validar\b/i.test(step.stepText)) return false;
      const resolvedPath = path.resolve(step.screenshotPath);
      if (seenFuncPaths.has(resolvedPath)) {
        console.log(`[evidence-docx] skippedDuplicateImage scenario=${sc.scenarioId} step=${step.stepIndex ?? "?"} reason=same_step_screenshot`);
        return false;
      }
      seenFuncPaths.add(resolvedPath);
      return true;
    })
    .map(step => ({
      path: path.resolve(step.screenshotPath!),
      stepText: step.stepText,
      stepIndex: step.stepIndex,
    }));

  // If no functional screenshots, use last screenshot as fallback
  let images: CandidateImage[] = functionalScreenshots;
  if (images.length === 0) {
    const seenAllPaths = new Set<string>();
    const allScreenshots = sc.steps
      .filter(step => {
        if (!step.screenshotPath || !isImageFile(step.screenshotPath) || !fs.existsSync(step.screenshotPath)) return false;
        const resolvedPath = path.resolve(step.screenshotPath);
        if (seenAllPaths.has(resolvedPath)) return false;
        seenAllPaths.add(resolvedPath);
        return true;
      })
      .map(step => ({
        path: path.resolve(step.screenshotPath!),
        stepText: step.stepText,
        stepIndex: step.stepIndex,
      }));
    const fallbackImage = allScreenshots.length > 0 ? allScreenshots[allScreenshots.length - 1] : null;
    images = fallbackImage ? [fallbackImage] : [];
  }

  images = prependInitialScreenImage(sc, images);

  // Dedup final-phase images: keep only the dominant final screenshot per scenario.
  // The final phase = last N images around the dominant stepIndex.
  // Mode "detail_or_ordinal" removes adjacent steps (click → ordinal → detail).
  // Mode "simple_final" only removes same-step duplicates.
  if (images.length > 2) {
    const detailEvidencePath = sc.detailEvidence?.screenshotPath
      ? path.resolve(sc.detailEvidence.screenshotPath) : null;
    // Find the dominant final image: detailEvidence path, or first with detailloaded/detalle, or last image
    let dominantIdx = images.length - 1;
    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i];
      const isDominant = (detailEvidencePath !== null && path.resolve(img.path) === detailEvidencePath) ||
        /\bdetalle\b|detailloaded/i.test(img.stepText);
      if (isDominant) { dominantIdx = i; break; }
    }
    const dominantStepIdx = images[dominantIdx].stepIndex;
    if (dominantStepIdx !== undefined && dominantStepIdx !== null) {
      // Determine mode: detail/ordinal if the dominant image has detail signals
      const domImg = images[dominantIdx];
      const hasDetailSignals = (detailEvidencePath !== null && path.resolve(domImg.path) === detailEvidencePath) ||
        /\bdetalle\b|detailloaded/i.test(domImg.stepText);
      // Check if any image between the last clear boundary and dominant has ordinal/detail text
      let hasOrdinalOrDetail = hasDetailSignals;
      if (!hasOrdinalOrDetail) {
        for (let i = dominantIdx; i >= Math.max(0, dominantIdx - 2); i--) {
          if (/(?:primer|primera|ordinal|seleccionar|selecci).*visible|detalle|detailloaded/i.test(images[i]?.stepText || "")) {
            hasOrdinalOrDetail = true; break;
          }
        }
      }
      const threshold = dominantStepIdx - (hasOrdinalOrDetail ? 1 : 0);
      console.log(`[evidence-docx] finalPhaseDedupe thresholdStep=${threshold} mode=${hasOrdinalOrDetail ? "detail_or_ordinal" : "simple_final"}`);
      const removed: number[] = [];
      for (let i = dominantIdx - 1; i >= 0; i--) {
        const imgIdx = images[i].stepIndex;
        if (imgIdx === undefined || imgIdx === null) break;
        if (imgIdx >= threshold) {
          removed.push(i);
        } else {
          break;
        }
      }
      for (const idx of removed.sort((a, b) => b - a)) {
        console.log(`[evidence-docx] duplicateFinalPhaseImageSkipped scenario=${sc.scenarioId} reason=covered_by_final_phase_image`);
        images.splice(idx, 1);
      }
      console.log(`[evidence-docx] finalPhaseImageKept scenario=${sc.scenarioId} path=${images[images.length - 1]?.path ?? "none"}`);
    }
  }

  // Append detailEvidence screenshot as final image if it exists and is not already in images
  if (sc.detailEvidence?.screenshotPath) {
    const detailPath = path.resolve(sc.detailEvidence.screenshotPath);
    console.log(`[evidence-docx] detailEvidence found scenario=${sc.scenarioId} path=${detailPath} required=${sc.detailEvidence.required} captured=${sc.detailEvidence.captured}`);
    if (isImageFile(detailPath) && fs.existsSync(detailPath)) {
      const alreadyInImages = images.some(img => path.resolve(img.path) === detailPath);
      if (!alreadyInImages) {
        images.push({ path: detailPath, stepText: `Detalle: ${sc.detailEvidence.target || "producto"}` });
        console.log(`[evidence-docx] detail screenshot appended scenario=${sc.scenarioId}`);
      } else {
        // Move to last position
        const idx = images.findIndex(img => path.resolve(img.path) === detailPath);
        if (idx >= 0 && idx < images.length - 1) {
          const [item] = images.splice(idx, 1);
          images.push(item);
          console.log(`[evidence-docx] detail screenshot moved to last position scenario=${sc.scenarioId}`);
        }
      }
    } else {
      console.log(`[evidence-docx] detail screenshot file not accessible scenario=${sc.scenarioId} path=${detailPath}`);
    }
  }

  // ── DEDUP: remove duplicate images by absolute path within the same scenario ──
  if (images.length > 1) {
    const before = images.length;
    const seenPaths = new Set<string>();
    const deduped: CandidateImage[] = [];
    for (const img of images) {
      const abs = path.resolve(img.path);
      if (seenPaths.has(abs)) {
        console.log(`[evidence-docx] skippedDuplicate scenario=${sc.scenarioId} reason=exact_path path=${abs}`);
        continue;
      }
      seenPaths.add(abs);
      deduped.push(img);
    }
    // If detailEvidence exists and its path appears multiple times, keep only the last occurrence
    if (sc.detailEvidence?.screenshotPath && deduped.length > 1) {
      const detailAbs = path.resolve(sc.detailEvidence.screenshotPath);
      const detailIndexes = deduped.map((img, i) => path.resolve(img.path) === detailAbs ? i : -1).filter(i => i >= 0);
      if (detailIndexes.length > 1) {
        // Remove all but the last occurrence
        for (let i = detailIndexes.length - 2; i >= 0; i--) {
          console.log(`[evidence-docx] skippedDuplicate scenario=${sc.scenarioId} reason=detail_loaded path=${deduped[detailIndexes[i]].path}`);
          deduped.splice(detailIndexes[i], 1);
        }
      }
    }
    if (deduped.length < before) {
      console.log(`[evidence-docx] imageDedupe scenario=${sc.scenarioId} before=${before} after=${deduped.length} removed=${before - deduped.length}`);
    }
    images = deduped;
  }

  const prepared = finalizeScenarioImages(sc, images);
  console.log(
    `[evidence-docx] imagesForDocx scenario=${sc.scenarioId} count=${prepared.images.length} finalIncluded=${prepared.finalIncluded} finalIsLast=${prepared.finalIsLast} finalImagePath=${prepared.finalImagePath ?? "none"}`,
  );

  return {
    scenarioId: sc.scenarioId,
    title: scenarioTitle,
    status: scenarioStatus,
    images: prepared.images,
    finalImagePath: prepared.finalImagePath,
    finalIncluded: prepared.finalIncluded,
    finalIsLast: prepared.finalIsLast,
    validateFinalImage: Boolean(sc.detailEvidence?.captured && prepared.finalImagePath),
  };
}

export function finalizeScenarioImages(
  scenario: EvidenceScenarioRecord,
  imageCandidates: EvidenceDocumentImage[],
): {
  images: EvidenceDocumentImage[];
  finalImagePath: string | null;
  finalIncluded: boolean;
  finalIsLast: boolean;
} {
  const dedupedImages: EvidenceDocumentImage[] = [];
  const seenAbsolutePaths = new Set<string>();

  for (const image of imageCandidates) {
    const absolutePath = path.resolve(image.path);
    if (seenAbsolutePaths.has(absolutePath)) {
      continue;
    }
    seenAbsolutePaths.add(absolutePath);
    dedupedImages.push({
      path: absolutePath,
      stepText: image.stepText,
    });
  }

  let finalImagePath: string | null = null;
  if (scenario.detailEvidence?.captured && scenario.detailEvidence.screenshotPath) {
    const detailPath = path.resolve(scenario.detailEvidence.screenshotPath);
    if (isImageFile(detailPath) && fs.existsSync(detailPath)) {
      finalImagePath = detailPath;
    }
  }

  if (!finalImagePath && dedupedImages.length > 0) {
    finalImagePath = path.resolve(dedupedImages[dedupedImages.length - 1].path);
  }

  let images = dedupedImages;
  if (finalImagePath) {
    const finalImageEntry =
      images.find(image => path.resolve(image.path) === finalImagePath) ??
      {
        path: finalImagePath,
        stepText: `Detalle: ${scenario.detailEvidence?.target || "producto"}`,
      };
    images = images
      .filter(image => path.resolve(image.path) !== finalImagePath)
      .concat(finalImageEntry);
  }

  const finalIncluded = finalImagePath ? images.some(image => path.resolve(image.path) === finalImagePath) : false;
  const finalIsLast = finalImagePath
    ? images.length > 0 && path.resolve(images[images.length - 1].path) === finalImagePath
    : false;

  return { images, finalImagePath, finalIncluded, finalIsLast };
}

export function prependInitialScreenImage<T extends EvidenceDocumentImage>(
  scenario: EvidenceScenarioRecord,
  images: T[],
): Array<T | EvidenceDocumentImage> {
  const initial = scenario.initialScreenEvidence;
  if (!initial?.path || !isImageFile(initial.path) || !fs.existsSync(initial.path)) return images;
  const initialPath = path.resolve(initial.path);
  if (images.some((image) => path.resolve(image.path) === initialPath)) return images;
  return [{
    path: initialPath,
    stepText: initial.status === "load_failed"
      ? `ESTADO INICIAL - FALLO DE CARGA: ${initial.reason ?? "initial_load_failure"}`
      : "ESTADO INICIAL",
  }, ...images];
}

export function isImageFile(filepath: string): boolean {
  const ext = path.extname(filepath).toLowerCase();
  return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
}
