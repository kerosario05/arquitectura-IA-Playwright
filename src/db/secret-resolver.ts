export class SecretResolutionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function resolveSecretRef(secretRef: string): string {
  if (!secretRef?.trim()) {
    throw new SecretResolutionError("secret_ref_empty", "secretRef is empty or missing");
  }
  if (!secretRef.startsWith("env:")) {
    throw new SecretResolutionError("secret_provider_not_supported", `unsupported secret provider: ${secretRef.split(":")[0]}`);
  }
  const varName = secretRef.slice(4);
  if (!varName) {
    throw new SecretResolutionError("secret_provider_not_supported", "env: prefix requires a variable name");
  }
  const value = process.env[varName];
  if (!value) {
    throw new SecretResolutionError("secret_not_found", `environment variable ${varName} is not set`);
  }
  return value;
}
