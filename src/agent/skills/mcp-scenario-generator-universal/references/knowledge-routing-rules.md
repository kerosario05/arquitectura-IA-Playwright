# Knowledge Routing Rules — Universal

## Source priority (highest to lowest)

| Priority | Source | When to use |
|---|---|---|
| 1 | HU textual content | Always — labels, fields, entities from HU text |
| 2 | `huExplicitRoutePath` | When HU has breadcrumb `A > B > C` |
| 3 | app.knowledge compatible | Filtered by intent/subIntent, trusted+validated only |
| 4 | `huModel` | Selectable entities, visible buttons, options from HU |
| 5 | routeProfile compatible | Only when routeProfile matches intent (catalog ↔ catalog intent) |
| 6 | routeProfile incompatible | `diagnostic_only` — do NOT use for allowedClicks/entrySteps |

## Priority

1. `validationStatus=validated` + `trustedForReuse=true` + `failureCount=0`
2. `source=mcp_runtime_observation` over `source=scenario_derived` / `preview_hu_analysis`
3. Runtime validated > runtime pending > preview pending

## Intent filtering

### balance_inquiry / loan_balance
**ALLOWED routes** (clickTargets containing):
- `consulta de balance`, `balance`, `préstamo`, `préstamos`, `transacciones`, `servicios`, `iniciar`

**EXCLUDED routes** (clickTargets containing):
- `generar cartas`, `carta de referencia`, `carta consular`, `carta bancaria`
- `información de productos`, `beneficios`, `requisitos`, `condiciones relevantes`, `solicitar`
- Exception: if HU text explicitly mentions these terms, they are allowed

**Penalty**: -80 score for excluded routes → they drop below MIN_SCORE

### document_generation
**ALLOWED routes**: `carta`, `certificación`, `constancia`, `comprobante`, `documento`, `generar`, `descargar`

**EXCLUDED routes**: `información de productos`, `catálogo`, `listado de productos`, `beneficios`, `requisitos`

### catalog_listing_flow
**ALLOWED routes**: `información de productos`, `productos`, `tarjetas`, `catálogo`

**EXCLUDED routes**: `carta`, `generar cartas`, `transferencia`, `pago`

### private/authenticated HUs (all non-catalog intents)
**Navigation prefix**: use `route_prefix` knowledge items for entry steps (e.g., `Iniciar → Transacciones y servicios`)

**DO NOT use** `routeProfile.entry` from `app.config.json` as required entry steps if entry is `Información de productos`

## Knowledge kind utilization

| knowledgeKind | How to use |
|---|---|
| `route_prefix` | Navigation prefix for ALL scenarios |
| `route_functional_observed` | Full route with steps — use as template |
| `route_menu_snapshot` | Click targets for navigation hints |
| `route_functional` | Validated functional route path |
| `scenario_validated` | Reusable scenario template |
| `scenario_candidate` | Reference only — not trusted for reuse |

## Compatibility checks

When selecting knowledge items:
1. Check `trustedForReuse === true` and `validationStatus === "validated"`
2. Check clickTargets against intent filter (allowed/excluded)
3. Score items (trust + validation + intent match + text similarity)
4. Select top 5 by score
5. Log rejected items

## routeProfile from app.config.json

- Compatibility is detected via **structural signals**, not label heuristics:
  - **High confidence**: targetPaths with productMetadata.subcategory, rich product groups (≥3), catalog entry labels
  - **Medium confidence**: targetPaths present (≥1), catalog-dominated visibleControls (≥30% catalog terms)
  - **Low confidence**: entry labels only, no structural metadata
- For **catalog** intents: use as navigation source and required entry validation
- For **private/balance/document** intents: `diagnostic_only`; do NOT impose entry steps, visibleControls, or allowedClicks
- For ALL intents: `visibleControls` is informational, not a validation source
- For new apps without metadata: fallback to heuristic with low confidence

## HU explicit route priority

When the HU text contains an explicit menu breadcrumb (e.g., `A > B > C`), these segments have **higher priority** than:
- Incompatible `routeProfile.entry` from `app.config.json` (e.g., "Información de productos" for a private balance HU)
- Knowledge routes that are tagged as incompatible by intent (penalized -80)

The explicit route is derived from the HU itself — it is the user's stated navigation path. It does NOT need external validation against routeProfile or allowedClicks.

**Merge rule**: Combine knowledge prefix + HU explicit route, deduplicating by normalized text:
```
knowledge prefix:   Iniciar → Transacciones y servicios
HU explicit route:  Consulta de balance → Préstamos
Result:             Clic en "Iniciar". Clic en "Transacciones y servicios".
                    Clic en "Consulta de balance". Clic en "Préstamos".
```

## Logging required

```
[knowledge-context] loaded history appSlug=<slug> items=<n>
[knowledge-context] candidates scanned=<n> eligible=<n> selected=<n> rejected=<n> huIntent=<intent>
[knowledge-context] rejected item kind=<kind> reason=intent_mismatch itemIntent=<itemIntent> huIntent=<huIntent>
```
