import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decryptSecret, encryptSecret, SecretBoxError } from "./secret-box";

const withKeyFile = (run: (env: NodeJS.ProcessEnv, file: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-secretbox-"));
  const file = path.join(dir, "secret.key");
  try { run({ QA_LAB_SECRET_KEY_FILE: file }, file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test("round trip with a generated key file; the key file is created once and reused", () => {
  withKeyFile((env, file) => {
    const first = encryptSecret("p@ss wörd", env);
    assert.equal(fs.existsSync(file), true);
    const keyBefore = fs.readFileSync(file, "utf8");
    assert.equal(decryptSecret(first, env), "p@ss wörd");
    assert.equal(decryptSecret(encryptSecret("otra", env), env), "otra");
    assert.equal(fs.readFileSync(file, "utf8"), keyBefore);
  });
});

test("the stored form never contains the plain text and differs every time (random IV)", () => {
  withKeyFile((env) => {
    const a = encryptSecret("super-secret", env);
    const b = encryptSecret("super-secret", env);
    assert.notEqual(a, b);
    assert.equal(a.includes("super-secret"), false);
    assert.match(a, /^v1:/);
  });
});

test("a passphrase from QA_LAB_SECRETS_KEY works without any key file", () => {
  const env = { QA_LAB_SECRETS_KEY: "una frase larga de prueba" } as NodeJS.ProcessEnv;
  assert.equal(decryptSecret(encryptSecret("clave", env), env), "clave");
});

test("another key, a tampered value or a bad format fails closed without returning text", () => {
  withKeyFile((env) => {
    const stored = encryptSecret("clave", env);
    const otherKey = { QA_LAB_SECRETS_KEY: "otra frase distinta" } as NodeJS.ProcessEnv;
    assert.throws(() => decryptSecret(stored, otherKey), (error: unknown) => error instanceof SecretBoxError && error.code === "secret_unreadable");
    const parts = stored.split(":");
    parts[3] = Buffer.from("alterado").toString("base64");
    assert.throws(() => decryptSecret(parts.join(":"), env), (error: unknown) => error instanceof SecretBoxError);
    for (const bad of ["", "v1:solo", "v2:a:b:c", "texto plano"]) {
      assert.throws(() => decryptSecret(bad, env), (error: unknown) => error instanceof SecretBoxError && error.code === "secret_unreadable");
    }
  });
});
