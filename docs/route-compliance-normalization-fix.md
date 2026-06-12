# Route Compliance Normalization Fix

## Objetivo

Corregir el validator post-generación para que permita entry steps técnicos válidos y haga matching robusto de acentos/encoding, sin relajar la protección contra clicks inventados.

## Problemas Resueltos

### 1. Entry Steps Técnicos Rechazados
**Problema**: "Iniciar" era rechazado porque es un entry step técnico agregado por `newEntrySteps`, pero no llegaba a `allowedExecutableClicks` antes del compliance validator.

**Solución**: 
- Actualizado `buildDerivedExecutionContext` para aceptar parámetro opcional `additionalEntryTargets`
- `codex-scenario-generator.ts` extrae targets de `entrySteps` y los pasa al context builder
- `mcp-scenario-prompt-builder.ts` también extrae y pasa estos targets
- Entry steps ahora incluidos en `allowedExecutableClicks` antes de la validación

### 2. Mojibake/Encoding Mismatch
**Problema**: "Información de productos" aparecía como mojibake "InformaciÃ³n de productos" y no matcheaba.

**Solución**:
- Creado módulo `target-normalization.ts` con helpers de normalización robusta:
  - `normalizeTarget()`: trim, lowercase, remove accents, fix mojibake, collapse whitespace
  - `targetsMatch()`: compara dos targets con normalización
  - `findTargetInList()`: busca target en lista con normalización
  - `detectMojibake()`: detecta y corrige patrones comunes
  - `buildNormalizedLookup()`: crea map para matching rápido

- Actualizado `scenario-route-compliance-validator.ts`:
  - `isTargetBacked()` ahora retorna `{ backed, canonicalTarget, matchStrategy }`
  - Implementa 5 estrategias de matching:
    1. exact_match
    2. normalized_accent (acentos diferentes)
    3. normalized_mojibake (encoding corrupto)
    4. alias_exact / alias_normalized
    5. reverse_alias / alias_canonical_normalized
  - Diagnostics mejorados con información de matching strategy

### 3. Protection Preservada
**Importante**: Clicks no respaldados siguen siendo rechazados, incluso después de normalización. La normalización solo ayuda a matchear targets legítimos que tienen variaciones de encoding/acentos.

## Archivos Modificados

### Nuevos Módulos

#### `src/scenarios/target-normalization.ts` (126 líneas)
- **Función**: Normalización robusta de targets para matching
- **Exports**:
  - `normalizeTarget(target: string): string`
  - `targetsMatch(a: string, b: string): boolean`
  - `findTargetInList(target: string, allowedTargets: string[]): string | null`
  - `detectMojibake(target: string): { hasMojibake: boolean, corrected: string }`
  - `buildNormalizedLookup(targets: string[]): Map<string, string>`
- **Mojibake patterns**: InformaciÃ³n → Información, DepÃ³sitos → Depósitos, etc.

### Módulos Actualizados

#### `src/scenarios/route-profile-derived-context.ts`
**Cambios**:
- `deriveAllowedExecutableClicks()` acepta parámetro opcional `additionalEntryTargets`
- Incluye additional entry targets en allowed clicks
- `buildDerivedExecutionContext()` acepta parámetro opcional `additionalEntryTargets`
- Pasa additional entry targets a `deriveAllowedExecutableClicks()`

#### `src/scenarios/scenario-route-compliance-validator.ts`
**Cambios**:
- Importa helpers de `target-normalization`
- `isTargetBacked()` ahora retorna objeto con `backed`, `canonicalTarget`, `matchStrategy`
- Implementa 5 estrategias de matching (exact, normalized_accent, normalized_mojibake, alias_exact, alias_normalized)
- `validateScenarioCompliance()` usa nuevo `isTargetBacked()` y `targetsMatch()`
- Diagnostics mejorados:
  - Log de match strategy cuando no es exact match
  - Log de mojibake detection y corrección
  - Log de normalized target y allowed sample cuando se rechaza
- Assertion-only check usa `targetsMatch()` en lugar de `includes()`

#### `src/scenarios/codex-scenario-generator.ts`
**Cambios**:
- Extrae `additionalEntryTargets` de `entrySteps` parameter
- También extrae de old-style `routeProfile.entry`
- Pasa `additionalEntryTargets` a `buildDerivedExecutionContext()`
- Log: `[scenario-route] additionalEntryTargets=[...]`

#### `src/scenarios/mcp-scenario-prompt-builder.ts`
**Cambios**:
- Extrae `additionalEntryTargets` de `entrySteps` parameter
- Pasa `additionalEntryTargets` a `buildDerivedExecutionContext()`

## Tests Agregados

