# Batch Discovery Summary

- **Batch ID:** 2026-05-29T00-39-24-089Z
- **Timestamp:** 2026-05-29T00:50:11.779Z

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
| Selected | 15 |
| Requested | 15 |
| Executed | 15 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 1 |
| Promoted | 13 |
| Already active (skipped) | 0 |
| Active rerun | 15 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 647682ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38125 | Validar categorías principales visibles en Información de productos | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 18877ms | - | - | 0 | no | - | - |
| C38126 | Visualizar detalle informativo de tarjeta de crédito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 14551ms | - | - | 0 | no | - | - |
| C38127 | Visualizar detalle informativo de depósito a plazo | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 19935ms | - | - | 0 | no | - | - |
| C38128 | Visualizar detalle informativo de cuenta de ahorro en Pesos | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 14886ms | - | - | 0 | no | - | - |
| C38131 | Visualizar detalle informativo de préstamo personal | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 21824ms | - | - | 0 | no | - | - |
| C38132 | Volver al listado desde el detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 14415ms | - | - | 0 | no | - | - |
| C38133 | Acción Solicitar visible desde detalle de producto | exploration_failed | exploration_failed | blocking_failures_remain | no | 50314ms | ambiguous_target | - | 0 | no | - | - |
| C38134 | Finalizar sesión desde detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 25598ms | - | - | 0 | no | - | - |
| C38257 | Consulta de balance - Visualizar listado de depósitos a plazo activos | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 62089ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38258 | Consulta de balance - Visualizar detalle de depósito a plazo activo | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 64521ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38260 | Consulta de balance - Validar etiquetas visibles del detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 63843ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38261 | Consulta de balance - Ver acciones disponibles en detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 63408ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38262 | Consulta de balance - Regresar desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 65421ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38263 | Consulta de balance - Volver al menú desde listado de depósitos | discovered_partial | discovered_partial | blocking_failures_remain | no | 82380ms | target_not_found | assertion_consumption_gap | 0 | no | none | - |
| C38264 | Consulta de balance - Finalizar sesión desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 65604ms | - | assertion_consumption_gap | 0 | no | none | - |

## Failure Forensics

### C38263 - Consulta de balance - Volver al menú desde listado de depósitos
- finalReason: target_not_found
- previousStatus: discovered_partial
- finalStatus: discovered_partial
- finalStatusReason: blocking_failures_remain
- pendingBefore: 1
- pendingAfter: 0
- promotionEligible: false
- rootCauseCategory: assertion_consumption_gap
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: none
- localClosureConsumedCount: 1
