import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Structural guard: GET /api/runs/ must keep calling jobStore.list() with no arguments, so it
 * inherits the new default (public/top-level jobs only, internal children excluded). Mounting
 * the full Express app + a real internal child job for this single assertion would be
 * disproportionate — the actual filtering behavior itself is covered exhaustively by
 * job-store.internal-child.test.ts. This only pins that the route never opts into
 * includeInternal.
 */

const source = fs.readFileSync(path.join(__dirname, "runs.ts"), "utf-8");

test("GET /api/runs/ calls jobStore.list() with no arguments (never includeInternal) so internal child jobs stay hidden", () => {
  const match = source.match(/runsRouter\.get\("\/",\s*\(_req,\s*res\)\s*=>\s*\{\s*res\.json\(\{\s*jobs:\s*jobStore\.list\(([^)]*)\)\s*\}\);/);
  assert.ok(match, "GET /api/runs/ handler not found in the expected shape");
  assert.equal(match![1].trim(), "", "the public run list must call jobStore.list() with no arguments — passing includeInternal here would leak internal child jobs");
});
