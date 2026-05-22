# Selected Skill: target-disambiguation

## Purpose
Resolver cuál candidato visible/actionable del snapshot corresponde al step fallido por ambigüedad.

## Allowed Failure Reasons
- ambiguous_target
- locator_resolution_failed

## Input Contract
- snapshotCandidates del context-pack.json
- failedTarget del context-pack.json
- Ambiguity diagnostics (semanticRole, relationContext, candidateTexts)

## Output Contract
- agent-response.json con skillId="target-disambiguation"
- proposedAction.type = "click_candidate"
- proposedAction.candidateId: ID del candidato seleccionado del snapshot
- diagnosis: justificación usando visible text, semanticRole, relationContext, nearbyText
- confidence: 0.0–1.0
- shouldRetryExecution: true
- requiresHumanApproval: false (o true si confidence < 0.7)
- evidenceUsed: textos visibles del snapshot que respaldan la elección
- risks: array de riesgos identificados

## Forbidden Actions
- Inventar selector CSS/XPath libre (solo usar candidateId existente del context-pack)
- Modificar registry estable
- Modificar archivos del framework
- Proponer candidateId que no existe en snapshotCandidates del context-pack
- Proponer URLs o rutas de navegación
- Generar código Playwright

## Validation Rules
- candidateId debe existir en snapshotCandidates del context-pack
- No puede proponer selector libre
- Debe justificar con evidencia del snapshot (visible text, semanticRole, relationContext)
- Si confidence < 0.6, status debe ser "needs_agent_review"
- No puede modificar archivos fuera del directorio handoff
- Si no hay candidato confiable, status debe ser "no_safe_action"

## Examples
### Múltiples botones con texto similar
- **Input:** failedTarget="Información de productos", candidates=[{id:"el1",text:"Información de productos",role:"link"},{id:"el2",text:"Información de tarjetas",role:"link"}], relationContext="main navigation"
- **Output:** {"candidateId":"el1","reason":"El texto 'Información de productos' coincide exactamente con el target, y el elemento está en el menú de navegación principal (relationContext).","confidence":0.92}
- **Reasoning:** El candidateId seleccionado tiene coincidencia exacta de texto y el context de navegación principal respalda que es el destino correcto.

### Sin candidato confiable
- **Input:** failedTarget="Tarjeta de Crédito", candidates=[], snapshotCandidates=[{id:"el1",text:"Bienvenido",role:"heading"}]
- **Output:** {"status":"needs_agent_review","reason":"No hay candidatos visibles en el snapshot que correspondan al target.","confidence":0.0,"shouldRetryExecution":false}
- **Reasoning:** Sin elementos visibles relacionados, no se puede proponer una acción segura.
