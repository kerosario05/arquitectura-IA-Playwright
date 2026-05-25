# Batch Discovery Summary

- **Batch ID:** 2026-05-25T00-39-44-988Z
- **Timestamp:** 2026-05-25T00:56:51.163Z

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
| Promoted | 5 |
| Already active (skipped) | 0 |
| Active rerun | 8 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 1026173ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37941 | Visualizar catálogo principal de productos disponibles | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 7731ms | - | context_not_reached | 0 | yes | none | - |
| C37942 | Filtrar productos por la categoría Phones | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 42984ms | - | context_not_reached | 0 | yes | none | - |
| C37943 | Visualizar detalle de producto desde listado filtrado | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 80372ms | - | context_not_reached | 0 | yes | none | - |
| C37944 | Agregar producto al carrito desde el detalle del producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 116803ms | - | - | 0 | no | - | - |
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | discovered_partial | discovered_partial | blocking_failures_remain | no | 152930ms | pending_local_assertions | context_not_reached | 0 | yes | none | - |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | discovered_partial | discovered_partial | blocking_failures_remain | no | 170010ms | pending_local_assertions | assertion_consumption_gap | 0 | yes | none | - |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 209533ms | - | assertion_consumption_gap | 0 | yes | none | - |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | discovered_partial | discovered_partial | blocking_failures_remain | no | 245808ms | pending_local_assertions | assertion_consumption_gap | 0 | yes | none | - |

## Failure Forensics

### C37945 - Visualizar carrito con producto agregado durante la sesión actual
- finalReason: pending_local_assertions
- previousStatus: discovered_partial
- finalStatus: discovered_partial
- finalStatusReason: blocking_failures_remain
- pendingBefore: 3
- pendingAfter: 0
- promotionEligible: false
- rootCauseCategory: context_not_reached
- pendingAssertionCount: 0
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 3

### C37946 - Visualizar formulario de orden desde carrito con producto agregado
- finalReason: pending_local_assertions
- previousStatus: discovered_partial
- finalStatus: discovered_partial
- finalStatusReason: blocking_failures_remain
- pendingBefore: 1
- pendingAfter: 0
- promotionEligible: false
- rootCauseCategory: assertion_consumption_gap
- pendingAssertionCount: 0
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 1

### C37948 - Cerrar confirmación de compra exitosa con la opción OK
- finalReason: pending_local_assertions
- previousStatus: discovered_partial
- finalStatus: discovered_partial
- finalStatusReason: blocking_failures_remain
- pendingBefore: 1
- pendingAfter: 0
- promotionEligible: false
- rootCauseCategory: assertion_consumption_gap
- pendingAssertionCount: 0
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 1
