import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import JSZip from "jszip";
import type { EvidenceScenarioRecord } from "./evidence-types";

const execFileAsync = promisify(execFile);
const MAX_IMAGE_WIDTH_POINTS = 460;
const MAX_IMAGE_HEIGHT_POINTS = 430;
const GENERATOR_VERSION = createHash("sha1")
  .update(fs.readFileSync(__filename))
  .digest("hex")
  .slice(0, 12);

type PreparedScenarioDocxInput = {
  scenarioId: string;
  title: string;
  status: string;
  images: Array<{ path: string; stepText: string }>;
  finalImagePath: string | null;
  finalIncluded: boolean;
  finalIsLast: boolean;
  validateFinalImage: boolean;
};

/**
 * Generate a consolidated DOCX evidence document for multiple scenarios.
 * Uses Word COM on Windows as primary strategy, JSZip as fallback.
 */
export async function generateConsolidatedEvidenceDocx(
  scenarios: EvidenceScenarioRecord[],
  templatePath: string,
  outputPath: string,
): Promise<{ success: boolean; error?: string; outputPath?: string }> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  if (!fs.existsSync(templatePath)) {
    return { success: false, error: "evidence_template_not_found" };
  }
  try {
    return await generateConsolidatedFromTemplate(scenarios, templatePath, outputPath);
  } catch (err: any) {
    return { success: false, error: `evidence_docx_template_error: ${err.message}` };
  }
}

/**
 * Generate a DOCX evidence document for a single scenario using the corporate template.
 */
export async function generateEvidenceDocx(
  record: EvidenceScenarioRecord,
  templatePath: string,
  outputPath: string,
): Promise<{ success: boolean; error?: string; outputPath?: string }> {
  // Single scenario is just consolidated with one scenario
  return generateConsolidatedEvidenceDocx([record], templatePath, outputPath);
}

/**
 * Generate consolidated DOCX from template.
 * Strategy: Word COM on Windows (primary), JSZip fallback.
 */
async function generateConsolidatedFromTemplate(
  scenarios: EvidenceScenarioRecord[],
  templatePath: string,
  outputPath: string,
): Promise<{ success: boolean; error?: string; outputPath?: string }> {
  console.log(`[evidence:docx] generatorVersion=${GENERATOR_VERSION}`);

  // Step 1: Copy template to output
  await copyTemplateToOutput(templatePath, outputPath);

  // Step 2: Try Word COM on Windows
  if (process.platform === "win32") {
    console.log("[evidence:docx] strategy=word_com");
    const wordComResult = await tryWordComGeneration(scenarios, outputPath);
    if (wordComResult.success) {
      await normalizeWordComDocxOutput(outputPath, scenarios);
      return { success: true, outputPath };
    }
    console.log(`[evidence:docx] Word COM failed: ${wordComResult.error}, attempting retry with backoff before fallback`);
    console.log(`[evidence:docx] word_com_failed deleting_partial_docx=true`);

    // Delete the partial DOCX that Word may have left in incomplete state
    try { await fs.promises.unlink(outputPath); } catch { /* ignore if file doesn't exist */ }
    // Re-copy template for the fallback
    await copyTemplateToOutput(templatePath, outputPath);

    // Add retry with backoff before falling back to JSZip
    const retryDelays = [500, 1000, 2000];
    for (const delay of retryDelays) {
      console.log(`[evidence:docx] waiting ${delay}ms before checking file lock...`);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Check if file is still locked
      const isLocked = await isFileLocked(outputPath);
      if (!isLocked) {
        console.log(`[evidence:docx] file unlocked after ${delay}ms, safe to proceed with fallback`);
        break;
      }
      console.log(`[evidence:docx] file still locked after ${delay}ms`);
    }

    // Final check before fallback
    const stillLocked = await isFileLocked(outputPath);
    if (stillLocked) {
      return {
        success: false,
        error: "evidence_docx_locked_after_word_com_failure: File remains locked by Word after cleanup. Close Word manually and retry.",
      };
    }
  }

  if (process.platform === "win32") {
    return {
      success: false,
      error: "evidence_docx_word_com_required: Word COM failed and JSZip fallback is not accepted on Windows for this layout.",
    };
  }

  // Step 3: Fallback to JSZip
  console.log("[evidence:docx] strategy=jszip_fallback");
  return await jsZipFallbackGeneration(scenarios, outputPath);
}

/**
 * Check if a file is locked (Windows).
 */
async function isFileLocked(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.promises.open(filePath, "r+");
    await fd.close();
    return false;
  } catch (err: any) {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

/**
 * Copy template to output path.
 */
async function copyTemplateToOutput(templatePath: string, outputPath: string): Promise<void> {
  const outputDir = path.dirname(outputPath);
  await fs.promises.mkdir(outputDir, { recursive: true });

  // Remove existing output if exists
  try {
    await fs.promises.unlink(outputPath);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      // File exists but can't be deleted (might be open)
      if (err.code === "EBUSY" || err.code === "EPERM") {
        throw new Error(`Output file is locked or open: ${outputPath}. Close it and try again.`);
      }
      throw err;
    }
  }

  await fs.promises.copyFile(templatePath, outputPath);
}

/**
 * Try to generate DOCX using Word COM via PowerShell.
 * Uses JSON temp file to avoid PowerShell array escaping issues with complex paths.
 */
