import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

/**
 * Proves the REAL QA Lab production caller (case-discovery-workflow.ts) now
 * activates the deterministic spec compiler at its promoteExecutionPlan(...)
 * call site -- not merely that promoteExecutionPlan honors the flag when
 * given it directly (already proven by promote-plan.deterministic-compiler-*
 * tests, not re-tested here).
 *
 * Instantiating the full workflow would require live TestRail fetch + real
 * browser discovery (explicitly out of scope: "NO browser. NO QA Lab. NO
 * TestRail."), and there is no existing dependency-injection seam around the
 * `promoteExecutionPlan` import to substitute a spy without altering
 * production wiring, which this ticket forbids. The established minimal seam
 * in this codebase for exactly this situation is a source-text boundary
 * proof (see e.g. spec-generation-hybrid.candidate-collection-parity.test.ts,
 * persisted-spec-revalidation.test.ts) -- reading the real, unmodified file
 * and asserting the literal call-site shape, which is precisely the artifact
 * this ticket changed.
 */

const WORKFLOW_PATH = path.resolve(__dirname, "case-discovery-workflow.ts");

function extractPromoteCallBlock(source: string): string {
  const start = source.indexOf("await promoteExecutionPlan(");
  assert.ok(start !== -1, "case-discovery-workflow.ts must still call promoteExecutionPlan(...)");
  // Bounded scan to the matching closing paren of the call, tracking paren depth.
  let depth = 0;
  let i = start + "await promoteExecutionPlan(".length - 1;
  const openIndex = i;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, "unbalanced parens while scanning promoteExecutionPlan(...) call site");
  return source.slice(openIndex, i + 1);
}

test("A/real QA Lab workflow caller: useDeterministicSpecCompiler=true is present, literal, and unconditional at the promoteExecutionPlan(...) call site", async () => {
  const source = await fs.readFile(WORKFLOW_PATH, "utf8");
  const callBlock = extractPromoteCallBlock(source);

  assert.match(
    callBlock,
    /useDeterministicSpecCompiler:\s*true\s*,/,
    "useDeterministicSpecCompiler: true must be present as a literal in the promoteExecutionPlan input object",
  );
});

test("B/the value is a bare literal, not derived from appSlug/case/text/URL or any conditional expression", async () => {
  const source = await fs.readFile(WORKFLOW_PATH, "utf8");
  const callBlock = extractPromoteCallBlock(source);

  const match = callBlock.match(/useDeterministicSpecCompiler:\s*([^,\n}]+)/);
  assert.ok(match, "useDeterministicSpecCompiler must appear in the call site");
  const rawValue = match[1].trim();
  assert.equal(rawValue, "true", "value must be the bare literal `true`, not a ternary/condition/derived expression");
});
