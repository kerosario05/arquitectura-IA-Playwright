# AI Repair Architecture (MCP Contract)

## 1) Principio central

La IA no reemplaza el motor MCP. La IA actúa solo como asesor de reparación cuando los resolutores locales no pueden resolver de forma segura.

**Reglas de oro:**
- IA no controla navegador
- IA no modifica repo
- IA no inventa selectores
- IA no recibe secretos
- MCP siempre valida antes de ejecutar
- MCP siempre puede rechazar decisión de IA

## 2) Flujo esperado

```
MCP ejecuta paso
-> falla
-> clasifica fallo (target_not_found, route_not_found, assertion_not_satisfied, ambiguous_selection)
-> ejecuta resolutores locales
-> si no pueden resolver:
   - construye context-pack compacto
   - llama al AI Provider
   - IA devuelve JSON mínimo
   - MCP valida schema, candidateId/evidenceId, visibilidad, actionability y seguridad
   - MCP aplica la decisión solo si es segura
   - MCP persiste diagnostics y metrics
-> si pasa, guarda aprendizaje reusable por appSlug (futuro)
```

## 3) Orden de decisión

1. Resolutores locales primero
2. Deterministic/direct candidates segundo
3. IA compacta tercero
4. Failure normal si IA no puede resolver

## 4) Límites

**La IA NO debe:**
- Controlar el navegador directamente
- Modificar el repo
- Inventar selectores (CSS/XPath/testId/locator)
- Devolver CSS/XPath/testId inventados
- Recibir secretos (password, OTP, API keys, tokens)
- Manejar OTP/password/API keys
- Resolver pagos, transferencias, contratos, préstamos o acciones irreversibles
- Reemplazar runtimeEvidenceTrace ni resolutores locales

**La IA SOLO puede:**
- Seleccionar candidateId existente del context-pack
- Seleccionar evidenceId existente de evidenceCandidates
- Devolver decisión: repaired_plan, no_safe_action, needs_more_context

## 5) Contrato de entrada (Context-Pack)

**La IA recibe solo un context-pack compacto con:**
- `appSlug`: identificador de la aplicación
- `failure`: tipo de fallo (target_not_found, route_not_found, etc.)
- `currentStep`: descripción del paso fallido
- `currentUrl`: URL actual
- `snapshotSummary`: resumen de elementos visibles
- `candidates`: lista de candidatos visibles con candidateId
- `runtimeEvidenceTrace`: evidencia de intentos de localización
- `structuralEvidence`: diagnóstico estructural
- `feedbackEvidence`: mensajes de feedback recientes
- `pendingAssertions`: assertions pendientes
- `previousActions`: acciones previas
- `previousFills`: fills previos
- `constraints`: restricciones de seguridad

**No debe recibir:**
- Repo completo
- Logs gigantes
- Secretos (redactados automáticamente)
- OTP
- Passwords
- API keys
- Datos sensibles innecesarios

**Campos específicos por repairType:**

| repairType | Additional Fields |
|------------|-------------------|
| target_resolution | (base fields only) |
| route_recovery | targetRoute, currentScreen, routeHistory |
| assertion_resolution | assertionTarget, assertionText, evidenceCandidates |
| selection_resolution | selectionTarget, selectionIntent, selectionCandidates |

## 6) Contrato de salida (RepairDecision)

**La IA solo puede devolver JSON mínimo:**

```json
{
  "decision": "repaired_plan" | "no_safe_action" | "needs_more_context",
  "repairType": "target_resolution" | "route_recovery" | "assertion_resolution" | "selection_resolution",
  "candidateId": "string (for target/route/selection)",
  "evidenceId": "string (for assertion)",
  "reason": "string",
  "confidence": 0.0-1.0
}
```

**Si decision = repaired_plan:**
- Debe usar candidateId/evidenceId existente del context-pack
- No puede inventar nuevos IDs
- Debe incluir reason y confidence

**RepairType-specific fields:**

| repairType | Required Fields | Optional Fields |
|------------|-----------------|-----------------|
| target_resolution | candidateId | - |
| route_recovery | candidateId | - |
| assertion_resolution | evidenceId, assertionStatus | - |
| selection_resolution | candidateId, selectionStatus | - |

## 7) Repair Types Soportados

### 7.1 target_resolution

**Cuándo se usa:** Elemento no encontrado (target_not_found)

**Flujo:**
1. Target resolver local falla
2. Auth gate recovery intenta (si aplica)
3. AI repair invocado con candidates visibles
4. IA selecciona candidateId existente
5. MCP valida candidate visible/clickable/no sensible
6. MCP ejecuta click/fill
7. Verifica navegación/estado

**Ejemplo decisión:**
```json
{
  "decision": "repaired_plan",
  "repairType": "target_resolution",
  "candidateId": "btn-add-cart",
  "reason": "Candidate matches target text and is visible.",
  "confidence": 0.85
}
```

### 7.2 route_recovery

**Cuándo se usa:** Navegación fallida o pantalla incorrecta (route_not_found, navigation_dead_end, wrong_screen)

