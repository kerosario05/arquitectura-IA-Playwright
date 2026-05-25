# Selected Skill: assertion-resolution

## Purpose
Clasificar assertions pendientes. Diferenciar literales, descriptores semánticos, expected-only y weak signals.

## Allowed Failure Reasons
- assertion_not_found
- pendingAssertions
- needs_assertion_resolution

## Input Contract
- pendingAssertions del context-pack.json (texto completo de cada assertion pendiente)
- snapshotCandidates: elementos visibles actuales del snapshot
- failedAtStep: índice del paso donde falló
- candidatePlan: plan actual con steps ejecutados

## Output Contract
- agent-response.json con skillId="assertion-resolution"
- proposedAction.type: "skip_assertion" | "retry_assertion" | "update_plan"
- Para cada assertion pendiente: classification, status, matchedText, confidence
- shouldRetryExecution: true si alguna assertion se resolvió como "retry"
- evidenceUsed: textos del snapshot usados para resolver

## Forbidden Actions
- Relajar literales explícitos (con quotes) a no bloqueantes
- Modificar registry estable
- Inventar datos que no están en el snapshot
- Generar código Playwright
- Modificar archivos del framework

## Validation Rules
- Una assertion literal con quotes explícitos no debe ser clasificada como semantic_descriptor
- Un descriptor sintético genérico desde expected source puede ser skipped_semantic_descriptor
- Un descriptor con señales concretas en el snapshot debe ser "passed"
- Si confidence < 0.5, marcar como needs_agent_review
- No puede modificar archivos fuera del directorio handoff

## Examples
### Descriptor semántico sin señales
- **Input:** pendingAssertion="Datos principales visibles", source="expected", visibleTexts=["Bienvenido"]
- **Output:** {"classification":"semantic_descriptor","status":"skipped_semantic_descriptor","reason":"Descriptor genérico sintético desde expected source sin evidencia concreta en el snapshot.","confidence":0.55}
- **Reasoning:** Al ser expected y no tener señales en el snapshot, se trata como non-blocking.

### Literal observable ausente
- **Input:** pendingAssertion="'Total a pagar: $500'", visibleTexts=["Bienvenido"]
- **Output:** {"classification":"literal_observable","status":"failed","reason":"Texto literal no encontrado en el snapshot.","confidence":0.0}
- **Reasoning:** El texto literal con quotes no está presente, por lo que es un blocker real.
