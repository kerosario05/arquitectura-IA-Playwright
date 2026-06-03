# MCP TestRail Case Generator V2

This skill generates MCP-ready TestRail artifacts:

- CSV scenarios with `mcpExecutable=true`.
- `app_config.json` with nested `routeProfile`.
- Validators that read `config["routeProfile"]` as the primary format.

## Validate generated scenarios

```bash
python scripts/validate_testrail_csv.py escenarios.csv --route-profile app_config.json
python scripts/validate_mcp_steps.py escenarios.csv --route-profile app_config.json
```

## Run discovery

```bash
npm.cmd run discovery:case -- --case-id <ID> --app <appSlug> --headed --overwrite --auto-promote --auto-pom
```

## app_config format

`routeProfile` must be an object, not a string:

```json
{
  "appSlug": "kiosko",
  "routeProfile": {
    "name": "authenticated_operations_balance_depositos_plazo",
    "entry": [
      {"businessLabel": "iniciar", "visibleLabel": "Iniciar"},
      {"businessLabel": "transacciones_servicios", "visibleLabel": "Transacciones y servicios"}
    ],
    "aliases": {
      "consulta_balance": "Consulta de balance",
      "depositos_plazo": "Depósitos a plazos",
      "volver": "Volver"
    },
    "intermediates": {
      "depositos_plazo": ["Consulta de balance", "Depósitos a plazos"]
    },
    "domainTerms": {
      "depositos_plazo": "depósito"
    },
    "visibleControls": ["Volver"],
    "representativeFixture": {
      "default": "cliente_deposito_plazo_multiple_activo"
    },
    "notes": []
  }
}
```