**Flujo:**
1. Route resolver local falla
2. IA recibe currentScreen + routeHistory
3. IA selecciona candidateId para navegación
4. MCP valida candidate visible/clickable/no sensible
5. MCP ejecuta click
6. Verifica cambio de URL/screen
7. Marca failedRoutePath para loop prevention

**Ejemplo decisión:**
```json
{
  "decision": "repaired_plan",
  "repairType": "route_recovery",
  "candidateId": "nav-products",
  "reason": "Link navigates to products section.",
  "confidence": 0.82
}
```

### 7.3 assertion_resolution

**Cuándo se usa:** Assertion no satisfecha después de resolutores locales (needs_assertion_resolution)

**Flujo:**
1. Assertion resolver local falla
2. Runtime evidence trace closure
3. Structural evidence closure
4. Feedback evidence closure
5. AI repair invocado con evidenceCandidates
6. IA selecciona evidenceId existente
7. MCP valida evidenceId visible/no sensible
8. Marca assertion como satisfied_by_ai_existing_evidence

**Ejemplo decisión:**
```json
{
  "decision": "repaired_plan",
  "repairType": "assertion_resolution",
  "evidenceId": "ev-success-msg",
  "assertionStatus": "satisfied_by_existing_evidence",
  "reason": "Feedback message confirms assertion is satisfied.",
  "confidence": 0.95
}
```

### 7.4 selection_resolution

**Cuándo se usa:** Selección ambigua con múltiples candidatos (ambiguous_selection)

**Flujo:**
1. Selection resolver local falla por ambigüedad
2. Product condition resolver intenta
3. First-visible deterministic resolver (si seguro)
4. Selection-state detector intenta
5. AI repair invocado con selectionCandidates
6. IA selecciona candidateId existente
7. MCP valida candidate visible/clickable/no sensible
8. MCP ejecuta click
9. Verifica cambio de selección/estado

**Ejemplo decisión:**
```json
{
  "decision": "repaired_plan",
  "repairType": "selection_resolution",
  "candidateId": "product-card-1",
  "selectionStatus": "selected",
  "reason": "Premium Edition best matches selection criteria.",
  "confidence": 0.82
}
```

## 8) Validación (MCP)

**Validator verifica:**
- Schema válido (decision, repairType, reason)
- candidateId/evidenceId existe en context-pack
- Candidate visible (si repaired_plan)
- Candidate actionable (clickable/enabled)
- Candidate no sensible
- No selector invention (CSS/XPath/locator/testId)
- No invented text patterns ("I think", "probably", "maybe")
- Confidence 0..1

**Errores de validación:**
- `AI_REPAIR_SCHEMA_INVALID`: Schema inválido
- `AI_REPAIR_MISSING_CANDIDATE`: candidateId faltante
- `AI_REPAIR_MISSING_EVIDENCE`: evidenceId faltante
- `AI_REPAIR_UNKNOWN_CANDIDATE`: candidateId no existe
- `AI_REPAIR_UNKNOWN_EVIDENCE`: evidenceId no existe
- `AI_REPAIR_CANDIDATE_NOT_VISIBLE`: candidate no visible
- `AI_REPAIR_EVIDENCE_NOT_VISIBLE`: evidence no visible
- `AI_REPAIR_CANDIDATE_NOT_ACTIONABLE`: candidate no accionable
- `AI_REPAIR_SENSITIVE_ACTION_BLOCKED`: candidate/evidence sensible
- `AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED`: evidence sensible para assertion
- `AI_REPAIR_SELECTOR_INVENTED`: selector invention detectado
- `AI_REPAIR_ASSERTION_TEXT_INVENTED`: texto inventado/incierto

## 9) Ejemplo: ai-repair-summary.json

```json
{
  "enabled": true,
  "invocations": 3,
  "providerName": "gemini",
  "model": "gemini-2.5-flash",
  "decisionCounts": {
    "repaired_plan": 2,
    "no_safe_action": 1,
    "needs_more_context": 0,
    "invalid_response": 0,
    "provider_error": 0,
    "provider_disabled": 0
  },
  "validationCounts": {
    "valid": 2,
    "blocked": 1,
    "invalid": 0,
    "error": 0
  },
  "repairTypeCounts": {
    "target_resolution": 1,
    "route_recovery": 1,
    "assertion_resolution": 0,
    "selection_resolution": 1,
    "pom_method_missing": 0,
    "unknown": 0
  },
  "appliedRepairs": 2,
  "blockedRepairs": 1,
  "avgDurationMs": 145,
  "maxDurationMs": 230,
  "targets": [
    {
      "stepIndex": 5,
      "target": "Add to Cart",
      "action": "click",
      "decisionStatus": "repaired_plan",
      "validationStatus": "valid",
      "repairType": "target_resolution",
      "selectedCandidateId": "btn-add-cart",
      "blockedReason": null,
      "durationMs": 120,
      "providerName": "gemini",
      "model": "gemini-2.5-flash"
    }
  ]
}
```

## 10) Ejemplo: ai-repair-batch-summary.json

