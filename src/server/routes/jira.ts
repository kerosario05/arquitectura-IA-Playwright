import { Router } from "express";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import { defectChecklistStore } from "../services/defect-checklist-store";
import * as path from "path";
import * as fs from "fs";
import { generateEvidenceDocx } from "../../evidence/evidence-docx-generator";

export const jiraRouter = Router();

function client(): JiraClient {
  return new JiraClient(requireJiraConfig(config));
}

jiraRouter.get("/projects", async (_req, res, next) => {
  try {
    const projects = await client().getProjects();
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

jiraRouter.get("/projects/:key/sprints", async (req, res, next) => {
  try {
    const jira = client();
    const boards = await jira.getBoards(req.params.key);
    const scrumBoard = boards.find((b) => b.type === "scrum") ?? boards[0];
    if (!scrumBoard) {
      res.json({ board: null, sprints: [] });
      return;
    }
    const sprints = await jira.getSprints(scrumBoard.id);
    res.json({ board: scrumBoard, sprints });
  } catch (err) {
    next(err);
  }
});

jiraRouter.get("/projects/:key/sprint/active", async (req, res, next) => {
  try {
    const sprint = await client().getActiveSprint(req.params.key);
    res.json({ sprint: sprint ?? null });
  } catch (err) {
    next(err);
  }
});

jiraRouter.get("/issues", async (req, res, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const sprintId = req.query.sprintId as string | undefined;
    const status = req.query.status as string | undefined;

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const jqlParts: string[] = [`project = "${projectId.replace(/"/g, '\\"')}"`];
    if (sprintId) jqlParts.push(`sprint = ${parseInt(sprintId, 10)}`);
    if (status) jqlParts.push(`status = "${status.replace(/"/g, '\\"')}"`);

    const jql = jqlParts.join(" AND ");
    const fields = ["summary", "status", "issuetype", "priority"];
    const issues = await client().searchIssues(jql, fields);

    const mapped = issues.map((issue) => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      status: issue.fields?.status?.name ?? "",
      issueType: issue.fields?.issuetype?.name ?? "",
      projectId,
      sprintId: sprintId ? parseInt(sprintId, 10) : undefined,
    }));

    console.log(`[jira] issues fetched count=${mapped.length} project=${projectId} sprint=${sprintId ?? "none"} status=${status ?? "none"}`);
    res.json({ issues: mapped });
  } catch (err) {
    next(err);
  }
});

