# Batch Discovery Summary

- **Batch ID:** 2026-05-21T14-51-24-470Z
- **Timestamp:** 2026-05-21T14:54:24.490Z

## Arguments

- Mode: `by-ids`
- Headed: true
- Auto-promote: true
- Dry-run: false
- Include active: true
- Stop on fail: false
- Concurrency: 1

## Summary

| Metric | Value |
|--------|-------|
| Selected | 1 |
| Executed | 1 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 1 |
| Promoted | 0 |
| Already active (skipped) | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 180014ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37848 | Enviar solicitud digital de tarjeta por correo | failed | no | 180014ms | Codex CLI timed out after 2.0 minutes (timeoutMs: 120000).
Cwd: C:\MisProyectos\MCP
Handoff directory: C:\MisProyectos\MCP\.artifacts\discovery\batch\2026-05-21T14-51-24-470Z\cases\case-37848\segment-1
Expected response path: C:\MisProyectos\MCP\.artifacts\discovery\batch\2026-05-21T14-51-24-470Z\cases\case-37848\segment-1\agent-response.json
Stdout log: C:\MisProyectos\MCP\.artifacts\discovery\batch\2026-05-21T14-51-24-470Z\cases\case-37848\segment-1\codex.stdout.log
Stderr log: C:\MisProyectos\MCP\.artifacts\discovery\batch\2026-05-21T14-51-24-470Z\cases\case-37848\segment-1\codex.stderr.log

Suggestions:
  - Increase AGENT_AUTO_REPAIR_TIMEOUT_MS / CODEX_AUTO_REPAIR_TIMEOUT_MS (current: 120000ms, recommended: 1800000ms / 30 min)
  - Run manually:
    C:\Users\radames\AppData\Roaming\npm\codex.cmd exec --skip-git-repo-check --sandbox workspace-write "You are repairing a...
  - Check handoff files in: C:\MisProyectos\MCP\.artifacts\discovery\batch\2026-05-21T14-51-24-470Z\cases\case-37848\segment-1
  - After manual repair, run: npm run agent:validate |
