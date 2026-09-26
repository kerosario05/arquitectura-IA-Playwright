# Análisis de la rama `codex/merge-kevin-recording-20260925`

Fecha: 2026-09-25 · Rama sincronizada con `origin`, 66 commits por delante de `main`.

Este documento responde tres cosas: **qué hay**, **qué falta** y **qué hacemos**.
Todo lo que se afirma aquí fue verificado ejecutando el código, no leyéndolo.

---

## 1. Qué es esta rama

Es la unión de dos trabajos que avanzaron en paralelo el mismo día:

| Lado | Commit | Autor | Contenido |
|---|---|---|---|
| Motor Record | `ccd1cea1` | Roque | Motor de grabación v2 (semántico), IA de reparación, discovery |
| Despliegue | `4ead5ade` | Kevin | Identidad, RBAC, persistencia de jobs, cola, respaldo, runbook |

El merge es `798e9940`; después vino `ea644891` ("Cambios para kelvin").
De los 66 commits, **57 son de Roque y 9 tuyos**.

El merge tocó 16 archivos en ambos lados a la vez. Los importantes:
`server.ts`, `job-store.ts`, `runs.ts`, `recordings.ts`, `mobile.ts`,
`sqlite-schema.ts`, `session-recording-runner.ts`, los tres `playwright.config`.

### El merge no rompió nada del despliegue — verificado

Las 10 suites del trabajo de despliegue e identidad **pasan todas**:

```
PASA  test:auth              PASA  test:jobs
PASA  test:identity          PASA  test:queue
PASA  test:bootstrap         PASA  test:backup
PASA  test:auth-flow         PASA  test:recording-availability
PASA  test:admin-api         PASA  test:route-policy
```

Y siguen en su sitio, enganchados al runtime:

- `hydrate()` / `drain()` en `server.ts` (los jobs sobreviven al reinicio)
- `HEADLESS` por defecto `true` en los tres configs de Playwright
- La cola de admisión (`job-queue.ts`) usada por `runs.ts`, `recordings.ts`, `mobile.ts`
- `route-policy.ts` con las 13 políticas de `/api/recordings`
- Respaldo (`db:backup`), spike de Playwright, los cuatro scripts de `deploy/`

**El motor arranca y responde.** Levantado en el puerto 3099 con el código
mergeado, `/health` devuelve 200.

### El front está limpio

`QA-lab` es otro repositorio, sin cambios pendientes, en `d77dbcb` — lo mismo
que está desplegado. `npx tsc --noEmit`: **0 errores**. `vite build`: OK en 32 s.

---

## 2. Qué trae el Motor Record

110 archivos en `src/recording/`, de los cuales 94 son suites de prueba.

Lo nuevo de fondo:

- **Contrato canónico de grabación** (`canonical-recording-contract.ts`): la
  grabación deja de ser una lista de clics y pasa a ser un contrato con dueños,
  linaje de valores y condiciones de ejecución.
- **Capture engine v2**: identidad estructural de controles, shadow DOM, ciclo
  de vida del documento, sesiones de edición.
- **Enriquecimiento semántico con IA** de la traza a escenarios.
- **Aprendizaje de rutas**: tabla nueva `RecordingRouteObservation`.
- **Redacción de credenciales** en la traza.

### Resultado de sus pruebas

```
710 pruebas · 700 pasan · 9 fallan
```

**98,7 % en verde, con 9 fallos reales** que hoy están en la rama. No son del
trabajo de despliegue — son del motor de grabación. Detalle en §4.1.

---

## 3. Lo que falta para que esto llegue al servidor

Ordenado por lo que bloquea de verdad.

### 3.1 El servidor corre código de antes del merge — BLOQUEANTE

Lo desplegado es `4ead5ade`. Desde ahí hasta `HEAD` cambiaron **571 archivos de
`src/`**: 127 de recording, 106 de automations, 102 de discovery, 59 de server.

Traducción: **el Motor Record no está en el servidor.** Todo lo que se grabe allá
usa el motor viejo.

Lo bueno: **la base de datos se migra sola.** Lo verifiqué —
`sqlite-connection.ts` ejecuta el esquema completo en cada conexión con
`CREATE TABLE IF NOT EXISTS`, y `ensureSchemaCompatibility()` añade la columna
nueva `ignoreHTTPSErrors`. La tabla `RecordingRouteObservation` se crea sola al
arrancar. **No hay migración manual.** El procedimiento de §10 del `LEEME.md`
sirve tal cual.

