# Blocked Scenarios Response Contract

## Problema

Cuando QA Lab solicita generar escenarios a partir de Jira issues, pero route-first bloquea la generación por falta de routeProfile o rutas incompletas, la UI mostraba el mensaje genérico:

> "Sin escenarios para este filtro"  
> "No hay escenarios con estado 'X' en el sprint activo."

Esto era confuso porque:
- **Caso A**: No hay issues Jira para ese filtro → mensaje correcto
- **Caso B**: Hay issues Jira, pero fueron bloqueados por route-first → mensaje incorrecto (el problema no es el filtro Jira, sino falta de routeProfile)

## Solución

Se agregó un nuevo campo `blockedScenarios` al response de `POST /api/scenarios/preview`.

### Nuevo contrato

```typescript
type ScenarioPreviewResponse = {
  ok: boolean;
  source: { ... };
  testrail: { ... };
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  appProfilePath?: string;
  
  summary: {
    generated: number;
    valid: number;
    invalid: number;
    rejected: number;
    blocked: number;  // NUEVO
  };
  
  routeProfile: McpRouteProfile | null;
  scenarios: ValidatedScenario[];
  rejected: McpRejectedScenario[];  // Backward compatibility
  
  blockedScenarios?: BlockedScenario[];  // NUEVO
  
  warnings: string[];
};

type BlockedScenario = {
  sourceIssueKey: string;       // Ej: "AA-82"
  title: string;                // Ej: "Visualizar información del producto"
  status: "blocked";
  reasonCode: DiagnosticCode;   // Ej: "needs_route_profile"
  reason: string;               // Mensaje completo del bloqueo
  diagnostics: ScenarioDiagnostic[];
  appSlug: string;
  appProfilePath?: string;
  suggestedAction: string;      // Ej: "configure_route_profile"
};

type DiagnosticCode =
  | "needs_route_profile"           // ERROR: No hay routeProfile
  | "missing_parent_route"          // ERROR: Falta ruta padre (lista)
  | "missing_intermediate_step"     // WARNING: Falta paso intermedio
  | "missing_detail_selection_step" // WARNING: Falta selección de item
  | "unsupported_route_target"      // INFO: Target no respaldado
  | "ambiguous_route_target";       // INFO: Target ambiguo
```

### Backward compatibility

El campo `rejected` se mantiene por compatibilidad. Contiene los mismos issues bloqueados pero con menos información:

```typescript
rejected: [
  {
    sourceIssueKey: "AA-82",
    reason: "needs_route_profile: Route profile not found..."
  }
]
```

## Lógica de la UI

La UI debe interpretar el response de la siguiente manera:

### Escenario A: No hay issues Jira

```json
{
  "source": { "issuesFound": 0 },
  "scenarios": [],
  "blockedScenarios": []
}
```

**Mostrar**: "No hay escenarios con estado 'X' en el sprint activo."

### Escenario B: Hay issues Jira, pero todos bloqueados

```json
{
  "source": { "issuesFound": 1 },
  "scenarios": [],
  "blockedScenarios": [
    {
      "sourceIssueKey": "AA-82",
      "reasonCode": "needs_route_profile",
      "suggestedAction": "configure_route_profile"
    }
  ]
}
```

**Mostrar**:
- Header: "Se encontraron historias, pero no se pudieron generar escenarios."
- Lista de bloqueados:
  - `AA-82: Visualizar información del producto`
  - Razón: `needs_route_profile` (Falta routeProfile para la app seleccionada)
  - Acción sugerida: "Configurar perfil de rutas o ejecutar bootstrap de navegación"

### Escenario C: Hay issues Jira, algunos generados, algunos bloqueados

```json
{
  "source": { "issuesFound": 3 },
  "summary": { "generated": 2, "blocked": 1 },
  "scenarios": [ ... ],
  "blockedScenarios": [
    {
      "sourceIssueKey": "AA-100",
      "reasonCode": "missing_parent_route"
    }
  ]
}
```

**Mostrar**:
- Escenarios generados (2)
- Sección colapsable: "1 historia bloqueada"
  - `AA-100` con diagnostic y acción sugerida

### Escenario D: Todos los escenarios generados

```json
{
  "source": { "issuesFound": 5 },
  "summary": { "generated": 5, "blocked": 0 },
  "scenarios": [ ... ],
  "blockedScenarios": []
}
```

**Mostrar**: Escenarios generados normalmente.

## Acciones sugeridas por reasonCode

| reasonCode                     | suggestedAction                | Mensaje UI                                                                                      |
|--------------------------------|--------------------------------|-------------------------------------------------------------------------------------------------|
| `needs_route_profile`          | `configure_route_profile`      | "Falta routeProfile. Configura el perfil de rutas en `app.config.json` o ejecuta discovery." |
| `missing_parent_route`         | `add_parent_route`             | "La ruta padre (listado) no está definida. Agrega visibleControls al routeProfile."          |
| `missing_intermediate_step`    | `add_intermediate_steps`       | "Faltan pasos intermedios. Agrega intermediates al routeProfile."                              |
| `missing_detail_selection_step`| `review_route_profile`         | "Falta domainTerm para selección. Agrega domainTerms al routeProfile."                        |

## Logs de diagnóstico

Cuando routeProfile falta o está vacío, se generan los siguientes logs:

```
[route-profile] resolving routeProfile targetAppSlug=arquitectura-automatizacion requestRouteProfile=none
[route-profile] appConfig loaded=true hasRouteProfile=true
[route-profile] configRp found name=inferred_from_scenarios entry=1 aliases=0 domainTerms=0 visibleControls=51 entrySteps=1
[route-profile] source=app_config returning routeProfile name=inferred_from_scenarios
[scenario-route] resolving routes for 1 issues routeProfile=inferred_from_scenarios
[scenario-route] blocked issue=AA-82 reason=needs_route_profile diagnostics=1
[scenario-preview] route-backed issues=0 blocked=1
[scenario-preview] no route-backed issues, skipping AI generation
[scenarios:preview] blockedScenarios=1 from routeResolutions
```

Si routeProfile NO existe:
```
[route-profile] appConfig loaded=true hasRouteProfile=false
[route-profile] configRp=null after getRouteProfileFromConfig
[route-profile] source=default returning null routeProfile
```

Si routeProfile existe pero entry/aliases validation falla:
```
[route-profile] configRp found but entry/aliases validation failed - entry.length=0 aliases.keys=0
```

Cuando el fallback construye blockedScenarios desde rejected:
```
[scenarios:preview] blockedScenarios=0 from routeResolutions
[blocked-scenarios] added sourceIssueKey=AA-82 reasonCode=needs_route_profile source=rejected_fallback
[blocked-scenarios] fromRouteResolutions=0 fromRejectedFallback=1 total=1
```

## Ejemplo completo

Ver: `examples/blocked-scenario-response.json`

## Migración

### Backend

No se requieren cambios. El nuevo campo `blockedScenarios` es opcional y backwards compatible.

### Frontend

1. Detectar cuando `blockedScenarios` existe y tiene elementos:
   ```typescript
   if (response.blockedScenarios && response.blockedScenarios.length > 0) {
     // Mostrar mensaje de "Se encontraron historias, pero no se pudieron generar escenarios"
   }
   ```

2. No mostrar mensaje genérico "Sin escenarios para este filtro" cuando hay `blockedScenarios`.

3. Renderizar lista de blocked scenarios con:
   - Issue key + title
   - Reason code (user-friendly)
   - Suggested action link/button
