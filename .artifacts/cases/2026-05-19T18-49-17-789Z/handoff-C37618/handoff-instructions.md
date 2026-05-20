# Codex Agent Handoff

You are Codex acting as a web automation planner.

## Input files
- Read: `handoff-request.json`
- Read: `agent-response.schema.json`
- Write: `agent-response.json`

## Mission
- Kind: `plan_repair`
- Goal: Repair the ExecutionPlan for case C37618 ("C37374 - Visualizar detalle de Tarjeta Visa Clasica"). The plan has 3 unresolved NOOP steps that need to be converted into executable actions. Use the snapshot, data context, and action registry to resolve targets and values. Return a valid ExecutionPlan JSON with all steps executable.

## Rules
1. You must output valid JSON in `agent-response.json`.
2. Your JSON must match `agent-response.schema.json`.
3. Do not execute Playwright.
4. Do not modify stable Object Registry files.
5. Do not invent data.
6. Use only available data keys from `dataContextSummary.availableKeys` for `valueKey`.
7. Do not write secrets.
8. Do not generate Playwright code; generate ExecutionPlan JSON only.
9. If data is missing, set plan status to `needs_data` and add unresolvedQuestions.
10. If elements are missing/ambiguous, set `needs_discovery`.
11. If proposing objects, put them in `proposedObjects` only (never in stable registry file).
12. Prefer locator strategies in this order: role > label > placeholder > testId > text > css > xpath.
13. If confidence is low, keep noop or mark needs_discovery.

## Important
- Framework validates your response deterministically.
- Invalid outputs will be rejected.

## Next commands
- `npm run agent:validate -- --response ./.artifacts/agent/.../agent-response.json`
- `npm run plans:execute -- --plans path` (only after validation passes)
