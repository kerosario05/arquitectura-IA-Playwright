import assert from "node:assert";
import {
  assertPasswordPolicy,
  checkPasswordPolicy,
  generateTemporaryPassword,
  hashPassword,
  needsRehash,
  PasswordPolicyError,
  verifyPassword,
} from "./password";

const failures: string[] = [];

async function test(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log("\nhashPassword / verifyPassword");

  await test("accepts the correct password", async () => {
    const stored = await hashPassword("Correcto123");
    assert.strictEqual(await verifyPassword("Correcto123", stored), true);
  });

  await test("rejects a wrong password", async () => {
    const stored = await hashPassword("Correcto123");
    assert.strictEqual(await verifyPassword("Incorrecto123", stored), false);
  });

  await test("uses a distinct salt per hash", async () => {
    const a = await hashPassword("MismaClave123");
    const b = await hashPassword("MismaClave123");
    assert.notStrictEqual(a, b, "two hashes of the same password must differ");
    assert.strictEqual(await verifyPassword("MismaClave123", a), true);
    assert.strictEqual(await verifyPassword("MismaClave123", b), true);
  });

  await test("stores the scrypt parameters in the encoded value", async () => {
    const stored = await hashPassword("Parametros123");
    const parts = stored.split("$");
    assert.strictEqual(parts.length, 6);
    assert.strictEqual(parts[0], "scrypt");
    assert.strictEqual(Number(parts[1]), 16384);
    assert.strictEqual(Number(parts[2]), 8);
    assert.strictEqual(Number(parts[3]), 1);
  });

  await test("normalizes unicode before hashing", async () => {
    // "á" composed (U+00E1) vs decomposed (U+0061 U+0301) must be the same secret.
    const stored = await hashPassword("contraseña1234");
    assert.strictEqual(await verifyPassword("contraseña1234", stored), true);
  });

  await test("returns false for malformed stored values instead of throwing", async () => {
    for (const bad of ["", "not-a-hash", "scrypt$1$2$3", "bcrypt$16384$8$1$aaaa$bbbb", "$$$$$"]) {
      assert.strictEqual(await verifyPassword("cualquiera", bad), false, `bad input: ${bad}`);
    }
  });

  await test("flags weaker-than-current parameters for rehash", async () => {
    const current = await hashPassword("Actual123456");
    assert.strictEqual(needsRehash(current), false);
    assert.strictEqual(needsRehash("scrypt$1024$8$1$c2FsdA==$aGFzaA=="), true);
    assert.strictEqual(needsRehash("basura"), true);
  });

  console.log("\ncheckPasswordPolicy");

  await test("accepts a compliant password", () => {
    assert.deepStrictEqual(checkPasswordPolicy("Segura12345", { username: "kevin" }), []);
  });

  await test("rejects passwords below the minimum length", () => {
    const errors = checkPasswordPolicy("Corta1");
    assert.ok(errors.some((e) => e.includes("10 caracteres")), errors.join("; "));
  });

  await test("requires a letter and a digit", () => {
    assert.ok(checkPasswordPolicy("1234567890").some((e) => e.includes("letra")));
    assert.ok(checkPasswordPolicy("solamenteletras").some((e) => e.includes("número")));
  });

  await test("rejects a password containing the username", () => {
    const errors = checkPasswordPolicy("kevin1234567", { username: "Kevin" });
    assert.ok(errors.some((e) => e.includes("nombre de usuario")), errors.join("; "));
  });

  await test("ignores usernames shorter than three characters", () => {
    assert.deepStrictEqual(checkPasswordPolicy("ab1234567890", { username: "ab" }), []);
  });

  await test("rejects surrounding whitespace", () => {
    assert.ok(checkPasswordPolicy(" Segura12345 ").some((e) => e.includes("espacios")));
  });

  await test("treats a missing password as a violation, not a crash", () => {
    assert.deepStrictEqual(checkPasswordPolicy(undefined), ["La contraseña es obligatoria"]);
    assert.deepStrictEqual(checkPasswordPolicy(null), ["La contraseña es obligatoria"]);
  });

  await test("assertPasswordPolicy throws PasswordPolicyError with the violations", () => {
    assert.throws(
      () => assertPasswordPolicy("corta"),
      (err: unknown) => {
        assert.ok(err instanceof PasswordPolicyError);
        assert.strictEqual(err.code, "password_policy_violation");
        assert.ok(err.violations.length > 0);
        return true;
      },
    );
    assert.strictEqual(assertPasswordPolicy("Segura12345"), "Segura12345");
  });

  console.log("\ngenerateTemporaryPassword");

  await test("generates passwords that satisfy the policy", () => {
    for (let i = 0; i < 100; i++) {
      const generated = generateTemporaryPassword();
      assert.strictEqual(generated.length, 14);
      assert.deepStrictEqual(
        checkPasswordPolicy(generated),
        [],
        `generated password violated policy: ${generated}`,
      );
    }
  });

  await test("generates a different password each time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateTemporaryPassword());
    assert.strictEqual(seen.size, 50);
  });

  await test("avoids visually ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      assert.ok(!/[l1IO0]/.test(generateTemporaryPassword()));
    }
  });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All password tests passed.\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
