# MCP Step Contract — Allowed and Forbidden Patterns

## Allowed patterns (use ONLY these)

| Pattern | Example | Notes |
|---|---|---|
| `Clic en "<target>".` | `Clic en "Iniciar".` | target must be from ALLOWED_EXECUTABLE_CLICKS or routeResolutions |
| `Validar que se muestre "<label>".` | `Validar que se muestre "Tipo de préstamo".` | label from HU text, NOT generic |
| `Validar que el botón "<label>" esté visible.` | `Validar que el botón "Volver" esté visible.` | Use `habilitado` or `deshabilitado` for state checks |
| `Seleccionar el primer <domainTerm> visible del listado.` | `Seleccionar el primer préstamo visible del listado.` | domainTerm from entity name |
| `Seleccionar el <ordinal> <domainTerm> visible del listado.` | `Seleccionar el segundo producto visible del listado.` | ordinal: primer, primera, último, última |
| `Ingresar "<valor>" en "<campo>".` | `Ingresar "00116848235" en "Cédula".` | For direct values |
| `Ingresar "<campo>" usando <dataKey>.` | `Ingresar "destinatario" usando destinatario_documento.` | For data-driven values |

## Forbidden patterns (REJECT immediately)

| Pattern | Reason |
|---|---|
| `Seleccionar el primer elemento visible del listado.` | No entity name — generic |
| `Validar que se muestre "Nombre".` | Generic label when HU has specific fields |
| `Validar que se muestre "Información".` | Too vague |
| `Validar que se muestre "Detalle".` | Too vague |
| `Validar que funcione correctamente.` | Abstract — no concrete target |
| `Validar resultado esperado.` | Abstract |
| `Validar que se genere correctamente.` | Abstract |
| `Completar datos requeridos.` | No field specification |
| `Ejecutar acción de la HU.` | Meaningless |
| `Gestionar la solicitud.` | Narrative |
| `Continuar con el flujo.` | Narrative |
| `Hacer clic en "X".` | Wrong verb — use `Clic en` |
| `Seleccionar la opción "X".` | Wrong verb — use `Clic en` |
| `Verificar "X".` | Wrong verb — use `Validar que se muestre` |
| `Completar autenticación.` | Backend/auth — out of scope |
| `Navegar a...` | Narrative |
| `El usuario debe...` | Narrative |
| `Sistema muestra...` | Narrative |

## Explicit HU route segments

When HU text contains an explicit menu breadcrumb (`A > B`, `A → B`, `A / B`), each segment becomes a mandatory `Clic en` step:

| Breadcrumb pattern | Conversion |
|---|---|
| `Consulta de balance > Préstamos` | `Clic en "Consulta de balance"` → `Clic en "Préstamos"` |
| `Pagos > Tarjetas > Pago mínimo` | `Clic en "Pagos"` → `Clic en "Tarjetas"` → `Clic en "Pago mínimo"` |
| `Generar cartas / Carta de referencia` | `Clic en "Generar cartas"` → `Clic en "Carta de referencia"` |

These steps are HU-derived mandatory navigation. They do NOT require routeProfile validation and take priority over incompatible routeProfile entry steps.

## Normalization rules (apply BEFORE pattern check)

1. Strip leading numbering: `21. Validar...` → `Validar...`
2. Fix common typos:
   - `mustre` → `muestre`
   - `muetra` → `muestra`
   - `bolon` / `boton` → `botón`
3. Capitalize first word of steps
4. Ensure end period: append `.` if missing

## Step numbering

All output steps must be numbered sequentially:
```
1. Clic en "Iniciar".
2. Validar que se muestre "Listado de préstamos".
3. Seleccionar el primer préstamo visible del listado.
```

## Quality gate

Before output, check every step:
1. Matches an allowed pattern
2. Does NOT match any forbidden pattern
3. Uses specific labels from HU, not placeholders
4. Selection steps include entity name
5. No duplicate consecutive steps