async function tryWordComGeneration(
  scenarios: EvidenceScenarioRecord[],
  outputPath: string,
): Promise<{ success: boolean; error?: string }> {
  let jsonTempPath: string | undefined;

  try {
    // Build scenario data
    const scenariosData: PreparedScenarioDocxInput[] = [];

    for (const sc of scenarios) {
      const scenarioTitle = sc.scenarioTitle || sc.scenarioId || "Sin título";
      // Override status if detail evidence was required but not captured
      let scenarioStatus = sc.status || "Exitoso";
      if (sc.detailEvidence?.required && !sc.detailEvidence?.captured) {
        scenarioStatus = "Fallido";
        console.log(
          `[evidence-docx] scenario has invalid detailEvidence required=true captured=false target=${sc.detailEvidence.target || "unknown"}`,
        );
      }

      // Get functional step screenshots (exclude validation steps)
      const functionalScreenshots = sc.steps
        .filter(step => {
          if (!step.screenshotPath || !isImageFile(step.screenshotPath)) return false;
          if (!fs.existsSync(step.screenshotPath)) return false;
          // Exclude steps starting with "Validar" (case-insensitive)
          if (/^\s*validar\b/i.test(step.stepText)) return false;
          return true;
        })
        .map(step => ({
          path: path.resolve(step.screenshotPath!),
          stepText: step.stepText,
        }));

      // If no functional screenshots, use last screenshot as fallback
      let images = functionalScreenshots;
      if (images.length === 0) {
        const allScreenshots = sc.steps
          .filter(step => step.screenshotPath && isImageFile(step.screenshotPath) && fs.existsSync(step.screenshotPath))
          .map(step => ({
            path: path.resolve(step.screenshotPath!),
            stepText: step.stepText,
          }));
        const fallbackImage = allScreenshots.length > 0 ? allScreenshots[allScreenshots.length - 1] : null;
        images = fallbackImage ? [fallbackImage] : [];
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

      const preparedImages = finalizeScenarioImagesForDocx(sc, images);
      images = preparedImages.images;
      console.log(
        `[evidence-docx] imagesForDocx scenario=${sc.scenarioId} count=${images.length} finalIncluded=${preparedImages.finalIncluded} finalIsLast=${preparedImages.finalIsLast} finalImagePath=${preparedImages.finalImagePath ?? "none"}`,
      );

      scenariosData.push({
        scenarioId: sc.scenarioId,
        title: scenarioTitle,
        status: scenarioStatus,
        images,
        finalImagePath: preparedImages.finalImagePath,
        finalIncluded: preparedImages.finalIncluded,
        finalIsLast: preparedImages.finalIsLast,
        validateFinalImage: Boolean(sc.detailEvidence?.captured && preparedImages.finalImagePath),
      });
      console.log(`[evidence:docx] Word COM input scenario=${scenarioTitle} images=${images.length} finalImagePath=${preparedImages.finalImagePath ?? "none"}`);
    }

    // Get first scenario data for global fields
    const firstScenario = scenarios[0];
    const fecha = firstScenario?.date || new Date().toLocaleDateString("es-ES");

    // Build requerimiento dynamically with priority:
    // 1. sectionName (if exists and not generic)
    // 2. sectionSlug
    // 3. appSlug
    // 4. fallback
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

    // Write JSON temp file
    jsonTempPath = path.join(path.dirname(outputPath), `docx-input-${Date.now()}.json`);
    const jsonData = {
      requerimiento,
      analista,
      fecha,
      scenarios: scenariosData,
    };

    await fs.promises.writeFile(jsonTempPath, JSON.stringify(jsonData, null, 2), "utf-8");
    console.log(`[evidence:docx] wrote JSON input tempPath=${jsonTempPath} scenarios=${scenariosData.length}`);

    // Build PowerShell script (reads JSON instead of embedding arrays)
    const script = buildWordComScript({
      outputPath,
      jsonInputPath: jsonTempPath,
    });

    // Execute PowerShell script
    const { stdout, stderr } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
      timeout: 90000, // 90 second timeout (increased for large documents)
    });

    if (stderr && stderr.trim()) {
      console.log(`[evidence:docx] Word COM stderr: ${stderr.trim().substring(0, 200)}`);
    }

    const stdoutFinalImageLines = (stdout ?? "")
      .split(/\r?\n/)
      .filter(line => /\[docx-word\] (IMAGE_INSERTED|FINAL_IMAGE_FORCED|FINAL_IMAGE_VERIFIED)/i.test(line))
      .slice(0, 80);
    if (stdoutFinalImageLines.length > 0) {
      console.log(`[evidence:docx] Word COM final-image stdout sample lines=${stdoutFinalImageLines.length}`);
      for (const line of stdoutFinalImageLines) {
        console.log(`[evidence:docx] ${line}`);
      }
    }

    const finalImageLogValidation = validateFinalImageInsertionLogs(stdout ?? "", scenariosData);
    for (const detail of finalImageLogValidation.details) {
      console.log(
        `[evidence:docx] final image log validation scenario=${detail.scenarioId} finalIncluded=${detail.finalIncluded} finalIsLast=${detail.finalIsLast} finalLogged=${detail.finalLogged} finalImagePath=${detail.finalImagePath ?? "none"}`,
      );
    }
    const failedFinalImageLog = finalImageLogValidation.details.find(detail => !detail.passed);
    if (failedFinalImageLog) {
      return {
        success: false,
        error: `evidence_docx_final_image_log_missing: scenario=${failedFinalImageLog.scenarioId}`,
      };
    }

    const marcoReutilizado = /MARCO_REUTILIZADO=true/i.test(stdout ?? "");
    const marcosGenerados = Number((stdout ?? "").match(/MARCOS_GENERADOS=(\d+)/i)?.[1] ?? "0");
    const imagenesInsertadas = Number((stdout ?? "").match(/IMAGENES_INSERTADAS=(\d+)/i)?.[1] ?? "0");

    console.log(`[evidence:docx] Word COM succeeded marcos=${marcosGenerados} reutilizado=${marcoReutilizado} images=${imagenesInsertadas}`);
    return { success: true };
  } catch (err: any) {
    console.log(`[evidence:docx] Word COM failed: ${err.message?.substring(0, 300)}`);
    return { success: false, error: err.message };
  } finally {
    // Cleanup JSON temp file
    if (jsonTempPath) {
      try {
        await fs.promises.unlink(jsonTempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function prepareScenarioDocxInput(scenario: EvidenceScenarioRecord): PreparedScenarioDocxInput {
  const scenarioTitle = scenario.scenarioTitle || scenario.scenarioId || "Sin tÃ­tulo";
  let scenarioStatus = scenario.status || "Exitoso";
  if (scenario.detailEvidence?.required && !scenario.detailEvidence?.captured) {
    scenarioStatus = "Fallido";
    console.log(
      `[evidence-docx] scenario has invalid detailEvidence required=true captured=false target=${scenario.detailEvidence.target || "unknown"}`,
    );
  }

  const functionalScreenshots = scenario.steps
    .filter(step => {
      if (!step.screenshotPath || !isImageFile(step.screenshotPath)) return false;
      if (!fs.existsSync(step.screenshotPath)) return false;
      if (/^\s*validar\b/i.test(step.stepText)) return false;
      return true;
    })
    .map(step => ({
      path: path.resolve(step.screenshotPath!),
      stepText: step.stepText,
    }));

  let images = functionalScreenshots;
  if (images.length === 0) {
    const allScreenshots = scenario.steps
      .filter(step => step.screenshotPath && isImageFile(step.screenshotPath) && fs.existsSync(step.screenshotPath))
      .map(step => ({
        path: path.resolve(step.screenshotPath!),
        stepText: step.stepText,
      }));
    const fallbackImage = allScreenshots.length > 0 ? allScreenshots[allScreenshots.length - 1] : null;
    images = fallbackImage ? [fallbackImage] : [];
  }

  if (scenario.detailEvidence?.screenshotPath) {
    const detailPath = path.resolve(scenario.detailEvidence.screenshotPath);
    console.log(
      `[evidence-docx] detailEvidence found scenario=${scenario.scenarioId} path=${detailPath} required=${scenario.detailEvidence.required} captured=${scenario.detailEvidence.captured}`,
    );
    if (isImageFile(detailPath) && fs.existsSync(detailPath)) {
      const alreadyInImages = images.some(image => path.resolve(image.path) === detailPath);
      if (!alreadyInImages) {
        images.push({ path: detailPath, stepText: `Detalle: ${scenario.detailEvidence.target || "producto"}` });
        console.log(`[evidence-docx] detail screenshot appended scenario=${scenario.scenarioId}`);
      } else {
        const idx = images.findIndex(image => path.resolve(image.path) === detailPath);
        if (idx >= 0 && idx < images.length - 1) {
          const [item] = images.splice(idx, 1);
          images.push(item);
          console.log(`[evidence-docx] detail screenshot moved to last position scenario=${scenario.scenarioId}`);
        }
      }
    } else {
      console.log(`[evidence-docx] detail screenshot file not accessible scenario=${scenario.scenarioId} path=${detailPath}`);
    }
  }

  const finalizedImages = finalizeScenarioImagesForDocx(scenario, images);
  console.log(
    `[evidence-docx] imagesForDocx scenario=${scenario.scenarioId} count=${finalizedImages.images.length} finalIncluded=${finalizedImages.finalIncluded} finalIsLast=${finalizedImages.finalIsLast} finalImagePath=${finalizedImages.finalImagePath ?? "none"}`,
  );

  return {
    scenarioId: scenario.scenarioId,
    title: scenarioTitle,
    status: scenarioStatus,
    images: finalizedImages.images,
    finalImagePath: finalizedImages.finalImagePath,
    finalIncluded: finalizedImages.finalIncluded,
    finalIsLast: finalizedImages.finalIsLast,
    validateFinalImage: Boolean(scenario.detailEvidence?.captured && finalizedImages.finalImagePath),
  };
}

function finalizeScenarioImagesForDocx(
  scenario: EvidenceScenarioRecord,
  imageCandidates: Array<{ path: string; stepText: string }>,
): {
  images: Array<{ path: string; stepText: string }>;
  finalImagePath: string | null;
  finalIncluded: boolean;
  finalIsLast: boolean;
} {
  const dedupedImages: Array<{ path: string; stepText: string }> = [];
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

function validateFinalImageInsertionLogs(
  stdout: string,
  scenarios: PreparedScenarioDocxInput[],
): {
  details: Array<{
    scenarioId: string;
    finalImagePath: string | null;
    finalIncluded: boolean;
    finalIsLast: boolean;
    finalLogged: boolean;
    passed: boolean;
  }>;
} {
  const details = scenarios
    .filter(scenario => scenario.validateFinalImage)
    .map(scenario => {
      const escapedScenarioId = escapeRegExp(scenario.scenarioId);
      const expectedIndex = scenario.images.length;
      const insertedRegex = new RegExp(
        `\\[docx-word\\] IMAGE_INSERTED scenario=${escapedScenarioId} index=${expectedIndex} final=(True|true)\\b`,
        "i",
      );
      const verifiedRegex = new RegExp(
        `\\[docx-word\\] FINAL_IMAGE_VERIFIED scenario=${escapedScenarioId} .*inserted=(True|true)`,
        "i",
      );
      const finalLogged = insertedRegex.test(stdout) || verifiedRegex.test(stdout);
      return {
        scenarioId: scenario.scenarioId,
        finalImagePath: scenario.finalImagePath,
        finalIncluded: scenario.finalIncluded,
        finalIsLast: scenario.finalIsLast,
        finalLogged,
        passed: scenario.finalIncluded && scenario.finalIsLast && finalLogged,
      };
    });

  return { details };
}

/**
 * Build PowerShell script for Word COM manipulation.
 * Reads data from JSON file to avoid PowerShell escaping issues.
 */
function buildWordComScript(args: {
  outputPath: string;
  jsonInputPath: string;
}): string {
  const escapeSingleQuote = (s: string) => s.replace(/'/g, "''");

  return [
    "$ErrorActionPreference='Stop'",
    `$docxPath='${escapeSingleQuote(path.resolve(args.outputPath))}'`,
    `$jsonPath='${escapeSingleQuote(path.resolve(args.jsonInputPath))}'`,
    "",
    "# Load data from JSON",
    "$data = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json",
    "$requerimiento = [string]$data.requerimiento",
    "$analista = [string]$data.analista",
    "$fecha = [string]$data.fecha",
    "$scenarios = $data.scenarios",
    "$stagedImageDir = Join-Path ([System.IO.Path]::GetDirectoryName($docxPath)) ('word-com-images-' + [guid]::NewGuid().ToString('N'))",
    "[System.IO.Directory]::CreateDirectory($stagedImageDir) | Out-Null",
    "function Get-WordSafeImagePath([string]$sourcePath, [string]$scenarioId, [int]$imageIndex) {",
    "  if (-not $sourcePath -or -not [System.IO.File]::Exists($sourcePath)) { return $null }",
    "  $extension = [System.IO.Path]::GetExtension($sourcePath)",
    "  if (-not $extension) { $extension = '.png' }",
    "  $safeName = ('{0}-{1:D3}{2}' -f $scenarioId, $imageIndex, $extension.ToLowerInvariant())",
    "  $destPath = Join-Path $stagedImageDir $safeName",
    "  [System.IO.File]::Copy($sourcePath, $destPath, $true)",
    "  return $destPath",
    "}",
    "",
    "# Initialize COM objects",
    "$word = $null",
    "$doc = $null",
    "$imagenesInsertadas = 0",
    "",
    "try {",
    "  $word = New-Object -ComObject Word.Application",
    "  $word.Visible = $false",
    "  $doc = $word.Documents.Open($docxPath)",
    "  $wdCollapseEnd = 0",
    "  $wdPageBreak = 7",
    "  $marcosGenerados = 0",
    "",
    "  # Helper function to fill labels in all document areas",
    "  function FillInRange([object]$rng, [string]$label, [string]$value){",
    "    try {",
    "      $r = $rng.Duplicate",
    "      $f = $r.Find",
    "      $f.ClearFormatting()",
    "      $f.Text = $label",
    "      $f.Forward = $true",
    "      $f.Wrap = 1",
    "      $ok = $f.Execute()",
    "      if (-not $ok) { return $false }",
    "      if ($r.Text -match [regex]::Escape($label) + \"\\s*\" + [regex]::Escape($value)) { return $true }",
    "      $newText = $label + \" \" + $value",
    "      $r.Text = $newText",
    "      return $true",
    "    } catch { return $false }",
    "  }",
    "",
    "  function FillEverywhere([object]$docRef, [string]$label, [string]$value){",
    "    $done = FillInRange $docRef.Content $label $value",
    "    $story = $docRef.StoryRanges",
    "    while ($story -ne $null -and -not $done) {",
    "      $done = FillInRange $story $label $value",
    "      try { $story = $story.NextStoryRange } catch { $story = $null }",
    "    }",
    "    if (-not $done) {",
    "      foreach ($s in $docRef.Shapes) {",
    "        try {",
    "          if ($s.TextFrame.HasText -eq -1) {",
    "            if (FillInRange $s.TextFrame.TextRange $label $value) { $done = $true; break }",
    "          }",
    "        } catch {}",
    "      }",
    "    }",
    "    if (-not $done) {",
    "      foreach ($tbl in $docRef.Tables) {",
    "        foreach ($cell in $tbl.Range.Cells) {",
    "          try {",
    "            $cellText = ($cell.Range.Text -replace \"[\\r\\a]\", \" \").Trim()",
    "            if ($cellText -like \"*$label*\") {",
    "              $cell.Range.Text = $label + \" \" + $value",
    "              $done = $true",
    "              break",
    "            }",
    "          } catch {}",
    "        }",
    "        if ($done) { break }",
    "      }",
    "    }",
    "    return $done",
    "  }",
    "",
    "",
    "  # Fill global fields",
    "  $okReq = FillEverywhere $doc \"Requerimiento:\" $requerimiento",
    "  $okAna = FillEverywhere $doc \"Analista:\" $analista",
    "",
    "  # Find base table containing \"Caso de prueba:\", \"Fecha:\", \"Estado:\"",
    "  $baseTable = $null",
    "  $markerText = '{{ESCENARIOS_EVIDENCIA}}'",
    "  $markerRange = $doc.Content.Duplicate",
    "  $markerFind = $markerRange.Find",
    "  $markerFind.ClearFormatting()",
    "  $markerFind.Text = $markerText",
    "  $markerFind.Forward = $true",
    "  $markerFind.Wrap = 1",
    "  $markerFound = $markerFind.Execute()",
    "",
    "  if ($markerFound) {",
    "    foreach ($tbl in $doc.Tables) {",
    "      try {",
    "        if ($tbl.Range.Start -le $markerRange.Start) {",
    "          $tblText = ($tbl.Range.Text -replace '[\\r\\a]', ' ')",
    "          if ($tblText -like '*Caso de prueba:*' -and $tblText -like '*Fecha:*' -and $tblText -like '*Estado:*') {",
    "            $baseTable = $tbl",
    "          }",
    "        }",
    "      } catch {}",
    "    }",
    "  }",
    "",
    "  # If not found near marker, search all tables",
    "  if ($baseTable -eq $null) {",
    "    foreach ($tbl in $doc.Tables) {",
    "      $tblText = ($tbl.Range.Text -replace '[\\r\\a]', ' ')",
    "      if ($tblText -like '*Caso de prueba:*' -and $tblText -like '*Fecha:*' -and $tblText -like '*Estado:*') {",
    "        $baseTable = $tbl",
    "        break",
    "      }",
    "    }",
    "  }",
    "",
    "  $marcoReutilizado = $false",
    "  if ($baseTable -ne $null) { $marcoReutilizado = $true }",
    "",
    "  # Replace marker with empty",
    "  if ($markerFound) {",
    "    $markerRange.Text = ''",
    "    $insertRange = $markerRange.Duplicate",
    "    $insertRange.Collapse($wdCollapseEnd)",
    "  } else {",
    "    $insertRange = $doc.Content.Duplicate",
    "    $insertRange.Collapse($wdCollapseEnd)",
    "  }",
    "",
    "  # Capture base table XML and delete it",
    "  if ($baseTable -ne $null) {",
    "    try {",
    "      $baseXml = $baseTable.Range.WordOpenXML",
    "      $baseTable.Delete()",
    "    } catch {",
    "      $baseXml = $null",
    "    }",
    "  } else {",
    "    $baseXml = $null",
    "  }",
    "",
    "  # Generate blocks for each scenario",
    "  for ($i = 0; $i -lt $scenarios.Count; $i++) {",
    "    $scenario = $scenarios[$i]",
    "    $scenarioId = [string]$scenario.scenarioId",
    "    $title = [string]$scenario.title",
    "    $statusScenario = [string]$scenario.status",
    "    $images = $scenario.images",
    "    $declaredFinalImagePath = [string]$scenario.finalImagePath",
    "",
    "    # Insert page break if not first",
    "    if ($i -gt 0) {",
    "      $insertRange.InsertBreak($wdPageBreak) | Out-Null",
    "      $insertRange.Collapse($wdCollapseEnd)",
    "    }",
    "",
    "    # Clone base table if available",
    "    if ($marcoReutilizado -and $baseXml) {",
    "      $insertRange.InsertXML($baseXml) | Out-Null",
    "      $currentTable = $doc.Tables.Item($doc.Tables.Count)",
    "",
    "      # Use FillInRange to replace labels in the cloned table (non-destructive)",
    "      try {",
    "        FillInRange $currentTable.Range \"Caso de prueba:\" $title | Out-Null",
    "        FillInRange $currentTable.Range \"Fecha:\" $fecha | Out-Null",
    "        FillInRange $currentTable.Range \"Estado:\" $statusScenario | Out-Null",
    "      } catch {}",
    "",
    "      $marcosGenerados += 1",
    "      $insertRange = $currentTable.Range.Duplicate",
    "      $insertRange.Collapse($wdCollapseEnd)",
    "      $insertRange.InsertParagraphAfter() | Out-Null",
    "      $insertRange.Collapse($wdCollapseEnd)",
    "    } else {",
    "      # Fallback: create simple table",
    "      $fallbackTable = $doc.Tables.Add($insertRange, 3, 1)",
    "      $fallbackTable.Cell(1,1).Range.Text = \"Caso de prueba: $title\"",
    "      $fallbackTable.Cell(2,1).Range.Text = \"Fecha: $fecha\"",
    "      $fallbackTable.Cell(3,1).Range.Text = \"Estado: $statusScenario\"",
    "      $marcosGenerados += 1",
    "      $insertRange = $fallbackTable.Range.Duplicate",
    "      $insertRange.Collapse($wdCollapseEnd)",
    "      $insertRange.InsertParagraphAfter() | Out-Null",
    "      $insertRange.Collapse($wdCollapseEnd)",
    "    }",
    "",
    "    # Insert images with proper path validation",
    "    $scenarioImagesInserted = 0",
    "    $finalImagePathScenario = $declaredFinalImagePath",
    "    $finalImageInserted = $false",
    "    $lastInsertedImagePath = $null",
    "    if ($images -ne $null) {",
    "      $scenarioImagesInserted = 0",
    "      foreach ($imgObj in $images) {",
    "        try {",
    "          $imgPathOriginal = [string]$imgObj.path",
    "",
    "          # Normalize and validate path",
    "          if (-not [System.IO.File]::Exists($imgPathOriginal)) {",
    "            Write-Output \"[docx-word] IMAGE_SKIPPED_NOT_FOUND scenario=$scenarioId path=$imgPathOriginal\"",
    "            continue",
    "          }",
    "          $imgPath = Get-WordSafeImagePath $imgPathOriginal $scenarioId ($scenarioImagesInserted + 1)",
    "          if (-not $imgPath -or -not [System.IO.File]::Exists($imgPath)) {",
    "            Write-Output \"[docx-word] IMAGE_STAGING_FAILED scenario=$scenarioId path=$imgPathOriginal stagedPath=$imgPath\"",
    "            continue",
    "          }",
    "",
    "          # Track if this is the final image for this scenario",
    "          $isFinalImage = ($finalImagePathScenario -and $imgPathOriginal -eq $finalImagePathScenario)",
    "          if (-not $finalImagePathScenario -and $scenarioImagesInserted -eq ($images.Count - 1)) {",
    "            $finalImagePathScenario = $imgPathOriginal",
    "            $isFinalImage = $true",
    "          }",
    "",
    "          Write-Output \"[docx-word] IMAGE_REQUEST scenario=$scenarioId index=$($scenarioImagesInserted + 1) path=$imgPathOriginal stagedPath=$imgPath\"",
    "",
    "          # Insert image using insertRange (already positioned after the scenario table)",
    "          $picRange = $doc.Range($insertRange.End, $insertRange.End)",
    "          $shape = $doc.InlineShapes.AddPicture($imgPath, $false, $true, $picRange)",
    "          $shape.LockAspectRatio = -1",
    "          $shape.Width = ${MAX_IMAGE_WIDTH_POINTS}",
    "          if ($shape.Height -gt ${MAX_IMAGE_HEIGHT_POINTS}) { $shape.Height = ${MAX_IMAGE_HEIGHT_POINTS} }",
    "          $shape.Range.ParagraphFormat.Alignment = 1",
    "          $insertRange.SetRange($shape.Range.End, $shape.Range.End)",
    "          $insertRange.InsertParagraphAfter() | Out-Null",
    "          $insertRange.Collapse($wdCollapseEnd)",
    "",
    "          $imagenesInsertadas += 1",
    "          $scenarioImagesInserted += 1",
    "          $lastInsertedImagePath = $imgPathOriginal",
    "          if ($isFinalImage -or ($finalImagePathScenario -and $imgPathOriginal -eq $finalImagePathScenario)) { $finalImageInserted = $true }",
    "          Write-Output \"[docx-word] IMAGE_INSERTED scenario=$scenarioId index=$($scenarioImagesInserted) final=$isFinalImage path=$imgPathOriginal stagedPath=$imgPath\"",
    "        } catch {",
    "          Write-Output \"[docx-word] IMAGE_FAILED scenario=$scenarioId path=$($imgObj.path) error=$($_.Exception.Message)\"",
    "        }",
    "      }",
    "    }",
    "",
    "    # Guarantee final image is inserted (if not already inserted via loop)",
    "    if ($finalImagePathScenario -and -not $finalImageInserted -and $lastInsertedImagePath -ne $finalImagePathScenario) {",
    "      try {",
    "        if ([System.IO.File]::Exists($finalImagePathScenario)) {",
    "          $finalImageStagedPath = Get-WordSafeImagePath $finalImagePathScenario $scenarioId 999",
    "          if (-not $finalImageStagedPath -or -not [System.IO.File]::Exists($finalImageStagedPath)) { throw 'Unable to stage final image for Word COM' }",
    "          $picRange = $doc.Range($insertRange.End, $insertRange.End)",
    "          $shape = $doc.InlineShapes.AddPicture($finalImageStagedPath, $false, $true, $picRange)",
    "          $shape.LockAspectRatio = -1",
    "          $shape.Width = ${MAX_IMAGE_WIDTH_POINTS}",
    "          if ($shape.Height -gt ${MAX_IMAGE_HEIGHT_POINTS}) { $shape.Height = ${MAX_IMAGE_HEIGHT_POINTS} }",
    "          $shape.Range.ParagraphFormat.Alignment = 1",
    "          $insertRange.SetRange($shape.Range.End, $shape.Range.End)",
    "          $insertRange.InsertParagraphAfter() | Out-Null",
    "          $insertRange.Collapse($wdCollapseEnd)",
    "          $imagenesInsertadas += 1",
    "          $lastInsertedImagePath = $finalImagePathScenario",
    "          $finalImageInserted = $true",
    "          Write-Output \"[docx-word] FINAL_IMAGE_FORCED scenario=$scenarioId path=$finalImagePathScenario stagedPath=$finalImageStagedPath\"",
    "        } else {",
    "          Write-Output \"[docx-word] FINAL_IMAGE_MISSING scenario=$scenarioId path=$finalImagePathScenario\"",
    "        }",
    "      } catch {",
    "        Write-Output \"[docx-word] FINAL_IMAGE_FAILED scenario=$scenarioId error=$($_.Exception.Message)\"",
    "      }",
    "    }",
    "    Write-Output \"[docx-word] FINAL_IMAGE_VERIFIED scenario=$scenarioId path=$finalImagePathScenario inserted=$finalImageInserted\"",
    "  }",
    "",
    "  $totalImagesExpected = 0",
    "  foreach ($sc in $scenarios) { if ($sc.images -ne $null) { $totalImagesExpected += $sc.images.Count } }",
    "  Write-Output \"[docx-word] SUMMARY imagesRequested=$totalImagesExpected imagesInserted=$imagenesInsertadas\"",
    "",
    "  # Clean up any remaining markers",
    "  $doc.Content.Find.Execute('{{ESCENARIOS_EVIDENCIA}}', $false, $false, $false, $false, $false, $true, 1, $false, '', 2) | Out-Null",
    "",
    "  # Save and close",
    "  $doc.Save()",
    "  Write-Output \"MARCO_REUTILIZADO=$marcoReutilizado\"",
    "  Write-Output \"MARCOS_GENERADOS=$marcosGenerados\"",
    "  Write-Output \"IMAGENES_INSERTADAS=$imagenesInsertadas\"",
    "} catch {",
    "  Write-Error \"Word COM error: $($_.Exception.Message)\"",
    "  throw",
    "} finally {",
    "  # Cleanup: always close Word even if error occurred",
    "  try {",
    "    if ($doc -ne $null) {",
    "      try {",
    "        $doc.Close($false)",
    "      } catch {}",
    "    }",
    "  } catch {}",
    "",
    "  try {",
    "    if ($word -ne $null) {",
    "      $word.Quit()",
    "    }",
    "  } catch {}",
    "",
    "  # Release COM objects",
    "  try {",
    "    if ($doc -ne $null) {",
    "      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null",
    "    }",
    "  } catch {}",
    "",
    "  try {",
    "    if ($word -ne $null) {",
    "      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null",
    "    }",
    "  } catch {}",
    "",
    "  # Force garbage collection",
    "  [GC]::Collect()",
    "  [GC]::WaitForPendingFinalizers()",
    "",
    "  try {",
    "    if ($stagedImageDir -and [System.IO.Directory]::Exists($stagedImageDir)) {",
    "      [System.IO.Directory]::Delete($stagedImageDir, $true)",
    "    }",
    "  } catch {}",
    "",
    "  Write-Output \"WORD_COM_CLEANUP_COMPLETED\"",
    "}",
  ].join("\n");
}

/**
 * Fallback generation using JSZip when Word COM is not available.
 * Creates a simplified document without step-by-step text listing.
 */
async function jsZipFallbackGeneration(
  scenarios: EvidenceScenarioRecord[],
  outputPath: string,
): Promise<{ success: boolean; error?: string; outputPath?: string }> {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(outputPath));

  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) {
    return { success: false, error: "word/document.xml not found in template" };
  }

  let documentXml = await documentXmlFile.async("string");
  documentXml = ensureImageNamespaces(documentXml);

  const { xml: scenariosXml, images } = buildSimplifiedScenarioBlocks(scenarios);

  const replacedDocumentXml = replacePlaceholderInXml(documentXml, "{{ESCENARIOS_EVIDENCIA}}", scenariosXml);
  if (!replacedDocumentXml) {
    return { success: false, error: "evidence_placeholder_not_found: {{ESCENARIOS_EVIDENCIA}} not found in template" };
  }

  zip.file("word/document.xml", replacedDocumentXml);

  // Handle images if any
  if (images.length > 0) {
    await embedImages(zip, images);
  }

  const docxBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });

  await fs.promises.writeFile(outputPath, docxBuffer);
  return { success: true, outputPath };
}

async function normalizeWordComDocxOutput(
  outputPath: string,
  scenarios: EvidenceScenarioRecord[],
): Promise<void> {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(outputPath));
  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) {
    return;
  }
  const relsXmlFile = zip.file("word/_rels/document.xml.rels");
  if (!relsXmlFile) {
    return;
  }

  let documentXml = await documentXmlFile.async("string");
  const relsXml = await relsXmlFile.async("string");

  documentXml = documentXml.replace(
    /<w:t>(Estado:\s+)(Exitoso|Fallido)\s+\2<\/w:t>/g,
    "<w:t>$1$2</w:t>",
  );

  documentXml = documentXml.replace(
    /<w:p\b[\s\S]*?<w:br\b[^>]*w:type="page"[^>]*\/>[\s\S]*?<w:t>-<\/w:t>[\s\S]*?<\/w:p>/,
    "",
  );

  console.log("[evidence:docx] normalizing image extents");
  const relsMap = parseDocumentRelationships(relsXml);
  const normalization = await normalizeZeroImageExtents(documentXml, zip, relsMap);
  documentXml = normalization.documentXml;

  zip.file("word/document.xml", documentXml);

  const docxBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });

  await fs.promises.writeFile(outputPath, docxBuffer);

  const validation = await validateNormalizedDocx(outputPath, scenarios);
  console.log(
    `[evidence:docx] image extent summary fixed=${normalization.fixed} zeroRemaining=${validation.zeroExtents}`,
  );
  console.log(
    `[evidence:docx] validation mediaFiles=${validation.mediaFiles} embeds=${validation.embeds} zeroExtents=${validation.zeroExtents} titlesFound=${validation.titlesFound}`,
  );
  for (const finalCheck of validation.finalImageChecks) {
    console.log(
      `[evidence:docx] final image validation scenario=${finalCheck.scenarioId} finalIncluded=${finalCheck.finalIncluded} finalIsLast=${finalCheck.finalIsLast} finalEmbedFound=${finalCheck.finalEmbedFound} finalImagePath=${finalCheck.finalImagePath ?? "none"}`,
    );
  }
  if (validation.zeroExtents > 0) {
    throw new Error(`evidence_docx_zero_extents_remaining: ${validation.zeroExtents}`);
  }
  if (validation.titlesFound !== scenarios.length) {
    throw new Error(`evidence_docx_titles_missing: expected=${scenarios.length} found=${validation.titlesFound}`);
  }
  if (validation.caseLabelsFound !== scenarios.length) {
    throw new Error(`evidence_docx_case_block_mismatch: expected=${scenarios.length} found=${validation.caseLabelsFound}`);
  }
  if (!validation.requirementFilled) {
    throw new Error("evidence_docx_requirement_missing");
  }
  if (!validation.analystFilled) {
    throw new Error("evidence_docx_analyst_missing");
  }
  if (validation.statusDuplicated) {
    throw new Error("evidence_docx_status_duplication_remaining");
  }
  const failedFinalCheck = validation.finalImageChecks.find(
    check => !(check.finalIncluded && check.finalIsLast && check.finalEmbedFound),
  );
  if (failedFinalCheck) {
    throw new Error(`evidence_docx_final_image_validation_failed: scenario=${failedFinalCheck.scenarioId}`);
  }
  console.log("[evidence:docx] validation passed realDocx=true");
}

