# Batch Discovery Summary

- **Batch ID:** 2026-05-24T17-37-46-737Z
- **Timestamp:** 2026-05-24T17:54:54.799Z

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
| Failed | 5 |
| Promoted | 3 |
| Already active (skipped) | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 1028061ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37941 | Visualizar catálogo principal de productos disponibles | promoted | yes | 7818ms | - |
| C37942 | Filtrar productos por la categoría Phones | failed | no | 42994ms | codex_cli_path_invalid |
| C37943 | Visualizar detalle de producto desde listado filtrado | promoted | yes | 79244ms | - |
| C37944 | Agregar producto al carrito desde el detalle del producto | promoted | yes | 116736ms | - |
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | failed | no | 152723ms | codex_cli_path_invalid |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | failed | no | 170229ms | codex_cli_path_invalid |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | failed | no | 209464ms | codex_cli_path_invalid |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | failed | no | 248852ms | codex_cli_path_invalid |