// POST /issues/upload-defects — create Jira issues and attach per-defect evidence
jiraRouter.post("/issues/upload-defects", async (req, res, next) => {
  try {
    const {
      sourceIssueKey,
      jiraProjectKey,
      defects = [],
      assigneeAccountId,
    } = req.body || {};

    if (!sourceIssueKey || !jiraProjectKey || !Array.isArray(defects) || defects.length === 0) {
      res.status(400).json({ ok: false, error: "sourceIssueKey, jiraProjectKey, and defects[] are required" });
      return;
    }

    const jira = client();
    const created: any[] = [];
    const failed: any[] = [];
    const skipped: any[] = [];

    const evidenceRoot = path.resolve(
      process.env.MCP_EVIDENCE_ROOT ||
      process.env.EVIDENCE_ROOT ||
      path.join(process.cwd(), ".artifacts", "evidence")
    );
    const templatePath = process.env.EVIDENCE_TEMPLATE_PATH || "";

    console.log(`[jira-evidence-runtime] cwd=${process.cwd()} configuredEvidenceRoot=${Boolean(process.env.MCP_EVIDENCE_ROOT || process.env.EVIDENCE_ROOT)} rootsChecked=2`);

    for (const d of defects) {
      const defectId = d.id;
      const scenarioId = d.scenarioId;
      const title = d.title || d.scenarioId || "Defecto QA Lab";
      const description = d.description || "";
      const issueType = (d as any).issueType;

      // Skip already-uploaded defects
      const storedDefect = defectId ? defectChecklistStore.findDefect(sourceIssueKey, defectId) : null;
      if (storedDefect?.jiraIssueKey) {
        skipped.push({ defectId, scenarioId, reason: "already_uploaded", jiraIssueKey: storedDefect.jiraIssueKey });
        continue;
      }

      // Create Jira issue
      const issueResult = await jira.createIssue({
        projectKey: jiraProjectKey,
        summary: title,
        description,
        issueType: issueType || undefined,
        assigneeAccountId,
      });

      if (!issueResult.ok || !issueResult.issueKey) {
        failed.push({ defectId, scenarioId, reason: issueResult.error || "issue_creation_failed" });
        continue;
      }

      const jiraIssueKey = issueResult.issueKey;

      // Persist Jira key on defect
      if (defectId) {
        try {
          const existing = defectChecklistStore.findDefect(sourceIssueKey, defectId);
          if (existing) {
            existing.jiraIssueKey = jiraIssueKey;
            existing.jiraIssueUrl = issueResult.issueUrl;
            defectChecklistStore.persist();
          }
        } catch { /* non-fatal */ }
      }

      // Resolve and attach evidence
      const evidenceResult = await resolveAndAttachEvidence({
        jira,
        defectId,
        scenarioId,
        jiraIssueKey,
        evidenceRoot,
        templatePath,
        sourceIssueKey,
      });

      console.log(`[jira-evidence-attach] defectId=${defectId} scenarioId=${scenarioId} jiraIssueKey=${jiraIssueKey} status=${evidenceResult.attachmentStatus} attachmentName=${evidenceResult.attachmentName || "none"}`);

      created.push({
        defectId,
        scenarioId,
        jiraIssueKey,
        jiraIssueUrl: issueResult.issueUrl,
        evidenceAttached: evidenceResult.attachmentStatus === "attached",
        attachmentStatus: evidenceResult.attachmentStatus,
        attachmentName: evidenceResult.attachmentName,
        attachmentReasonCode: evidenceResult.attachmentReasonCode,
      });
    }

    console.log(`[jira-upload-defect-result] total=${defects.length} created=${created.length} failed=${failed.length} skipped=${skipped.length}`);
    res.json({ ok: true, created, failed, skipped });
  } catch (err) {
    next(err);
  }
});

// POST /issues/:issueKey/retry-evidence — re-attach evidence to an existing Jira issue
jiraRouter.post("/issues/:issueKey/retry-evidence", async (req, res, next) => {
  try {
    const { issueKey } = req.params;
    const { sourceIssueKey, defectId } = req.body || {};

    if (!issueKey || !sourceIssueKey || !defectId) {
      res.status(400).json({ ok: false, error: "issueKey, sourceIssueKey, and defectId are required" });
      return;
    }

    const stored = defectChecklistStore.findDefect(sourceIssueKey, defectId);
    if (!stored) {
      res.status(404).json({ ok: false, error: "defect_not_found" });
      return;
    }

    const scenarioId = stored.scenarioId || defectId;
    const jira = client();
    const evidenceRoot = path.resolve(
      process.env.MCP_EVIDENCE_ROOT ||
      process.env.EVIDENCE_ROOT ||
      path.join(process.cwd(), ".artifacts", "evidence")
    );
    const templatePath = process.env.EVIDENCE_TEMPLATE_PATH || "";

    console.log(`[jira-evidence-runtime] cwd=${process.cwd()} configuredEvidenceRoot=${Boolean(process.env.MCP_EVIDENCE_ROOT || process.env.EVIDENCE_ROOT)}`);

    const result = await resolveAndAttachEvidence({
      jira,
      defectId,
      scenarioId,
      jiraIssueKey: issueKey,
      evidenceRoot,
      templatePath,
      sourceIssueKey,
    });

    res.json({
      ok: result.attachmentStatus === "attached",
      defectId,
      scenarioId,
      jiraIssueKey: issueKey,
      attachmentStatus: result.attachmentStatus,
      attachmentName: result.attachmentName,
      attachmentReasonCode: result.attachmentReasonCode,
    });
  } catch (err) {
    next(err);
  }
});

