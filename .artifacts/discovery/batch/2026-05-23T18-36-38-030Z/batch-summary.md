# Batch Discovery Summary

- **Batch ID:** 2026-05-23T18-36-38-030Z
- **Timestamp:** 2026-05-23T18:41:46.331Z

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
| Selected | 5 |
| Executed | 5 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 4 |
| Promoted | 1 |
| Already active (skipped) | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 308299ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37923 | Validar agregar producto al carrito desde detalle | promoted | yes | 116561ms | - |
| C37927 | Validar inicio de sesión con credenciales válidas | failed | no | 25719ms | click_no_transition |
| C37929 | Validar formulario de orden desde el carrito | failed | no | 60817ms | click_no_transition |
| C37931 | Validar compra exitosa desde el carrito | failed | no | 60955ms | click_no_transition |
| C37932 | Validar cierre de confirmación de compra | failed | no | 44245ms | assertion_not_found |
