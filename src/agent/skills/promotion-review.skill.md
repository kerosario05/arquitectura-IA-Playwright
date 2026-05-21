# Skill: promotion-review

## id
promotion-review

## purpose
Revisar la estabilidad y completitud del plan candidato antes de promoverlo a producción. Detectar acciones débiles, assertions omitidas y riesgos de mantenibilidad.

## allowedFailureReasons
- promotion_gate_blocked

## inputContract
- candidatePlan del context-pack.json (plan completo con steps)
- discovery result del context-pack (status, steps, failedReason)
- knownPlans del context-pack (planes similares ya promovidos para referencia)
- snapshotCandidates: elementos visibles usados durante discovery

## outputContract
- agent-response.json con skillId="promotion-review"
- proposedAction.type: "update_plan" | "case_quality_suggestion"
- diagnosis: análisis de estabilidad del plan
- shouldRetryExecution: false (no se debe re-ejecutar, solo revisar)
- requiresHumanApproval: true si hay acciones sensibles (pagar, comprar, eliminar)
- confidence: 0.0–1.0
- evidenceUsed: detalles del plan y steps analizados
- risks: array de riesgos identificados

## forbiddenActions
- Modificar el plan directamente (solo proponer cambios vía update_plan action)
- Eliminar steps sensibles sin justificación
- Ignorar assertions obligatorias insatisfechas
- Modificar registry estable
- Generar código Playwright

## validationRules
- Si hay acciones sensibles (pagar, comprar, eliminar, confirmar), requiresHumanApproval debe ser true
- Si hay steps con confidence < 0.5, debe listarse como riesgo
- Si hay assertions skipped por weak signal, debe documentarse
- No puede bloquear por warnings menores (confidence >= 0.7 es aceptable)
- Si el plan no tiene steps, status debe ser "no_safe_action"
- No puede modificar archivos fuera del directorio handoff

## examples

### Ejemplo 1: Plan con acción sensible
- scenario: Plan contiene step "click en 'Confirmar pago'" con confidence 0.6
- input: plan={steps:[{action:"click",target:"Confirmar pago",index:3}]}
- output: {"diagnosis":"El plan contiene una acción sensible de pago. Confidence moderada (0.6).","risks":["Acción 'Confirmar pago' requiere verificación manual"],"requiresHumanApproval":true}
- reasoning: Acciones de pago requieren aprobación humana incluso si el plan es correcto.

### Ejemplo 2: Plan estable para promoción
- scenario: Plan con todos los steps con confidence >= 0.8, sin acciones sensibles, assertions satisfechas
- input: plan={steps:[{action:"click",target:"Iniciar",index:1,confidence:0.95}]}
- output: {"diagnosis":"Plan estable. No se detectan riesgos significativos.","risks":[],"requiresHumanApproval":false}
- reasoning: Steps con alta confianza y sin acciones sensibles permiten promoción automática.
