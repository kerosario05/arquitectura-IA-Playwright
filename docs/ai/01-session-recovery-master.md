# 01 — Session recovery master (checkpoint técnico)

> Origen: sesión Claude Code `92da4817-1cfb-4a51-be97-2b7e9cb9ef94` (cuenta anterior), 2026-10-21 → 2026-11-04, ~74 000 líneas / 269 MB.
> Método: lectura incremental por script (streaming JSONL) de mensajes de usuario, 21 resúmenes de compactación (los más densos), últimos ~215 turnos y lista de archivos editados. No se ejecutó ningún job, spec ni prueba; no se modificó código ni configuración.
> Sin credenciales, tokens ni cédulas reales. Los job ids sí se citan (son evidencia, no secretos).
> Etiquetas: **[HIST]** = dicho por el historial/resúmenes (no re-verificado). **[REPO]** = comprobado hoy en disco. **[NO VERIFICADO]** = sin respaldo suficiente.

## 1. Reglas permanentes del usuario (preservar)
- Respuestas en español, breves. Fixes **genéricos y multiproyecto**: sin hardcodes de proyecto/ruta/label/cédula ("nada hardcode a proyectos").
- Regla CLAUDE.md: *NO FRESH RUN → NO FUNCTIONAL DIAGNOSIS → NO FIX*; preservar fronteras PHYSICAL GREEN; una first-loss por iteración; actualizar `docs/ai/00-current-state.md` al cerrar iteración QA Lab.
- No lanzar jobs sin orden explícita; ser explícito con escrituras a DB (backup antes; el usuario autoriza caso por caso); comandos largos en segundo plano; reiniciar backend antes de lanzar ejecuciones cuando el cambio es de servicio.
- No tocar el grabador (`src/recording/web/*`, `capture-engine-v2.*`) sin aprobación. No repetir `git stash` en repo sucio. Nunca imprimir secretos de `.env`.
- Lección: una vez se sobrescribió `src/discovery/click-retry-policy.ts` con Write sin leerlo (restaurado desde git). Leer antes de escribir.
- Windows: PowerShell/Write tool; el quoting de bash falla. `node --test` con lista vacía corre toda la suite: pasar siempre archivos explícitos.

## 2. Arquitectura / componentes involucrados [HIST, confirmado en parte con CLAUDE.md]
- **Engine QA Lab** `:3002` (`node --import tsx src/server/server.ts`, jobs en memoria; reiniciar mata jobs; rerun vía `POST /api/runs/<id>/rerun`, con fallback a artefactos). **BFF** `:3001` y **Vite** `:5173` en `C:\MisProyectos\QA-lab-main`. Preview-child por job carga el código al arrancar (cambios de discovery aplican sin reiniciar; cambios de servicio —cédulas, release, rutas— exigen reiniciar el engine). Servicios mueren si se detiene la tarea que los lanzó → arrancar desacoplados (`Invoke-CimMethod Win32_Process Create`).
- **Cadena Recording → Discovery → Spec → Promoción**: `trace.json` → `normalizeEvents` → `buildSemanticRecordingModel` → escenarios → discovery (`case-discovery.ts`, `target-resolver.ts`) → generación de spec (`spec-execution-contract.ts`, `deterministic-spec-compiler.ts`) → `spec_execution` (`promoted-spec-runtime.ts`) → gate de promoción. Etapas del gate: structural, traceFidelity, semanticCoverage, typescript, playwright collection, `spec_execution`.
- **Servicio de cédulas** (`src/server/services/data-cedulas-*.ts`, `recording-fresh-cedulas.ts`, `fico-engine-probe.ts`, `scripts/prepare-ready-cedulas.ts`, rutas `src/server/routes/data-cedulas.ts`, panel `QA-lab-main/src/pages/Configuracion/ReadyCedulasPanel.tsx`): DB SQL Server `BitacoraBuro` (SRVDEVBIZDB01), Oracle QA1, Lexis/PLAFT vía MDW (`172.20.18.142:8732`). Regla clave: Discovery usa cédula A; validación del spec promovido usa cédula B distinta.
- Otros frentes de la sesión (resueltos): módulo Jira (caso 55032), Diseño de pruebas, portal ficticio `portal-comercial-pj` (:4310/:4311), cancelación de solicitudes Portal Comercial.

