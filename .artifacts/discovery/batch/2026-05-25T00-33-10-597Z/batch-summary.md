# Batch Discovery Summary

- **Batch ID:** 2026-05-25T00-33-10-597Z
- **Timestamp:** 2026-05-25T00:38:07.120Z

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
| Total duration | 296521ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37941 | Visualizar catálogo principal de productos disponibles | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 7732ms | - | context_not_reached | 0 | yes | none | - |
| C37943 | Visualizar detalle de producto desde listado filtrado | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 79346ms | - | context_not_reached | 0 | yes | none | - |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | promoted | discovered_passed | local_closure_consumed_all_blockers | yes | 209443ms | - | assertion_consumption_gap | 0 | yes | none | - |

## Failure Forensics
