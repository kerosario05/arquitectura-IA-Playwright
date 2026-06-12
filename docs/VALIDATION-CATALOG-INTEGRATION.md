# Validación de Implementación - Catalog Discovery en QA Lab

## Estado: ✅ VALIDADO CON MEJORAS APLICADAS

## 1. ✅ Escenarios según HU seleccionada (alcance no expandido)

**Confirmación:**
- Seeds solo complementan productos NO cubiertos por IA (líneas 56-79 de `scenario-deterministic-seeds.ts`)
- IA genera escenarios según HU (define el alcance)
- Seeds detectan productos ya cubiertos y los omiten
- Seeds solo agregan escenarios para productos descubiertos pero NO mencionados

**Mejora aplicada:**
- Documentación clarificada: "Seeds are generated ONLY for products aligned with HU scope (AI scenarios define the scope)"
- Énfasis: "exhaustive means all products mentioned/implied by HU, NOT all products in global catalog"

**Archivos actualizados:**
- `src/scenarios/scenario-deterministic-seeds.ts` (líneas 3-29)

---

## 2. ✅ coverageMode="exhaustive" significa cobertura alineada con HU

**Confirmación:**
- `exhaustive` = cubrir todos los targetPaths alineados con la HU
- NO significa cubrir todo el catálogo global
- Seeds solo generan para productos en routeProfile.targetPaths que IA no cubrió
- **NUEVO:** HU scope filtering implementado con heurísticas multiproject-safe

**Mejora aplicada:**
- Documentación `.env.example` clarificada:
  ```bash
  # - exhaustive: AI + deterministic seeds cover ALL products aligned with HU scope
  #   (NOT entire global catalog, only products relevant to the user story)
  ```
- **HU Scope Filter implementado (`scenario-hu-scope-filter.ts`, 344 líneas):**
  - Construye corpus HU desde summary/description/acceptanceCriteria/labels/components
  - Extrae keywords con filtrado de stop words y normalización de diacríticos
  - Matching multimodal: directo/domainTerms/aliases
  - Alignment score con threshold 30%
  - Fallback graceful cuando no hay matches (retorna todos con warning)

**Ejemplo de HU scope filtering:**
```typescript
// HU: "Visualizar tarjetas de crédito"
// Catálogo: Tarjetas, Cuentas, Préstamos

const { alignedTargetPaths, diagnostics } = filterTargetPathsByIssueScope(
  issueContext,
  routeProfile.targetPaths,
  routeProfile
);

// Result:
// alignedProducts: 2 (solo Tarjeta Visa, Tarjeta Mastercard)
// filteredOut: 2 (Cuenta Ahorros, Préstamo Personal)
// matchedKeywords: ["tarjetas", "credito", "visa", "mastercard"]
```

**Archivos actualizados:**
- `.env.example` (líneas 154-157)
- `src/scenarios/scenario-deterministic-seeds.ts` (lines 52-68): integra filterTargetPathsByIssueScope
- **NUEVO:** `src/scenarios/scenario-hu-scope-filter.ts` (344 líneas completas)

**Tests agregados:**
- `tests/scenario-hu-scope-filter.spec.ts` (6 tests, all passing):
  1. HU de tarjetas + catálogo mixto → seeds solo tarjetas
  2. HU amplia productos → permite múltiples categorías
  3. HU genérica sin match → fallback con warning
  4. No issue context → fallback con warning
  5. domainTerms con sinónimos (credit↔crédito, card↔tarjeta)
  6. aliases con normalización (info productos→Información de productos)

---

## 3. ✅ catalogMode soporta comportamiento "auto" (mejorado)

**Estado anterior:**
- ✅ `catalogMode="existing"` reutiliza catálogo si existe
- ✅ `catalogMode="existing"` ejecuta discovery si no existe
- ✅ `catalogMode="refresh"` fuerza refresh
- ❌ No detectaba catálogo stale/incompleto