## 3. Hallazgos técnicos confirmados (causa raíz) [HIST]
**Servicio de cédulas / motor de decisiones**
- `sp_GetConsulta` re-consulta TransUnion y sobrescribe datos si `DATEDIFF(day, DatosGenerales.FechaProceso, GETDATE())` supera min(`DIASVIGENCIA`, tolerancia del portal <342 d). Solo una fecha maestra fresca por cédula garantiza usar lo almacenado. Editar tablas hijas sin tocar `FechaProceso` no sirve (TU sobrescribe). FK `FK_Activas_DatosGenerales`: actualizar `DatosGenerales` in place.
- Motor `MotorDecisionesFICO` (probe `fico-engine-probe.ts`): acepta cualquier `numeroSolicitud`; edad aprobada hasta ~66 (Flag 5; 71/87 rechazo); ingreso mínimo 60 000 (Flag 17); aprobación ≈75–85 % de las que pasan filtros; Multicrédito suele rechazar (Flag 26).
- Defaults vigentes del servicio [HIST+doc 00-current-state]: ingreso ≥60 000, score ≥780, segmento EXP, edad 21–66, ≤5 préstamos, ≤8 tarjetas, ratio pago ≤0.25, historial limpio, sin límite de vigencia de score. Cadena de entrega: liberar solicitudes abiertas (Bizagi SQL + Oracle + lista del Portal) → preparar (`FechaProceso=now` con backup JSON en `.artifacts/data-cedulas-backups/`) → pre-check de motor.
- Generador "cédulas listas": stock en `.artifacts/data-cedulas-ready.json`, hold 2 h; llegó a **446/500** aprobadas (~410 usables) y quedó pausado por intermitencia Lexis/PLAFT. `DATA_CEDULAS_MAX_BATCHES` en `.env` es 1000 (el motor debe reiniciarse para tomar cambios de `.env`).
- `DATA_CEDULAS_FORCED_IDS` debe estar vacío (usar stock).

**Discovery / replay (Portal Comercial, grabación `fde5fc4f-589e-4fb1-bc2e-11e8f8c22176`, TestRail 56967, "Inicio Fenix", 136 pasos)**
- Paso 69/70 (seguros): el peso (InputNumber PrimeVue) quedaba vacío → tarjetas de seguro no aparecían → "Presionar PRESTAMO CONSUMO HUMANO" colgaba. Fix: `filled-input-repair.ts` + `isSecretInput` (confirmado en job `b35c9c8a`: `[fill-repair] field="Peso (lbs)"… retyped=true`).
- Lentitud: esperas 2×120 s por falso loader (clases `upload/download`); corregido en `execution-plan-executor.ts` (paso 68: 272 s→51 s).
- Documentos "Cargar" de la pestaña *Firma*: filas repetidas; fix por fila (`data-codex-pick-row`), espera de indicador de subida, fallback cuando todos los siblings están "completados" (paso 128). El selector de archivos abierto cuenta como resultado de clic (`openedFileChooser`, paso 108); esa regla se quitó una vez y se reaplicó porque sin ella el paso 108 falló 2 de 5 jobs.
- Paso 11 (*Depurar*): falla por intermitencia MDW/Bizagi/PLAFT (HTTP 5xx, `ConsultarCasosBizagiORACLE` 10–24 s) o modal "Casos activos… MPN-xxxx". Mitigación: reintento genérico de clics de lookup 3× (`src/discovery/lookup-click-retry.ts`, cubre error visible, 5xx y postcondición no alcanzada) + liberación de solicitudes del Portal. Es **externo** al código; el firewall `srvdevqaca01 (172.27.4.97) → 172.20.18.142:8732` quedó pendiente del usuario.
- Servicio MDW corre con cuenta de dominio distinta; desde su servidor Lexis responde (TCP/HTTPS 200 en 0.27 s) pero el servicio MDW agota 20–30 s (`TrnOk=0`): sospecha TLS/proxy de cuenta de servicio. [NO RESUELTO]

**Spec / promoción (bloqueo actual del caso 56967)**
- Discovery completa 136/136 de forma fiable (jobs `4dfe6071`, `8709336e`, `df603817`, `f23eb088`, y otros).
- `spec_execution` falla en **paso 43** del spec: `structured_selection_control_unresolved target="24 - PRESTAMOS PERSONALES FACILES"`; log `selection_surface_not_observed field="Producto"` (combo dependiente de Categoría, no abre; ~70 s perdidos).
- Raíz propuesta: `plan.json` paso 43 sin `locatorStrategy` (`strategy: undefined`; pasos 42/44 sí `selection_option_causal_surface`) → compilador emite `display_fallback` sin `technicalTargetRefs`. Opciones: (a) dar estrategia a la rama de discovery que devuelve selección sin `locatorStrategy`; (b) usar refs técnicas del contrato cuando falta estrategia.
- Fix aplicado (b) en `src/automations/spec-execution-contract.ts` (usa la ref estable `role:option|…` de la lista cuando el paso no trae `technicalTargetRef`). **Sin validar**: ningún job llegó a `spec_execution` después. Un reintento previo de reapertura del desplegable en `promoted-spec-runtime.ts` (~línea 6131) no dejó rastro en logs (`[runtime:selection-owner-retry]` ausente) — inexplicado.
- Paso 103 `Gestión Documental N`: el badge numérico cambia según la cédula (8 vs 9). Fix en `target-resolver.ts` (comparar también nombre accesible). **No funcionó** en `f2ef34d8` ni `f78a4526`: ambos quedaron en bucle `recorded_target_not_present_or_unique` en el paso 103 (resolver_end ~602 s `not_found`) [REPO: confirmado en logs]. Hipótesis (sin verificar): el bucle interno de espera del botón grabado agota antes de la lógica relajada `volatileNumericLabelRetry`; hay que poner la tolerancia dentro de ese bucle.
- Nota: la sesión de Codex (según `00-current-state.md`, 2026-11-04) añadió además una variante: omitir el número solo si el botón resultante es único/visible/habilitado, con test `target-resolver.recorded-count-badge.test.ts`; y otros fixes (detector de cambio post-clic, índices de filas confirmadas). Contrastar con el código antes de tocar de nuevo el paso 103.