function parseDocumentRelationships(relsXml: string): Map<string, string> {
  const relsMap = new Map<string, string>();
  const relRegex = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = relRegex.exec(relsXml)) !== null) {
    relsMap.set(match[1], match[2]);
  }
  return relsMap;
}

async function normalizeZeroImageExtents(
  documentXml: string,
  zip: JSZip,
  relsMap: Map<string, string>,
): Promise<{ documentXml: string; fixed: number }> {
  const containerRegex = /<wp:(inline|anchor)\b[\s\S]*?<a:blip\b[^>]*r:embed="([^"]+)"[\s\S]*?<\/wp:\1>/g;
  let fixed = 0;
  const updatedChunks: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = containerRegex.exec(documentXml)) !== null) {
    const [fullMatch, , rid] = match;
    updatedChunks.push(documentXml.slice(lastIndex, match.index));
    lastIndex = match.index + fullMatch.length;

    const hasZeroWpExtent = /<wp:extent\b[^>]*\bcx="0"[^>]*\bcy="0"[^>]*\/>/.test(fullMatch);
    const hasZeroADrawingExtent = /<a:ext\b[^>]*\bcx="0"[^>]*\bcy="0"[^>]*\/>/.test(fullMatch);
    if (!hasZeroWpExtent && !hasZeroADrawingExtent) {
      updatedChunks.push(fullMatch);
      continue;
    }

    const relTarget = relsMap.get(rid);
    const mediaPath = relTarget ? normalizeWordMediaPath(relTarget) : null;
    if (!mediaPath) {
      updatedChunks.push(fullMatch);
      continue;
    }

    const mediaFile = zip.file(mediaPath);
    if (!mediaFile) {
      updatedChunks.push(fullMatch);
      continue;
    }

    const imageBuffer = await mediaFile.async("nodebuffer");
    const dimensions = getImageDimensions(imageBuffer, path.extname(mediaPath));
    if (!dimensions) {
      updatedChunks.push(fullMatch);
      continue;
    }

    const { cx, cy } = scaleImageToEvidenceWidth(dimensions.width, dimensions.height);
    let updatedMatch = fullMatch;
    updatedMatch = updatedMatch.replace(
      /<wp:extent\b[^>]*\bcx="0"[^>]*\bcy="0"[^>]*\/>/g,
      `<wp:extent cx="${cx}" cy="${cy}"/>`,
    );
    updatedMatch = updatedMatch.replace(
      /<a:ext\b([^>]*)\bcx="0"([^>]*)\bcy="0"([^>]*)\/>/g,
      `<a:ext$1cx="${cx}"$2cy="${cy}"$3/>`,
    );

    if (updatedMatch !== fullMatch) {
      fixed += 1;
      console.log(`[evidence:docx] image extent fixed rid=${rid} media=${mediaPath} cx=${cx} cy=${cy}`);
    }
    updatedChunks.push(updatedMatch);
  }

  updatedChunks.push(documentXml.slice(lastIndex));
  return { documentXml: updatedChunks.join(""), fixed };
}

