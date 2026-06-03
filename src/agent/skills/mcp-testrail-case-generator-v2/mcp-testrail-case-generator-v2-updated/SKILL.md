---
name: mcp-testrail-case-generator-v2
description: Generate MCP/web-ai-automation-runner-ready TestRail CSV cases and routeProfile/app_config artifacts. Use when the user provides Jira stories, acceptance criteria, appSlug/routeProfile metadata, screenshots, existing TestRail cases, or asks for MCP automation-friendly scenarios. Generate only UI-automatable cases by default, with executable numbered steps, visible targets, routeProfile aliases/intermediates/domainTerms, setupStrategy, automationType, appSlug metadata, dataRequirements, app.config.json, and validators that reject manual/backend/conceptual scenarios.
---

# MCP TestRail Case Generator V2

Generate a complete MCP-ready package for TestRail scenarios that `web-ai-automation-runner` can execute through UI discovery and promote to Playwright specs. Default behavior is **MCP-automated only**.

## Mandatory output

Unless the user explicitly asks for text-only output, create these downloadable artifacts:

1. CSV of MCP-automated TestRail scenarios.
2. `app_config.json` with `appSlug` and nested `routeProfile` object.
3. Standalone `route_profile_<app>_<profile>.json` for legacy validator compatibility when useful.
4. `scripts/validate_testrail_csv.py` compatible with nested app_config.
5. `scripts/validate_mcp_steps.py` compatible with nested app_config.
6. Optional short `README.md` with validation and discovery commands.

## CSV schema

Use this column order unless the user gives a different TestRail-compatible schema:

```csv
ID,Título,Pasos,Precondiciones,Resultado Esperado,Tipo,base de datos,is_converted,automationType,setupStrategy,appSlug,routeProfile,dataRequirements,nonExecutableCriteria,mcpExecutable
```

Rules:
- Quote every CSV field.
- Preserve existing TestRail IDs when provided; otherwise leave `ID` empty.
- Use Spanish by default.
- Use `Functional` for `Tipo`, `QA` for `base de datos`, and `0` for `is_converted` unless provided otherwise.
- Number `Pasos` and `Precondiciones` when multiline.
- `mcpExecutable` must be `true` for every generated row.
- `nonExecutableCriteria` must be empty or contain only non-blocking notes.
- Do not generate cases that are primarily manual, backend-only, conceptual, security-sensitive, exact-calculation dependent, DB dependent, log/audit dependent, or Core/API validation dependent.

## app_config format

Generate `app_config.json` with this required shape:

```json
{
  "appSlug": "<app-slug>",
  "routeProfile": {
    "name": "<route-profile-name>",
    "entry": [
      {"businessLabel": "<business_key>", "visibleLabel": "<texto visible>"}
    ],
    "aliases": {
      "<business_key>": "<texto visible o fragmento estable>"
    },
    "intermediates": {
      "<route_key>": ["<texto visible intermedio 1>", "<texto visible intermedio 2>"]
    },
    "domainTerms": {
      "<route_key>": "<termino de dominio singular>"
    },
    "visibleControls": ["<texto visible control 1>"],
    "representativeFixture": {
      "default": "<fixture_key>",
      "empty": "<fixture_key>",
      "single": "<fixture_key>"
    },
    "notes": ["<nota no bloqueante>"]
  }
}
```

Critical rules:
- `routeProfile` in `app_config.json` must be an object, never a string.
- `routeProfile.name` is the profile name used by the CSV `routeProfile` column.
- Put `entry`, `aliases`, `intermediates`, `domainTerms`, `visibleControls`, `representativeFixture`, and `notes` inside `routeProfile`.
- If an existing app config is provided, preserve unrelated keys and update only `routeProfile` unless the user asks otherwise.
- Keep standalone routeProfile JSON only for validation/backward compatibility; validators must primarily support nested `app_config["routeProfile"]`.

## MCP-automated-only policy

