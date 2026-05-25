# Batch Discovery Summary

- **Batch ID:** 2026-05-24T19-46-31-868Z
- **Timestamp:** 2026-05-24T20:03:39.149Z

## Arguments

- Mode: `by-ids`
- Headed: true
- Auto-promote: true
- Dry-run: false
- Include active: true
- Rerun active: true
- Stop on fail: false
- Concurrency: 1
- Parallel: false

## Summary

| Metric | Value |
|--------|-------|
| Selected | 8 |
| Requested | 8 |
| Executed | 8 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 4 |
| Promoted | 1 |
| Already active (skipped) | 0 |
| Active rerun | 8 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 1027280ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37941 | Visualizar catálogo principal de productos disponibles | discovered_partial | no | 7694ms | pending_local_assertions |
| C37942 | Filtrar productos por la categoría Phones | discovered_partial | no | 43016ms | pending_local_assertions |
| C37943 | Visualizar detalle de producto desde listado filtrado | discovered_partial | no | 80374ms | pending_local_assertions |
| C37944 | Agregar producto al carrito desde el detalle del producto | promoted | yes | 116832ms | - |
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | failed | no | 152688ms | codex_cli_path_invalid |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | failed | no | 170116ms | codex_cli_path_invalid |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | failed | no | 210518ms | codex_cli_path_invalid |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | failed | no | 246040ms | codex_cli_path_invalid |
