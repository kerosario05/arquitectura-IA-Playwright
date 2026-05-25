# Batch Discovery Summary

- **Batch ID:** 2026-05-24T23-05-39-856Z
- **Timestamp:** 2026-05-24T23:22:44.611Z

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
| Selected | 8 |
| Requested | 8 |
| Executed | 8 |
| Skipped | 0 |
| Passed | 0 |
| Failed | 7 |
| Promoted | 1 |
| Already active (skipped) | 0 |
| Active rerun | 8 |
| Promotion failed | 0 |
| Not promoted | 0 |
| Total duration | 1024753ms |

## Cases

| Case ID | Title | Status | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |
|---------|-------|--------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|
| C37941 | Visualizar catálogo principal de productos disponibles | failed | no | 1779663947615ms | Cannot access 'executedSuccessfulActions' before initialization | - | 0 | no | - | - |
| C37942 | Filtrar productos por la categoría Phones | failed | no | 1779663990585ms | Cannot access 'executedSuccessfulActions' before initialization | - | 0 | no | - | - |
| C37943 | Visualizar detalle de producto desde listado filtrado | failed | no | 1779664069879ms | Cannot access 'executedSuccessfulActions' before initialization | - | 0 | no | - | - |
| C37944 | Agregar producto al carrito desde el detalle del producto | promoted | yes | 116714ms | - | - | 0 | no | - | - |
| C37945 | Visualizar carrito con producto agregado durante la sesión actual | failed | no | 1779664339393ms | Cannot access 'executedSuccessfulActions' before initialization | - | 0 | no | - | - |
| C37946 | Visualizar formulario de orden desde carrito con producto agregado | failed | no | 1779664509411ms | Cannot access 'executedSuccessfulActions' before initialization | - | 0 | no | - | - |
| C37947 | Completar orden de compra con datos válidos generados para ambiente demo | failed | no | 1779664718887ms | Cannot access 'executedSuccessfulActions' before initialization | - | 0 | no | - | - |
| C37948 | Cerrar confirmación de compra exitosa con la opción OK | failed | no | 1779664964610ms | Cannot access 'executedSuccessfulActions' before initialization | - | 0 | no | - | - |

## Failure Forensics

### C37941 - Visualizar catálogo principal de productos disponibles
- finalReason: Cannot access 'executedSuccessfulActions' before initialization
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0

### C37942 - Filtrar productos por la categoría Phones
- finalReason: Cannot access 'executedSuccessfulActions' before initialization
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0

### C37943 - Visualizar detalle de producto desde listado filtrado
- finalReason: Cannot access 'executedSuccessfulActions' before initialization
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0

### C37945 - Visualizar carrito con producto agregado durante la sesión actual
- finalReason: Cannot access 'executedSuccessfulActions' before initialization
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0

### C37946 - Visualizar formulario de orden desde carrito con producto agregado
- finalReason: Cannot access 'executedSuccessfulActions' before initialization
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0

### C37947 - Completar orden de compra con datos válidos generados para ambiente demo
- finalReason: Cannot access 'executedSuccessfulActions' before initialization
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0

### C37948 - Cerrar confirmación de compra exitosa con la opción OK
- finalReason: Cannot access 'executedSuccessfulActions' before initialization
- rootCauseCategory: unknown
- pendingAssertionCount: 0
- autoRepairCalled: false
- autoRepairReason: -
- localClosureConsumedCount: 0
