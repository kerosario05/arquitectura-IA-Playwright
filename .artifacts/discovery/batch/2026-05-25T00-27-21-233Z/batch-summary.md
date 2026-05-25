# Batch Discovery Summary

- **Batch ID:** 2026-05-25T00-27-21-233Z
- **Timestamp:** 2026-05-25T00:32:16.894Z

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
| Promotion failed | 3 |
| Not promoted | 0 |
| Total duration | 295660ms |

## Cases

| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37941 | Visualizar catálogo principal de productos disponibles | promotion_failed | discovered_passed | local_closure_consumed_all_blockers | no | 7757ms | - | context_not_reached | 0 | yes | none | - |
| C37943 | Visualizar detalle de producto desde listado filtrado | promotion_failed | discovered_passed | local_closure_consumed_all_blockers | no | 79395ms | - | context_not_reached | 0 | yes | none | - |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | promotion_failed | discovered_passed | local_closure_consumed_all_blockers | no | 208508ms | - | assertion_consumption_gap | 0 | yes | none | - |

## Failure Forensics
