#!/usr/bin/env python3
"""Validate MCP step syntax and routeProfile compatibility for TestRail CSV files."""
from __future__ import annotations
import argparse
import csv
import json
import re
import sys
from pathlib import Path

QUOTE_RE = re.compile(r'"([^"]+)"')
STEP_PATTERNS = [
    re.compile(r'^\d+\. Clic en "[^"]+"\.$'),
    re.compile(r'^\d+\. Validar que se muestre "[^"]+"\.$'),
    re.compile(r'^\d+\. Esperar que se muestre "[^"]+"\.$'),
    re.compile(r'^\d+\. Validar que el botón "[^"]+" esté visible\.$'),
    re.compile(r'^\d+\. Validar que el botón "[^"]+" esté habilitado\.$'),
    re.compile(r'^\d+\. Validar que el botón "[^"]+" esté deshabilitado\.$'),
    re.compile(r'^\d+\. Validar que la opción "[^"]+" esté disponible\.$'),
    re.compile(r'^\d+\. Seleccionar el primer .+ visible del listado\.$'),
    re.compile(r'^\d+\. Seleccionar la primera .+ visible del listado\.$'),
    re.compile(r'^\d+\. Seleccionar el último .+ visible del listado\.$'),
    re.compile(r'^\d+\. Ingresar .+ usando [a-z0-9_]+\.$'),
]
ORDINAL_RE = re.compile(r'Seleccionar (?:el primer|la primera|el último) (.+?) visible del listado\.')
BAD_DOMAIN_TERMS = {"tarjeta", "cuenta", "depósito", "deposito", "préstamo", "prestamo", "documento", "solicitud"}


def load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        raise SystemExit(f"FAIL\n- config error: cannot read {path}: {exc}")


def get_profile(config: dict) -> dict:
    profile = config.get("routeProfile", config)
    if isinstance(profile, str):
        raise SystemExit("FAIL\n- config error: routeProfile must be an object in app_config, not a string")
    return profile


def get_app_slug(config: dict) -> str | None:
    profile = get_profile(config)
    return config.get("appSlug") or profile.get("appSlug")


def get_route_profile_name(config: dict) -> str | None:
    profile = get_profile(config)
    return profile.get("name") or config.get("routeProfile")


def get_visible_labels(config: dict) -> set[str]:
    profile = get_profile(config)
    labels: set[str] = set()
    for item in profile.get("entry", []):
        if isinstance(item, dict) and item.get("visibleLabel"):
            labels.add(str(item["visibleLabel"]))
    for value in profile.get("aliases", {}).values():
        if value:
            labels.add(str(value))
    for value in profile.get("visibleControls", []):
        if value:
            labels.add(str(value))
    return labels


def split_steps(steps: str) -> list[str]:
    return [line.strip() for line in (steps or "").splitlines() if line.strip()]


def row_title(row: dict) -> str:
    return row.get("Título") or row.get("title") or "<sin título>"


def validate_intermediates(row: dict, steps: list[str], profile: dict) -> list[str]:
    errors: list[str] = []
    text = "\n".join(steps)
    title = row_title(row)
    for route_key, chain in profile.get("intermediates", {}).items():
        if not isinstance(chain, list) or not chain:
            continue
        domain = profile.get("domainTerms", {}).get(route_key)
        case_route = row.get("dataRequirements", "") + " " + row.get("Título", "") + " " + row.get("Pasos", "")
        # Only enforce the chain when the route key, any chain label, or the domain term appears in the row.
        if route_key not in case_route and not any(str(label) in case_route for label in chain) and not (domain and domain in case_route):
            continue
        last_idx = -1
        for label in chain:
            idx = text.find(f'"{label}"')
            if idx < 0:
                errors.append(f"missing intermediate '{label}': {title}")
                continue
            if idx < last_idx:
                errors.append(f"intermediate order invalid for '{label}': {title}")
            last_idx = idx
    return errors


def validate(csv_path: Path, config_path: Path):
    config = load_json(config_path)
    profile = get_profile(config)
    app_slug = get_app_slug(config)
    profile_name = get_route_profile_name(config)
    labels = get_visible_labels(config)
    domain_terms = {str(v).lower() for v in profile.get("domainTerms", {}).values() if v}
    errors: list[str] = []

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    for idx, row in enumerate(rows, start=2):
        title = row_title(row)
        low_title = title.lower()
        steps = split_steps(row.get("Pasos", ""))
        selects = [s for s in steps if "Seleccionar " in s]
        if "visualizar listado" in low_title and selects:
            errors.append(f"row {idx} listing case selects item: {title}")
        if any(k in low_title for k in ["visualizar detalle", "consultar detalle", "seleccionar item"]):
            if not selects:
                errors.append(f"row {idx} detail case does not select item: {title}")

        for step in steps:
            if not any(p.match(step) for p in STEP_PATTERNS):
                errors.append(f"row {idx} unsupported MCP step syntax '{step}': {title}")
            for target in QUOTE_RE.findall(step):
                if target not in labels:
                    errors.append(f"row {idx} unknown visible target '{target}': {title}")
            m = ORDINAL_RE.search(step)
            if m:
                used_domain = m.group(1).lower().strip()
                if domain_terms and used_domain not in domain_terms:
                    errors.append(f"row {idx} ordinal domain '{used_domain}' not in routeProfile.domainTerms: {title}")
                # Catch common wrong-domain terms when they are not declared for this route profile.
                if used_domain in BAD_DOMAIN_TERMS and used_domain not in domain_terms:
                    errors.append(f"row {idx} wrong domain term '{used_domain}': {title}")

        for msg in validate_intermediates(row, steps, profile):
            errors.append(f"row {idx} {msg}")

    return not errors, errors, len(rows), app_slug, profile_name


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_file")
    parser.add_argument("--route-profile", required=True, help="app_config.json or standalone route profile JSON")
    args = parser.parse_args()
    ok, errors, count, app_slug, profile_name = validate(Path(args.csv_file), Path(args.route_profile))
    if ok:
        print(f"PASS validate_mcp_steps: {count} rows, MCP step syntax OK")
        return 0
    print("FAIL")
    for err in errors:
        print(f"- {err}")
    return 1

if __name__ == "__main__":
    sys.exit(main())