function normalizeWordMediaPath(target: string): string | null {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("word/")) {
    return normalized;
  }
  if (normalized.startsWith("media/")) {
    return `word/${normalized}`;
  }
  return `word/${normalized}`;
}

function scaleImageToEvidenceWidth(
  widthPx: number,
  heightPx: number,
): { cx: number; cy: number } {
  const EMU_PER_PIXEL = 9525;
  const maxWidthEmu = 5486400;
  let cx = Math.max(1, Math.round(widthPx * EMU_PER_PIXEL));
  let cy = Math.max(1, Math.round(heightPx * EMU_PER_PIXEL));

  if (cx > maxWidthEmu) {
    const scale = maxWidthEmu / cx;
    cx = Math.round(cx * scale);
    cy = Math.max(1, Math.round(cy * scale));
  }

  return { cx, cy };
}

function getImageDimensions(
  buffer: Buffer,
  extension: string,
): { width: number; height: number } | null {
  const ext = extension.toLowerCase();
  if (ext === ".png") {
    if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
      return null;
    }
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (ext === ".jpg" || ext === ".jpeg") {
    return getJpegDimensions(buffer);
  }

  return null;
}

function getJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const blockLength = buffer.readUInt16BE(offset + 2);
    if (blockLength < 2 || offset + 2 + blockLength > buffer.length) {
      return null;
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + blockLength;
  }

  return null;
}

