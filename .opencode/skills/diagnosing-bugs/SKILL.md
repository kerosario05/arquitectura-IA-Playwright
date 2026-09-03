---
name: diagnosing-bugs
description: Diagnostica bugs del proyecto QA Lab/MCP antes de modificar código, siguiendo input, transformación y output hasta el primer contrato violado.
compatibility: opencode
---

# Diagnosing Bugs

## Activación

Usa esta skill cuando el usuario pida investigar un bug, analizar logs, encontrar causa raíz, localizar dónde se pierde metadata, explicar un fallo de runtime o auditar un pipeline o transformación.

## Objetivo

Diagnostica antes de proponer cambios. No modifiques código hasta identificar el primer punto concreto donde se viola el contrato. No implementes el fix salvo que el usuario lo solicite expresamente.

## Procedimiento

1. Trabaja con la cadena `input -> transformación -> output`.
2. Formula hipótesis falsables y busca evidencia antes de proponer un fix.
3. Sigue la metadata por cada frontera relevante: si se recibe, si se devuelve, si se remapea y si puede desaparecer una entidad referenciada.
4. Revisa explícitamente si se conservan `requirementId`, `branchId`, `stepRequirementRefs`, `stepClaims` y `branchAssociation`.
5. Comprueba si la autoridad se reconstruye desde texto libre o si una entidad referenciada puede desaparecer.
6. Detén el audit en el primer defecto probado; no explores capas posteriores innecesariamente.

## Restricciones

- Una sola tarea por ejecución.
- Máximo 1-2 búsquedas focales.
- Lee solo archivos directamente relacionados, preferiblemente bloques de 80-150 líneas.
- No escanees el repositorio completo ni ejecutes suites globales.
- No ejecutes build o typecheck global salvo necesidad demostrada.
- No refactorices código ajeno.
- Mantén la arquitectura multiproyecto.

## Invariantes de arquitectura

- No hardcodees HU, issue, `appSlug`, proyecto, textos UI, URLs, paths, `scenarioId`, `branchId` ni `requirementId` como comportamiento especial.
- No hardcodees la cantidad de escenarios.
- HU define intención funcional; runtime prueba existencia.
- Provider output no otorga autoridad.
- Knowledge no otorga automáticamente autoridad semántica.
- `functional validity` no equivale a `execution authority`.
- SQL es source of truth; JSON materializado es cache.
- No reconstruyas autoridad estructural desde texto libre.

## Salida

Usa por defecto exactamente este formato:

```text
firstFailurePoint=
file=
lines=
contractExpected=
contractActual=
evidence=
rootCause=
safeToFix=
nextAction=
```

Si aún no hay causa demostrada, usa `nextAction=continue-audit`.
