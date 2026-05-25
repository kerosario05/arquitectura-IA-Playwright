# Batch Discovery Summary

- **Batch ID:** 2026-05-24T23-48-21-425Z
- **Timestamp:** 2026-05-24T23:53:17.988Z

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
| Total duration | 296562ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37941 | Visualizar catálogo principal de productos disponibles | discovered_partial | no | 7733ms | pending_local_assertions | context_not_reached | 0 | yes | none | - |
| C37943 | Visualizar detalle de producto desde listado filtrado | discovered_partial | no | 79370ms | pending_local_assertions | context_not_reached | 0 | yes | none | - |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | discovered_partial | no | 209459ms | pending_local_assertions | assertion_consumption_gap | 0 | yes | none | - |

## Failure Forensics

### C37941 - Visualizar catálogo principal de productos disponibles
- finalReason: pending_local_assertions
- rootCauseCategory: context_not_reached
- pendingAssertionCount: 0
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 1

### C37943 - Visualizar detalle de producto desde listado filtrado
- finalReason: pending_local_assertions
- rootCauseCategory: context_not_reached
- pendingAssertionCount: 0
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 3

### C37947 - Completar orden de compra con datos válidos generados para ambiente demo
- finalReason: pending_local_assertions
- rootCauseCategory: assertion_consumption_gap
- pendingAssertionCount: 0
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 1
