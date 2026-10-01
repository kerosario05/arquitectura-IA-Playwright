#!/usr/bin/env tsx
/**
 * QA Lab Codex Orchestrator entrypoint.
 *
 * Usage:
 *   LIVE:     npx tsx scripts/qa-lab-orchestrator.ts --task <path-to-task.json> [--max-iterations N]
 *   DIAGNOSE: npx tsx scripts/qa-lab-orchestrator.ts --task <task.json> --no-codex-orchestrator
 *   DRY_RUN:  npx tsx scripts/qa-lab-orchestrator.ts --task <task.json> --dry-run [--fixture <evidence.json>]
 *
 * LIVE (no --dry-run) has the Codex Orchestrator agent ON by default -- it is the reasoning
 * authority between Claude Builder and Codex Physical. `--no-codex-orchestrator` is the only
 * opt-out (diagnostic use only: pure deterministic decide(), no agent reasoning). If the agent
 * cannot start, LIVE FAILS CLOSED to EXTERNAL_BLOCKER -- it never silently degrades to the
 * deterministic path and invokes an actor anyway.
 *
 * DRY_RUN never invokes Claude Builder, Codex Physical, or the Codex Orchestrator agent: it
 * decides from the task's own declared currentFrontier plus an optional
 * --fixture <path-to-evidence.json> (a canned ClaudeResult or CodexPhysicalResult), writes the
 * generated prompt to disk, prints the decision, and exits. No source mutation, no process spawned.
 */
import fs from "node:fs";
import path from "node:path";
import { loadState, runOneIteration, saveState, seedFreshPhysicalEvidenceFromTask } from "../src/orchestrator/orchestrator-runner";
import type { ClaudeResult, CodexPhysicalResult, TaskContract } from "../src/orchestrator/types";
import { runChat } from "../src/orchestrator/chat-ui";

export function parseArgs(argv: string[]): { taskPath?: string; dryRun: boolean; fixturePath?: string; physicalEvidenceFromTaskId?: string; maxIterations: number; useCodexOrchestratorAgent: boolean; chat: boolean } {
  let taskPath: string | undefined;
  let dryRun = false;
  let fixturePath: string | undefined;
  let physicalEvidenceFromTaskId: string | undefined;
  let maxIterations = 25;
  let noAgent = false;
  let chat = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--task") taskPath = argv[++i];
    else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--fixture") fixturePath = argv[++i];
    else if (argv[i] === "--physical-evidence-from") physicalEvidenceFromTaskId = argv[++i];
    else if (argv[i] === "--max-iterations") maxIterations = Number.parseInt(argv[++i], 10) || 25;
    else if (argv[i] === "--no-codex-orchestrator") noAgent = true;
    else if (argv[i] === "--chat") chat = true;
  }
  // LIVE default: agent ON. DRY_RUN: agent never invoked regardless (fixture path only).
  return { taskPath, dryRun, fixturePath, physicalEvidenceFromTaskId, maxIterations, useCodexOrchestratorAgent: !noAgent, chat };
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const { taskPath, dryRun, fixturePath, physicalEvidenceFromTaskId, maxIterations, useCodexOrchestratorAgent, chat } = parseArgs(process.argv.slice(2));
  if (chat) return runChat(repoRoot);
  if (!taskPath) {
    console.error("Usage: qa-lab-orchestrator --task <path-to-task.json> [--dry-run] [--fixture <path>] [--max-iterations N]");
    process.exit(2);
  }
  const task = JSON.parse(fs.readFileSync(taskPath, "utf8")) as TaskContract;
  let state = loadState(repoRoot, task);
  if (physicalEvidenceFromTaskId) {
    state = seedFreshPhysicalEvidenceFromTask(repoRoot, state, physicalEvidenceFromTaskId);
    saveState(repoRoot, state);
    const seeded = state.iterations[0].codexPhysicalResult!;
    console.log(`[orchestrator] seeded fresh physical evidence sourceTask=${physicalEvidenceFromTaskId} freshRunId=${seeded.freshRunId}`);
  }
  const dryRunEvidence: ClaudeResult | CodexPhysicalResult | undefined = fixturePath
    ? JSON.parse(fs.readFileSync(fixturePath, "utf8"))
    : undefined;
  // DRY_RUN + --fixture demonstrates the Orchestrator reacting to an ALREADY-RECORDED piece of
  // evidence (e.g. "here is what the last real Codex Physical run reported") -- seed it as
  // iteration 0's evidence so decide() sees it as the latest result, without spawning anything.
  if (dryRun && dryRunEvidence && state.iterations.length === 0) {
    state = {
      ...state,
      iterations: [{
        iteration: 0,
        at: new Date().toISOString(),
        evidenceKind: dryRunEvidence.actor === "CLAUDE" ? "CLAUDE_RESULT" : "CODEX_PHYSICAL_RESULT",
        claudeResult: dryRunEvidence.actor === "CLAUDE" ? dryRunEvidence : undefined,
        codexPhysicalResult: dryRunEvidence.actor === "CODEX_PHYSICAL" ? dryRunEvidence : undefined,
        decision: { actor: "ORCHESTRATOR", taskId: task.taskId, iteration: 0, decision: "CALL_CODEX_PHYSICAL", physicalGreensPreserved: state.physicalGreens, successCriteriaSatisfied: [], successCriteriaOpen: task.successCriteria },
      }],
    };
  }

  let iterations = 0;
  while (state.status === "RUNNING" && iterations < maxIterations) {
    state = await runOneIteration(repoRoot, state, { dryRun, dryRunEvidence, useCodexOrchestratorAgent });
    iterations++;
    const last = state.iterations[state.iterations.length - 1];
    console.log(`[orchestrator] iteration=${last.iteration} decision=${last.decision.decision} nextActor=${last.decision.nextActor ?? "(none)"} status=${state.status}`);
    if (dryRun) break; // dry-run demonstrates exactly one decision, never loops.
  }

  saveState(repoRoot, state);
  console.log(`[orchestrator] FINAL status=${state.status} taskId=${task.taskId}`);
  if (state.status === "SUCCESS") process.exit(0);
  if (state.status === "HUMAN_GATE" || state.status === "EXTERNAL_BLOCKER") process.exit(1);
}

// Only run when executed directly (`tsx scripts/qa-lab-orchestrator.ts ...`), never as a side
// effect of importing `parseArgs` for tests.
if (require.main === module) {
  main().catch((err) => {
    console.error("[orchestrator] fatal:", err);
    process.exit(1);
  });
}
