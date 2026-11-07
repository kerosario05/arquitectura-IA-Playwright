# 03 — Estado actual y siguientes pasos (recuperación)

Fecha de recuperación: 2026-11-04. Distingue **Histórico (HIST)** de **Verificado hoy (REPO)**.

## A. Último estado conocido (HIST, sesión original, 2026-11-04 ~06:12Z)
- Meta: promover la grabación `fde5fc4f-589e-4fb1-bc2e-11e8f8c22176` (Portal Comercial, TestRail 56967, 136 pasos) con fixes genéricos. **No promovida** (`specsPromoted=0`).
- Discovery: 136/136 pasó en varios jobs. Gate: structural ✔, semantic ✔, typescript ✔, collection ✔, **`spec_execution` ✘ en paso 43** (desplegable dependiente *Producto*).
- Fix para paso 43 (`spec-execution-contract.ts`, usar ref `role:option|…`) aplicado pero **nunca ejecutado** en `spec_execution`: los jobs posteriores (`f2ef34d8`, `f78a4526`) murieron antes, en discovery paso 103.
- Paso 103 (`Gestión Documental 9` vs `8`): fix de nombre accesible aplicado, **no resolvió** (bucle `recorded_target_not_present_or_unique`).
- Generador de cédulas listas pausado en 446/500 por Lexis/PLAFT intermitente; stock ~410 usable.

## B. Verificado hoy en el repo [REPO]
- Archivo JSONL legible, 269.5 MB, 74 084 líneas, 2026-10-21 → 2026-11-04T20:16Z.
- Rama `QA_Record_V2_Backup_Final`, HEAD `5027515`; 360 entradas sin commit (mezcla de varias sesiones).
- Engine `:3002` responde `/health` ok (alguien lo levantó después). No se probó BFF/Vite.
- Jobs `f2ef34d8` y `f78a4526` en `.artifacts/scenario-preview-runs/`: `specsPromoted=0`, ambos terminan en paso 103 `status=not_found` (~602 s) con ~230 líneas `recorded_target_not_present_or_unique`.
- `docs/ai/00-current-state.md` fue editado después por otras sesiones (Codex): tiene un historial del 2026-11-04 sobre este mismo caso (jobs `a9666a92`, `ccde1f2a`, `cf255d86`, `356bc904`) y variante del fix de paso 103 (omitir badge solo si botón único) + test `target-resolver.recorded-count-badge.test.ts`. Resultado final de `356bc904` **no registrado**.
- Jobs creados desde 11-04 08:28 hasta 16:46 no contienen `fde5fc4f` en su log y ningún `specsPromoted=1` en lo revisado (no concluyente).
- **NO verificado hoy**: que los fixes listados compilen/pasen tests (no se ejecutó `tsc` ni tests, por instrucción), ni el estado de MDW/Lexis/firewall, ni el estado de la DB de cédulas.

## C. Bloqueos pendientes
1. **Paso 43 del spec** (`Producto`): fix aplicado sin validar; sin log `[runtime:selection-owner-retry]` del reintento anterior (inexplicado; añadir log de depuración antes de confiar).
2. **Paso 103**: conflicto de dos fixes (nombre accesible vs badge único). Hipótesis a probar: la tolerancia debe vivir dentro del bucle de espera del botón grabado.
3. **Paso 11 (Depurar)** intermitente por MDW/Bizagi/PLAFT: externo; mitigado con reintento 3×; firewall `172.27.4.97 → 172.20.18.142:8732` pendiente del usuario; causa de que el servicio MDW falle Lexis (cuenta de dominio, TLS/proxy) sin cerrar.
4. Generador de cédulas: 446/500 pausado; motor debe reiniciarse para tomar `.env`.
5. Pendiente de aprobación del usuario: registrar nombre de **fila** en el grabador (raíz de los "Cargar" repetidos); allowlist por proyecto del reintento de clics; verbos ingleses en el denylist.
6. Pruebas rojas preexistentes (ver master §6): vigilar que no empeoren.

## D. Plan concreto de continuación (sin lanzar nada automáticamente)
1. Leer `docs/ai/00-current-state.md` (sección más reciente de este caso) y `git diff --stat` para saber qué fixes de paso 103/43 ya están realmente en disco. Leer el código de `spec-execution-contract.ts` y la rama de badge en `target-resolver.ts`.
2. `npx tsc --noEmit -p .` y tests focales explícitos (`target-resolver.recorded-count-badge.test.ts`, `spec-execution-contract` selection-authority, `post-click-ui-change-detector`, `target-resolver.upload-sequence-rerender`) para fijar baseline.
3. Preguntar al usuario si autoriza: reiniciar engine (mata jobs) y **un** rerun desde un job fuente terminado (`df603817-4945-4112-90ca-cfe660f5c2c2`) con cédulas A/B distintas del stock. Un solo job; sin vigilantes que lancen jobs extra (la sesión anterior terminó con dos jobs simultáneos por bucles solapados).
4. Si falla en 103: instrumentar el bucle de espera (log del texto agregado y nombre accesible) antes de otro fix. Si falla en 43: leer `[runtime:selection-resolution] step=43` y `functional-execution-failure-detail`; evaluar opción (a) raíz (dar `locatorStrategy` a la rama de discovery) sobre (b).
5. Éxito = log con `specsPromoted=1` y `promotionAllowed=true` + segunda cédula verificada; entonces actualizar `docs/ai/00-current-state.md` (compacto: job id, GREEN nuevo, un solo NEXT ACTION).
6. Respetar regla CLAUDE.md QA Lab: reproducción física vía `scripts/codex-qa-verify.ps1` (no `codex:rescue`) antes de tocar código en bugs nuevos.

## E. Qué requiere validación antes de retomar
- ¿Qué job es el más reciente del caso y cómo terminó (`356bc904` u otro)? ¿Se promovió ya fuera de esta sesión?
- ¿Qué parte del árbol sin commit corresponde a fixes de este caso (commit selectivo recomendado antes de seguir)?
- **Decisión del usuario (2026-11-04):** `RECORDING_SPEC_GENERATION_ENABLED=false` es correcto e intencional: Recording ya no genera spec ni promueve. El objetivo "promover `fde5fc4f` (`specsPromoted=1`)" queda **obsoleto**; éxito = Discovery pasa 136/136. Los bloqueos de `spec_execution` (paso 43) solo aplican si se reactiva la generación de spec.
- Estado de MDW/Lexis y del stock de cédulas.

## F. Actualización de alcance (decisión del usuario)
- Recording sin generación de spec: no reiniciar trabajo de paso 43 / promoción. Pasos D.3–D.5 solo valen si se reactiva el toggle.
- Frontera vigente para el caso 56967: Discovery 136/136 y paso 103 (badge `Gestión Documental N`) estable; paso 11 depende del entorno MDW.