// Helper: resolve per-defect evidence DOCX and attach to Jira issue
async function resolveAndAttachEvidence(params: {
  jira: JiraClient;
  defectId: string;
  scenarioId: string;
  jiraIssueKey: string;
  evidenceRoot: string;
  templatePath: string;
  sourceIssueKey: string;
}): Promise<{
  attachmentStatus: "attached" | "not_available" | "generation_failed" | "upload_failed";
  attachmentName?: string;
  attachmentReasonCode?: string;
  attachmentDiagnosticCode?: string;
}> {
  const { jira, defectId, scenarioId, jiraIssueKey, evidenceRoot, templatePath, sourceIssueKey } = params;
  const attachmentName = `evidencia-${scenarioId.replace(/[^a-zA-Z0-9_-]/g, "")}.docx`;
  const stored = defectChecklistStore.findDefect(sourceIssueKey, defectId);
  const jobId = stored?.jobId;
  const legacyEvidenceDir = stored?.technicalContext?.evidenceDir;

  let docxPath: string | undefined;
  let sourceLog = "none";
  let screenshotCount = 0;
  let canonicalDirFound = false;
  let legacyDirPresent = false;

  // 1. Primary: canonical scan by jobId + scenarioId under evidence root + .artifacts/evidence
  const canonicalRoots = [
    evidenceRoot,
    path.resolve(".artifacts/evidence"),
  ];
  const uniqueRoots = [...new Set(canonicalRoots)];

  if (jobId) {
    for (const root of uniqueRoots) {
      const result = await tryGenerateScenarioDocx(jobId, scenarioId, root, templatePath, defectId);
      if (result) {
        canonicalDirFound = true;
        screenshotCount = result.screenshots;
        if (result.docxPath) {
          docxPath = result.docxPath;
          sourceLog = result.source;
          break;
        }
      }
    }
  }

  // 2. Fallback: legacy evidenceDir from technicalContext
  if (!docxPath && legacyEvidenceDir) {
    legacyDirPresent = true;
    const candidate = path.resolve(legacyEvidenceDir, "evidencia.docx");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && fs.statSync(candidate).size > 0) {
      docxPath = candidate;
      sourceLog = "legacy_evidence_dir";
    }
  }

  console.log(`[jira-evidence-path-resolution] defectId=${defectId} scenarioId=${scenarioId} jobId=${jobId ?? "none"} legacyDirPresent=${legacyDirPresent} canonicalDirFound=${canonicalDirFound} screenshots=${screenshotCount} docxExists=${docxPath != null}`);

  if (!docxPath) {
    return {
      attachmentStatus: "not_available",
      attachmentReasonCode: canonicalDirFound ? "scenario_docx_generation_failed" : "canonical_evidence_not_found",
    };
  }

  // Attach
  try {
    const attachResult = await jira.attachFileToIssue(jiraIssueKey, docxPath, attachmentName);
    if (attachResult.ok) {
      console.log(`[jira-evidence-attach] scenarioId=${scenarioId} jiraIssueKey=${jiraIssueKey} status=attached source=${sourceLog} attachmentId=${attachResult.attachmentId ?? "none"}`);
      return { attachmentStatus: "attached", attachmentName };
    }
    console.log(`[jira-evidence-attach] scenarioId=${scenarioId} jiraIssueKey=${jiraIssueKey} status=upload_failed source=${sourceLog}`);
    return { attachmentStatus: "upload_failed", attachmentName, attachmentReasonCode: attachResult.error };
  } catch {
    return { attachmentStatus: "upload_failed", attachmentName, attachmentReasonCode: "attachment_exception" };
  }
}

