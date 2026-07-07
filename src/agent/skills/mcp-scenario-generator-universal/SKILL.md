---
name: mcp-scenario-generator-universal
description: Universal MCP scenario generator contract. Classifies HU intent, extracts coverage model, filters compatible knowledge routes, generates quality MCP scenarios with executable steps, and enforces minimum coverage rules. Use for ALL HU types — catalog, transaction, balance, document, payment, detail.
---

# MCP Scenario Generator — Universal Contract

Generate MCP-executable scenarios from any Jira HU/issue. Guarantees quality, coverage, and intent-aware routing.

## When to use

Always. Every scenario generation invocation must follow this contract. It replaces `mcp-testrail-case-generator-v2` for generation logic while keeping its CSV and app_config output patterns when requested.

## Mandatory flow

Follow these steps in order. Skip none.

### Step 1: Classify HU intent

Analyze the HU text (summary + description + acceptanceCriteria). Classify using `references/intent-classification.md` rules.

Key classification rules:
- `consulta de balance` + `préstamo` → `balance_inquiry` / `loan_balance`
- `generar carta` / `certificación` → `document_generation`
- `enviar por correo` / `imprimir` as post-options do NOT change the intent
- `generar tabla amortización` does NOT make the HU document_generation
- Priority: `loan_balance > document_generation` when both signals present

### Step 1.5: Extract explicit route path from HU (MANDATORY)

Before building the coverage model, extract any explicit menu breadcrumb from HU text.

**Detection**: Look for patterns like:
- `A > B` / `A → B` / `A / B`
- `menú: A > B` / `opción: A > B`
- `ruta: A > B > C` / `seleccionó en el menú: A > B`
- `navegación: A / B / C`

**Conversion**: Each segment becomes a mandatory MCP step:
```
Clic en "A".
Clic en "B".
Clic en "C".
```

**No hardcoding**: Extract generically. Do not hardcode "Consulta de balance", "Préstamos", or any specific label. The rule applies to ANY HU with a breadcrumb.

**Integration**: The extracted path has priority over incompatible routeProfile entry steps. It must be prepended to ALL generated scenarios as mandatory navigation prefix. Combine with validated knowledge prefix without duplication.

### Step 2: Extract coverage model

Build a coverage model from HU text using `references/scenario-coverage-rules.md`.

Must identify:
- Required screens (list, detail, form, confirmation, result)
- Required fields (`"Tipo de préstamo"`, `"Balance pendiente"`, etc.)
- Selectable entities (loan, card, account, product, deposit)
- Visible buttons (`"Volver"`, `"Enviar vía correo"`, `"Imprimir"`, etc.)
- Visible options / warnings
- Error flows (sin datos, sin selección, campos requeridos)
- Format obligations (moneda, fecha, porcentaje)

### Step 3: Resolve compatible knowledge

Use `references/knowledge-routing-rules.md`.

Rules:
- Prefer `validationStatus=validated` + `trustedForReuse=true` + `failureCount=0`
- Filter by intent: if `balance_inquiry`, exclude routes containing `carta|cartas|certificación|beneficios|requisitos|información de productos`
- `route_prefix` from validated knowledge provides navigation prefix (e.g., `Iniciar → Transacciones y servicios`)
- `route_functional_observed` and `route_menu_snapshot` provide clickTargets and steps
- `routeProfile` from `app.config.json` is diagnostic only for non-catalog intents — do NOT impose its entry steps, visibleControls, or allowedClicks
- routeProfile compatibility: detected via structural signals (targetPaths, productMetadata, entry labels, visibleControls) — not by checking a single label like "Información de productos"
- routeProfile is catalog-oriented when it has: rich targetPaths with product groups, productMetadata with subcategories, catalog-pattern entry labels, or catalog-dominated visibleControls
- Log: `routeProfile compatibility=<compatible|incompatible> intent=<intent> reason=score=N (signals...)`
- Log `rejected item reason=intent_mismatch` for excluded items
- Do NOT generate assertions for labels from routeProfile that are NOT in the HU text

### Step 4: Generate scenario plan

Determine scenario count target based on HU richness using `references/scenario-coverage-rules.md`:

- Simple HU (1-2 screens, few fields): minimum 3
- Medium HU (3+ screens, 5+ fields): minimum 5
- Rich HU (detail with financial fields, options, error cases): minimum 6
- HU with explicit error cases: generate happy path + validations + error cases

Target: `Math.max(minimum, huPlan.scenarioCountTarget ?? 0)`
Constraint: never generate less than 60% of target.

### Step 5: Generate MCP scenarios

Use `references/mcp-step-contract.md` for ALL step generation.

**CRITICAL — DO NOT USE these forbidden patterns:**
- `Seleccionar el primer elemento visible del listado.` → use entity name: `Seleccionar el primer préstamo visible del listado.`
- `Validar que se muestre "Nombre".` → use specific label from HU fields
- `Validar que funcione correctamente.` → reject
- `Validar que se muestre "Información".` → reject if HU has specific fields
- `Validar resultado esperado.` → reject
- `Completar datos requeridos.` → reject
- `Ejecutar acción de la HU.` → reject
- `Gestionar la solicitud.` → reject
- `Continuar con el flujo.` → reject

**Allowed patterns only:**
- `Clic en "X".`
- `Validar que se muestre "X".`
- `Validar que el botón "X" esté visible.`
- `Validar que el botón "X" esté habilitado/deshabilitado.`
- `Seleccionar el primer <domainTerm> visible del listado.`
- `Seleccionar el <ordinal> <domainTerm> visible del listado.`
- `Ingresar "<campo>" usando <dataKey>.`
- `Ingresar "<valor>" en "<campo>".`

Step numbering: `"1. Clic en..."`, `"2. Validar..."` — always numbered.

### Step 6: Validate quality

Before output, validate all scenarios:
1. Every step matches an allowed MCP pattern
2. No forbidden patterns or abstract phrases
3. Labels come from HU text, not generic placeholders
4. Selection steps include entity name, never "elemento"
5. Entry steps use knowledge-validated prefix (not catalog routeProfile for private HUs)
6. Coverage meets minimum target
7. Format obligations (moneda/fecha/porcentaje) are explicitly validated

If any scenario fails quality, reject it with reason. If all fail, report `quality_gate_failed` and output the `rejected` array.

## Output rules

- Return JSON array of scenarios
- Each scenario has: `sourceIssueKey`, `title`, `steps` (numbered), `expectedResult`, `routeProfile`
- Add `mcpExecutable: true` for UI-automatable only
- Add `automationType: "ui_discovery"`, `setupStrategy: "no_login"`
- Rejected scenarios go to `rejected` array with `reason` field

**Expected Result**: Must be short contextual phrase. NOT a source of executable steps. Context only.

**Important**: The pipeline automatically repairs AI-generated scenarios by injecting the required navigation prefix (knowledge prefix + HU explicit route) if missing. You do NOT need to manually add these steps — the system guarantees they are present before validation. Focus on generating correct functional steps *after* the navigation prefix.

## References

- `references/intent-classification.md` — HU intent classification rules
- `references/scenario-coverage-rules.md` — Coverage targets and scenario types
- `references/mcp-step-contract.md` — Allowed and forbidden step patterns
- `references/knowledge-routing-rules.md` — Knowledge and routeProfile compatibility
- `references/examples.md` — Bad vs good scenario generation examples
