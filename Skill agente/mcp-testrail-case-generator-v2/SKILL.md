---
name: mcp-testrail-case-generator-v2
description: Generate or rewrite TestRail CSV scenarios that are compatible with MCP/web-ai-automation-runner discovery. Use when the user provides Jira stories, acceptance criteria, requirements, screenshots, or existing CSV cases and wants automation-friendly TestRail cases. Always produce the user's CSV format with numbered steps, no URL-opening steps, concrete visible targets, manual-login/modal steps when applicable, and split long requirements into small focused cases.
---

# MCP TestRail Case Generator V2

Generate TestRail scenarios that QA users can read and MCP can execute through discovery. The output must be functional, explicit, and importable as CSV.

## Mandatory output

Always create a downloadable `.csv` artifact unless the user explicitly asks for text-only output.

Use exactly this column order:

```csv
ID,Título,Pasos,Precondiciones,Resultado Esperado,Tipo,base de datos,is_converted
```

Rules:
- Quote every CSV field.
- For new cases, leave `ID` empty.
- Use Spanish by default.
- Use `Functional` for `Tipo` unless another type is required.
- Use `QA` for `base de datos` unless the user provides another value.
- Use `0` for `is_converted`.
- `Pasos`, `Precondiciones`, and `Resultado Esperado` may contain multiline numbered text.

## Step numbering

`Pasos` must always be numbered:

```text
1. Acción o validación.
2. Acción o validación.
3. Acción o validación.
```

`Precondiciones` should also be numbered.

## BASE_URL rule

Do not include steps like:

```text
Abrir URL...
Abrir el portal...
Navegar a la página...
```

The base URL belongs in `Precondiciones`, for example:

```text
1. La URL base de la aplicación está configurada en BASE_URL.
2. Portal web disponible y accesible.
```

Steps must start at the first functional action or visible validation.

## Case splitting rule

Do not turn a long user story into one giant case. Generate multiple focused rows.

Default target: 4 to 12 steps per case.

If a case exceeds 12 steps and is not explicitly E2E, split it or move setup to preconditions.

Separate cases for:
- catalog/list visibility
- category/filter behavior
- item detail
- add to cart
- remove from cart
- checkout required-field validation
- successful checkout
- confirmation modal
- login success
- login invalid/error

## Setup vs objective

Do not repeat long setup flows inside downstream cases. Move setup into `Precondiciones` when the case objective is not testing that setup.

Bad downstream case:

```text
1. Seleccionar categoría.
2. Seleccionar producto.
3. Clic en Add to cart.
4. Clic en Cart.
5. Clic en Place Order.
6. Validar cierre de confirmación.
```

Good downstream case:

```text
Precondiciones:
1. La URL base de la aplicación está configurada en BASE_URL.
2. Portal web disponible y accesible.
3. Existe una orden completada exitosamente.
4. El mensaje de confirmación está visible.

Pasos:
1. Clic en "OK".
2. Validar que no se muestre el mensaje de confirmación.
```

## Action wording rules

Use `Clic en` for visible buttons/links/actions.

Use `Seleccionar` for options, cards, categories, list items, radio options, products, accounts, countries, recipients, or other selectable items.

Use `Escribir el valor del dato "clave" en el campo "Campo".` for data entry.

Use `Validar que se muestre "Texto visible".` for concrete visible assertions.

Do not use vague wording:
- `Realizar el proceso.`
- `Continuar con el flujo.`
- `Verificar correctamente.`
- `Validar información.`
- `Pantalla relacionada con...`
- `Señal visible...` when a concrete text/field/button is known.

## Strong prohibition: dynamic list selection ambiguity

Never generate any of these patterns:

```text
Seleccionar el primer producto visible de la categoría "X".
Seleccionar el primer producto de la categoría "X".
Seleccionar la primera tarjeta visible de la categoría "X".
Seleccionar la primera tarjeta de producto visible después de filtrar por "X".
Seleccionar el primer resultado visible de la categoría "X".
```

These phrases make MCP confuse the category target with the product/card target.

Always split category selection from item/card selection:

```text
1. Seleccionar la categoría "Phones".
2. Seleccionar la primera tarjeta visible del listado de productos.
```

For another category, use the same neutral second step:

```text
1. Seleccionar la categoría "Laptops".
2. Seleccionar la primera tarjeta visible del listado de productos.
```

Do not mention the category again in the second step.

For non-product lists:

```text
1. Aplicar el filtro "Pendientes".
2. Seleccionar la primera tarjeta visible del listado de resultados.
```

## Login modes and manual login cases

If the story includes a case whose objective is to test login, generate manual-login steps. Do not depend on AuthGate/AuthFlow automatic behavior.

Required manual login pattern:

```text
1. Clic en "Log in".
2. Validar que se muestre el formulario de inicio de sesión con los campos "Username" y "Password".
3. Escribir el valor del dato "usuario_valido" en el campo "Username".
4. Escribir el valor del dato "contrasena_valida" en el campo "Password".
5. Clic en "Log in".
6. Validar que se muestre "Log out".
```

Preconditions must include:

```text
Datos requeridos: usuario_valido y contrasena_valida.
Flujo de autenticación automático: no_aplica; login manual por pasos del caso.
```

For invalid login:

```text
1. Clic en "Log in".
2. Validar que se muestre el formulario de inicio de sesión con los campos "Username" y "Password".
3. Escribir el valor del dato "usuario_invalido" en el campo "Username".
4. Escribir el valor del dato "contrasena_invalida" en el campo "Password".
5. Clic en "Log in".
6. Validar que se muestre un mensaje de credenciales inválidas.
7. Validar que no se muestre "Log out".
```

## Modal/dialog/form rule

When a click opens a modal, dialog, drawer, popup, or form, add an explicit validation step before filling fields.

For login:

```text
1. Clic en "Log in".
2. Validar que se muestre el formulario de inicio de sesión con los campos "Username" y "Password".
3. Escribir el valor del dato "usuario_valido" en el campo "Username".
```

For checkout/order:

```text
1. Clic en "Place Order".
2. Validar que se muestre el formulario de orden con los campos "Name", "Country", "City", "Credit card", "Month" y "Year".
3. Escribir el valor del dato "orden_nombre" en el campo "Name".
```

Never fill modal/form fields immediately after the opening click without validating that the modal/form appeared.

## Observable expected results

`Resultado Esperado` must use observable signals.

Good:

```text
Validar que la pantalla final muestre señales esperadas:
- "Thank you for your purchase!"
- "Amount"
- "Card Number"
```

Bad:

```text
La operación finaliza correctamente.
```

## Test data keys

Use snake_case keys:
- `usuario_valido`
- `contrasena_valida`
- `usuario_invalido`
- `contrasena_invalida`
- `orden_nombre`
- `orden_pais`
- `orden_ciudad`
- `orden_tarjeta`
- `orden_mes`
- `orden_anio`

## CSV validation

When creating the CSV artifact, use `scripts/write_mcp_testrail_csv.py` when possible. It validates key MCP compatibility rules and writes quoted CSV safely.

Before finalizing, check:
- exact columns
- numbered steps
- no URL-opening steps
- no forbidden dynamic-selection phrases
- manual login includes form validation before credential entry
- checkout includes order form validation before field entry
- no non-E2E case has more than 12 steps
