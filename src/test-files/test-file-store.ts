import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const FILE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".txt", ".csv", ".rtf"]);
const FILE_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"], ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".png": ["image/png"], ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"],
  ".txt": ["text/plain"], ".csv": ["text/csv", "application/vnd.ms-excel"],
  ".rtf": ["application/rtf", "text/rtf"],
};

export type TestFileAsset = {
  fileRef: string;
  projectSlug: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
};

export class TestFileStoreError extends Error {
  constructor(readonly code: "invalid_project" | "invalid_file" | "file_not_found", message: string) {
    super(message);
    this.name = "TestFileStoreError";
  }
}

function storageRoot(): string {
  // Keep fixture data beside the configured persistent evidence directory by default.
  // Deployments can point this at a dedicated durable volume with TEST_FILE_STORAGE_DIR.
  const evidenceDir = process.env.EVIDENCE_DIR?.trim() || "./evidence";
  return path.resolve(process.env.TEST_FILE_STORAGE_DIR?.trim() || path.join(evidenceDir, "..", "test-files"));
}

function safeProjectSlug(projectSlug: string): string {
  const slug = projectSlug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug)) throw new TestFileStoreError("invalid_project", "El proyecto indicado no es válido.");
  return slug;
}

function projectDirectory(projectSlug: string): string {
  return path.join(storageRoot(), safeProjectSlug(projectSlug));
}

function safeFilename(filename: string): string {
  const base = path.basename(filename.replace(/\\/g, "/"));
  const cleaned = base.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim().slice(0, 160);
  if (!cleaned || cleaned === "." || cleaned === "..") throw new TestFileStoreError("invalid_file", "El archivo debe tener un nombre válido.");
  return cleaned;
}

function filePaths(projectSlug: string, fileRef: string): { bytes: string; metadata: string } {
  if (!/^[0-9a-f-]{36}$/i.test(fileRef)) throw new TestFileStoreError("file_not_found", "El archivo de prueba no existe.");
  const directory = projectDirectory(projectSlug);
  return { bytes: path.join(directory, fileRef), metadata: path.join(directory, `${fileRef}.json`) };
}

function publicMetadata(value: unknown, projectSlug: string): TestFileAsset | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<TestFileAsset>;
  if (typeof item.fileRef !== "string" || typeof item.filename !== "string" || typeof item.contentType !== "string"
    || typeof item.size !== "number" || typeof item.sha256 !== "string" || typeof item.uploadedAt !== "string") return undefined;
  return { fileRef: item.fileRef, projectSlug, filename: item.filename, contentType: item.contentType,
    size: item.size, sha256: item.sha256, uploadedAt: item.uploadedAt };
}

export function validateTestFile(filename: string, contentType: string, size: number): { filename: string; contentType: string } {
  const safeName = safeFilename(filename);
  const extension = path.extname(safeName).toLowerCase();
  const normalizedType = contentType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  if (!FILE_EXTENSIONS.has(extension) || !(FILE_TYPES[extension] ?? []).includes(normalizedType)) {
    throw new TestFileStoreError("invalid_file", "Tipo de archivo no permitido. Usa PDF, Word, Excel, imagen, texto, CSV o RTF.");
  }
  if (!Number.isInteger(size) || size < 1 || size > 25 * 1024 * 1024) {
    throw new TestFileStoreError("invalid_file", "El archivo debe pesar entre 1 byte y 25 MB.");
  }
  return { filename: safeName, contentType: normalizedType };
}

export async function saveTestFile(input: { projectSlug: string; filename: string; contentType: string; bytes: Buffer }): Promise<TestFileAsset> {
  const projectSlug = safeProjectSlug(input.projectSlug);
  const validated = validateTestFile(input.filename, input.contentType, input.bytes.byteLength);
  const fileRef = randomUUID();
  const directory = projectDirectory(projectSlug);
  const paths = filePaths(projectSlug, fileRef);
  const asset: TestFileAsset = { fileRef, projectSlug, filename: validated.filename, contentType: validated.contentType,
    size: input.bytes.byteLength, sha256: createHash("sha256").update(input.bytes).digest("hex"), uploadedAt: new Date().toISOString() };
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(paths.bytes, input.bytes, { flag: "wx" });
  try {
    const tempMetadata = `${paths.metadata}.${randomUUID()}.tmp`;
    await fs.writeFile(tempMetadata, JSON.stringify(asset), { encoding: "utf8", flag: "wx" });
    await fs.rename(tempMetadata, paths.metadata);
  } catch (error) {
    await fs.rm(paths.bytes, { force: true }).catch(() => undefined);
    throw error;
  }
  return asset;
}

export async function listTestFiles(projectSlug: string): Promise<TestFileAsset[]> {
  const directory = projectDirectory(projectSlug);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const assets = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith(".json")).map(async entry => {
    try { return publicMetadata(JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8")), projectSlug); }
    catch { return undefined; }
  }));
  return assets.filter((asset): asset is TestFileAsset => Boolean(asset)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function resolveTestFile(projectSlug: string, fileRef: string): Promise<{ path: string; filename: string; contentType: string; size: number; sha256: string }> {
  const paths = filePaths(projectSlug, fileRef);
  try {
    const asset = publicMetadata(JSON.parse(await fs.readFile(paths.metadata, "utf8")), projectSlug);
    if (!asset) throw new Error("invalid metadata");
    const bytes = await fs.readFile(paths.bytes);
    if (bytes.byteLength !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error("file integrity mismatch");
    }
    return { path: paths.bytes, filename: asset.filename, contentType: asset.contentType, size: asset.size, sha256: asset.sha256 };
  } catch {
    throw new TestFileStoreError("file_not_found", "El archivo asociado no está disponible en el almacenamiento del servidor.");
  }
}
