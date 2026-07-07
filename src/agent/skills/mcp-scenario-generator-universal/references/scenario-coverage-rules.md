# Scenario Coverage Rules — Universal

## Coverage targets

| HU complexity | Minimum scenarios | Signals |
|---|---|---|
| Simple | 3 | 1-2 screens, few fields, no errors |
| Medium | 5 | 3+ screens, 5+ fields, action buttons |
| Rich | 6+ | Detail with financial fields, formats, error cases |
| With errors | 6+ | Explicit error/flujo alternativo in acceptance criteria |

**Constraint**: never generate less than 60% of `huPlan.scenarioCountTarget`.
If target is 6 and AI generates 1: activate `fallback_reason = ai_under_generated_target`.

## Scenario types

Every coverage set must include these layers:

1. **List/Navigation** — how the user reaches the functional area
2. **Selection** — select an entity from a list
3. **Detail/Core** — validate primary fields of the selected entity
4. **Formats** — validate moneda, fecha, porcentaje render correctly
5. **Post-options** — validate action buttons visible after detail
6. **Return** — navigate back from detail to list/menu
7. **Error/Empty** — if HU specifies: sin datos, sin selección, campos inválidos

## loan_balance specific coverage

For `intent=balance_inquiry, subIntent=loan_balance`:

```
1. Visualizar listado de préstamos disponibles
2. Seleccionar el primer préstamo visible del listado
3. Validar datos identificativos (tipo, número, fecha consulta)
4. Validar campos financieros (balance, tasa, desembolsado, cancelación)
5. Validar plan de pagos (cuota, plazo, pagos, fechas)
6. Validar opciones posteriores (volver, correo, imprimir, tabla amortización)
7. Regresar al listado desde el detalle
```

## catalog_listing specific coverage

For `intent=catalog_listing_flow`:

```
1. Navegar al módulo de información de productos
2. Visualizar categorías disponibles
3. Explorar subcategoría específica
4. Seleccionar producto del listado
5. Validar secciones del detalle (beneficios, requisitos, condiciones)
6. Regresar al listado desde detalle
```

## document_generation specific coverage

For `intent=document_generation`:

```
1. Navegar a funcionalidad de generación de documento
2. Completar datos requeridos (destinatario, RNC, correo)
3. Revisar vista previa (si aplica)
4. Confirmar generación
5. Validar comprobante/resultado
6. Validar campos requeridos (datos faltantes → validación)
7. Cancelar antes de confirmar
```

## Quality enforcement

| Check | Rule |
|---|---|
| Entity selection | Always use domain term: `Seleccionar el primer préstamo visible...` never `elemento` |
| Labels | Always from HU text: `"Tipo de préstamo"` never `"Nombre"` |
| Formats | If HU mentions moneda/fecha/porcentaje, validate them explicitly |
| Post-options | Validate at least 2 action buttons from HU text (Volver, Enviar, Imprimir, etc.) |
| Navigation | Include return/cancel scenario unless HU is single-screen |
| Explicit route | If HU has breadcrumb (`A > B > C`), ALL scenarios must prepend those segments as mandatory clicks before entity selection or validation |
