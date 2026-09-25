import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeMojibakeInSourceText, normalizeMojibakeUtf8 } from "./spec-generation-hybrid";

/**
 * Job 0d61e648-45cd-41b1-8bd3-c93b27a84a34, scenarioStepIndex=4: physical codepoint inspection
 * (not visual reading) proved:
 *   - the execution contract / AI prompt input is correctly encoded (U+00E9 "é", single
 *     codepoint) — verified in an earlier ticket.
 *   - the AI provider's OWN parsed response (response.json's specContent) already contains
 *     "CrÃ©dito" (U+00C3 U+00A9, double-UTF8 mojibake) in the target/locator strings for step 4,
 *     yet ALSO contains an already-correct "crédito" (single U+00E9) elsewhere in the very same
 *     response text (a different, unrelated sentence).
 *   - candidate.spec.ts on disk carries the mojibake through unchanged.
 *
 * The first-loss boundary this codebase can fix is NOT the AI's own generation (out of reach —
 * cannot control what the model emits) but the candidate-normalization step immediately after
 * it: normalizeMojibakeUtf8 requires its ENTIRE input to decode as one coherent UTF-8 byte
 * stream. Once a file mixes an already-correct multi-byte character with a genuinely corrupted
 * one, that whole-file decode attempt fails (the correct character breaks byte alignment for
 * everything after it), so normalizeMojibakeUtf8(wholeFile) silently no-ops — exactly matching
 * the historical "[spec-candidate] rawChanged=false" log despite provable, real corruption.
 */

const REAL_CANDIDATE_PATH = path.resolve(
  __dirname,
  "../../automations/apps/kiosko/sections/default-section/cases/preview-001-tarjeta/spec-generation/candidate.spec.ts",
);
const REAL_RESPONSE_PATH = path.resolve(
  __dirname,
  "../../automations/apps/kiosko/sections/default-section/cases/preview-001-tarjeta/spec-generation/response.json",
);

test("firstLossBoundaryTraceTest: the AI provider's own parsed response already mixes correct and mojibake-corrupted Unicode for the same word", () => {
  const raw = fs.readFileSync(REAL_RESPONSE_PATH, "utf-8");
  const response = JSON.parse(raw) as { specContent: string };
  const spec = response.specContent;
  assert.equal(spec.includes("CrÃ©dito"), true, "the provider's parsed specCode must already contain the double-mojibake this incident is about");
  assert.equal(spec.includes("crédito") || spec.includes("Crédito"), true, "the SAME response must also contain an already-correct occurrence, proving this is not a uniform decoding bug in our own pipeline");
});

test("providerResultEncodingTest: the current on-disk candidate.spec.ts still carries the unfixed mojibake (pre-fix artifact, proves the bug is real on disk, not just in the response)", () => {
  const raw = fs.readFileSync(REAL_CANDIDATE_PATH, "utf-8");
  assert.equal(raw.includes("CrÃ©"), true);
});

test("BUG REPRO: whole-file normalizeMojibakeUtf8 silently no-ops on the real corrupted candidate (reproduces rawChanged=false)", () => {
  const raw = fs.readFileSync(REAL_CANDIDATE_PATH, "utf-8");
  const normalized = normalizeMojibakeUtf8(raw);
  assert.equal(normalized, raw, "this is the proven, historical bug: whole-string normalization no-ops once the file mixes correct and corrupted Unicode");
  assert.equal(normalized.includes("CrÃ©"), true, "the mojibake survives specifically because the whole-string call did nothing");
});

test("candidatePreparationUnicodeTest / FIX PROOF: normalizeMojibakeInSourceText (the real function now wired into candidate preparation) fully repairs the same real, physical candidate file", () => {
  const raw = fs.readFileSync(REAL_CANDIDATE_PATH, "utf-8");
  const fixed = normalizeMojibakeInSourceText(raw);
  assert.notEqual(fixed, raw, "the real corrupted file must actually change");
  for (const mojibake of ["CrÃ©dito", "ClÃ¡sica", "sesiÃ³n", "lÃ­nea"]) {
    assert.equal(fixed.includes(mojibake), false, `${mojibake} must not survive`);
  }
  for (const correct of ["Crédito", "Clásica", "sesión", "línea"]) {
    assert.equal(fixed.includes(correct), true, `${correct} must be present after repair`);
  }
  assert.equal(fixed.includes("�"), false, "no U+FFFD may ever be introduced");
});

