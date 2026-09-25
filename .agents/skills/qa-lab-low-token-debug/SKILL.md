---
name: qa-lab-low-token-debug
description: Diagnose or narrowly repair QA Lab/MCP, Recording/Replay, discovery, compiler, Playwright/Appium, promotion, and runtime failures by proving one first-loss boundary and stopping.
---

# QA Lab low-token debug

Use for QA Lab, MCP, Recording/Replay, Capture V2, Route Discovery, `SpecExecutionContract`, deterministic spec compilation, Playwright/Appium, promoted runtime, Auto-POM, TestRail transport, promotion gates, first-loss analysis, runtime logs, or compact prompts for another coding agent.

## Operating rule

Find one evidence-backed **first loss**. Diagnose or change only that boundary, then **STOP**. Do not investigate downstream failures while an earlier boundary is unresolved. Keep an already-GREEN compiler, resolver, Recording, Discovery, runtime, semantic gate, or POM closed unless direct new regression evidence reopens it.

## Select mode

- **DIAGNOSE:** inspect logs/results; isolate first loss; do not change code.
- **MICROFIX:** one small change in the first-loss layer; run focal tests only.
- **REVIEW:** assess another agent's report/diff; distinguish supported, inferred, and physically unknown.
- **PHYSICAL-GATE:** interpret a user-provided QA Lab physical run; mark GREEN only what that run proves.

## Evidence and scope

Authority, highest first: fresh physical QA Lab runtime; direct runtime artifacts; boundary-crossing integration test; focal unit test; static reasoning. Lower evidence cannot contradict higher evidence.

Default budget: one task/first loss, 2–3 searches, about 5–6 files, relevant 80–150-line blocks, decisive log lines only, focal tests before broad suites. Do not explore the repository or run global typecheck/suites without a demonstrated need. Keep the result short.

Preserve CORE multi-project architecture and SQL/QA_LAB as source of truth where applicable. No app/case/URL/business-text/ID/step hardcodes, parallel pipelines/resolvers, invented locators/certification, or conflation of execution readiness with promotion certification. Preserve promoted-spec reuse and keep Record/Discovery runtime separate from promoted-spec runtime.

## Resolution, waits, and runtime ownership

Never use `nth()`, `first()`, `last()`, DOM indices, or coordinates as authority. Prefer certified technical identity, durable structural evidence, shared resolution, and field-scoped resolution when the contract permits.

Never fix synchronization with fixed sleeps; use existing real signals, adaptive waits, completion probes, or network/navigation/loading signals.

Do not run physical QA Lab or production browser/runtime validation. The user performs it. You may diagnose, edit code, run focused/static checks, and state the exact replay signal to verify.

Never run `git reset`, `clean`, `checkout`, `restore`, `stash`, `merge`, `rebase`, `commit`, `push`, or `worktree` unless explicitly requested.

## Required output

Use exactly the relevant mode format:

- **DIAGNOSE:** `PHYSICALLY_PROVEN`, `FIRST_LOSS`, `WHY_NOT_OTHER_HYPOTHESES`, `NEXT_BOUNDARY`, `STOP`.
- **MICROFIX:** `FIRST_LOSS`, `FIX`, `TESTS`, `RESULT`, `readyForPhysicalReplay=true|false`, `pushPerformed=false`, `commitPerformed=false`, `STOP`.
- **REVIEW:** `SUPPORTED`, `INFERRED`, `PHYSICAL_UNKNOWN`, `NEXT_RUN_SIGNAL`, `STOP`.
- **PHYSICAL-GATE:** `GREEN`, `OPEN`, `UNKNOWN`, `NEXT_BOUNDARY`, `STOP`.

For the next-agent ticket, read [prompt templates](references/prompt-templates.md). Keep model/effort/cost outside the prompt when useful.