Only generate scenarios MCP can execute automatically by UI using discovery, AuthGate, routeProfile, recovery, Auto-POM, promotion, and Playwright specs.

Allowed `automationType` values:
- `ui_discovery`
- `ui_with_auth_gate`
- `ui_with_controlled_data`
- `ui_with_auth_gate_controlled_data`

Allowed `setupStrategy` values:
- `self_contained`
- `auth_gate`
- `controlled_data`
- `no_login`

Do not generate cases with manual/backend-only validation, exact financial calculation validation, database validation, integration/Core Banking validation, logs/audit validation, token/session technical validation, manual OCR/visual interpretation, or invisible business rules.

## Source of execution

`Pasos` is the only executable source for MCP.

`Resultado Esperado` must be one short, non-blocking contextual sentence. It must not introduce additional validation targets, backend assertions, or new UI text.

Correct:
```text
El cliente visualiza el detalle del depósito a plazo seleccionado.
```

Incorrect:
```text
Se muestra Volver, Imprimir, Enviar vía correo y el saldo coincide con Core Banking.
```

## Allowed step patterns

Every step must be numbered and match one of these patterns:

```text
Clic en "X".
Validar que se muestre "X".
Validar que el botón "X" esté visible.
Validar que el botón "X" esté habilitado.
Validar que el botón "X" esté deshabilitado.
Validar que la opción "X" esté disponible.
Esperar que se muestre "X".
Seleccionar el primer <domainTerm> visible del listado.
Seleccionar la primera <domainTerm> visible del listado.
Seleccionar el último <domainTerm> visible del listado.
Ingresar <campo> usando <dataKey>.
```

Never write literal credentials, OTPs, card numbers, account numbers, PINs, or sensitive data in steps.

Forbidden step phrases include:
- `El sistema permite`
- `El cliente accede`
- `Validar correctamente`
- `Verificar que funcione`
- `Se procesa exitosamente`
- `Según configuración`
- `Cuando aplique`
- `Validar backend`
- `Validar Core Banking`
- `Validar base de datos`
- `Validar cálculo exacto`
- `Validar reglas de negocio`
- `Validar integración`
- `Validar auditoría`
- `Validar que se registró`

## Visible labels and stable fragments

Executable quoted targets must exist in one of:
- `routeProfile.entry[].visibleLabel`
- `routeProfile.aliases` values
- `routeProfile.visibleControls`
- stable message fragments stored in `routeProfile.aliases`

For return/back actions prefer short visible labels:
- `Volver`
- `Volver al menú`
- `Volver al Listado`
- `Regresar`
- `Atrás`

Do not invent long return labels like `Volver al menú principal` or `Volver al listado de depósitos a plazos` unless they are explicitly present in `aliases` or `visibleControls`.

For long alerts/errors/warnings, use stable fragments in aliases, for example:
- `vence próximamente`
- `no está disponible`
- `Información no disponible`
- `No fue posible validar`

## AuthGate/AuthFlow

For authenticated cases, never generate manual login, identification, phone, PIN, or OTP steps unless the test objective is specifically login itself.

Put AuthGate in preconditions:
```text
1. BASE_URL configurado.
2. App disponible.
3. APP_LOGIN_MODE=password.
4. AuthGate/AuthFlow habilitado para autenticación por la ruta autenticada.
5. Cliente de prueba cumple dataRequirements.
6. App Slug: <appSlug>.
7. Route Profile: <routeProfile>.
8. Setup Strategy: auth_gate.
9. Automation Type: ui_with_auth_gate.
10. Data Requirements: <fixture_key>.
```

Auth data must come from configuration such as `Identity_Provider`, `OTP_SECRET`, `APP_USERNAME`, `APP_PASSWORD`, and `APP_TEST_DATA_JSON`.

## Data requirements

Only generate cases with clear, preparable data fixtures. Use snake_case fixture keys.