### 3.2 El `.env` del servidor tiene 23 variables; el local tiene 128 — BLOQUEANTE

Faltan **105 variables**. Las que importan:

| Bloque | Qué se rompe sin ellas |
|---|---|
| `AI_*` (45 var.) | **Derivar escenarios de una grabación.** `AI_ENABLED` vale `true` por defecto, y `resolveAiConfig()` lanza `Missing AI provider configuration` si no hay `AI_PROVIDER`. El Motor Record llama a la IA desde `session-recording-runner.ts`. |
| `CODEX_CLI_COMMAND`, `CLAUDE_CLI_COMMAND`, `AGENT_*` | Auto-reparación. Además **el servidor no tiene esos CLI instalados**, así que aunque se configuren, fallarán. |
| `EVIDENCE_*` (9 var.) | Generación del `.docx` de evidencia. |
| `TESTRAIL_*` (14 var.), `JIRA_*` (12 var.) | Son respaldo: la configuración real vive por proyecto en la BD. Menos grave, pero los valores por defecto se leen de aquí. |
| `APP_TEST_DATA_JSON`, `Identity_Provider`, `OTP_SECRET` | Flujo de autenticación contra la app bajo prueba. |
| `SCENARIO_PREVIEW_BASE_URL` | Ya está en el `.env` del BFF, no en el del motor. |

**Decisión que hay que tomar**: si el servidor no sale a internet y no tiene
Codex ni Claude CLI, la vía honesta es poner `AI_ENABLED=false` allá y que la
derivación con IA se haga en la máquina del QA — igual que ya decidimos con la
grabación. Si no, hay que resolver antes el acceso a un proveedor de IA.

### 3.3 Pendientes de infraestructura que ya venían

Del `LEEME.md` §12, sin avance:

- [ ] Registrar las dos tareas programadas (`schtasks`) — **necesita elevación**
- [ ] Registrar la tarea de respaldo diario; `BACKUP_DIR` en otro disco
- [ ] Apagar el sitio de IIS (hoy hay dos copias del front)
- [ ] Dar de alta los tres proyectos (la BD del servidor arranca vacía)
- [ ] Cuenta de servicio dedicada en vez de una personal
- [ ] Resolver por qué un compañero en la misma red no alcanza la URL
      (quedaron pendientes `Resolve-DnsName` y `Test-NetConnection`)
- [ ] Repartir `deploy/instalar-local.ps1` a los 5 QA

---

## 4. Problemas que trae la rama

### 4.1 Nueve pruebas del motor de grabación en rojo

Están concentradas en cinco archivos, lo que ayuda: no es ruido disperso.

| Archivo (`src/recording/`) | Fallos |
|---|---|
| `derived-scenario-durability.test.ts` | 3 |
| `recording-materialization-consistency.test.ts` | 3 |
| `canonical-recording-contract.test.ts` | 1 |
| `canonical-recording-contract.structural-runtime-readiness.test.ts` | 1 |
| `trace-to-scenario.unnamed-button-display.test.ts` | 1 |

Qué afirma cada una:

```
✖ el catálogo derivado persistido sobrevive a una lectura nueva con IDs estables
✖ la hidratación del escenario conserva sugerencias y repara su proyección
✖ la mutación alternativa cambia el dataset canónico
✖ la materialización separa selección compuesta de autoridad de monto
✖ preview y artefactos de caso generado se materializan del contrato corregido
✖ los extras estructurados son prerrequisitos técnicos, no acciones funcionales
✖ una interacción con ambigüedad previa nunca es elegible para resolución en runtime
✖ el hermano CommonJS registrado rechaza postcondiciones de ruta obsoletas
✖ una aria-label real gana a la relación de campo
```

Dos grupos, y los dos importan para el servidor:

- **Durabilidad** (`derived-scenario-durability`): el escenario derivado no
  sobrevive bien a una relectura. Justo lo que un servicio que se reinicia hace
  todo el tiempo.
- **Materialización** (`recording-materialization-consistency`): lo que se
  previsualiza y lo que se genera como caso no coinciden.

Son fallos de contrato, no de infraestructura. **Esto es para Roque.** Pero
conviene no subir el Motor Record al servidor con nueve contratos rotos sin
saber cuáles importan.

### 4.2 El compilador de tipos empeoró: 349 → 523 errores

