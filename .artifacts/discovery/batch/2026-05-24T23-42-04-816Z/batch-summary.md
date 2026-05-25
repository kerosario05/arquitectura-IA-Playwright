# Batch Discovery Summary

- **Batch ID:** 2026-05-24T23-42-04-816Z
- **Timestamp:** 2026-05-24T23:47:01.519Z

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
| Total duration | 296702ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37941 | Visualizar catálogo principal de productos disponibles | discovered_partial | no | 7778ms | pending_local_assertions | context_not_reached | 1 | yes | none | que se muestre al menos un producto visible con nombre |
| C37943 | Visualizar detalle de producto desde listado filtrado | discovered_partial | no | 79433ms | pending_local_assertions | context_not_reached | 3 | yes | none | que se muestre el detalle del producto seleccionado; que se muestre el nombre del producto |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | discovered_partial | no | 209491ms | pending_local_assertions | assertion_consumption_gap | 1 | yes | none | Product added |

## Failure Forensics

### C37941 - Visualizar catálogo principal de productos disponibles
- finalReason: pending_local_assertions
- rootCauseCategory: context_not_reached
- pendingAssertionCount: 1
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 0
- notConsumedReasons: evidence_not_passed_to_resolver
- pending: "que se muestre al menos un producto visible con nombre" reason=evidence_not_passed_to_resolver expected=satisfied_by_structural_evidence

### C37943 - Visualizar detalle de producto desde listado filtrado
- finalReason: pending_local_assertions
- rootCauseCategory: context_not_reached
- pendingAssertionCount: 3
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 0
- notConsumedReasons: evidence_not_passed_to_resolver
- pending: "que se muestre el detalle del producto seleccionado" reason=evidence_not_passed_to_resolver expected=satisfied_by_structural_evidence
- pending: "que se muestre el nombre del producto" reason=evidence_not_passed_to_resolver expected=satisfied_by_structural_evidence
- pending: "Nombre del producto." reason=evidence_not_passed_to_resolver expected=satisfied_by_structural_evidence

### C37947 - Completar orden de compra con datos válidos generados para ambiente demo
- finalReason: pending_local_assertions
- rootCauseCategory: assertion_consumption_gap
- pendingAssertionCount: 1
- autoRepairCalled: true
- autoRepairReason: none
- localClosureConsumedCount: 0
- notConsumedReasons: evidence_not_passed_to_resolver
- pending: "Product added" reason=evidence_not_passed_to_resolver expected=satisfied_by_feedback_message
