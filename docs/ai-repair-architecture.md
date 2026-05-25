# AI Repair Architecture (MCP Contract)

## 1) Principio central
La IA no reemplaza el motor MCP. La IA actúa solo como asesor de reparación cuando los resolutores locales no pueden resolver de forma segura.

## 2) Flujo esperado
MCP ejecuta paso  
-> falla  
-> clasifica fallo  
-> ejecuta resolutores locales  
-> si no pueden resolver:
- construye context-pack compacto
- llama al AI Provider
-> IA devuelve JSON mínimo  
-> MCP valida schema, candidateId, visibilidad, actionability y seguridad  
-> MCP aplica la decisión solo si es segura  
-> MCP relanza segmento/caso de forma controlada  
-> si pasa, luego se podrá guardar aprendizaje reusable por appSlug.

## 3) Orden de decisión
- resolutores locales primero
- deterministic/direct candidates segundo
- IA compacta tercero
- failure normal si IA no puede resolver

## 4) Límites
La IA NO debe:
- controlar el navegador
- modificar repo
- inventar selectores
- devolver CSS/XPath/testId inventados
- recibir secretos
- manejar OTP/password/API keys
- resolver pagos, transferencias, contratos, préstamos o acciones irreversibles
- reemplazar runtimeEvidenceTrace ni resolutores locales

## 5) Contrato de entrada
La IA recibe solo un context-pack compacto con:
- appSlug
- failure
- currentStep
- currentUrl
- snapshotSummary
- candidates visibles
- runtimeEvidenceTrace
- structuralEvidence
- feedbackEvidence
- pendingAssertions
- previousActions
- previousFills
- constraints

No debe recibir:
- repo completo
- logs gigantes
- secretos
- OTP
- passwords
- API keys
- datos sensibles innecesarios

## 6) Contrato de salida
La IA solo puede devolver JSON mínimo con una decisión:
- repaired_plan
- no_safe_action
- needs_more_context

Si decision = repaired_plan, debe usar un candidateId existente del context-pack.

## 7) Alcance inicial
Integrar IA solo para `target_not_found` después de que fallen los resolutores locales.

No integrar todavía en:
- assertions
- POM repair
- route recovery completo
- repo patches

## 8) Futuro
Luego extender a:
- route_recovery
- assertion_resolution
- pom_method_missing
- selection_resolution
- aprendizaje reusable por appSlug