## 4. Hipótesis descartadas / correcciones de rumbo [HIST]
- "Editar tablas BitacoraBuro cambia lo que ve el motor" → falso sin `FechaProceso` fresca.
- Piso de ingreso 79 200 derivado del salario declarado → incorrecto; el motor exige 60 000 (ratio de ingreso declarado queda apagado por defecto).
- Cédulas 2025 gratis del servicio → no: límite 60 d original; hoy se traen preparando `FechaProceso`.
- "PLAFT del paso 11 = cédula mala" → descartado: cédulas distintas fallan igual; es el entorno MDW.
- Fallo del paso 43 = "login timeout puntual" en un job → one-off, no la causa.

## 5. Archivos más tocados en la sesión (por nº de ediciones en el historial) [HIST]
Repo backend: `src/automations/runtime/promoted-spec-runtime.ts` (121), `src/discovery/case-discovery.ts` (93), `src/discovery/target-resolver.ts` (69), `src/server/services/data-cedulas-new-customer.ts` (51), `src/recording/canonical-recording-contract.ts` (20), `data-cedulas-reuse.ts` (18), `capture-engine-v2.browser-instrumentation.ts` (17), `portal-comercial-request-cancellation.ts` (15), `file-chooser-capture.ts` (15), `spec-execution-contract.ts` (14), `scripts/prepare-ready-cedulas.ts` (14), `routes/runs.ts` (13), `live-view-session.ts` (13), `recorded-runtime-actions.ts` (12), `recording-fresh-cedulas.ts`, `fico-engine-probe.ts`, `execution-plan-executor.ts`, `web-session-recorder.ts`, `deterministic-spec-compiler.ts`, `routes/data-cedulas.ts`.
Front `QA-lab-main`: `pages/Recording/index.tsx` (24), `pages/TestDesign/*`, `Sidebar.tsx`, `ReadyCedulasPanel.tsx`, `server/routes/recordings.ts`.
Portal ficticio: `C:\MisProyectos\portal-comercial-pj\public\app.js`, `core.js`, `aprobaciones/public/app.js`.
[REPO] `git status` hoy: 360 entradas modificadas en el árbol de trabajo (rama `QA_Record_V2_Backup_Final`, sin commit de este trabajo). Mezcla cambios de esta sesión y de sesiones Codex posteriores: no atribuir por archivo sin `git diff`.

## 6. Pruebas conocidas [HIST]
- Fallos preexistentes (no nuestros): resolver 204 pass/15 fail (baseline posterior ~17); `scenario-preview-runner.reuse-evidence` 2; recording canonical 23; `promoted rerun requests only one…` 1; compilador/contrato 4; promoted-spec-runtime 12–14; case-discovery ~26; suites jira ~14. Solo preocupa si empeoran.
- Tests nuevos verdes reportados: `data-cedulas-new-customer` 16, `data-cedulas-reuse` 10, `fico-engine-probe` 3, `selection-label-owner` 2, `filled-input-repair` 3, trace-normalizer placeholder 3, capture-engine placeholder 3.
- `tsc --noEmit` limpio tras los últimos fixes de la sesión.

## 7. Lo que NO se pudo reconstruir
- Contenido íntegro de los ~10 000 mensajes de usuario y 16 000 de asistente (solo muestreo + resúmenes). Detalles de cada fix intermedio (líneas exactas) → ver `git diff` y transcript.
- Qué cambios exactos del árbol de trabajo pertenecen a esta sesión vs a Codex/otras sesiones.
- Si la promoción de `fde5fc4f` ocurrió después del último turno (2026-11-04 06:12 UTC): los logs de `.artifacts/scenario-preview-runs/` posteriores no mencionan `fde5fc4f` y ninguno muestra `specsPromoted=1` en lo revisado; **no concluyente**.
- Estado del firewall/MDW y de la meta (`/goal`): no consultable.
