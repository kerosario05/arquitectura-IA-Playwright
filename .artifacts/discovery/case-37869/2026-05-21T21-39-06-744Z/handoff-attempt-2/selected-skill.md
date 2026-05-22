# Selected Skill: navigation-recovery

## Purpose
Proponer la siguiente acción segura cuando no se encuentra el target del step actual.

## Allowed Failure Reasons
- target_not_found
- locator_resolution_failed
- click_no_transition

## Input Contract
- snapshotCandidates del context-pack.json (elementos visibles actuales)
- failedTarget: target que no se encontró
- failedAtStep: índice del paso donde falló
- candidatePlan: plan con steps restantes
- failedReason: razón exacta del fallo
- knownRoutes del context-pack (rutas conocidas de otros planes)

## Output Contract
- agent-response.json con skillId="navigation-recovery"
- proposedAction.type: "click_candidate" | "update_plan"
- proposedAction.candidateId: ID del candidato visible a clickear (si existe)
- diagnosis: explicación de por qué ese candidato es la siguiente acción segura
- confidence: 0.0–1.0
- shouldRetryExecution: true si hay candidato clickeable
- evidenceUsed: elementos del snapshot que respaldan la decisión
- risks: riesgos como "clic sin cambio de DOM esperado"

## Forbidden Actions
- Inventar rutas o URLs de navegación
- Proponer candidateId que no existe en snapshotCandidates
- Inventar selectores CSS/XPath
- Modificar registry estable
- Generar código Playwright
- Asumir estado de la aplicación no verificado

## Validation Rules
- Solo puede elegir entre candidatos visibles del snapshot actual
- Si no hay candidato clickeable con confidence >= 0.5, status debe ser "no_safe_action"
- Si confidence < 0.6, marcar como "needs_agent_review"
- No puede ejecutar navegación (Playwright)
- No puede proponer acciones no presentes en supportedActions
- No puede modificar archivos fuera del directorio handoff

## Examples
### Target no encontrado, candidato alternativo visible
- **Input:** failedTarget="Tarjeta de Crédito" no encontrado, candidates=[{id:"el5",text:"Ver tarjetas",role:"link",tagName:"a"}]
- **Output:** {"candidateId":"el5","reason":"El target original 'Tarjeta de Crédito' no está visible. 'Ver tarjetas' es un enlace visible con la misma intención semántica.","confidence":0.72,"risks":["El texto no coincide exactamente con el target original"]}
- **Reasoning:** Aunque no es el target exacto, el candidato tiene relación semántica y es clickeable.

### Sin candidato clickeable
- **Input:** failedTarget="Iniciar sesión", candidates=[{id:"el1",text:"Cargando...",role:"status"}]
- **Output:** {"status":"no_safe_action","reason":"No hay candidatos clickeables en el snapshot actual.","confidence":0.0,"shouldRetryExecution":false}
- **Reasoning:** Sin elementos interactivos visibles, no se puede recuperar.
