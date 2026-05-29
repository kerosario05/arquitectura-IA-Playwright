# Batch Discovery Summary

- **Batch ID:** 2026-05-29T01-27-44-631Z
- **Timestamp:** 2026-05-29T01:30:59.355Z

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
| Selected | 5 |
| Requested | 5 |
| Executed | 5 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 0 |
| Promoted | 5 |
| Already active (skipped) | 0 |
| Active rerun | 5 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 194717ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C38131 | Visualizar detalle informativo de préstamo personal | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 23697ms | - | - | 0 | no | - | - |
| C38132 | Volver al listado desde el detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 14384ms | - | - | 0 | no | - | - |
| C38134 | Finalizar sesión desde detalle de producto | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 25533ms | - | - | 0 | no | - | - |
| C38262 | Consulta de balance - Regresar desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 65643ms | - | assertion_consumption_gap | 0 | no | none | - |
| C38264 | Consulta de balance - Finalizar sesión desde detalle de depósito | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 65456ms | - | assertion_consumption_gap | 0 | no | none | - |

## Failure Forensics
