# Skill: form-fill

## id
form-fill

## purpose
Resolver campos de formulario y datos requeridos para steps de tipo fill. Usar exclusivamente los availableDataKeys del context-pack.

## allowedFailureReasons
- missing_test_data
- field_not_found
- ambiguous_field
- fill_target_not_found
- fill_target_not_editable

## inputContract
- snapshotCandidates del context-pack (elementos visibles incluyendo inputs fields)
- availableDataKeys del safeData del context-pack
- failedTarget: target del campo que falló
- candidatePlan: plan actual con steps
- failedAtStep: índice del paso donde falló

## outputContract
- agent-response.json con skillId="form-fill"
- proposedAction.type: "needs_data" | "update_plan"
- diagnosis: qué campo no se pudo resolver y por qué
- Si falta dato: proposedAction.type = "needs_data", listar dataKey requerido
- Si campo ambiguo: proponer clarificación del target del campo
- confidence: 0.0–1.0
- shouldRetryExecution: false (si falta data) o true (si campo resuelto)
- evidenceUsed: campos visibles del snapshot

## forbiddenActions
- Inventar datos que no están en availableDataKeys
- Usar valores literales sensibles (passwords, tokens, bearer)
- Modificar registry estable
- Proponer dataKeys que no existen en availableDataKeys
- Generar código Playwright
- Asumir valores por defecto sin respaldo en availableDataKeys

## validationRules
- Solo puede usar dataKeys de availableDataKeys del context-pack
- Si se necesita un dato no disponible, status debe ser "needs_data"
- No puede hardcodear valores de prueba (e.g., "username", "password123")
- Para campos ambiguos, debe sugerir asociación con dataKey existente
- No puede modificar archivos fuera del directorio handoff

## examples

### Ejemplo 1: Campo encontrado, dato disponible
- scenario: fill target "Usuario" encontrado en snapshot, dataKey "username" disponible
- input: failedTarget="Usuario", availableDataKeys=["username", "password"], field={id:"el3",type:"input",label:"Usuario"}
- output: {"proposedAction":{"type":"update_plan","reason":"Campo 'Usuario' (el3) coincide con dataKey 'username'.","dataKey":"username","fieldId":"el3"},"confidence":0.95}
- reasoning: El campo visible y el dataKey disponible coinciden semánticamente.

### Ejemplo 2: Dato faltante
- scenario: fill target "Código de verificación" encontrado, pero no hay dataKey para "verification_code"
- input: failedTarget="Código de verificación", availableDataKeys=["username", "password"], field={id:"el4",type:"input",label:"Código de verificación"}
- output: {"proposedAction":{"type":"needs_data","reason":"Campo 'Código de verificación' visible pero no hay dataKey disponible para este campo.","requiredKey":"verification_code","fieldId":"el4"},"confidence":0.85}
- reasoning: El campo existe pero el dato no está disponible. Se debe agregar a testData.
