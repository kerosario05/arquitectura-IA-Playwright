# Batch Discovery Summary

- **Batch ID:** 2026-05-24T16-44-00-542Z
- **Timestamp:** 2026-05-24T16:49:27.451Z

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
| Selected | 4 |
| Executed | 4 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 1 |
| Promoted | 1 |
| Already active (skipped) | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 326907ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37923 | Validar agregar producto al carrito desde detalle | promoted | yes | 118152ms | - |
| C37929 | Validar formulario de orden desde el carrito | discovered_partial | no | 61492ms | - |
| C37931 | Validar compra exitosa desde el carrito | discovered_partial | no | 100937ms | - |
| C37932 | Validar cierre de confirmación de compra | failed | no | 46325ms | assertion_not_found |
