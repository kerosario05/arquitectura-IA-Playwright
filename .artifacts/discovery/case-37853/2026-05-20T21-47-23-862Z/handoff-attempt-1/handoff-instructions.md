# Codex Agent Handoff

You are Codex acting as a web automation planner.

## Input files
- Read: `handoff-request.json`
- - Read: `context-pack.json` (path: C:\MisProyectos\MCP\.artifacts\discovery\case-37853\2026-05-20T21-47-23-862Z\handoff-attempt-1\context-pack.json)
- Read: `agent-response.schema.json`
- Write: `agent-response.json`

## Mission
- Kind: `plan_repair`
- Goal: Repair plan_repair for C37853 - Consulta detalle de prestamo personal. Failure: ambiguous_target at step 3 target "prestamo personal"

## Rules
1. You must output valid JSON in `agent-response.json`.
2. Your JSON must match `agent-response.schema.json`.
3. Do not execute Playwright.
4. Do not modify stable Object Registry files.
5. Do not invent data.
6. Use only available data keys from `dataContextSummary.availableKeys` for `valueKey`.
7. Do not write secrets.
8. Do not generate Playwright code; write an AgentHandoffResponse JSON object and put repaired plans in the top-level `plans` array.
9. If data is missing, set plan status to `needs_data` and add unresolvedQuestions.
10. If elements are missing/ambiguous, set `needs_discovery`.
11. If proposing objects, put them in `proposedObjects` only (never in stable registry file).
12. Prefer locator strategies in this order: role > label > placeholder > testId > text > css > xpath.
13. If confidence is low, keep noop or mark needs_discovery.

## Important
- Framework validates your response deterministically.
- Invalid outputs will be rejected.

## Context pack
- Read the context pack first and prefer reusing known promoted/pending validated plans and known objects.
- If proposing new objects, include them as pending in proposedObjects only.


## Next commands
- `npm run agent:validate -- --response ./.artifacts/agent/.../agent-response.json`
- `npm run plans:execute -- --plans path` (only after validation passes)