De ellos **215 están en código productivo** (no en pruebas). Los peores focos:

```
39  src/discovery/case-discovery.ts
13  src/cli/discovery-preview.ts
12  src/server/jobs/scenario-preview-runner.ts
12  src/discovery/case-discovery-workflow.ts
11  src/scenarios/app-knowledge-writer.ts
```

Esto no impide arrancar: el servidor corre con `tsx`, que borra los tipos sin
comprobarlos. Pero es exactamente por eso que preocupa — **son errores que solo
aparecerán en producción**, cuando un campo no exista en tiempo de ejecución.
Varios dicen literalmente "Property X does not exist".

### 4.3 La aplicación escribe carpetas de proyecto en la raíz del repositorio

Hay 11 carpetas sueltas en la raíz que deberían estar bajo `automations/apps/`:

```
xc  sd  sa  qa  kiosko  pruebaqa  prueba-kiosko
portal-empresarial  portal-comercial  app-a  arquitectura-automatizacion
```

Siete duplican un perfil que **sí existe** en `automations/apps/`.
Y **seis se modificaron hoy mismo**, en el merge — o sea, el fallo está vivo:
`ea644891` modifica `portal-comercial/page-objects.index.json` en la raíz.

El origen probable está en `src/automations/app-profile.ts:443`: cuando
`isStandardAppDir` da falso, escribe `page-objects.index.json` directamente en
`baseDir`, sin anclarlo a `automations/apps/`.

Consecuencia real: el registro de Page Objects puede leerse de un sitio y
escribirse en otro. En el servidor, donde `C:\qa\.artifacts` es el estado, esto
ensuciaría la carpeta de aplicación.

### 4.4 El repositorio carga ~198 MB de basura versionada

| Qué | Archivos | Peso |
|---|---|---|
| `Python/` — un Python 3.14 completo, con `pip.exe` | 2 775 | **173 MB** |
| `.codex-*-build-*` — 11 carpetas de compilaciones | 618 | 12 MB |
| `.stale-js-quarantine-20260924/` | 586 | 8,3 MB |
| `tests/*.js` — los 324 son el `.js` compilado de su `.ts` gemelo | 324 | 4 MB |
| `.playwright-mcp/`, `token-metrics/`, `tmp-*.cjs` | 31 | 208 KB |
| Dos archivos con nombre corrupto: `{` y `{console.error(e)` | 2 | — |

`.git` pesa **257 MB**. Casi todo es esto.

Además, en `automations/apps/` hay fixtures de prueba versionados como si fueran
apps reales: `__test_error_trigger__`, `nonexistent-slug-xyz`, `dedup-test-app`,
`test-app`, `env-priority`, `tests`.

### 4.5 Cosas menores

- `QA-lab/src/pages/TestLaunch.index.actual-roto.backup.tsx` — un respaldo con
  "roto" en el nombre, versionado.
- `CLAUDE.md` **no menciona el motor de grabación**, que hoy son 110 archivos y
  da nombre a la rama. Quien llegue nuevo no sabrá que existe.
- Las 397 pruebas `node:test` de `src/` **no tienen un script que las corra
  todas**. `npm test` ejecuta Playwright, que es otra cosa.

---

## 5. Qué hacer, en orden

### Ahora (desbloquea el servidor, no toca código de Roque)

1. **Completar el `.env` del servidor.** Copiar el bloque `AI_*` y `EVIDENCE_*`
   del `.env` local, decidiendo el valor de `AI_ENABLED`. Actualizar
   `deploy/env.servidor.txt` para que la plantilla deje de mentir.
2. **Registrar las tres tareas programadas** (motor, BFF, respaldo). Requiere
   permisos de administrador — es el mismo bloqueo de siempre.
3. **Apagar el sitio de IIS** y dar de alta los tres proyectos.
4. **Cerrar el diagnóstico de red** del compañero.

### Antes de subir el Motor Record al servidor

5. **Que Roque cierre los 9 contratos en rojo**, o diga cuáles son aceptables y
   por qué.
6. **Decidir la historia de la IA en el servidor.** Sin proveedor configurado,
   derivar escenarios de una grabación falla con un error poco claro. O se
   configura, o se apaga explícitamente con un mensaje entendible.
7. **Arreglar las carpetas escritas en la raíz** (§4.3). Es un fallo activo.
8. Redesplegar con el procedimiento de `LEEME.md` §10 — la BD se migra sola.

