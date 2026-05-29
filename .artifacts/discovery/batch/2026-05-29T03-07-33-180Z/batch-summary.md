# Batch Discovery Summary

- **Batch ID:** 2026-05-29T03-07-33-180Z
- **Timestamp:** 2026-05-29T03:10:37.840Z

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
| Selected | 4 |
| Requested | 4 |
| Executed | 4 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 1 |
| Promoted | 3 |
| Already active (skipped) | 0 |
| Active rerun | 4 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 184652ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38131 | Visualizar detalle informativo de préstamo personal | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 24669ms | - | - | 0 | no | - | - |
| C38134 | Finalizar sesión desde detalle de producto | failed | failed | - | no | 17045ms | Spec validation failed: Selection-like step "Información de productos" is mapped to clickPrimaryAction instead of a select method.; Selection-like step "el primer préstamo visible del listado" is mapped to clickPrimaryAction instead of a select method.. Promotion blocked to prevent degraded spec from being promoted. | - | 0 | no | - | - |
| C38262 | Consulta de balance - Regresar desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 76313ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38264 | Consulta de balance - Finalizar sesión desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 66620ms | - | assertion_consumption_gap | 0 | no | none | - |

## Failure Forensics

### C38134 - Finalizar sesión desde detalle de producto
- finalReason: Spec validation failed: Selection-like step "Información de productos" is mapped to clickPrimaryAction instead of a select method.; Selection-like step "el primer préstamo visible del listado" is mapped to clickPrimaryAction instead of a select method.. Promotion blocked to prevent degraded spec from being promoted.
- previousStatus: failed
- finalStatus: failed
- finalStatusReason: -
- pendingBefore: -
- pendingAfter: -
- promotionEligible: -
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0
