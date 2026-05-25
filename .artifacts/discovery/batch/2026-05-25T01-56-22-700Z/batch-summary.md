# Batch Discovery Summary

- **Batch ID:** 2026-05-25T01-56-22-700Z
- **Timestamp:** 2026-05-25T02:13:28.951Z

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
| Failed | 0 |
| Promoted | 8 |
| Already active (skipped) | 0 |
| Active rerun | 8 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 1026250ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37941 | Visualizar catálogo principal de productos disponibles | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 7701ms | - | context_not_reached | 0 | no | none | - |
| C37942 | Filtrar productos por la categoría Phones | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 42946ms | - | context_not_reached | 0 | no | none | - |
| C37943 | Visualizar detalle de producto desde listado filtrado | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 80404ms | - | context_not_reached | 0 | no | none | - |
| C37944 | Agregar producto al carrito desde el detalle del producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 116844ms | - | - | 0 | no | - | - |
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 153041ms | - | context_not_reached | 0 | no | none | - |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 170023ms | - | assertion_consumption_gap | 0 | no | none | - |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 209431ms | - | assertion_consumption_gap | 0 | no | none | - |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 245859ms | - | assertion_consumption_gap | 0 | no | none | - |

## Failure Forensics