### `tests/target-normalization.spec.ts` (14 tests)
- ✅ normalizes accents correctly
- ✅ normalizes mojibake patterns
- ✅ collapses whitespace
- ✅ handles mixed case and accents
- ✅ targetsMatch returns true for matching targets
- ✅ targetsMatch returns false for non-matching targets
- ✅ findTargetInList finds exact match
- ✅ findTargetInList finds normalized match
- ✅ findTargetInList finds mojibake match
- ✅ findTargetInList returns null for no match
- ✅ detectMojibake identifies mojibake patterns
- ✅ detectMojibake returns false for clean text
- ✅ buildNormalizedLookup creates correct map
- ✅ buildNormalizedLookup handles duplicates

**Resultado**: 14 passed (1.2s)

### `tests/scenario-route-compliance-validator.spec.ts` (4 tests nuevos, 12 total)
- ✅ entry step target is allowed via additionalEntryTargets
- ✅ mojibake target matches via normalization
- ✅ accent-insensitive matching works
- ✅ unbacked click still rejected after normalization

**Resultado**: 12 passed (1.1s)

## Logs Mejorados

### Matching Exitoso (info level)
```
[scenario-compliance] appSlug=app-a issue=AA-82 scenario="..." valid=true
[scenario-compliance] Click target "InformaciÃ³n de productos" matched via normalized_mojibake (canonical: "Información de productos")
```

### Matching Fallido (error level)
```
[scenario-compliance] rejected issue=AA-82 target="Contenido X" reasonCode=unbacked_click_target message=Click target "Contenido X" is not backed by route profile. Not found in allowedExecutableClicks. Normalized: "contenido x". Allowed sample: [Iniciar, Información de productos, Depósitos, Crédito, Préstamos]
```

### Additional Entry Targets
```
[scenario-route] additionalEntryTargets=["Iniciar","Información de productos"]
```

## Match Strategies

1. **exact_match**: Target exactamente igual a allowed click
2. **normalized_accent**: Target matchea después de normalizar acentos/case
3. **normalized_mojibake**: Target matchea después de corregir mojibake
4. **alias_exact**: Target es alias exacto de allowed click
5. **alias_normalized**: Target es alias que matchea con normalización
6. **reverse_alias**: Target es canonical form de un alias
7. **alias_canonical_normalized**: Target matchea canonical alias form con normalización

## Criterios de Validación

### ✅ Permitidos
- Entry steps técnicos (de `newEntrySteps`/`entrySteps`)
- Entry steps de profile (`routeProfile.entry`)
- Visible controls (`routeProfile.visibleControls`)
- Executable route steps (`routeResolutions.executableRouteSteps`)
- Aliases respaldados (`routeProfile.aliases`)
- Todos con variaciones de acentos/encoding/case

### ❌ Rechazados
- Clicks no respaldados por ninguna fuente
- Assertion-only terms usados como clicks
- Sensitive actions clickeadas (solo validaciones permitidas)

## Backward Compatibility

✅ **Totalmente compatible**:
- El parámetro `additionalEntryTargets` es opcional
- Si no se provee, funciona como antes
- Tests existentes pasan sin cambios
- No se requiere migración de datos

## Comandos de Validación

```bash
# Typecheck
npm run typecheck
# Output: 0 errors

# Tests
npm run test:framework -- target-normalization.spec.ts
# Output: 14 passed (1.2s)

npm run test:framework -- scenario-route-compliance-validator.spec.ts
# Output: 12 passed (1.1s)

npm run test:framework -- route-profile-derived-context.spec.ts
# Output: 8 passed (1.3s)

# Tests existentes no rotos
npm run test:framework
# Output: All tests pass
```

## Ejemplo de Uso

### Antes (Rechazaba entry steps y mojibake)
```
[scenario-compliance] rejected issue=AA-82 target="Iniciar" reasonCode=unbacked_click_target
[scenario-compliance] rejected issue=AA-82 target="InformaciÃ³n de productos" reasonCode=unbacked_click_target
```

### Después (Permite con normalización)
```
[scenario-route] additionalEntryTargets=["Iniciar","Información de productos"]
[route-profile-derived] appSlug=arquitectura-automatizacion allowedClicks=22 assertionTerms=0 sensitiveActions=1 confidence=high
[scenario-compliance] appSlug=arquitectura-automatizacion issue=AA-82 scenario="..." valid=true
[scenario-compliance] Click target "InformaciÃ³n de productos" matched via normalized_mojibake (canonical: "Información de productos")
```

## Resumen Ejecutivo

**Problema**: 
1. Entry steps técnicos rechazados porque no estaban en allowedExecutableClicks
2. Mojibake/encoding issues causaban mismatch de targets legítimos

**Solución**: 
1. Pasar additional entry targets a buildDerivedExecutionContext
2. Normalización robusta con 5+ estrategias de matching
3. Diagnostics mejorados con match strategy logging

**Resultado**:
- ✅ Entry steps técnicos permitidos
- ✅ Mojibake/accents/case handled correctamente
- ✅ Clicks no respaldados siguen rechazados
- ✅ 14 tests nuevos de normalización
- ✅ 4 tests nuevos de compliance
- ✅ Typecheck limpio
- ✅ Backward compatible
- ✅ Multi-proyecto (sin hardcode)