function resolveScreenshotPath(
  screenshotPath: string,
  scenarioDir: string,
  evidenceRoot: string,
  cwd: string,
  screenshotsDir: string,
  _stepIndex: number,
): string | undefined {
  const sp = screenshotPath.replace(/[\\/]+/g, path.sep).trim();
  if (!sp) return undefined;

  // 1. Absolute path — normalize and check existence
  if (path.isAbsolute(sp)) {
    if (fs.existsSync(sp) && isImageFile(sp)) return sp;
    return undefined;
  }

  // 2. Relative from cwd (e.g., ".artifacts/evidence/.../screenshots/file.png")
  const cwdCandidate = path.join(cwd, sp);
  if (fs.existsSync(cwdCandidate) && isImageFile(cwdCandidate)) return cwdCandidate;

  // 3. Relative from scenarioDir
  const scenarioCandidate = path.join(scenarioDir, sp);
  if (fs.existsSync(scenarioCandidate) && isImageFile(scenarioCandidate)) return scenarioCandidate;

  // 4. Relative from screenshotsDir
  const screenshotsCandidate = path.join(screenshotsDir, sp);
  if (fs.existsSync(screenshotsCandidate) && isImageFile(screenshotsCandidate)) return screenshotsCandidate;

  // 5. Basename search inside screenshotsDir
  const basename = path.basename(sp);
  if (basename && basename !== sp) {
    const basenameCandidate = path.join(screenshotsDir, basename);
    if (fs.existsSync(basenameCandidate) && isImageFile(basenameCandidate)) return basenameCandidate;
  }

  // 6. Raw file is directly in screenshotsDir
  const directCandidate = path.join(screenshotsDir, sp);
  if (fs.existsSync(directCandidate) && isImageFile(directCandidate)) return directCandidate;

  return undefined;
}

