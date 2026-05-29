# Batch Discovery Summary

- **Batch ID:** 2026-05-26T21-04-20-232Z
- **Timestamp:** 2026-05-26T21:08:53.574Z

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
| Selected | 12 |
| Requested | 13 |
| Executed | 12 |
| Skipped | 1 |
| Passed | 0 |
| Failed | 10 |
| Promoted | 2 |
| Already active (skipped) | 1 |
| Active rerun | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 273337ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38065 | Visualizar categorías principales de Información de productos | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 21707ms | - | - | 0 | no | - | - |
| C38066 | Visualizar detalle de un producto de Tarjetas | exploration_failed | exploration_failed | blocking_failures_remain | no | 12962ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38067 | Visualizar detalle de un producto de Depósitos a Plazo | exploration_failed | exploration_failed | blocking_failures_remain | no | 22745ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38068 | Visualizar subcategorías de Cuentas de Efectivo | skipped_active | skipped_active | - | no | - | - | - | 0 | no | - | - |
| C38069 | Visualizar detalle de un producto de Cuentas de Efectivo en Pesos | exploration_failed | exploration_failed | blocking_failures_remain | no | 32089ms | target_not_found | - | 0 | no | - | - |
| C38070 | Visualizar detalle de un producto de Cuentas de Efectivo en Dólares | exploration_failed | exploration_failed | blocking_failures_remain | no | 39057ms | target_not_found | - | 0 | no | - | - |
| C38071 | Visualizar detalle de un producto de Cuentas de Efectivo en Euros | exploration_failed | exploration_failed | blocking_failures_remain | no | 39559ms | target_not_found | - | 0 | no | - | - |
| C38072 | Visualizar subcategoría de Préstamos | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 21715ms | - | - | 0 | no | - | - |
| C38073 | Visualizar detalle de un producto de Préstamos personales | exploration_failed | exploration_failed | blocking_failures_remain | no | 14418ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38074 | Validar secciones visibles del contenido oficial del producto | exploration_failed | exploration_failed | blocking_failures_remain | no | 22542ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38075 | Regresar al listado desde el detalle de producto | exploration_failed | exploration_failed | blocking_failures_remain | no | 13081ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38076 | Visualizar acción Solicitar en el detalle del producto | exploration_failed | exploration_failed | blocking_failures_remain | no | 21583ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |
| C38077 | Finalizar sesión desde el detalle del producto | exploration_failed | exploration_failed | blocking_failures_remain | no | 11867ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado de productos |

## Failure Forensics
