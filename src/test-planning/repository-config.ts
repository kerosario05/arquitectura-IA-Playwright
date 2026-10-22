/**
 * Per-project configuration of the git repository that holds the
 * `test-plan-<HU>.md` files read by the "Planificación de pruebas" module.
 */

export interface RepositoryConfig {
  repoUrl: string;
  defaultBranch: string;
  /** Repo-relative folder holding one sub-folder per spec branch. */
  specsPath: string;
  /** File name pattern; `{key}` is the HU key (e.g. GEN-827). */
  filePattern: string;
  /** Branch names or globs (`release/*`) where commits are refused. */
  protectedBranches: string[];
  /**
   * `env:VAR` holding a PAT, sent as an HTTP header per command. null uses the
   * machine's own git credentials (credential manager / ssh agent).
   */
  credentialSecretRef: string | null;
  enabled: boolean;
}

export const REPOSITORY_CONFIG_DEFAULTS = {
  specsPath: "docs/specs",
  filePattern: "test-plan-{key}.md",
  protectedBranches: ["main", "master", "develop"],
} as const;

export class RepositoryConfigValidationError extends Error {
  readonly code = "validation_error";
  constructor(
    message: string,
    readonly field: keyof RepositoryConfig,
  ) {
    super(message);
  }
}

const HTTPS_URL = /^https:\/\/[^\s/@:]+(?:@[^\s/@:]+)?(?::\d+)?\/\S+$/i;
const SSH_URL = /^(?:ssh:\/\/[^\s/]+\/\S+|[\w.-]+@[\w.-]+:[\w./~-]\S*)$/i;
/**
 * Only variables named for this purpose may be used: the header is sent to the
 * configured URL, so allowing any `env:` ref would let a project editor send
 * other platform secrets (Jira, TestRail, DB) to a host of their choice.
 */
const ENV_REF = /^env:[A-Z0-9_]*GIT_(PAT|TOKEN)[A-Z0-9_]*$/;

/** Rejects URLs git would treat as local paths or remote helpers (`ext::`). */
export function isAllowedRepoUrl(url: string): boolean {
  return HTTPS_URL.test(url) || SSH_URL.test(url);
}

export function isHttpsRepoUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/** Subset of `git check-ref-format` that also blocks option injection. */
export function isValidBranchName(name: string): boolean {
  return (
    /^[\w.\-/]+$/.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//")
  );
}

export function matchesBranchPattern(branch: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return regex.test(branch);
}

export function isProtectedBranch(config: Pick<RepositoryConfig, "protectedBranches">, branch: string): boolean {
  return config.protectedBranches.some((pattern) => matchesBranchPattern(branch, pattern));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSpecsPath(value: string): string {
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) return "";
  if (cleaned.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new RepositoryConfigValidationError("La carpeta de specs debe ser una ruta relativa dentro del repo.", "specsPath");
  }
  if (!/^[\w.\- /]+$/.test(cleaned)) {
    throw new RepositoryConfigValidationError("La carpeta de specs tiene caracteres no permitidos.", "specsPath");
  }
  return cleaned;
}

/** Validates and normalizes a PUT body. Throws RepositoryConfigValidationError. */
export function normalizeRepositoryConfig(input: Record<string, unknown>): RepositoryConfig {
  const repoUrl = text(input.repoUrl);
  if (!repoUrl) throw new RepositoryConfigValidationError("La URL del repositorio es obligatoria.", "repoUrl");
  if (!isAllowedRepoUrl(repoUrl)) {
    throw new RepositoryConfigValidationError("La URL debe ser https://… o ssh (git@host:ruta).", "repoUrl");
  }
  if (/^https:\/\/[^/@]*:[^/@]*@/i.test(repoUrl)) {
    throw new RepositoryConfigValidationError("La URL no puede incluir contraseña; usa la credencial env:.", "repoUrl");
  }

  const defaultBranch = text(input.defaultBranch) || "develop";
  if (!isValidBranchName(defaultBranch)) {
    throw new RepositoryConfigValidationError("La rama por defecto no es un nombre de rama válido.", "defaultBranch");
  }

  const specsPath = normalizeSpecsPath(text(input.specsPath) || REPOSITORY_CONFIG_DEFAULTS.specsPath);

  const filePattern = text(input.filePattern) || REPOSITORY_CONFIG_DEFAULTS.filePattern;
  if (!filePattern.includes("{key}") || !filePattern.toLowerCase().endsWith(".md") || /[\\/]/.test(filePattern)) {
    throw new RepositoryConfigValidationError(
      "El patrón de archivo debe contener {key}, terminar en .md y no incluir carpetas.",
      "filePattern",
    );
  }

  const rawProtected = Array.isArray(input.protectedBranches)
    ? input.protectedBranches
    : typeof input.protectedBranches === "string"
      ? input.protectedBranches.split(/[,\n]/)
      : [...REPOSITORY_CONFIG_DEFAULTS.protectedBranches];
  const protectedBranches = [...new Set(rawProtected.map(text).filter(Boolean))];
  for (const pattern of protectedBranches) {
    if (!isValidBranchName(pattern.replace(/\*/g, "x"))) {
      throw new RepositoryConfigValidationError(`Rama protegida no válida: ${pattern}`, "protectedBranches");
    }
  }

  const credentialSecretRef = text(input.credentialSecretRef) || null;
  if (credentialSecretRef && !ENV_REF.test(credentialSecretRef)) {
    throw new RepositoryConfigValidationError(
      "La credencial debe ser env:VARIABLE y el nombre debe contener GIT_PAT o GIT_TOKEN (ej. env:AZDO_GIT_PAT).",
      "credentialSecretRef",
    );
  }
  if (credentialSecretRef && !isHttpsRepoUrl(repoUrl)) {
    throw new RepositoryConfigValidationError("La credencial env: solo aplica a URLs https.", "credentialSecretRef");
  }

  return {
    repoUrl,
    defaultBranch,
    specsPath,
    filePattern,
    protectedBranches,
    credentialSecretRef,
    enabled: input.enabled === undefined ? true : input.enabled === true || input.enabled === 1,
  };
}

/** File name for an HU key, e.g. `test-plan-GEN-827.md`. */
export function planFileName(config: Pick<RepositoryConfig, "filePattern">, key: string): string {
  return config.filePattern.replace("{key}", key);
}

/** Extracts the HU key from a file name, or null when it does not match the pattern. */
export function keyFromPlanFileName(config: Pick<RepositoryConfig, "filePattern">, fileName: string): string | null {
  const [prefix, suffix] = config.filePattern.split("{key}");
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) return null;
  const key = fileName.slice(prefix.length, fileName.length - suffix.length);
  return /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key) ? key.toUpperCase() : null;
}
