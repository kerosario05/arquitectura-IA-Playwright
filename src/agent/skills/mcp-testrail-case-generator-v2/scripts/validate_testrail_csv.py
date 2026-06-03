#!/usr/bin/env python3
"""Validate MCP-ready TestRail CSV files against nested app_config/routeProfile JSON."""
from __future__ import annotations
import argparse
import csv
import json
import re
import sys
from pathlib import Path

REQUIRED_COLUMNS = [
    "ID", "Título", "Pasos", "Precondiciones", "Resultado Esperado", "Tipo",
    "base de datos", "is_converted", "automationType", "setupStrategy", "appSlug",
    "routeProfile", "dataRequirements", "nonExecutableCriteria", "mcpExecutable",
]
ALLOWED_AUTOMATION = {
    "ui_discovery", "ui_with_auth_gate", "ui_with_controlled_data", "ui_with_auth_gate_controlled_data"
}
ALLOWED_SETUP = {"self_contained", "auth_gate", "controlled_data", "no_login"}
FORBIDDEN_STEP_PHRASES = [
    "el sistema permite", "el cliente accede", "validar correctamente", "verificar que funcione",
    "se procesa exitosamente", "según configuración", "segun configuracion", "cuando aplique",
    "validar backend", "validar core banking", "validar base de datos", "validar cálculo",
    "validar calculo", "validar reglas de negocio", "validar integración", "validar integracion",
    "validar auditoría", "validar auditoria", "validar que se registró", "validar que se registro",
]
FORBIDDEN_NONEXEC = [
    "backend", "core banking", "base de datos", "cálculo exacto", "calculo exacto",
    "auditoría", "auditoria", "logs", "manual", "b2000"
]
STEP_LINE_RE = re.compile(r"^\s*\d+\.\s+.+")
QUOTE_RE = re.compile(r'"([^"]+)"')


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


def row_title(row: dict) -> str:
    return row.get("Título") or row.get("title") or "<sin título>"


def split_steps(steps: str) -> list[str]:
    return [line.strip() for line in (steps or "").splitlines() if line.strip()]


def expected_targets(expected: str) -> list[str]:
    return QUOTE_RE.findall(expected or "")


def validate(csv_path: Path, config_path: Path) -> tuple[bool, list[str], int, str | None, str | None]:
    config = load_json(config_path)
    app_slug = get_app_slug(config)
    profile_name = get_route_profile_name(config)
    labels = get_visible_labels(config)
    errors: list[str] = []

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return False, ["csv has no header"], 0, app_slug, profile_name
        missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
        if missing:
            errors.append(f"missing columns: {', '.join(missing)}")
        rows = list(reader)

    for idx, row in enumerate(rows, start=2):
        title = row_title(row)
        prefix = f"row {idx}"
        if row.get("appSlug") != app_slug:
            errors.append(f"{prefix} appSlug mismatch: {title}")
        if row.get("routeProfile") != profile_name:
            errors.append(f"{prefix} routeProfile mismatch: {title}")
        if row.get("automationType") not in ALLOWED_AUTOMATION:
            errors.append(f"{prefix} invalid automationType: {title}")
        if row.get("setupStrategy") not in ALLOWED_SETUP:
            errors.append(f"{prefix} invalid setupStrategy: {title}")
        if str(row.get("mcpExecutable", "")).strip().lower() != "true":
            errors.append(f"{prefix} mcpExecutable must be true: {title}")
        if "controlled_data" in str(row.get("automationType", "")) and not row.get("dataRequirements"):
            errors.append(f"{prefix} controlled_data requires dataRequirements: {title}")

        for step in split_steps(row.get("Pasos", "")):
            if not STEP_LINE_RE.match(step):
                errors.append(f"{prefix} step is not numbered: {title}")
            low = step.lower()
            for phrase in FORBIDDEN_STEP_PHRASES:
                if phrase in low:
                    errors.append(f"{prefix} forbidden step phrase '{phrase}': {title}")
            for target in QUOTE_RE.findall(step):
                if target not in labels:
                    errors.append(f"{prefix} unknown visible target '{target}': {title}")

        for target in expected_targets(row.get("Resultado Esperado", "")):
            errors.append(f"{prefix} expectedResult introduces target '{target}': {title}")

        nonexec = (row.get("nonExecutableCriteria") or "").lower()
        if str(row.get("mcpExecutable", "")).strip().lower() == "true":
            for phrase in FORBIDDEN_NONEXEC:
                if phrase in nonexec:
                    errors.append(f"{prefix} nonExecutableCriteria contains blocking phrase '{phrase}': {title}")

    return not errors, errors, len(rows), app_slug, profile_name


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_file")
    parser.add_argument("--route-profile", required=True, help="app_config.json or standalone route profile JSON")
    args = parser.parse_args()
    ok, errors, count, app_slug, profile_name = validate(Path(args.csv_file), Path(args.route_profile))
    if ok:
        print(f"PASS validate_testrail_csv: {count} rows, appSlug={app_slug}, routeProfile={profile_name}")
        return 0
    print("FAIL")
    for err in errors:
        print(f"- {err}")
    return 1

if __name__ == "__main__":
    sys.exit(main())
