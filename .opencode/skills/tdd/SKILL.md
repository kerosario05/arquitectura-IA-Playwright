---
name: tdd
description: Aplica microfixes seguros mediante un test focal en ciclo red, green y validación mínima, preservando metadata y autoridad estructural.
compatibility: opencode
---

# TDD

## Activación

Usa esta skill cuando ya exista una causa raíz demostrada, el usuario pida corregir un bug, añadir una regresión o hacer un microfix seguro.

## Procedimiento obligatorio

1. Antes de modificar producción, crea o identifica un test que reproduzca exactamente el bug.
2. Ejecuta solo el test focal y demuestra que falla por la causa esperada.
3. Aplica el cambio mínimo de producción.
4. Ejecuta de nuevo el mismo test hasta que pase.
5. Valida únicamente lo necesario para confirmar el cambio.

## Límites

- Habitualmente, un test nuevo por microfix.
- Hasta dos si existen dos comportamientos estructuralmente distintos.
- Tres solo si es imprescindible.
- No crees suites amplias.
- No ejecutes test global, build global o typecheck global salvo necesidad demostrada.
- No hagas refactors relacionados solo indirectamente.
- No ocultes errores preexistentes; distingue regresiones nuevas de fallos previos.

## Invariantes de arquitectura

- Mantén la arquitectura multiproyecto.
- No introduzcas hardcodes por HU, app, proyecto o UI.
- No fijes cantidades de escenarios.
- No transfieras autoridad desde texto.
- Preserva `requirementId`, `branchId`, `stepRequirementRefs`, `stepClaims` y `branchAssociation`.
- SQL es source of truth; JSON materializado es cache.

## Hipótesis incorrecta

Si el test demuestra que la hipótesis inicial era incorrecta, detén la implementación, reporta la evidencia y vuelve a `diagnosing-bugs`. No fuerces un fix.

## Salida

Usa este formato:

```text
RED
test=
failure=
expectedCauseConfirmed=true|false

FIX
filesChanged=
minimalChange=

GREEN
test=
result=

VALIDATION
additionalChecks=
remainingPreexistingErrors=
```
