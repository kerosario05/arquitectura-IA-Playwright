# Batch Discovery Summary

- **Batch ID:** 2026-05-27T00-44-02-561Z
- **Timestamp:** 2026-05-27T00:48:54.331Z

## Arguments

- Mode: `by-ids`
- Headed: false
- Auto-promote: true
- Dry-run: false
- Include active: false
- Rerun active: false
- Stop on fail: false
- Concurrency: 1
- Parallel: false

## Summary

| Metric | Value |
|--------|-------|
| Selected | 9 |
| Requested | 13 |
| Executed | 9 |
| Skipped | 4 |
| Passed | 0 |
| Failed | 6 |
| Promoted | 3 |
| Already active (skipped) | 4 |
| Active rerun | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 291764ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38065 | Visualizar categorías principales de Información de productos | skipped_active | skipped_active | - | no | - | - | - | 0 | no | - | - |
| C38066 | Visualizar detalle de un producto de Tarjetas | skipped_active | skipped_active | - | no | - | - | - | 0 | no | - | - |
| C38067 | Visualizar detalle de un producto de Depósitos a Plazo | exploration_failed | exploration_failed | blocking_failures_remain | no | 21655ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38068 | Visualizar subcategorías de Cuentas de Efectivo | skipped_active | skipped_active | - | no | - | - | - | 0 | no | - | - |
| C38069 | Visualizar detalle de un producto de Cuentas de Efectivo en Pesos | exploration_failed | exploration_failed | blocking_failures_remain | no | 62934ms | target_not_found | - | 0 | no | - | - |
| C38070 | Visualizar detalle de un producto de Cuentas de Efectivo en Dólares | exploration_failed | exploration_failed | blocking_failures_remain | no | 36333ms | target_not_found | - | 0 | no | - | - |
| C38071 | Visualizar detalle de un producto de Cuentas de Efectivo en Euros | exploration_failed | exploration_failed | blocking_failures_remain | no | 42773ms | target_not_found | - | 0 | no | - | - |
| C38072 | Visualizar subcategoría de Préstamos | skipped_active | skipped_active | - | no | - | - | - | 0 | no | - | - |
| C38073 | Visualizar detalle de un producto de Préstamos personales | exploration_failed | exploration_failed | blocking_failures_remain | no | 22975ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38074 | Validar secciones visibles del contenido oficial del producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 12076ms | - | - | 0 | no | - | - |
| C38075 | Regresar al listado desde el detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 41340ms | - | context_not_reached | 0 | no | none | - |
| C38076 | Visualizar acción Solicitar en el detalle del producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 22607ms | - | - | 0 | no | - | - |
| C38077 | Finalizar sesión desde el detalle del producto | exploration_failed | exploration_failed | blocking_failures_remain | no | 29063ms | target_not_found | - | 0 | no | - | - |

## Failure Forensics