Examples:
- `cliente_deposito_plazo_multiple_activo`
- `cliente_deposito_plazo_unico_activo`
- `cliente_sin_depositos_plazo`
- `cliente_deposito_plazo_proximo_vencer`
- `cliente_cuenta_ahorro_pesos_activa`
- `cliente_tarjeta_credito_activa`
- `cliente_prestamo_personal_activo`

If a case depends on a special state and no realistic `dataRequirements` key exists, omit the case.

## Scenario design rules

1. Generate only MCP-automated scenarios.
2. Separate list cases from detail cases.
3. If a title says `visualizar listado`, do not select an item.
4. If the case selects an item, the title must say `visualizar detalle`, `seleccionar item`, or `consultar detalle`.
5. If routeProfile defines intermediates, include them explicitly.
6. Use `routeProfile.domainTerms` for ordinal selection nouns.
7. Do not use an incorrect domain term, for example `tarjeta` in account/deposit/loan scenarios.
8. If only checking action availability, assert visibility instead of clicking.
9. Do not click sensitive actions unless the objective is explicit and safe.
10. Negative scenarios are allowed only when the error/empty state is visible by UI and dataRequirements is realistic.
11. Do not generate negatives that require expiring tokens, altering backend, simulating outages, manipulating network, changing DB, or inspecting logs.

Sensitive actions include `Pagar`, `Transferir`, `Enviar dinero`, `Confirmar operación`, `Aceptar contrato`, `Firmar`, `Eliminar`, `Cancelar producto`, `Solicitar producto financiero`, `Debitar`, and `Aprobar`.

## Validators

Always include validators compatible with nested `app_config["routeProfile"]`.

Validators must use helpers equivalent to:

```python
def get_profile(config):
    return config.get("routeProfile", config)

def get_app_slug(config):
    profile = get_profile(config)
    return config.get("appSlug") or profile.get("appSlug")

def get_visible_labels(config):
    profile = get_profile(config)
    labels = set()
    for item in profile.get("entry", []):
        if item.get("visibleLabel"):
            labels.add(item["visibleLabel"])
    for value in profile.get("aliases", {}).values():
        if value:
            labels.add(value)
    for value in profile.get("visibleControls", []):
        if value:
            labels.add(value)
    return labels
```

`validate_testrail_csv.py` must validate:
- required columns
- appSlug equals app_config.appSlug
- routeProfile equals app_config.routeProfile.name
- allowed automationType and setupStrategy
- mcpExecutable=true
- numbered steps
- quoted targets exist in visible labels/aliases/visibleControls
- expected result does not introduce executable targets
- no conceptual/backend/manual phrases in steps
- dataRequirements exists when automationType includes controlled_data
- nonExecutableCriteria has no backend/manual/calculation obligation

`validate_mcp_steps.py` must validate:
- MCP step syntax
- supported verbs
- quoted targets
- intermediate order when routeProfile.intermediates defines a route
- ordinal selection domainTerms
- list cases do not select items
- detail cases select items when the title says detail/consultar

Passing output format:
```text
PASS validate_testrail_csv: <n> rows, appSlug=<appSlug>, routeProfile=<routeProfileName>
PASS validate_mcp_steps: <n> rows, MCP step syntax OK
```

Failing output format:
```text
FAIL
- row <n> <error>: <title>
```

## README

Include a short README with:

```bash
python validate_testrail_csv.py escenarios.csv --route-profile app_config.json
python validate_mcp_steps.py escenarios.csv --route-profile app_config.json
npm.cmd run discovery:case -- --case-id <ID> --app <appSlug> --headed --overwrite --auto-promote --auto-pom
```

## Final response

Final chat response must include:
- `App slug detectado`
- `Confianza`
- `Motivo`
- `Ruta funcional esperada`
- validator summary when validators were run
- links to CSV, app_config JSON, standalone routeProfile JSON if generated, validators, README, and updated skill package when applicable