test("step4CandidateLocatorUnicodeTest: the fixed candidate's actual Step 4 locator line reads the correct attribute value, never the mojibake one", () => {
  const raw = fs.readFileSync(REAL_CANDIDATE_PATH, "utf-8");
  const fixed = normalizeMojibakeInSourceText(raw);
  assert.match(fixed, /alt="Tarjeta Crédito Visa Clásica"/);
  assert.doesNotMatch(fixed, /alt="Tarjeta CrÃ©dito Visa ClÃ¡sica"/);
  // No positional selector, no app-specific special-casing introduced by the fix itself.
  for (const forbidden of [".first(", ".last(", ".nth("]) {
    assert.equal(fixed.includes(forbidden), raw.includes(forbidden), "normalization must not add or remove positional selectors");
  }
});

test("alreadyCorrectUnicodeNoChangeTest: a source string that is already fully correct Unicode is byte/codepoint-identical after normalization", () => {
  const source = `test('Tarjeta', async ({ page }) => {\n  await page.locator('div').filter({ has: page.locator('img[alt="Crédito Clásica sesión línea"]') }).click();\n});\n`;
  const result = normalizeMojibakeInSourceText(source);
  assert.equal(result, source);
  assert.equal(result.length, source.length);
  for (let i = 0; i < source.length; i += 1) {
    assert.equal(result.codePointAt(i), source.codePointAt(i), `codepoint mismatch at index ${i}`);
  }
});

test("reversibleMojibakeRepairTest: mixed correct-and-corrupted source is repaired only where corrupted, chosen boundary confirmed", () => {
  const source = `const a = 'crédito ok';\nconst b = 'CrÃ©dito corrupted';\n`;
  const result = normalizeMojibakeInSourceText(source);
  assert.equal(result, `const a = 'crédito ok';\nconst b = 'Crédito corrupted';\n`);
});

test("uFFFDNoGuessTest: a genuinely irrecoverable U+FFFD is never guessed/reconstructed into something else", () => {
  const source = `const a = 'Tarjeta Cr�dito';\n`;
  const result = normalizeMojibakeInSourceText(source);
  assert.equal(result, source, "an unrecoverable value must be left exactly as-is, never silently altered");
  assert.equal(result.includes("�"), true);
});

test("typescriptSyntaxPreservedTest: brackets, quotes, semicolons, indentation and import statements are byte-identical, only word content inside strings can change", () => {
  const source = [
    "import { test, expect } from '@playwright/test';",
    "test('Tarjeta CrÃ©dito', async ({ page }) => {",
    "  await page.locator('div[data-x=\"1\"]').click();",
    "});",
    "",
  ].join("\n");
  const result = normalizeMojibakeInSourceText(source);
  const stripWords = (s: string) => s.replace(/[A-Za-z-ɏ]+/g, "");
  assert.equal(stripWords(result), stripWords(source), "non-letter structure (brackets, quotes, punctuation, whitespace) must be identical");
  assert.match(result, /^import \{ test, expect \} from '@playwright\/test';$/m);
  assert.match(result, /data-x="1"/);
});

test("semantic comparison still passes after the fix (normalizeText already tolerated the mojibake for comparison purposes; the fix additionally makes the disk content itself correct)", () => {
  const correct = "Tarjeta Crédito Visa Clásica";
  const raw = fs.readFileSync(REAL_CANDIDATE_PATH, "utf-8");
  const fixed = normalizeMojibakeInSourceText(raw);
  assert.equal(fixed.includes(correct), true);
});
