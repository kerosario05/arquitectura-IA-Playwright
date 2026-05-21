# Skill: target-disambiguation

## id
target-disambiguation

## purpose
Resolver únicamente cuál candidato visible/actionable del snapshot corresponde al step fallido por ambigüedad.

## allowedFailureReasons
- ambiguous_target
- locator_resolution_failed (cuando existan candidatos en el snapshot)

## inputContract
- snapshotCandidates del context-pack.json
- failedTarget del context-pack.json
- Ambiguity diagnostics (semanticRole, relationContext, candidateTexts)

## outputContract
- agent-response.json con skillId="target-disambiguation"
- proposedAction.type = "click_candidate"
- proposedAction.candidateId: ID del candidato seleccionado del snapshot
- diagnosis: justificación usando visible text, semanticRole, relationContext, nearbyText
- confidence: 0.0–1.0
- shouldRetryExecution: true
- requiresHumanApproval: false (o true si confidence < 0.7)
- evidenceUsed: textos visibles del snapshot que respaldan la elección
- risks: array de riesgos identificados

## forbiddenActions
- Inventar selector CSS/XPath libre (solo usar candidateId existente del context-pack)
- Modificar registry estable
- Modificar archivos del framework
- Proponer candidateId que no existe en snapshotCandidates del context-pack
- Proponer URLs o rutas de navegación
- Generar código Playwright

## validationRules
- candidateId debe existir en snapshotCandidates del context-pack
- No puede proponer selector libre
- Debe justificar con evidencia del snapshot (visible text, semanticRole, relationContext)
- Si confidence < 0.6, status debe ser "needs_agent_review"
- No puede modificar archivos fuera del directorio handoff
- Si no hay candidato confiable, status debe ser "no_safe_action"

## examples

### Ejemplo 1: Múltiples botones con texto similar
- scenario: Clic en 'Información de productos' donde existen dos elementos con texto similar
- input: failedTarget="Información de productos", candidates=[{id:"el1",text:"Información de productos",role:"link"},{id:"el2",text:"Información de tarjetas",role:"link"}], relationContext="main navigation"
- output: {"candidateId":"el1","reason":"El texto 'Información de productos' coincide exactamente con el target, y el elemento está en el menú de navegación principal (relationContext).","confidence":0.92}
- reasoning: El candidateId seleccionado tiene coincidencia exacta de texto y el context de navegación principal respalda que es el destino correcto.

### Ejemplo 2: Sin candidato confiable
- scenario: failedTarget="Tarjeta de Crédito" pero no hay elementos visibles en el snapshot
- input: failedTarget="Tarjeta de Crédito", candidates=[], snapshotCandidates=[{id:"el1",text:"Bienvenido",role:"heading"}]
- output: {"status":"needs_agent_review","reason":"No hay candidatos visibles en el snapshot que correspondan al target 'Tarjeta de Crédito'.","confidence":0.0,"shouldRetryExecution":false}
- reasoning: Sin elementos visibles relacionados, no se puede proponer una acción segura. Se debe escalar a revisión.
