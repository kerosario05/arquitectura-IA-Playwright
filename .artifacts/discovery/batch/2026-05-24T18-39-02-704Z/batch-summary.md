# Batch Discovery Summary

- **Batch ID:** 2026-05-24T18-39-02-704Z
- **Timestamp:** 2026-05-24T18:56:08.748Z

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
| Failed | 6 |
| Promoted | 2 |
| Already active (skipped) | 0 |
| Active rerun | 8 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 1026043ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37941 | Visualizar catálogo principal de productos disponibles | promoted | yes | 7710ms | - |
| C37942 | Filtrar productos por la categoría Phones | failed | no | 43012ms | codex_cli_path_invalid |
| C37943 | Visualizar detalle de producto desde listado filtrado | failed | no | 80322ms | codex_cli_path_invalid |
| C37944 | Agregar producto al carrito desde el detalle del producto | promoted | yes | 116672ms | - |
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | failed | no | 152925ms | codex_cli_path_invalid |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | failed | no | 170295ms | codex_cli_path_invalid |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | failed | no | 209496ms | codex_cli_path_invalid |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | failed | no | 245609ms | codex_cli_path_invalid |
