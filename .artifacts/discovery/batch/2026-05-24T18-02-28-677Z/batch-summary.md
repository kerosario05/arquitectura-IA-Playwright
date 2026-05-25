# Batch Discovery Summary

- **Batch ID:** 2026-05-24T18-02-28-677Z
- **Timestamp:** 2026-05-24T18:16:10.633Z

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
| Skipped | 3 |
| Passed | 0 |
| Failed | 5 |
| Promoted | 0 |
| Already active (skipped) | 3 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 821955ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Failure Reason |
|---------|-------|--------|----------|----------|----------------|
| C37941 | Visualizar catálogo principal de productos disponibles | skipped_active | no | - | - |
| C37942 | Filtrar productos por la categoría Phones | failed | no | 43871ms | codex_cli_path_invalid |
| C37943 | Visualizar detalle de producto desde listado filtrado | skipped_active | no | - | - |
| C37944 | Agregar producto al carrito desde el detalle del producto | skipped_active | no | - | - |
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | failed | no | 152825ms | codex_cli_path_invalid |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | failed | no | 170146ms | codex_cli_path_invalid |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | failed | no | 209417ms | codex_cli_path_invalid |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | failed | no | 245696ms | codex_cli_path_invalid |
