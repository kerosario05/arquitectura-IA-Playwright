# Batch Discovery Summary

- **Batch ID:** 2026-05-24T03-08-48-293Z
- **Timestamp:** 2026-05-24T03:11:31.547Z

## Arguments

- Mode: `by-ids`
- Headed: true
- Auto-promote: true
- Dry-run: false
- Include active: false
- Stop on fail: false
- Concurrency: 1
- Parallel: false

## Summary

| Metric | Value |
|--------|-------|
| Selected | 2 |
| Executed | 2 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 0 |
| Promoted | 0 |
| Already active (skipped) | 0 |
| Promotion failed | 1 |
| Not promoted | 0 |
| Total duration | 163253ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37927 | Validar inicio de sesión con credenciales válidas | promotion_failed | no | 62399ms | - |
| C37931 | Validar compra exitosa desde el carrito | discovered_partial | no | 100852ms | - |
