import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing built on Node's built-in scrypt — no native dependency to
 * install, which keeps the runtime footprint of this repo unchanged.
 *
 * Stored format: `scrypt$N$r$p$<saltBase64>$<hashBase64>`
 * The parameters travel with the hash so raising the cost later stays backward
 * compatible: old hashes keep verifying with the parameters they were made with.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCHEME = "scrypt";
const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** 128 * N * r is scrypt's working set (16 MiB at the defaults); leave headroom. */
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: DEFAULT_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
    maxmem: MAX_MEM,
  });
  return [
    SCHEME,
    DEFAULT_N,
    DEFAULT_R,
    DEFAULT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false (never throws) for malformed stored
 * values so a corrupted row cannot turn into a 500 on the login path.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; hash: Buffer };

function parseStoredHash(stored: string): ParsedHash | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const [scheme, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (scheme !== SCHEME) return null;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 2 || r < 1 || p < 1) return null;
  try {
    const salt = Buffer.from(rawSalt, "base64");
    const hash = Buffer.from(rawHash, "base64");
    if (salt.length === 0 || hash.length === 0) return null;
    return { N, r, p, salt, hash };
  } catch {
    return null;
  }
}

/** True when a stored hash was produced with weaker parameters than today's defaults. */
export function needsRehash(stored: string): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) return true;
  return parsed.N < DEFAULT_N || parsed.r < DEFAULT_R || parsed.p < DEFAULT_P;
}

export type PasswordPolicyContext = {
  username?: string;
  currentHash?: string;
};

/**
 * Returns the list of unmet policy rules — empty means the password is accepted.
 * Messages are in Spanish because they surface directly in the UI.
 */
export function checkPasswordPolicy(password: unknown, context: PasswordPolicyContext = {}): string[] {
  const errors: string[] = [];
  if (typeof password !== "string" || password.length === 0) {
    return ["La contraseña es obligatoria"];
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres`);
  }
  if (password.trim().length !== password.length) {
    errors.push("La contraseña no puede empezar ni terminar con espacios");
  }
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(password)) {
    errors.push("La contraseña debe incluir al menos una letra");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("La contraseña debe incluir al menos un número");
  }
  const username = context.username?.trim().toLowerCase();
  if (username && username.length >= 3 && password.toLowerCase().includes(username)) {
    errors.push("La contraseña no puede contener el nombre de usuario");
  }
  return errors;
}

export class PasswordPolicyError extends Error {
  readonly code = "password_policy_violation";
  constructor(readonly violations: string[]) {
    super(violations.join("; "));
    this.name = "PasswordPolicyError";
  }
}

export function assertPasswordPolicy(password: unknown, context: PasswordPolicyContext = {}): string {
  const violations = checkPasswordPolicy(password, context);
  if (violations.length > 0) throw new PasswordPolicyError(violations);
  return password as string;
}

const TEMP_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Temporary password handed to a user on creation or admin reset. Always paired
 * with `mustChangePassword = 1`, so it only ever survives until the first login.
 * Rejection sampling keeps the distribution uniform over the alphabet.
 */
export function generateTemporaryPassword(length = 14): string {
  const size = TEMP_ALPHABET.length;
  const limit = 256 - (256 % size);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      out += TEMP_ALPHABET[byte % size];
      if (out.length === length) break;
    }
  }
  // Guarantee the generated value satisfies the policy it will be checked against.
  if (!/[0-9]/.test(out)) out = `${out.slice(0, -1)}7`;
  if (!/[A-Za-z]/.test(out)) out = `${out.slice(0, -1)}q`;
  return out;
}
