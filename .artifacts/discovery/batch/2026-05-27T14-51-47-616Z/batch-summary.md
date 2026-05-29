# Batch Discovery Summary

- **Batch ID:** 2026-05-27T14-51-47-616Z
- **Timestamp:** 2026-05-27T14:56:50.724Z

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
| Selected | 7 |
| Requested | 7 |
| Executed | 7 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 5 |
| Promoted | 0 |
| Already active (skipped) | 0 |
| Active rerun | 0 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 303102ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38125 | Validar categorías principales visibles en Información de productos | discovered_partial | discovered_partial | blocking_failures_remain | no | 18440ms | - | - | 2 | no | - | Se muestran las categorías principales configuradas en el routeProfile.; Tarjeta de Crédito |
| C38126 | Visualizar detalle informativo de tarjeta de crédito | exploration_failed | exploration_failed | blocking_failures_remain | no | 13347ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado |
| C38127 | Visualizar detalle informativo de depósito a plazo | exploration_failed | exploration_failed | blocking_failures_remain | no | 132068ms | target_not_found | - | 2 | no | - | el primer depósito visible del listado; Finalizar sesión |
| C38128 | Visualizar detalle informativo de cuenta de ahorro en Pesos | exploration_failed | exploration_failed | blocking_failures_remain | no | 50257ms | ambiguous_target | - | 0 | no | - | - |
| C38131 | Visualizar detalle informativo de préstamo personal | exploration_failed | exploration_failed | blocking_failures_remain | no | 23957ms | semantic_mismatch | - | 1 | no | - | el primer préstamo visible del listado |
| C38132 | Volver al listado desde el detalle de producto | discovered_partial | discovered_partial | blocking_failures_remain | no | 42567ms | target_not_found | assertion_consumption_gap | 2 | no | none | el primer depósito visible del listado; 1. El sistema regresa al listado/categoría de productos sin cerrar la sesión. |
| C38133 | Acción Solicitar visible desde detalle de producto | exploration_failed | exploration_failed | blocking_failures_remain | no | 22456ms | semantic_mismatch | - | 1 | no | - | la primera tarjeta visible del listado |

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

### C38132 - Volver al listado desde el detalle de producto
- finalReason: target_not_found
- previousStatus: discovered_partial
- finalStatus: discovered_partial
- finalStatusReason: blocking_failures_remain
- pendingBefore: 2
- pendingAfter: 2
- promotionEligible: false
- rootCauseCategory: assertion_consumption_gap
- pendingAssertionCount: 2
- autoRepairCalled: false
- autoRepairReason: none
- localClosureConsumedCount: 0
- notConsumedReasons: concrete_evidence_missing
- pending: "el primer depósito visible del listado" reason=concrete_evidence_missing expected=
