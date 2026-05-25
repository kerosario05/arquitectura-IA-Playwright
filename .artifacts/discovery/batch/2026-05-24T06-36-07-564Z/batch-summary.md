# Batch Discovery Summary

- **Batch ID:** 2026-05-24T06-36-07-564Z
- **Timestamp:** 2026-05-24T06:48:16.247Z

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
| Selected | 8 |
| Executed | 8 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 6 |
| Promoted | 2 |
| Already active (skipped) | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 728681ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37919 | Validar visualización del catálogo principal de productos | promoted | yes | 7749ms | - |
| C37920 | Validar filtrado de productos por categoría Phones | failed | no | 43114ms | needs_assertion_resolution |
| C37921 | Validar filtrado de productos por categoría Laptops | failed | no | 43298ms | needs_assertion_resolution |
| C37922 | Validar detalle de producto desde el catálogo | failed | no | 80578ms | needs_assertion_resolution |
| C37923 | Validar agregar producto al carrito desde detalle | promoted | yes | 119537ms | - |
| C37924 | Validar visualización del carrito con producto agregado | failed | no | 46378ms | assertion_not_found |
| C37925 | Validar eliminación de producto del carrito | failed | no | 81408ms | assertion_not_found |
| C37926 | Validar agregar múltiples productos al carrito desde diferentes categorías | failed | no | 306617ms | needs_assertion_resolution |
