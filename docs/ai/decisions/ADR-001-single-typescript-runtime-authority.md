# ADR-001: Single TypeScript runtime authority

## Decision

Shared `src` runtime modules no deben mantener sibling JS stale capaz de shadowear la autoridad TS en Playwright child processes.

## Guardrail

No ordenar borrado masivo de JS. Cada eliminación futura requiere demostrar primero autoridad/shadow.
