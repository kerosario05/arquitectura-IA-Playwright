# Skill: assertion-resolution

## id
assertion-resolution

## purpose
Clasificar assertions pendientes que no pudieron resolverse durante el discovery. Diferenciar entre literales observables, descriptores semánticos, expected-only, weak signals.

## allowedFailureReasons
- assertion_not_found
- pendingAssertions
- needs_assertion_resolution

## inputContract
- pendingAssertions del context-pack.json (texto completo de cada assertion pendiente)
- snapshotCandidates: elementos visibles actuales del snapshot
- failedAtStep: índice del paso donde falló
- candidatePlan: plan actual con steps ejecutados

## outputContract
- agent-response.json con skillId="assertion-resolution"
- proposedAction.type: "skip_assertion" | "retry_assertion" | "update_plan"
- Para cada assertion pendiente: classification, status, matchedText, confidence
- shouldRetryExecution: true si alguna assertion se resolvió como "retry"
- evidenceUsed: textos del snapshot usados para resolver

## forbiddenActions
- Relajar literales explícitos (con quotes) a no bloqueantes
- Modificar registry estable
- Inventar datos que no están en el snapshot
- Generar código Playwright
- Modificar archivos del framework

## validationRules
- Una assertion literal con quotes explícitos no debe ser clasificada como semantic_descriptor
- Un descriptor sintético genérico (e.g., "Sección principal visible") desde expected source puede ser skipped_semantic_descriptor
- Un descriptor con señales concretas en el snapshot (subject visible + structural signals) debe ser "passed"
- Si confidence < 0.5, marcar como needs_agent_review
- No puede modificar archivos fuera del directorio handoff

## examples

### Ejemplo 1: Descriptor semántico sin señales
- scenario: Assertion "Datos principales visibles" desde expected source sin elementos visibles de datos en el snapshot
- input: pendingAssertion="Datos principales visibles", source="expected", visibleTexts=["Bienvenido"]
- output: {"classification":"semantic_descriptor","status":"skipped_semantic_descriptor","reason":"Descriptor genérico sintético desde expected source sin evidencia concreta en el snapshot.","confidence":0.55}
- reasoning: Al ser expected y no tener señales en el snapshot, se trata como non-blocking.

### Ejemplo 2: Literal observable presente
- scenario: Assertion "'Resultado visible'" con quotes, y el texto "Resultado visible" está en el snapshot
- input: pendingAssertion="'Resultado visible'", visibleTexts=["Resultado visible", "Monto: $100"]
- output: {"classification":"literal_observable","status":"passed","matchedText":"Resultado visible","confidence":0.98}
- reasoning: El texto literal coincide exactamente con un elemento visible del snapshot.

### Ejemplo 3: Literal observable ausente
- scenario: Assertion "'Total a pagar: $500'" con quotes, pero no está visible
- input: pendingAssertion="'Total a pagar: $500'", visibleTexts=["Bienvenido"]
- output: {"classification":"literal_observable","status":"failed","reason":"Texto literal no encontrado en el snapshot.","confidence":0.0}
- reasoning: El texto literal con quotes no está presente, por lo que es un blocker real.
