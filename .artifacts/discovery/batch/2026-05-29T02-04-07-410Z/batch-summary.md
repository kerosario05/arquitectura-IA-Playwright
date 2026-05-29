# Batch Discovery Summary

- **Batch ID:** 2026-05-29T02-04-07-410Z
- **Timestamp:** 2026-05-29T02:07:15.046Z

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
| Failed | 0 |
| Promoted | 4 |
| Already active (skipped) | 0 |
| Active rerun | 4 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 187627ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38131 | Visualizar detalle informativo de préstamo personal | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 23994ms | - | - | 0 | no | - | - |
| C38134 | Finalizar sesión desde detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 21549ms | - | - | 0 | no | - | - |
| C38262 | Consulta de balance - Regresar desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 76053ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38264 | Consulta de balance - Finalizar sesión desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 66028ms | - | assertion_consumption_gap | 0 | no | none | - |

## Failure Forensics
