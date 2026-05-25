# Batch Discovery Summary

- **Batch ID:** 2026-05-25T01-17-34-409Z
- **Timestamp:** 2026-05-25T01:27:08.030Z

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
| Selected | 3 |
| Requested | 3 |
| Executed | 3 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 0 |
| Promoted | 0 |
| Already active (skipped) | 0 |
| Active rerun | 3 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 573620ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | discovered_partial | discovered_partial | blocking_failures_remain | no | 152697ms | pending_local_assertions | context_not_reached | 0 | yes | none | - |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | discovered_partial | discovered_partial | blocking_failures_remain | no | 170006ms | pending_local_assertions | assertion_consumption_gap | 0 | yes | none | - |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | discovered_partial | discovered_partial | blocking_failures_remain | no | 250917ms | pending_local_assertions | assertion_consumption_gap | 0 | yes | none | - |

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
