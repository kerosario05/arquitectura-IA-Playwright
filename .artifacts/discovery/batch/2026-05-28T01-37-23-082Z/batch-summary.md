# Batch Discovery Summary

- **Batch ID:** 2026-05-28T01-37-23-082Z
- **Timestamp:** 2026-05-28T01:39:59.610Z

## Arguments

- Mode: `by-ids`
- Headed: false
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
| Selected | 7 |
| Requested | 7 |
| Executed | 7 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 0 |
| Promoted | 6 |
| Already active (skipped) | 0 |
| Active rerun | 7 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 156521ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38125 | Validar categorías principales visibles en Información de productos | discovered_partial | discovered_partial | blocking_failures_remain | no | 15901ms | - | - | 2 | no | - | Se muestran las categorías principales configuradas en el routeProfile.; Tarjeta de Crédito |
| C38126 | Visualizar detalle informativo de tarjeta de crédito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 13754ms | - | - | 0 | no | - | - |
| C38127 | Visualizar detalle informativo de depósito a plazo | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 11878ms | - | - | 0 | no | - | - |
| C38128 | Visualizar detalle informativo de cuenta de ahorro en Pesos | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 24077ms | - | - | 0 | no | - | - |
| C38131 | Visualizar detalle informativo de préstamo personal | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 13565ms | - | - | 0 | no | - | - |
| C38132 | Volver al listado desde el detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 52189ms | - | context_not_reached | 0 | no | none | - |
| C38133 | Acción Solicitar visible desde detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 25151ms | - | - | 0 | no | - | - |

## Failure Forensics

### C38125 - Validar categorías principales visibles en Información de productos
- finalReason: -
- previousStatus: discovered_partial
- finalStatus: discovered_partial
- finalStatusReason: blocking_failures_remain
- pendingBefore: 2
- pendingAfter: 2
- promotionEligible: false
- rootCauseCategory: unknown
- pendingAssertionCount: 2
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0
- notConsumedReasons: normalization_mismatch
- pending: "Se muestran las categorías principales configuradas en el routeProfile." reason=normalization_mismatch expected=
- pending: "Tarjeta de Crédito" reason=normalization_mismatch expected=