function isSafePath(filePath: string, allowedRoot: string): boolean {
  try {
    const resolved = path.resolve(filePath);
    const root = path.resolve(allowedRoot);
    const relative = path.relative(root, resolved);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function isImageFile(filepath: string): boolean {
  const ext = path.extname(filepath).toLowerCase();
  return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
}

async function tryGenerateScenarioDocx(
  jobId: string,
  scenarioId: string,
  evidenceRoot: string,
  templatePath: string,
  defectId: string,
): Promise<{ docxPath?: string; screenshots: number; source: string } | undefined> {
  try {
    const root = path.resolve(evidenceRoot);
    if (!fs.existsSync(root)) return undefined;

    // Walk app/section/runs/<jobId>/scenarios/<scenarioId>
    const apps = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const app of apps) {
      const appDir = path.join(root, app.name);
      const sections = fs.readdirSync(appDir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const section of sections) {
        const runsDir = path.join(appDir, section.name, "runs");
        if (!fs.existsSync(runsDir)) continue;
        const jobDir = path.join(runsDir, jobId);
        if (!fs.existsSync(jobDir)) continue;
        const scenarioDir = path.join(jobDir, "scenarios", scenarioId);
        if (!fs.existsSync(scenarioDir)) continue;

        // Check for existing DOCX first
        const existingDocx = path.join(scenarioDir, "evidencia.docx");
        if (fs.existsSync(existingDocx) && fs.statSync(existingDocx).isFile() && fs.statSync(existingDocx).size > 0) {
          console.log(`[jira-evidence-resolve] defectId=${defectId} scenarioId=${scenarioId} documentExists=true screenshots=n/a source=existing_docx`);
          return { docxPath: existingDocx, screenshots: -1, source: "existing_docx" };
        }

        // Try evidence.json for on-demand generation
        const evidenceJson = path.join(scenarioDir, "evidence.json");
        if (!fs.existsSync(evidenceJson)) continue;

        try {
          const record = JSON.parse(fs.readFileSync(evidenceJson, "utf-8"));
          const rawSteps: any[] = record.steps || [];
          const screenshotsDir = path.join(scenarioDir, "screenshots");

          // Resolve screenshot paths with multi-base fallback
          const normalizedSteps = rawSteps.map((s: any, idx: number) => {
            const sp = s.screenshotPath;
            if (!sp) return s;

            const resolved = resolveScreenshotPath(sp, scenarioDir, evidenceRoot, process.cwd(), screenshotsDir, idx);

            const pathKind = path.isAbsolute(sp) ? "absolute"
              : sp.startsWith(".artifacts") ? "project_relative"
              : sp.includes("screenshots") ? "scenario_relative"
              : "filename_only";

            const base = path.basename(resolved || sp);
            console.log(`[jira-evidence-image-resolution] scenarioId=${scenarioId} stepIndex=${s.index ?? idx} pathKind=${pathKind} absoluteExists=${resolved ? fs.existsSync(resolved) : false} basenameExists=${base ? fs.existsSync(path.join(screenshotsDir, base)) : false}`);

            return { ...s, screenshotPath: resolved || sp };
          });
          const normalizedRecord = { ...record, steps: normalizedSteps };

          const imagesDeclared = normalizedSteps.filter((s: any) => s.screenshotPath).length;
          const imagesExisting = normalizedSteps.filter((s: any) => s.screenshotPath && isImageFile(s.screenshotPath) && fs.existsSync(s.screenshotPath)).length;

          console.log(`[jira-evidence-record] scenarioId=${scenarioId} steps=${normalizedSteps.length} imagesDeclared=${imagesDeclared} imagesResolved=${imagesExisting}`);

          if (imagesExisting === 0) {
            return { screenshots: 0, source: "none" };
          }

          // Template resolution: try multiple locations
          let resolvedTemplate = "";
          if (templatePath) {
            const candidates = [
              path.resolve(templatePath),                                              // absolute or relative to cwd
              path.resolve(process.cwd(), templatePath),                               // explicit cwd
              path.resolve(path.dirname(__filename), "..", "..", "..", templatePath),  // relative to this source file
              path.resolve(evidenceRoot, "..", templatePath),                          // near evidence root
            ];
            // Also try the evidence config default location
            try {
              const { loadEvidenceConfig } = await import("../../evidence/evidence-types");
              const cfg = loadEvidenceConfig();
              if (cfg.templatePath && cfg.templatePath !== templatePath) {
                candidates.push(path.resolve(cfg.templatePath));
                candidates.push(path.resolve(process.cwd(), cfg.templatePath));
              }
            } catch { /* non-fatal */ }
            for (const c of candidates) {
              if (fs.existsSync(c)) { resolvedTemplate = c; break; }
            }
            if (!resolvedTemplate && candidates.length > 0) {
              // Try __dirname relative to the jira route file
              resolvedTemplate = candidates[0]; // use first candidate; will be checked below
            }
          }
          const templateExists = resolvedTemplate ? fs.existsSync(resolvedTemplate) : false;
          console.log(`[jira-evidence-template] source=multi_candidate resolved=${templateExists} extension=${resolvedTemplate ? path.extname(resolvedTemplate) || "none" : "none"}`);

          if (!templateExists) {
            console.log(`[jira-evidence-resolve] defectId=${defectId} scenarioId=${scenarioId} templatePath=missing_or_invalid`);
            return { screenshots: imagesExisting, source: "none" };
          }

          // Generate DOCX
          const docxOut = path.join(scenarioDir, "evidencia.docx");
          try {
            const result = await generateEvidenceDocx(normalizedRecord, resolvedTemplate, docxOut);
            const outputExists = fs.existsSync(docxOut);
            const outputSize = outputExists ? fs.statSync(docxOut).size : 0;

            if (result.success && outputExists && outputSize > 0) {
              console.log(`[jira-evidence-generation] scenarioId=${scenarioId} source=canonical_evidence_json screenshots=${imagesExisting} generated=true validated=true outputSize=${outputSize}`);
              return { docxPath: docxOut, screenshots: imagesExisting, source: "generated_docx" };
            }

            console.log(`[jira-evidence-generation-error] scenarioId=${scenarioId} errorName=GeneratorFailed errorMessage="${result.error || "unknown"}" templateResolved=${templateExists} recordLoaded=true imagesDeclared=${imagesDeclared} imagesExisting=${imagesExisting} outputCreated=${outputExists} outputSize=${outputSize}`);
          } catch (genErr: any) {
            console.log(`[jira-evidence-generation-error] scenarioId=${scenarioId} errorName=${genErr.name || "Error"} errorMessage="${(genErr.message || String(genErr)).slice(0, 200)}" templateResolved=${templateExists} recordLoaded=true imagesDeclared=${imagesDeclared} imagesExisting=${imagesExisting} outputCreated=false outputSize=0`);
          }

          return { screenshots: imagesExisting, source: "none" };
        } catch (parseErr: any) {
          console.log(`[jira-evidence-generation-error] scenarioId=${scenarioId} errorName=${parseErr.name || "Error"} errorMessage="${(parseErr.message || String(parseErr)).slice(0, 200)}" templateResolved=false recordLoaded=false imagesDeclared=0 imagesExisting=0 outputCreated=false outputSize=0`);
          return undefined;
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
