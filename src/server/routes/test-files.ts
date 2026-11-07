import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { readJiraApplications, saveJiraApplications } from "../../jira/jira-workflow-config";
import { canAccessProject, type Principal } from "../../auth/principal";
import { getProjectBySlug } from "../../db/project-repository";
import { listTestFiles, resolveTestFile, saveTestFile, TestFileStoreError } from "../../test-files/test-file-store";

export const testFilesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try { await fn(req, res); } catch (error) { next(error); }
  };
}

async function assertProjectAccess(principal: Principal, projectSlug: string): Promise<string> {
  const project = await getProjectBySlug(projectSlug);
  if (!project || !canAccessProject(principal, project.id) && !canAccessProject(principal, project.slug)) {
    throw new TestFileStoreError("invalid_project", "No tienes acceso a los archivos de este proyecto.");
  }
  return project.slug;
}

function projectSlugFrom(req: Request): string {
  const slug = typeof req.query.projectSlug === "string" ? req.query.projectSlug : req.body?.projectSlug;
  if (typeof slug !== "string" || !slug.trim()) throw new TestFileStoreError("invalid_project", "Indica el proyecto de automatización.");
  return slug.trim();
}

async function list(req: Request, res: Response) {
  const projectSlug = await assertProjectAccess(req.principal!, projectSlugFrom(req));
  res.json({ files: await listTestFiles(projectSlug) });
}

const uploadFile = upload.single("file");
function receiveUpload(req: Request, res: Response, next: NextFunction) {
  uploadFile(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ ok: false, error: "file_too_large", message: "El archivo supera el límite de 25 MB." });
      return;
    }
    next(error);
  });
}

const save = handle(async (req, res) => {
  if (!req.file) throw new TestFileStoreError("invalid_file", "Selecciona un archivo para adjuntar.");
  const projectSlug = await assertProjectAccess(req.principal!, projectSlugFrom(req));
  const asset = await saveTestFile({ projectSlug, filename: req.file.originalname, contentType: req.file.mimetype, bytes: req.file.buffer });
  res.status(201).json({ file: asset });
});

for (const prefix of ["/api/test-design/files", "/api/runs/test-files"]) {
  testFilesRouter.get(prefix, handle(async (req, res) => list(req, res)));
  testFilesRouter.post(prefix, receiveUpload, save);
}

for (const prefix of ["/api/test-design/workflow-applications", "/api/runs/workflow-applications"]) {
  testFilesRouter.get(prefix, handle(async (req, res) => {
    const slug = await assertProjectAccess(req.principal!, projectSlugFrom(req));
    res.json({ applications: await readJiraApplications(slug) });
  }));
  testFilesRouter.put(prefix, handle(async (req, res) => {
    const slug = await assertProjectAccess(req.principal!, projectSlugFrom(req));
    try { res.json({ applications: await saveJiraApplications(slug, req.body?.applications) }); }
    catch (error) {
      if (error instanceof Error && (/^JIRA_WORKFLOW_/.test(error.message) || error instanceof TypeError)) {
        res.status(400).json({ ok: false, error: "invalid_workflow_applications", message: "Revisa los nombres y URLs de las aplicaciones. El nombre principal está reservado." });
        return;
      }
      throw error;
    }
  }));
}

testFilesRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof TestFileStoreError) {
    res.status(error.code === "file_not_found" ? 404 : 400).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  next(error);
});

export async function resolveProjectTestFile(projectSlug: string, fileRef: string) {
  return resolveTestFile(projectSlug, fileRef);
}