async function validateNormalizedDocx(
  outputPath: string,
  scenarios: EvidenceScenarioRecord[],
): Promise<{
  mediaFiles: number;
  embeds: number;
  zeroExtents: number;
  titlesFound: number;
  caseLabelsFound: number;
  requirementFilled: boolean;
  analystFilled: boolean;
  statusDuplicated: boolean;
  finalImageChecks: Array<{
    scenarioId: string;
    finalIncluded: boolean;
    finalIsLast: boolean;
    finalEmbedFound: boolean;
    finalImagePath: string | null;
  }>;
}> {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(outputPath));
  const documentXml = await zip.file("word/document.xml")?.async("string");
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  if (!documentXml) {
    throw new Error("evidence_docx_validation_missing_document_xml");
  }
  if (!relsXml) {
    throw new Error("evidence_docx_validation_missing_document_rels");
  }

  const mediaFiles = Object.keys(zip.files).filter(name => /^word\/media\/[^/]+$/i.test(name)).length;
  const embeds = (documentXml.match(/r:embed="[^"]+"/g) ?? []).length;
  const zeroWpExtents = (documentXml.match(/<wp:extent\b[^>]*\bcx="0"[^>]*\bcy="0"[^>]*\/>/g) ?? []).length;
  const zeroADrawingExtents = (documentXml.match(/<a:ext\b[^>]*\bcx="0"[^>]*\bcy="0"[^>]*\/>/g) ?? []).length;
  const zeroExtents = zeroWpExtents + zeroADrawingExtents;
  const titlesFound = scenarios.filter(scenario => {
    const title = escapeXml(scenario.scenarioTitle || scenario.scenarioId || "");
    return title && documentXml.includes(title);
  }).length;
  const caseLabelsFound = (documentXml.match(/Caso de prueba:/g) ?? []).length;
  const textContent = decodeXmlEntities(
    Array.from(documentXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
      .map(match => match[1])
      .join(" "),
  ).replace(/\s+/g, " ");
  const requirementFilled = /Requerimiento:\s+\S+/.test(textContent);
  const analystFilled = /Analista:\s+\S+/.test(textContent);
  const statusDuplicated = textContent.includes("Estado: Exitoso Exitoso");
  const relsMap = parseDocumentRelationships(relsXml);
  const mediaHashes = await buildDocxMediaHashIndex(zip, relsMap);
  const finalImageChecks = await Promise.all(
    scenarios
      .map(prepareScenarioDocxInput)
      .filter(scenario => scenario.validateFinalImage)
      .map(async scenario => {
        const finalImageHash = scenario.finalImagePath ? await hashFileIfExists(scenario.finalImagePath) : null;
        const finalEmbedFound = finalImageHash ? mediaHashes.has(finalImageHash) : false;
        return {
          scenarioId: scenario.scenarioId,
          finalIncluded: scenario.finalIncluded,
          finalIsLast: scenario.finalIsLast,
          finalEmbedFound,
          finalImagePath: scenario.finalImagePath,
        };
      }),
  );

  return {
    mediaFiles,
    embeds,
    zeroExtents,
    titlesFound,
    caseLabelsFound,
    requirementFilled,
    analystFilled,
    statusDuplicated,
    finalImageChecks,
  };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildDocxMediaHashIndex(zip: JSZip, relsMap: Map<string, string>): Promise<Set<string>> {
  const hashes = new Set<string>();
  const mediaPaths = new Set(Array.from(relsMap.values()).map(target => normalizeWordMediaPath(target)).filter(Boolean) as string[]);
  for (const mediaPath of mediaPaths) {
    const mediaFile = zip.file(mediaPath);
    if (!mediaFile) {
      continue;
    }
    const buffer = await mediaFile.async("nodebuffer");
    hashes.add(createHash("sha1").update(buffer).digest("hex"));
  }
  return hashes;
}

async function hashFileIfExists(filePath: string): Promise<string | null> {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return createHash("sha1").update(buffer).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Build simplified scenario blocks (no step-by-step text).
 * Only metadata table + primary screenshot per scenario.
 */
function buildSimplifiedScenarioBlocks(
  scenarios: EvidenceScenarioRecord[],
): { xml: string; images: Array<{ rId: string; path: string; filename: string }> } {
  const blocks: string[] = [];
  const images: Array<{ rId: string; path: string; filename: string }> = [];
  let imageCounter = 1;
  let rIdCounter = 10;

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];

    // Metadata table (simplified, no nested structure)
    blocks.push(`
<w:tbl>
  <w:tblPr>
    <w:tblStyle w:val="TableGrid"/>
    <w:tblW w:w="9000" w:type="dxa"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>
    </w:tblBorders>
  </w:tblPr>
  <w:tr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
      <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Caso de prueba:</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6500" w:type="dxa"/></w:tcPr>
      <w:p><w:r><w:t>${escapeXml(sc.scenarioTitle)}</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
  <w:tr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
      <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Fecha:</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6500" w:type="dxa"/></w:tcPr>
      <w:p><w:r><w:t>${escapeXml(sc.date)}</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
  <w:tr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
      <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Estado:</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6500" w:type="dxa"/></w:tcPr>
      <w:p><w:r><w:t>${escapeXml(sc.status || "Exitoso")}</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`);

    // Add spacing after table
    blocks.push(`<w:p><w:pPr><w:spacing w:after="200"/></w:pPr></w:p>`);

    // Get functional screenshots (exclude validation steps)
    const functionalScreenshots = sc.steps.filter(
      step => {
        if (!step.screenshotPath || !isImageFile(step.screenshotPath)) return false;
        if (!fs.existsSync(step.screenshotPath)) return false;
        // Exclude steps starting with "Validar" (case-insensitive)
        if (/^\s*validar\b/i.test(step.stepText)) return false;
        return true;
      }
    );

    // If no functional screenshots, use last screenshot as fallback
    const screenshotsToUse = functionalScreenshots.length > 0
      ? functionalScreenshots
      : sc.steps.filter(step => step.screenshotPath && isImageFile(step.screenshotPath) && fs.existsSync(step.screenshotPath));

    // Prefer detailEvidence screenshot: move it last in output (as final/primary image)
    let detailScreenshotFound = false;
    if (sc.detailEvidence?.screenshotPath) {
      const detailPath = path.resolve(sc.detailEvidence.screenshotPath);
      console.log(`[evidence-docx] detailEvidence found scenario=${sc.scenarioId} path=${detailPath} required=${sc.detailEvidence.required} captured=${sc.detailEvidence.captured}`);
      if (isImageFile(detailPath) && fs.existsSync(detailPath)) {
        const detailIdx = screenshotsToUse.findIndex(s => {
          const sp = s.screenshotPath ? path.resolve(s.screenshotPath) : "";
          return sp === detailPath;
        });
        if (detailIdx >= 0) {
          const [detailScreenshot] = screenshotsToUse.splice(detailIdx, 1);
          screenshotsToUse.push(detailScreenshot);
          detailScreenshotFound = true;
          console.log(`[evidence-docx] detail screenshot moved to last position scenario=${sc.scenarioId}`);
        }
      } else {
        console.log(`[evidence-docx] detail screenshot file not accessible scenario=${sc.scenarioId} path=${detailPath}`);
      }
    }
    if (!detailScreenshotFound && sc.detailEvidence?.required && sc.detailEvidence?.captured && sc.detailEvidence?.screenshotPath) {
      const detailPath = path.resolve(sc.detailEvidence.screenshotPath);
      if (isImageFile(detailPath) && fs.existsSync(detailPath)) {
        console.log(`[evidence-docx] detail screenshot appended scenario=${sc.scenarioId}`);
        screenshotsToUse.push({
          index: sc.detailEvidence.capturedAfterStep ?? screenshotsToUse.length + 1,
          stepText: `Detalle: ${sc.detailEvidence.target}`,
          status: "passed",
          screenshotPath: detailPath,
          timestamp: new Date().toISOString(),
        } as any);
        detailScreenshotFound = true;
      } else {
        console.log(`[evidence-docx] detail screenshot file not found scenario=${sc.scenarioId} path=${detailPath}`);
      }
    }

    // Log final image info
    if (screenshotsToUse.length > 0) {
      const lastImg = screenshotsToUse[screenshotsToUse.length - 1];
      console.log(`[evidence-docx] case final image scenario=${sc.scenarioId} path=${lastImg.screenshotPath}`);
    }

    // Insert all functional screenshots
    for (const screenshot of screenshotsToUse) {
      const rId = `rId${rIdCounter++}`;
      const filename = `image${imageCounter++}${path.extname(screenshot.screenshotPath!)}`;
      images.push({ rId, path: screenshot.screenshotPath!, filename });

      blocks.push(`
<w:p>
  <w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="5280000" cy="3960000"/>
        <wp:effectExtent l="0" t="0" r="0" b="0"/>
        <wp:docPr id="${imageCounter}" name="${filename}"/>
        <wp:cNvGraphicFramePr>
          <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
        </wp:cNvGraphicFramePr>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr>
                <pic:cNvPr id="${imageCounter}" name="${filename}"/>
                <pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="${rId}"/>
                <a:srcRect/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext cx="5280000" cy="3960000"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>`);
    }

    // Page break after each scenario except the last
    if (i < scenarios.length - 1) {
      blocks.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
    }
  }

  return { xml: blocks.join("\n"), images };
}

/**
 * Embed images into the ZIP.
 */
async function embedImages(
  zip: JSZip,
  images: Array<{ rId: string; path: string; filename: string }>,
): Promise<void> {
  // Update rels
  let relsXml: string;
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (relsFile) {
    relsXml = await relsFile.async("string");
  } else {
    relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
  }

  for (const img of images) {
    const relXml = `  <Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.filename}"/>`;
    if (!relsXml.includes(`Id="${img.rId}"`)) {
      relsXml = relsXml.replace("</Relationships>", `${relXml}\n</Relationships>`);
    }
  }

  zip.file("word/_rels/document.xml.rels", relsXml);

  // Update content types
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (contentTypesFile) {
    let contentTypesXml = await contentTypesFile.async("string");
    const imageExts = new Set(images.map(img => path.extname(img.filename).toLowerCase()));
    for (const ext of imageExts) {
      const mimeType = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      const extWithoutDot = ext.substring(1);
      if (!contentTypesXml.includes(`Extension="${extWithoutDot}"`)) {
        const defaultXml = `  <Default Extension="${extWithoutDot}" ContentType="${mimeType}"/>`;
        contentTypesXml = contentTypesXml.replace("</Types>", `${defaultXml}\n</Types>`);
      }
    }
    zip.file("[Content_Types].xml", contentTypesXml);
  }

  // Add image files
  for (const img of images) {
    if (fs.existsSync(img.path)) {
      const imageData = await fs.promises.readFile(img.path);
      zip.file(`word/media/${img.filename}`, imageData);
    } else {
      console.log(`[evidence:docx] warning: image not found: ${img.path}`);
    }
  }
}

function isImageFile(filepath: string): boolean {
  const ext = path.extname(filepath).toLowerCase();
  return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
}

function ensureImageNamespaces(docXml: string): string {
  const requiredNamespaces = {
    "xmlns:r": 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    "xmlns:wp": 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    "xmlns:a": 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    "xmlns:pic": 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  };

  const rootMatch = docXml.match(/<w:document[^>]*>/);
  if (!rootMatch) {
    console.log("[evidence:docx] warning: could not find <w:document> root element");
    return docXml;
  }

  let rootElement = rootMatch[0];
  let modified = false;

  for (const [nsPrefix, nsDeclaration] of Object.entries(requiredNamespaces)) {
    if (!rootElement.includes(nsPrefix)) {
      rootElement = rootElement.replace(/>$/, ` ${nsDeclaration}>`);
      modified = true;
    }
  }

  if (modified) {
    docXml = docXml.replace(rootMatch[0], rootElement);
    console.log("[evidence:docx] added missing image namespaces to document.xml");
  }

  return docXml;
}

function replacePlaceholderInXml(xml: string, placeholder: string, replacement: string): string | null {
  const paragraphRegex = /<w:p\b[^>]*>.*?<\/w:p>/gs;
  const paragraphs: Array<{ full: string; start: number; end: number; text: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = paragraphRegex.exec(xml)) !== null) {
    const paragraphXml = m[0];
    const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let textMatch: RegExpExecArray | null;
    let text = "";
    while ((textMatch = textRegex.exec(paragraphXml)) !== null) {
      text += textMatch[1];
    }
    paragraphs.push({
      full: paragraphXml,
      start: m.index,
      end: m.index + paragraphXml.length,
      text,
    });
  }

  let phStartParagraph = -1, phEndParagraph = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].text.includes(placeholder)) {
      if (phStartParagraph < 0) {
        phStartParagraph = i;
      }
      phEndParagraph = i;
    } else if (phStartParagraph >= 0 && phEndParagraph >= 0) {
      break;
    }
  }

  if (phStartParagraph < 0) {
    for (let i = 0; i < paragraphs.length; i++) {
      let combinedText = paragraphs[i].text;
      for (let j = i + 1; j < paragraphs.length; j++) {
        combinedText += paragraphs[j].text;
        if (combinedText.includes(placeholder)) {
          phStartParagraph = i;
          phEndParagraph = j;
          break;
        }
        if (combinedText.length > placeholder.length * 2) {
          break;
        }
      }
      if (phStartParagraph >= 0) break;
    }
  }

  if (phStartParagraph < 0) return null;

  let result = xml.slice(0, paragraphs[phStartParagraph].start);
  result += replacement;
  result += xml.slice(paragraphs[phEndParagraph].end);

  return result;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