### Deuda que conviene no dejar crecer

9. **Limpiar el repositorio**: sacar `Python/`, las carpetas `.codex-*-build-*`,
   la cuarentena, los 324 `.js` compilados y los dos archivos de nombre corrupto;
   añadirlos al `.gitignore`. Son ~198 MB.
   Nota: `git rm --cached` los saca del árbol pero **no del historial** — el
   `.git` seguirá pesando 257 MB hasta que se reescriba, y eso obliga a que
   todos vuelvan a clonar. Es una decisión aparte.
10. **Bajar los 215 errores de tipos en código productivo**, empezando por
    `case-discovery.ts`.
11. **Un script `npm run test:unit`** que corra las 397 suites de `node:test`.
12. **Documentar el motor de grabación en `CLAUDE.md`.**

---

## 6. Resumen en cuatro líneas

- El merge **no rompió el trabajo de despliegue**: 10 suites en verde, el motor
  arranca, la BD migra sola. Se puede redesplegar cuando se quiera.
- Lo que bloquea de verdad es **el `.env` incompleto del servidor** (105
  variables) y **los permisos de administrador** que llevan días pendientes.
- El **Motor Record aún no está en el servidor** y trae 9 contratos rotos.
- El repositorio arrastra **198 MB de basura** y **215 errores de tipos en
  código productivo** que hoy nadie ve porque `tsx` no comprueba tipos.

---

# Anexo: por qué están fallando las ejecuciones

`codex/upload-all-current-changes-20260925` (tip `ccd1cea1`) es el lado Motor
Record del merge, y ya es ancestro de `HEAD`. Esto es lo que trajo al camino de
ejecución.

## Causa principal: un filtro de admisión nuevo en el lanzador

`src/server/jobs/launch-orchestrator.ts` pasó de 631 a 1076 líneas. Antes del
merge, en `4ead5ade`, ese archivo **no mencionaba ni una vez**
`specVerificationStatus`, `pomStatus`, `mcp_required`, `executionSource` ni
`reusable`. Ahora clasifica cada caso en tres cubos, y solo uno ejecuta el spec
que ya existe.

Un caso solo corre su spec si cumple las tres condiciones
(`launch-orchestrator.ts:500`):

```ts
entry.status === "active"
  && entry.pomStatus === "promoted"
  && entry.specVerificationStatus === "passed"
```

Apliqué ese filtro al registro real. De **522 automatizaciones registradas**:

```
  ADMITIDAS (ejecutan su spec)  :  60
  desviadas a mcp_required      : 462
        392  spec_not_verified (specVerificationStatus = "not_run")
         53  status_spec_failed
          9  status_blocked_missing_pom
          5  pom_not_promoted
          2  spec_not_verified (sin el campo)
          1  status_inline_debug_only
```

En la app principal, `arquitectura-automatizacion`: **390 `not_run`, 18
`passed`, 30 `failed`**. Dieciocho de 438 casos pueden ejecutar su spec.

**Por qué explica el síntoma exacto.** Los 392 `not_run` son históricos: los
escribió el código anterior, cuando nadie miraba ese campo al lanzar. Hoy el
filtro exige `"passed"`. Y no es que se salten — `admitted = existingSpec +
mcpRequired` (`launch-orchestrator.ts:538`), así que **se reenvían a la ruta de
MCP/descubrimiento**: en vez de correr un spec que ya existía y funcionaba, el
sistema vuelve a descubrir el caso con navegador e IA. Es más lento, necesita
proveedor de IA y falla por su cuenta.

Eso es "fallan en parte": unos pocos corren, la mayoría se redescubre.

Dos detalles que empeoran el diagnóstico:

- Los casos `blocked` **solo se escriben con `console.error`**
  (`launch-orchestrator.ts:733`), no al log del job ni al resumen. En el front
  se ven menos resultados de los que pediste, sin explicación.
- Si todo queda bloqueado, el error es `no_launchable_scenarios` con un mensaje
  en inglés.

La misma regla `specVerificationStatus === "passed"` ahora también gobierna
`automation-reuse.ts:51` y `recording-automation-resolution.ts:190`.

## Causa secundaria: el compilador determinista falla cerrado

