import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Encrypts secrets stored in the database (AES-256-GCM, a fresh random IV per value).
 *
 * The key never lives in the database:
 *   1. QA_LAB_SECRETS_KEY (any passphrase; stretched with scrypt) when set, otherwise
 *   2. a 32-byte random key in `data/secret.key`, created on first use and ignored by git.
 * Losing the key makes stored secrets unreadable: callers must then ask for them again.
 */
const VERSION = "v1";
const FIXED_SALT = "qa-lab/secret-box/v1";
const keyCache = new Map<string, Buffer>();

export class SecretBoxError extends Error {
  constructor(readonly code: "secret_unreadable" | "secret_key_unavailable", message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

function keyFilePath(env: NodeJS.ProcessEnv): string {
  return path.resolve(env.QA_LAB_SECRET_KEY_FILE?.trim() || path.join("data", "secret.key"));
}

function loadKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const passphrase = env.QA_LAB_SECRETS_KEY?.trim();
  const cacheKey = passphrase ? `env:${passphrase}` : `file:${keyFilePath(env)}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  let key: Buffer;
  if (passphrase) {
    key = scryptSync(passphrase, FIXED_SALT, 32);
  } else {
    const file = keyFilePath(env);
    try {
      if (fs.existsSync(file)) {
        key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
        if (key.length !== 32) throw new Error("invalid length");
      } else {
        key = randomBytes(32);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
      }
    } catch (error) {
      throw new SecretBoxError("secret_key_unavailable", `No se pudo leer ni crear la clave de cifrado (${error instanceof Error ? error.message : "error"}).`);
    }
  }
  keyCache.set(cacheKey, key);
  return key;
}

export function encryptSecret(plain: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(env), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  const [version, iv, tag, body] = String(stored ?? "").split(":");
  if (version !== VERSION || !iv || !tag || !body) {
    throw new SecretBoxError("secret_unreadable", "El secreto guardado no tiene un formato válido.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", loadKey(env), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof SecretBoxError) throw error;
    // Wrong key or tampered data: never return partial plaintext.
    throw new SecretBoxError("secret_unreadable", "No se pudo descifrar el secreto guardado (clave distinta o dato alterado).");
  }
}
