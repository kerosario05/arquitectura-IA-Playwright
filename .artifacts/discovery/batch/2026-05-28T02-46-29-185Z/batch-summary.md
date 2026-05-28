# Batch Discovery Summary

- **Batch ID:** 2026-05-28T02-46-29-185Z
- **Timestamp:** 2026-05-28T02:49:39.264Z

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
| Total duration | 190072ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38126 | Visualizar detalle informativo de tarjeta de crédito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 26031ms | - | - | 0 | no | - | - |
| C38127 | Visualizar detalle informativo de depósito a plazo | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 14519ms | - | - | 0 | no | - | - |
| C38128 | Visualizar detalle informativo de cuenta de ahorro en Pesos | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 22788ms | - | - | 0 | no | - | - |
| C38131 | Visualizar detalle informativo de préstamo personal | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 15570ms | - | - | 0 | no | - | - |
| C38132 | Volver al listado desde el detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 53118ms | - | context_not_reached | 0 | no | none | - |
| C38133 | Acción Solicitar visible desde detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 26491ms | - | - | 0 | no | - | - |
| C38230 | Consulta de balance - Visualizar listado de depósitos a plazo activos | discovered_partial | discovered_partial | blocking_failures_remain | no | 31547ms | assertion_not_found | - | 2 | no | - | Volver al menú principal; La pantalla permite seleccionar un depósito o volver al menú principal. |

## Failure Forensics

### C38230 - Consulta de balance - Visualizar listado de depósitos a plazo activos
- finalReason: assertion_not_found
- previousStatus: discovered_partial
- finalStatus: discovered_partial
- finalStatusReason: blocking_failures_remain
- pendingBefore: 3
- pendingAfter: 2
- promotionEligible: false
- rootCauseCategory: unknown
- pendingAssertionCount: 2
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0
- notConsumedReasons: normalization_mismatch
- pending: "Volver al menú principal" reason=normalization_mismatch expected=
- pending: "La pantalla permite seleccionar un depósito o volver al menú principal." reason=normalization_mismatch expected=
