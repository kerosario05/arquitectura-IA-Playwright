# Batch Discovery Summary

- **Batch ID:** 2026-05-25T01-46-46-286Z
- **Timestamp:** 2026-05-25T01:56:15.019Z

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
| Promoted | 3 |
| Already active (skipped) | 0 |
| Active rerun | 3 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 568722ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 152757ms | - | context_not_reached | 0 | no | none | - |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 170027ms | - | assertion_consumption_gap | 0 | no | none | - |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 245937ms | - | assertion_consumption_gap | 0 | no | none | - |

## Failure Forensics