**Mejora aplicada:**
- Detección de staleness agregada (>7 días)
- `catalogMode="existing"` ahora refresca automáticamente si catálogo es stale
- Logs detallados de razón de discovery: `user_requested_refresh`, `no_existing_products`, `catalog_stale`

**Comportamiento actualizado:**
```typescript
const needsDiscovery =
  options.catalogMode === "refresh" ||
  (options.catalogMode === "existing" && existingProducts.length === 0) ||
  (options.catalogMode === "existing" && isStale); // NUEVO
```

**Archivos actualizados:**
- `src/scenarios/scenario-catalog-context.ts` (líneas 56-98)

---

## 4. ✅ Deterministic seeds pasan por normalizer/validator

**Confirmación:**
1. Seeds agregados a `rawScenarios` (línea 561)
2. Normalizados encoding mojibake (línea 688)
3. Validados con `validateScenario()` (línea 693)
4. Agregados a `validated` con validation result (línea 704)

**Flujo completo:**
```
generateDeterministicSeeds()
  → rawScenarios.push(...seeds)
  → encodingNormalized = rawScenarios.map(detectMojibake)
  → for each scenario: validateScenario(sc, resolvedRouteProfile)
  → validated.push({ ...sc, validation })
```

**Archivos verificados:**
- `src/scenarios/scenario-preview.service.ts` (líneas 548-705)

---

## 5. ✅ Prueba de integración del flujo real (creada)

**Archivo creado:**
- `tests/scenario-preview-catalog-integration.spec.ts`

**Tests incluidos (9 totales):**
1. Full flow: generateScenarioPreview con catalog enrichment (sin ejecución)
2. Catalog enrichment no expande alcance HU
3. catalogMode=existing reutiliza cache sin discovery
4. catalogMode=existing trigger discovery para catalog stale
5. catalogMode=refresh fuerza re-discovery
6. coverageMode=exhaustive agrega seeds para productos no cubiertos
7. coverageMode=representative no agrega seeds
8. Discovery failure fallback graceful
9. No specs escritos durante fase "Generate scenarios"

**Validaciones críticas:**
- ✅ catalogDiagnostics presente en response
- ✅ NO archivos .spec.ts escritos
- ✅ NO evidencias generadas
- ✅ NO llamadas TestRail API
- ✅ NO ejecución de tests promovidos

**Resultado:** 9 passed (2.5s)

---

## 6. ✅ Ejemplo real de catalogDiagnostics (documentado)

**Archivo creado:**
- `docs/catalog-diagnostics-examples.md`

**Ejemplos incluidos:**
1. Successful discovery with refresh
2. Reusing existing catalog
3. Discovery disabled by request
4. Discovery failure (graceful fallback)
5. No routeProfile available
6. Stale catalog triggers refresh
7. Exhaustive coverage with seeds

**Ejemplo representativo:**
```json
{
  "catalogUsed": true,
  "discoveryRefreshed": true,
  "discoveredProductCount": 10,
  "representativeProductCount": 10,
  "discoveryTimestamp": "2026-06-11T18:30:45.123Z",
  "warnings": []
}
```

---

## 7. ✅ Tests ejecutados exitosamente

### Typecheck
```bash
npm run typecheck
✅ 0 errors
```

### Catalog Context Tests
```bash
npm run test:framework -- scenario-catalog-context.spec.ts
✅ 6 passed (3.7s)
```

Tests:
1. disabled by request returns original routeProfile
2. no routeProfile returns gracefully
3. existing mode with products uses existing catalog
4. existing mode without products triggers discovery
5. refresh mode triggers discovery even with existing products
6. discovery failure returns fallback diagnostics

### Deterministic Seeds Tests
```bash
npm run test:framework -- scenario-deterministic-seeds.spec.ts
✅ 10 passed (1.4s)
```

