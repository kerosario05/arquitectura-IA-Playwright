# Batch Discovery Summary

- **Batch ID:** 2026-05-21T15-12-50-356Z
- **Timestamp:** 2026-05-21T15:13:06.997Z

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
| Total duration | 16639ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37844 | Visualizar detalle de Tarjeta Visa Gold | failed | no | 16637ms | Automation 'c37844-visualizar-detalle-de-tarjeta-visa-gold' already exists at 'automations\apps\default\cases\c37844-visualizar-detalle-de-tarjeta-visa-gold\plan.json'. Use --overwrite to replace. |
