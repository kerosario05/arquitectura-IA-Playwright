# Examples — Bad vs Good Scenario Generation

## Example: loan_balance HU

### HU text
```
AA-91: Consulta de balance > Préstamos.
Debe mostrar listado de préstamos y detalle:
Tipo de préstamo, Número de préstamo, Fecha y hora de consulta,
Número de cuota, Plazo, Fecha último pago, Monto último pago,
Fecha próxima pago, Balance pendiente a la fecha, Tasa de interés,
Monto desembolsado, Fecha próxima cuota, Monto pagado,
Saldo de cancelación.
Opciones: Volver al listado de préstamos, Volver al menú principal,
Enviar vía correo, Imprimir, Generar tabla amortización, Finalizar sesión.
```

### BAD generation (reject)

```json
[{
  "sourceIssueKey": "AA-91",
  "title": "Consulta de balance de prestamos — consultar balance",
  "steps": [
    "1. Clic en \"Iniciar\".",
    "2. Seleccionar el primer elemento visible del listado.",
    "3. Validar que se muestre \"Nombre\"."
  ]
}]
```
Rejected reasons:
- `Seleccionar el primer elemento visible del listado.` → no usa "préstamo"
- `Validar que se muestre "Nombre".` → label genérico; HU tiene Tipo de préstamo, Número de préstamo, etc.
- Solo 1 escenario para HU rica con target=6
- No valida campos financieros (balance, tasa, monto)
- No valida opciones posteriores

### GOOD generation (accept)

```json
[
  {
    "sourceIssueKey": "AA-91",
    "title": "Consulta de balance de prestamos — Visualizar listado de préstamos",
    "steps": [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Transacciones y servicios\".",
      "3. Clic en \"Consulta de balance\".",
      "4. Clic en \"Préstamos\".",
      "5. Validar que se muestre \"Listado de préstamos\"."
    ],
    "expectedResult": "Listado de préstamos visible con opciones de selección."
  },
  {
    "sourceIssueKey": "AA-91",
    "title": "Consulta de balance de prestamos — Seleccionar el primer préstamo visible",
    "steps": [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Transacciones y servicios\".",
      "3. Clic en \"Consulta de balance\".",
      "4. Clic en \"Préstamos\".",
      "5. Seleccionar el primer préstamo visible del listado."
    ],
    "expectedResult": "Detalle del préstamo seleccionado visible."
  },
  {
    "sourceIssueKey": "AA-91",
    "title": "Consulta de balance de prestamos — Validar datos identificativos del préstamo",
    "steps": [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Transacciones y servicios\".",
      "3. Clic en \"Consulta de balance\".",
      "4. Clic en \"Préstamos\".",
      "5. Seleccionar el primer préstamo visible del listado.",
      "6. Validar que se muestre \"Tipo de préstamo\".",
      "7. Validar que se muestre \"Número de préstamo\".",
      "8. Validar que se muestre \"Fecha y hora de la consulta\"."
    ],
    "expectedResult": "Datos identificativos del préstamo visibles."
  },
  {
    "sourceIssueKey": "AA-91",
    "title": "Consulta de balance de prestamos — Validar campos financieros",
    "steps": [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Transacciones y servicios\".",
      "3. Clic en \"Consulta de balance\".",
      "4. Clic en \"Préstamos\".",
      "5. Seleccionar el primer préstamo visible del listado.",
      "6. Validar que se muestre \"Balance pendiente a la fecha\".",
      "7. Validar que se muestre \"Tasa de interés\".",
      "8. Validar que se muestre \"Monto desembolsado\".",
      "9. Validar que se muestre \"Saldo de cancelación\"."
    ],
    "expectedResult": "Campos financieros del préstamo visibles con formatos correctos."
  },
  {
    "sourceIssueKey": "AA-91",
    "title": "Consulta de balance de prestamos — Validar plan de pagos del préstamo",
    "steps": [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Transacciones y servicios\".",
      "3. Clic en \"Consulta de balance\".",
      "4. Clic en \"Préstamos\".",
      "5. Seleccionar el primer préstamo visible del listado.",
      "6. Validar que se muestre \"Número de cuota\".",
      "7. Validar que se muestre \"Plazo\".",
      "8. Validar que se muestre \"Fecha último pago\".",
      "9. Validar que se muestre \"Monto último pago\".",
      "10. Validar que se muestre \"Fecha próxima cuota\".",
      "11. Validar que se muestre \"Monto pagado\"."
    ],
    "expectedResult": "Plan de pagos del préstamo visible con fechas y montos."
  },
  {
    "sourceIssueKey": "AA-91",
    "title": "Consulta de balance de prestamos — Validar opciones posteriores al detalle",
    "steps": [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Transacciones y servicios\".",
      "3. Clic en \"Consulta de balance\".",
      "4. Clic en \"Préstamos\".",
      "5. Seleccionar el primer préstamo visible del listado.",
      "6. Validar que el botón \"Volver al listado de préstamos\" esté visible.",
      "7. Validar que el botón \"Volver al menú principal\" esté visible.",
      "8. Validar que el botón \"Enviar vía correo\" esté visible.",
      "9. Validar que el botón \"Imprimir\" esté visible.",
      "10. Validar que el botón \"Generar tabla amortización\" esté visible."
    ],
    "expectedResult": "Opciones posteriores al detalle visibles y accesibles."
  },
  {
    "sourceIssueKey": "AA-91",
    "title": "Consulta de balance de prestamos — Regresar al listado desde el detalle",
    "steps": [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Transacciones y servicios\".",
      "3. Clic en \"Consulta de balance\".",
      "4. Clic en \"Préstamos\".",
      "5. Seleccionar el primer préstamo visible del listado.",
      "6. Validar que se muestre \"Balance pendiente a la fecha\".",
      "7. Clic en \"Volver al listado de préstamos\".",
      "8. Validar que se muestre \"Listado de préstamos\"."
    ],
    "expectedResult": "Regreso exitoso al listado de préstamos."
  }
]
```

## Key differences

| Aspect | BAD | GOOD |
|---|---|---|
| Scenarios | 1 | 7 |
| Selection label | `primer elemento visible` | `primer préstamo visible` |
| Validation label | `"Nombre"` (generic) | `"Tipo de préstamo"`, `"Balance pendiente"` (specific) |
| Financial fields | None | Balance, tasa, desembolsado, cancelación |
| Formats | Not validated | Each format type validated separately |
| Post-options | Not covered | All 5 buttons validated |
| Return flow | Not covered | Separate return scenario |
| Navigation prefix | Only "Iniciar" | Full prefix from knowledge |
| Explicit HU route | Ignored; no "Consulta de balance" or "Préstamos" steps | Extracted from HU breadcrumb: `Consulta de balance > Préstamos` → mandatory clicks |
