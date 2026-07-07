# Intent Classification — Universal Rules

Classify HU intent from summary + description + acceptanceCriteria. Deterministic, no AI needed.

## Intent priority (check in this order)

### 1. balance_inquiry / loan_balance
**Triggers**: Any of:
- `balance` or `saldo` in HU text AND `préstamo`, `cuenta`, `producto`, or `tarjeta`
- `préstamo` + financial fields (`monto`, `tasa`, `plazo`, `cuota`, `desembolsado`, `amortización`)
- `consulta de balance > préstamos` pattern

**subIntent**:
- `loan_balance` if `préstamo` is the dominant entity
- `generic_balance` otherwise

**Signals that DO NOT change intent**: `generar tabla amortización`, `enviar vía correo`, `imprimir` — these are post-detail options, not intent changers.

### 2. document_generation
**Triggers**: `generar carta` OR `carta de referencia` OR `certificación` OR `certificado` OR `constancia` OR `comprobante` AND (`generar` OR `emitir` OR `descargar`)

**subIntent**:
- `reference_letter` if `carta de referencia`
- `certification` if `certificación` or `certificado`
- `with_preview` if `vista previa`
- `with_qr` if `código QR` or `QR`
- `with_auth_code` if `código de autenticación`

### 3. statement_generation
**Triggers**: `estado de cuenta` OR `extracto` OR `movimiento`

### 4. payment_transfer
**Triggers**: `pagar` OR `pago` OR `transferir` OR `transferencia` OR (`enviar` AND `fondos`/`dinero`)

### 5. product_request
**Triggers**: `solicitar` OR `contratar` OR `apertura` OR `registrar` AND (`cuenta` OR `tarjeta` OR `producto` OR `servicio`)

### 6. maintenance_crud
**Triggers**: `editar` OR `modificar` OR `cambiar` OR `actualizar` OR `eliminar` OR `desactivar`

### 7. catalog_listing / product_detail
**Triggers**: `información de productos` OR `catálogo de productos` OR `listado de productos` OR `beneficios` OR `requisitos` OR `condiciones relevantes`

### 8. fallback
If none above match: the routeResolutions or knowledgeContext determine mode.

## Conflict resolution

When multiple signals match, use priority order:
1. `loan_balance` (most specific, financial detail)
2. `balance_inquiry` (financial display)
3. `document_generation` (active generation with output)
4. `statement_generation`
5. `payment_transfer`
6. `product_request`
7. `maintenance_crud`
8. `catalog_listing` / `product_detail`

## Post-option signals (DO NOT reclassify)

These signals appear in acceptance criteria as options AFTER the main flow. They do NOT change the intent:
- `enviar vía correo` / `correo electrónico` — delivery option
- `imprimir` — print option
- `generar tabla amortización` — data export option
- `volver al listado` / `volver al menú principal` — navigation
- `finalizar sesión` — session management
- `descargar` — export/delivery option