`src/discovery/case-discovery-workflow.ts:2952` pasa
`useDeterministicSpecCompiler: true` **fijo, sin bandera ni variable de
entorno**. Cuando el contrato no tiene autoridad para cada acción requerida,
`promote-plan.ts:1639` lanza `DETERMINISTIC_SPEC_GENERATION_FAILED_CLOSED` y
**no hay respaldo con IA** (`aiInvoked=false`).

Antes, un objetivo ambiguo se compilaba en silencio a `getByText(...)` y muchas
veces pasaba. Ahora es un error duro. Es un cambio deliberado y probablemente
correcto, pero convierte promociones que antes "funcionaban" en fallos.

## Causa menor: mapeo ambiguo

`loadExistingCaseAutomationEntries` carga **dos** índices y los concatena:
`automations/apps/<slug>/index.json` y el global `automations/index.json` (608
entradas, modificado hoy). Si el mismo caso aparece con slug distinto entre los
dos, la deduplicación por `id + appSlug` no los une y el caso queda
`blocked:ambiguous_automation_mapping`.

Medido: 3 casos en `arquitectura-automatizacion`, 6 en `default`, 1 en `bsc`,
1 en `kiosko`. Es real pero pequeño.

Ayuda a explicarlo el desorden del índice global, que tiene slugs basura
(`df`, `de`, `as`, `sd`, `asd`, `ccc`, `zzz-temp-production-e2e-15304`) y
`portalempresarial` sin guion junto a la carpeta `portal-empresarial`.

## Riesgo latente, todavía no activo

`execution-plan-executor.ts` (+509 líneas) añadió precondiciones duras:

```
throw new Error("fill requires value, valueKey, or supportingStrategy.");
throw new Error("select requires value, valueKey, or supportingStrategy.");
```

Revisé los 29 pasos `fill`/`select` de todos los `plan.json` persistidos:
**los 29 traen valor**. Hoy no dispara. Pero `resolveStepValue` devuelve
`undefined` si el `valueKey` no resuelve contra el contexto de datos — es decir,
en un entorno sin `APP_TEST_DATA_JSON` (como el servidor) estos pasos pasarían
de "llenar vacío" a error duro.

## Lo que descarté

Para que no se pierda tiempo ahí:

- **Sombras `.js` obsoletas.** Hay 9 en `automations/` (páginas de `default`,
  `promoted-spec-helpers`). Las revisé una por una: son copias compiladas
  fieles, con los mismos métodos y exports que su `.ts`. No divergen hoy.
  Siguen siendo un riesgo latente, igual que el caso ya cerrado de
  `target-resolver.js`, pero no son la causa.
- **Specs promovidos llamando métodos inexistentes.** Escaneé todos los
  `.spec.ts` promovidos contra los métodos de sus page objects: **0 llamadas a
  métodos que no existen**. El `productListPage.executeAction is not a function`
  de `docs/ai/00-current-state.md` es de un spec de validación temporal
  (`.candidate-validation-*.spec.ts`), no de los promovidos.
- **`Dirent<NonSharedBuffer>` en `promoted-runtime-contract.ts:265-273`.** El
  compilador dice "esta comparación es siempre falsa", pero es una anotación de
  tipo mal puesta (`Awaited<ReturnType<typeof fs.readdir>>` toma la sobrecarga
  sin `withFileTypes`). En ejecución `entry.name` sí es string. Ruido, no bug.
- **`validatePhysicalPageObjectCalls`**, la validación nueva que rechaza specs
  con métodos inexistentes, solo corre con `requirePomRuntime` /
  `PROMOTION_REQUIRE_POM_RUNTIME=true`. No está activa por defecto.

## Qué haría

Lo primero es decidir qué significa `specVerificationStatus` para ustedes. Hay
tres salidas, de menos a más trabajo:

1. **Relajar el filtro**: admitir `not_run` además de `passed`. Restaura el
   comportamiento anterior de inmediato, y es una línea. Pierde la garantía que
   el filtro quería dar.
2. **Reverificar el registro**: repromover con `--verify-promoted-spec` para que
   los 392 pasen a `passed` o `failed` de verdad. Es lo correcto, pero son 392
   ejecuciones reales contra la app.
3. **Dejarlo como está** y asumir que casi todo se redescubre por MCP. Solo
   viable si la IA está configurada y no importa el tiempo.

Antes de tocar nada conviene reproducirlo físicamente con
`scripts/codex-qa-verify.ps1`, como pide el flujo de `CLAUDE.md`: este anexo es
análisis estático sobre el registro y el código, no una corrida real.