```json
{
  "casesWithAiRepair": 2,
  "totalInvocations": 5,
  "appliedRepairs": 3,
  "blockedRepairs": 2,
  "providerErrors": 0,
  "invalidResponses": 0,
  "avgDurationMs": 156,
  "byProvider": {
    "gemini": {
      "invocations": 5,
      "appliedRepairs": 3,
      "blockedRepairs": 2,
      "providerErrors": 0,
      "avgDurationMs": 156
    }
  },
  "cases": [
    {
      "caseId": "c37948",
      "appSlug": "arquitectura-automatizacion",
      "invocations": 3,
      "appliedRepairs": 2,
      "blockedRepairs": 1
    },
    {
      "caseId": "c99997",
      "appSlug": "arquitectura-automatizacion",
      "invocations": 2,
      "appliedRepairs": 1,
      "blockedRepairs": 1
    }
  ]
}
```

## 11) Troubleshooting

### IA no se invoca

**Verificar:**
```bash
# 1. AI_REPAIR_ENABLED=true en .env
# 2. AI_PROVIDER configurado correctamente
# 3. AI_API_KEY presente (si requiere)
# 4. Logs: [ai-repair] enabled provider=...
```

### IA devuelve invalid_response

**Causas comunes:**
- candidateId/evidenceId no existe en context-pack
- Candidate no visible
- Candidate sensible (pago, password, OTP)
- Selector invention detectado en reason
- Texto incierto ("I think", "probably")

**Solución:**
```bash
# Revisar logs: [ai-repair] decision=status invalid_response
# Revisar diagnostics.errorCode en ai-repair-summary.json
```

### Provider error

**Causas:**
- API key inválida
- URL base incorrecta
- Timeout excedido
- Rate limit

**Solución:**
```bash
# Verificar AI_BASE_URL, AI_API_KEY
# Aumentar AI_TIMEOUT_MS
# Revisar logs del provider
```

### Selection no se resuelve

**Verificar:**
- Hay múltiples candidatos visibles
- Ningún candidato es sensible
- Local resolver falló por ambigüedad (status=ambiguous)

## 12) Comandos de Validación

```bash
# Typecheck
npm run typecheck

# AI Repair tests
npm run test:framework -- --grep "ai-repair"

# Smoke gate (fake provider)
npm run ai:validate

# Smoke gate (real provider)
npm run ai:validate:real

# Promoted runtime validation
npm run promoted:validate-runtime -- --app arquitectura-automatizacion
```

## 13) Configuración (Environment Variables)

Ver `.env.example` para configuración completa.

**Core:**
- `AI_ENABLED=true`
- `AI_PROVIDER=openai_compatible`
- `AI_PROVIDER_NAME=gemini`
- `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
- `AI_API_KEY=...`
- `AI_MODEL=gemini-2.5-flash`

**Repair:**
- `AI_REPAIR_ENABLED=true`
- `AI_REPAIR_MODE=compact`
- `AI_REPAIR_MAX_CONTEXT_CHARS=30000`
- `AI_REPAIR_REQUIRE_JSON=true`
- `AI_REPAIR_REQUIRE_JSON_SCHEMA=true`
- `AI_REPAIR_MUST_RETURN_EXISTING_CANDIDATE_ID=true`
- `AI_REPAIR_MUST_USE_VISIBLE_CANDIDATE=true`
- `AI_REPAIR_BLOCK_SENSITIVE_ACTIONS=true`
- `AI_REPAIR_BLOCK_AUTH_SECRETS=true`
- `AI_REPAIR_BLOCK_PAYMENTS=true`
- `AI_REPAIR_BLOCK_TRANSFERS=true`

**Attempt Limits:**
- `AI_ROUTE_RECOVERY_MAX_ATTEMPTS_PER_CASE=1`
- `AI_ASSERTION_REPAIR_MAX_ATTEMPTS_PER_CASE=1`
- `AI_SELECTION_REPAIR_MAX_ATTEMPTS_PER_CASE=1`

## 14) Seguridad

**Secretos redactados automáticamente en context-pack:**
- password, contrasena
- otp, pin
- token
- api_key, api-key, apikey
- authorization
- secret

**Acciones bloqueadas por defecto:**
- Pagos (payment, pago, card, cvv)
- Transferencias (transfer, transferencia)
- Auth secrets (password, otp, token)
- Sensibles (configurado por candidate.sensitive=true)

## 15) Métricas y Artifacts

**Archivos generados:**
- `evidence/ai-repair-summary.json`: Case-level summary
- `evidence/ai-repair-batch-summary.json`: Batch-level summary
- `evidence/step-X-assertion.json`: Assertion diagnostics con aiRepairDiagnostics
- `evidence/step-X-snapshot.json`: Snapshot con aiRepairDiagnostics

**Diagnostics por step:**
```json
{
  "aiRepairDiagnostics": {
    "enabled": true,
    "providerName": "gemini",
    "model": "gemini-2.5-flash",
    "failureType": "target_not_found",
    "decisionStatus": "repaired_plan",
    "validationStatus": "valid",
    "selectedCandidateId": "btn-add-cart",
    "blockedReason": null,
    "durationMs": 145
  }
}
```
