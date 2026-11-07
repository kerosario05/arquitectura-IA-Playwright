# 02 — Cronología de la sesión `92da4817…` (2026-10-21 → 2026-11-04)

Fuente: 21 resúmenes de compactación + muestreo de mensajes + cola de la sesión. Fechas en UTC aproximadas. **[HIST]** salvo indicación. Cada bloque nombra el job/evidencia citado en el historial; no mezclar resultados entre jobs.

| Fecha | Objetivo | Resultado / evidencia |
|---|---|---|
| 10-21 | "Reejecutar" no relanzaba casos; run TestRail 4870 (Fenix) a promover con fix genérico | Grabación promovida: job `c7e60331` (`functionalExecution=passed`, `specsPromoted=1`). Caso Jira 55032 (job `37a8666d`) bloqueado por "observable oracle unresolved (8)" |
| 10-23 | Caso 55032 + construir portal web ficticio `portal-comercial-pj` (flujo del PDF "Portal Persona Jurídica V2") para estresar motores Jira/Recording | Promoción 55032 resuelta (contrato/compilador/runtime/selección). Portal ficticio en :4310 (+ aprobaciones :4311) |
| 10-25 | Diseño de pruebas (AA-113, 81 casos) → adaptar pasos, crear escenario nuevo, subir a TestRail (sección "portal comercial"), lanzar | Pass-rate 21 % → 73 %; fallos abiertos 1,3,8,9,17,20,26 |
| 10-26 | Grabar ≥10 escenarios con módulo Grabación → reproducir y subir a TestRail → lanzar y corregir | Regresión discovery 100 % (51/51). Precondiciones de Diseño verificadas físicamente (incl. `custom_preconds`) |
| 10-27 | Ciclo completo Lanzar pruebas / Diseño / Grabación; spec promovido con validaciones en prosa; triage de tests rojos | Job `785d4f41` PASS (oráculo final Jira), job `1d39015f` y `63517594` PASS (ruta UI Jira con discovery+promoción+reuse) |
| 10-28 | Probar Grabación vía UI con dos apps (web A :4310, web B Aprobaciones :4311), cambio de pestaña, adjuntos 1/2/3/5 | Replay de dos apps PASA: job `95a22429`; aislamiento de documentos por proyecto verificado. Variantes 1/2/5 docs, Northstar, negativos sin verificar |
| 10-28/29 | "Crear Cliente" Portal Comercial: acelerar replay, capturar re-selecciones en dropdowns custom | Ruta dinámica de Depurar tras 3 observaciones, settle_data `verified=true`; quedó sin verificar el mislabel de re-selección (pasos 43/44) y "Plazo 12 meses" huérfano |
| 10-29/30 | Meta con Stop-hook: promover "Crear Cliente V2" con cancelación automática de solicitudes QA previa al spec | Cancelación backend con switch verificada; discovery 48 pasos; error del Portal `GetRate 404` (externo) → `specsPromoted=0`; usuario aceptó cerrar |
| 10-30 | Nueva meta: promover grabación `94252931` ("Crear Cliente V2", escenario `REC-94252931-01`) usando servicio "tomar cédula" (sin PLAFT) y segunda cédula "Cédula Spec" | Capturada la pregunta en 6 radios Sí/No; búsqueda (`interaction-27`) incluida; pasos 1–64 con cédula limpia (job `c656e1d6`) |
| 10-31 | Mismo caso: pasos 65–104 | Jobs `b475682c`, `ea675194`, `cd109b4f` pasan discovery 1–104; bloqueo: generación de documentos del Portal/webhook |
| 11-01 | Mismo caso | **PROMOVIDO**: job `c294e51c-d6c4-47e0-a38a-46cfb4adb616` (`promotionStatus=promoted`, `specsPromoted=1`, segunda cédula verificada, 32.3 min). Sección de documentos 14m46s → ~40 s |
| 11-02 | Acelerar replays (subidas 1.2–1.7 s; job 19.8→10.8 min), tasas del Portal para usuario QA, filtro de frescura 30 d | Mejoras de tiempos confirmadas; tasas del Portal sin confirmar |
| 11-02 (tarde) | Nueva meta: promover recording `fde5fc4f` ("Inicio Fenix", AA-97, TestRail 56967); job fuente `31afde82` | Fix de paso 44 `target_not_found` (interacción excluida filtraba su valor a `valueKey` compartido); rerun `ffcb00d8`, luego `a5702132` (paso 47 volatilidad de tasa) |
| 11-03 mañana | Cédulas: contar usables, ampliar; implementar niveles 1–3 ("implementalo") | `data-cedulas-prepare.ts`, filtros reales del motor, pre-check FICO, panel "Generación de cédulas listas", notificación y botón deshabilitado hasta completar, 107→446 aprobadas |
| 11-03 11:50–15:00Z | Job se congela en paso 69 (seguros) | Job `b35c9c8a` pasa 69 y 70 tras fill-repair; medición de tiempos → arreglos de falsos loaders; relanzamientos `ee2f044d`, `fb8db470` caen en paso 11 (MDW) |
| 11-03 15:00–19:00Z | Diagnóstico MDW/Lexis, permisos de firewall (xlsx preparado para el usuario) | Servicio MDW responde a ratos; causa no cerrada (ver master §3) |
| 11-03 19:30Z | `ebecec1f` completa 136 pasos de discovery en 13 min por primera vez; promoción bloqueada por 3 documentos de *Firma* sin adjuntar | Fix por fila + espera de indicador |
| 11-03 20:00–23:40Z | Reintento de Depurar (3×); fix 5xx; cédula con modal "Casos activos" (liberación por Portal) | Jobs `d96e0bfd`, `74b1d289` (falla paso 112), `0335eb62` (Firma ok), `4dfe6071` **136/136 + validación estructural/semántica/TS ok, `spec_execution` ✘** |
| 11-04 00:15–00:47Z | Localizar paso de promoción que falla; dejar handoff a Codex | `spec_execution` paso 43 (`Producto`). Handoff: `docs/ai/codex-handoff-promote-portal-comercial.md` |
| 11-04 02:24–04:28Z | Paso 108 `click_no_transition`; servicios caídos; reaplicar regla `openedFileChooser` | `f23eb088` discovery completo pero spec falla en paso 43; `53901d86` marcado atascado antes del paso 125 |
| 11-04 04:30–06:11Z | Fix `spec-execution-contract.ts` para paso 43; luego paso 103 (badge 8 vs 9) | Jobs `f2ef34d8`, `f78a4526`: bucle en paso 103, `specsPromoted=0`. Última acción: vigilante esperando `f78a4526` |
| 11-04 06:12Z | Fin de la sesión | Límite mensual de gasto alcanzado; 20:15Z "Login expired" |

## Después de la sesión (otra gestión, no de esta cuenta) [REPO: `00-current-state.md`]
- Entradas del 2026-11-04 en `docs/ai/00-current-state.md` (líneas ~870–1000): rerun con fix de badge único (`a9666a92`, `ccde1f2a`, `cf255d86`, `356bc904`), detector post-clic, índices confirmados por grupo en *Cargar*, toggle `RECORDING_SPEC_GENERATION_ENABLED` (false local → Discovery sin spec/promoción), scheduler de jobs concurrentes, y varios objetivos de otros proyectos (Fenix SMS, teclado virtual, "Casa" popup). El job `356bc904…` seguía `running` en la última entrada relevante; **resultado final no registrado**.
