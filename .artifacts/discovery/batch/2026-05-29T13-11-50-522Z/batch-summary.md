# Batch Discovery Summary

- **Batch ID:** 2026-05-29T13-11-50-522Z
- **Timestamp:** 2026-05-29T13:13:45.561Z

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
| Selected | 3 |
| Requested | 3 |
| Executed | 3 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 3 |
| Promoted | 0 |
| Already active (skipped) | 0 |
| Active rerun | 3 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 115034ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38131 | Visualizar detalle informativo de préstamo personal | failed | failed | - | no | 23933ms | Spec validation failed: Suspicious duplicate homePage.start() calls: 5. Spec may be degraded.. Promotion blocked to prevent degraded spec from being promoted. | - | 0 | no | - | - |
| C38134 | Finalizar sesión desde detalle de producto | failed | failed | - | no | 16143ms | Spec validation failed: Suspicious duplicate homePage.start() calls: 6. Spec may be degraded.; Selection-like step "Información de productos" is mapped to clickPrimaryAction instead of a select method.; Selection-like step "el primer préstamo visible del listado" is mapped to clickPrimaryAction instead of a select method.. Promotion blocked to prevent degraded spec from being promoted. | - | 0 | no | - | - |
| C38264 | Consulta de balance - Finalizar sesión desde detalle de depósito | failed | failed | - | no | 74957ms | Spec validation failed: Suspicious duplicate homePage.start() calls: 5. Spec may be degraded.. Promotion blocked to prevent degraded spec from being promoted. | - | 0 | no | - | - |

## Failure Forensics

### C38131 - Visualizar detalle informativo de préstamo personal
- finalReason: Spec validation failed: Suspicious duplicate homePage.start() calls: 5. Spec may be degraded.. Promotion blocked to prevent degraded spec from being promoted.
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

### C38134 - Finalizar sesión desde detalle de producto
- finalReason: Spec validation failed: Suspicious duplicate homePage.start() calls: 6. Spec may be degraded.; Selection-like step "Información de productos" is mapped to clickPrimaryAction instead of a select method.; Selection-like step "el primer préstamo visible del listado" is mapped to clickPrimaryAction instead of a select method.. Promotion blocked to prevent degraded spec from being promoted.
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

### C38264 - Consulta de balance - Finalizar sesión desde detalle de depósito
- finalReason: Spec validation failed: Suspicious duplicate homePage.start() calls: 5. Spec may be degraded.. Promotion blocked to prevent degraded spec from being promoted.
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