Tests:
1. representative mode returns no seeds
2. exhaustive mode with no products returns no seeds
3. exhaustive mode with null routeProfile returns no seeds
4. generates seed for uncovered detail_page product
5. generates seed for uncovered product_card (clickable)
6. generates seed for uncovered product_card (not clickable)
7. skips products already covered by AI scenarios
8. skips products covered by validation steps in AI scenarios
9. generates multiple seeds for multiple uncovered products
10. seed scenarios have required fields for validation

### HU Scope Filter Tests
```bash
npm run test:framework -- scenario-hu-scope-filter.spec.ts
✅ 6 passed (1.3s)
```

Tests:
1. HU de tarjetas + catálogo tarjetas/cuentas/préstamos → seeds solo tarjetas
2. HU amplia 'información de productos' → puede usar varias categorías
3. HU sin match claro → warning y fallback a todos los productos
4. no issue context → fallback a todos los productos con warning
5. domainTerms ayuda con sinónimos (tarjeta → card, crédito → credit)
6. aliases ayuda con normalización (info productos → información de productos)

### Catalog Integration Tests
```bash
npm run test:framework -- scenario-preview-catalog-integration.spec.ts
✅ 9 passed (2.5s)
```

---

## Archivos Creados/Modificados

### Nuevos Archivos:
1. `src/scenarios/scenario-catalog-context.ts` (134 líneas)
2. `src/scenarios/scenario-deterministic-seeds.ts` (224 líneas)
3. `src/scenarios/scenario-hu-scope-filter.ts` (344 líneas) **NUEVO**
4. `tests/scenario-catalog-context.spec.ts` (6 tests)
5. `tests/scenario-deterministic-seeds.spec.ts` (10 tests)
6. `tests/scenario-hu-scope-filter.spec.ts` (6 tests) **NUEVO**
7. `tests/scenario-preview-catalog-integration.spec.ts` (9 tests)
8. `docs/catalog-diagnostics-examples.md` (7 ejemplos)

### Archivos Modificados:
1. `src/scenarios/scenario-types.ts` (tipos extendidos)
2. `src/scenarios/scenario-preview.service.ts` (integración)
3. `.env.example` (documentación)

---

## Garantías de Implementación

### ✅ Multiproject-Safe
- NO hardcoded appSlug/products/categories
- Todo basado en routeProfile.targetPaths
- Funciona para cualquier app

### ✅ Alcance Controlado por HU
- Seeds solo complementan lo que IA genera
- Exhaustive = todos los productos alineados con HU
- NO todo el catálogo global

### ✅ Enrichment Phase ONLY
- Discovery runs durante "Generate scenarios"
- NO execution/evidence/TestRail durante discovery
- Specs escritos en fase separada (si usuario ejecuta)

### ✅ Graceful Fallback
- Discovery failure no rompe scenario generation
- catalogDiagnostics incluye warnings/fallbackReason
- Sistema continúa con routeProfile sin productos

### ✅ Staleness Detection
- Catálogo >7 días se considera stale
- Auto-refresh en modo "existing"
- Logs claros de razón de discovery

---

## Conclusión

**Estado:** ✅ IMPLEMENTACIÓN VALIDADA Y LISTA PARA CIERRE

**Tests:** 31/31 passing
- Catalog Context: 6/6 ✅
- Deterministic Seeds: 10/10 ✅
- HU Scope Filter: 6/6 ✅
- Integration: 9/9 ✅

**Typecheck:** ✅ 0 errors

**Documentación:** ✅ Completa
- Código documentado con docstrings
- `.env.example` actualizado
- Ejemplos de catalogDiagnostics
- Tests de integración con specs detalladas

**Comportamiento:**
- ✅ Escenarios alineados con HU
- ✅ Exhaustive = alcance HU con filtrado heurístico
- ✅ HU scope filtering multiproject-safe (keywords, domainTerms, aliases)
- ✅ catalogMode="existing" = comportamiento "auto" mejorado
- ✅ Seeds pasan por normalizer/validator
- ✅ NO execution durante enrichment
- ✅ Graceful fallback
- ✅ Multiproject-safe
