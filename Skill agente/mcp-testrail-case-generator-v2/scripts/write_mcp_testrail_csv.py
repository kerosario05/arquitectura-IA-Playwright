#!/usr/bin/env python3
"""Write and validate MCP-friendly TestRail CSV files.

Input JSON shape:
{
  "rows": [
    {
      "ID": "",
      "Título": "...",
      "Pasos": "1. ...\n2. ...",
      "Precondiciones": "1. ...",
      "Resultado Esperado": "...",
      "Tipo": "Functional",
      "base de datos": "QA",
      "is_converted": "0"
    }
  ]
}
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path
from typing import Any

COLUMNS = [
    "ID",
    "Título",
    "Pasos",
    "Precondiciones",
    "Resultado Esperado",
    "Tipo",
    "base de datos",
    "is_converted",
]

FORBIDDEN_URL_STEP = re.compile(r"^\s*\d+\.\s*(abrir|navegar|acceder)\s+(url|la url|el portal|la pagina|la página)", re.I | re.M)
FORBIDDEN_DYNAMIC_SELECTION = re.compile(
    r"seleccionar\s+(el|la)\s+primer(?:a|o)?\s+(producto|tarjeta|resultado|item|elemento)(?:\s+visible)?(?:\s+de\s+producto)?\s+(de\s+la\s+categor[ií]a|despu[eé]s\s+de\s+filtrar\s+por)",
    re.I,
)
FIELD_FILL = re.compile(r"^\s*\d+\.\s*Escribir\s+el\s+valor\s+del\s+dato\s+\"[^\"]+\"\s+en\s+el\s+campo\s+\"([^\"]+)\"", re.I | re.M)
LOGIN_CLICK = re.compile(r"^\s*\d+\.\s*Clic\s+en\s+\"(?:Log in|Login|Sign in|Iniciar sesi[oó]n|Acceder)\"", re.I | re.M)
LOGIN_FORM_VALIDATION = re.compile(r"formulario\s+de\s+inicio\s+de\s+sesi[oó]n.*\"Username\".*\"Password\"|\"Username\".*\"Password\".*formulario\s+de\s+inicio\s+de\s+sesi[oó]n", re.I | re.S)
PLACE_ORDER_CLICK = re.compile(r"^\s*\d+\.\s*Clic\s+en\s+\"(?:Place Order|Checkout|Continuar al checkout|Comprar)\"", re.I | re.M)
ORDER_FORM_VALIDATION = re.compile(r"formulario\s+de\s+orden.*\"Name\".*\"Country\".*\"City\".*\"Credit card\".*\"Month\".*\"Year\"", re.I | re.S)


def step_count(steps: str) -> int:
    return len(re.findall(r"^\s*\d+\.\s+", steps or "", re.M))


def validate_row(row: dict[str, Any], idx: int) -> list[str]:
    errors: list[str] = []
    for col in COLUMNS:
        if col not in row:
            errors.append(f"row {idx}: missing column {col}")

    title = str(row.get("Título", ""))
    steps = str(row.get("Pasos", ""))
    pre = str(row.get("Precondiciones", ""))

    if not title.strip():
        errors.append(f"row {idx}: Título is required")
    if not steps.strip():
        errors.append(f"row {idx}: Pasos is required")
    if not re.search(r"^\s*1\.\s+", steps, re.M):
        errors.append(f"row {idx}: Pasos must be numbered starting with 1.")
    if FORBIDDEN_URL_STEP.search(steps):
        errors.append(f"row {idx}: do not include URL-opening/navigation setup steps in Pasos; move BASE_URL to Precondiciones")
    if "BASE_URL" not in pre:
        errors.append(f"row {idx}: Precondiciones should mention BASE_URL")
    if FORBIDDEN_DYNAMIC_SELECTION.search(steps):
        errors.append(f"row {idx}: forbidden ambiguous dynamic selection; split into category selection + 'Seleccionar la primera tarjeta visible del listado de productos.'")

    count = step_count(steps)
    if count > 12 and not re.search(r"\b(e2e|end\s*to\s*end|punta\s+a\s+punta)\b", title, re.I):
        errors.append(f"row {idx}: non-E2E case has {count} steps; split it or move setup to preconditions")

    # Login modal validation: if filling username/password after login click, require a login form validation.
    fields = [m.group(1).lower() for m in FIELD_FILL.finditer(steps)]
    has_login_fields = any(f in {"username", "usuario", "user", "email"} for f in fields) and any(f in {"password", "contraseña", "contrasena"} for f in fields)
    if LOGIN_CLICK.search(steps) and has_login_fields and not LOGIN_FORM_VALIDATION.search(steps):
        errors.append(f"row {idx}: login fields are filled after Log in without validating the login form/modal with Username and Password first")

    # Checkout/order modal validation: if filling order fields after Place Order, require order form validation.
    order_fields = {"name", "country", "city", "credit card", "month", "year"}
    has_order_fields = len(order_fields.intersection(set(fields))) >= 2
    if PLACE_ORDER_CLICK.search(steps) and has_order_fields and not ORDER_FORM_VALIDATION.search(steps):
        errors.append(f"row {idx}: order fields are filled after Place Order without validating the order form/modal fields first")

    return errors


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: write_mcp_testrail_csv.py input.json output.csv", file=sys.stderr)
        return 2
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    data = json.loads(input_path.read_text(encoding="utf-8"))
    rows = data.get("rows", data if isinstance(data, list) else None)
    if not isinstance(rows, list):
        print("input must contain rows list", file=sys.stderr)
        return 2

    normalized: list[dict[str, str]] = []
    errors: list[str] = []
    for i, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            errors.append(f"row {i}: must be an object")
            continue
        out = {col: str(row.get(col, "")) for col in COLUMNS}
        out["Tipo"] = out["Tipo"] or "Functional"
        out["base de datos"] = out["base de datos"] or "QA"
        out["is_converted"] = out["is_converted"] or "0"
        errors.extend(validate_row(out, i))
        normalized.append(out)

    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(normalized)
    print(f"wrote {len(normalized)} rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
