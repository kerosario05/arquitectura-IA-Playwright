# Plan: regresión del motor de grabación en QA Lab

## Objetivo

Agregar al dashboard local **Regresión QA Lab** un segundo modo que valide el motor de grabación y su recorrido hasta Discovery, AutoPOM y promoción. La experiencia debe mostrar proyecto, caso, fase, logs en vivo, resultados y conteo de promociones como el modo actual.

## Restricciones

- No detener ni alterar jobs ya iniciados por el usuario.
- Las grabaciones persistidas en `automations/apps/<app>/recordings/` son datos fuente inmutables: no borrarlas, moverlas ni sobrescribirlas.
- No ejecutar un lote con escenarios de distintos proyectos. Cada job lleva un solo `projectSlug` y debe conservar el `appSlug` y URL configurados para ese perfil.
- El recorrido de validación debe incluir Discovery y AutoPOM; una prueba que solo ejecute un spec no cubre el objetivo.
- Mantener separados los jobs, logs y contadores de los modos de ejecución existente y regresión de grabación.

## Flujo propuesto

1. **Preparar entradas**: obtener las grabaciones/casos elegidos y agruparlos por proyecto. Leer las grabaciones originales y crear una copia de trabajo con IDs propios bajo `.artifacts/recording-regression/<jobId>/`; registrar hashes de los archivos fuente antes de iniciar.
2. **Validar captura automáticamente**: usar un runner Playwright controlado para interactuar con una página fixture y conectar el `WebSessionRecorder`. Capturar clic, fill, selección, navegación y campo sensible sin intervención manual.
3. **Persistir y derivar en staging**: escribir la traza, escenarios y modelo semántico únicamente en la copia temporal; leerlos de vuelta y verificar orden, identidad técnica, `valueKey`, enmascaramiento de secretos y consistencia entre artefactos.
4. **Ejecutar el pipeline de QA Lab**: pasar la entrada aislada al flujo de Discovery, generación determinista de spec y AutoPOM. Para los perfiles reales, conservar su configuración y URL propia, ejecutando un job por proyecto.
5. **Validar promoción y aislamiento**: contar por caso si Discovery pasó, AutoPOM terminó, la promoción fue permitida/persistida y el runtime requerido pasó. Comparar hashes y rutas fuente; fallar el job si una grabación original cambió.
6. **Mostrar resultados en el dashboard existente**: selector de modo, fase actual por caso, proyecto y `appSlug`, paso, logs originales con redacción, fallidos/promovidos y links al informe/artifacts de staging.

## Diseño previo a implementación

El endpoint actual `/api/recordings/execute-batch` carga y materializa grabaciones, y puede escribir escenarios y specs. No debe recibir directamente una grabación original en este nuevo modo. Antes de conectar la UI, hacer un spike para comprobar que Discovery/AutoPOM puede ejecutarse desde un namespace de regresión aislado manteniendo la configuración correcta del perfil. Si el CLI escribe inevitablemente en los paths oficiales, agregar primero soporte explícito para un workspace/output root de regresión; no compensar copiando y restaurando carpetas oficiales.

La captura automatizada de fixture valida el motor sin una persona, pero no sustituye la ejecución de grabaciones reales de cada proyecto. El job mostrará claramente qué tramo cubrió cada caso: `capture-fixture`, `persist/hydrate`, `discovery`, `auto-pom`, `promotion` y, si aplica, `runtime`.

## Cobertura de regresión

- Captura: `src/recording/web/web-session-recorder.*.test.ts` y pruebas de integración del capturador sobre la página fixture.
- Persistencia/lectura: `src/recording/atomic-json-store.test.ts`, `src/recording/recording-store.*.test.ts` y contratos de hidratación.
- Pipeline: prueba de integración del staging con Discovery/AutoPOM; fixtures de al menos dos perfiles, incluyendo uno distinto de Fenix.
- Seguridad de datos: assertion de que contraseñas/OTP no aparecen en pasos ni logs y que las grabaciones fuente conservan sus hashes.
- Dashboard: prueba sintética de estados/eventos de ambos modos, incluyendo fallos y promoción parcial.

## Criterios de aceptación

- Puede iniciarse desde la misma web como un modo separado y muestra los eventos hasta el resultado final.
- Ninguna grabación original cambia; el job acredita esto con verificación de hashes.
- No hay cruces de proyecto: cada job usa una sola configuración, base URL y perfil.
- Un caso aparece como promovido solo si el resultado real de QA Lab confirma el gate correspondiente.
- El job deja un informe con resumen por proyecto/caso y rutas de artifacts de staging, sin datos secretos.
- La regresión puede ejecutarse de nuevo desde cero limpiando solo su propio staging, nunca el directorio fuente de grabaciones.

## Secuencia de trabajo

1. Auditoría focalizada de la API/job de grabación, `execute-batch`, opciones de `discovery:preview`/AutoPOM y rutas de escritura.
2. Spike de aislamiento para Discovery/AutoPOM y contrato de evento unificado del dashboard.
3. Runner de captura fixture + staging inmutable con pruebas de persistencia/hidratación.
4. Orquestador de job por proyecto que usa el pipeline existente sin escribir en datos fuente.
5. UI del dashboard, informe y validación de regresión local.

## Estado

## Implementación local

Ya existe un modo separado `recording-engine` en el dashboard de escritorio y un lanzador dedicado
`QA-Lab-Regresion-Motor-Grabacion.bat`. El CLI `src/cli/recording-engine-regression.ts` ejecuta un
fixture local con `WebSessionRecorder`, persiste/lee la traza, modelo semántico y escenario bajo
`.artifacts/recording-regression/<jobId>/`, y después llama a Discovery/AutoPOM con un `appSlug`
único de staging. No usa `/api/recordings/execute-batch`, no envía grabaciones fuente y no escribe
en TestRail. El store de grabaciones admite un `rootDir` opcional y conserva su ubicación normal
cuando no se pasa esa opción.

La regresión encontró y cubre tres pérdidas: un pointer id ya consumido no puede reclamar una
acción posterior; un `<select>` nativo capturado como `fill` debe proyectarse como `select`; y el
clic de apertura del mismo `<select>` no debe duplicarse como acción independiente cuando existe
evidencia capturada de la selección. La última regla también se aplica durante hidratación, que
reconstruye las interacciones desde el trace normalizado.

Resultado real local más reciente: job `f716f42c-be69-417b-93ec-d08dc13356e1`, 1/1 caso promovido.
Discovery pasó, AutoPOM pasó, `promotionAllowed=true`, `specWritten=true`, `firstPassPromotion=true`.
El job usó `recording-regression-f716f42c` bajo staging, con cero escrituras TestRail y sin tocar
grabaciones fuente. Reporte: `.artifacts/recording-regression/f716f42c-be69-417b-93ec-d08dc13356e1/report.json`.

Validación final: 33 pruebas focalizadas pasan; strict TypeScript de los archivos de grabación,
hidratación y runner pasa; `git diff --check` pasa. `npm run typecheck` completo sigue fallando con
94 diagnósticos en tests/fixtures; no se comparó contra una revisión limpia, así que no se clasifican
como preexistentes. No se detuvo ni alteró ningún job del usuario; las grabaciones oficiales
permanecen intactas.

Siguiente acción: usar el modo local de regresión del motor de grabación para validar cambios
futuros, conservando cada job bajo un `jobId` de staging distinto. El runner actual valida un fixture
web sintético; para ampliar cobertura de grabaciones existentes se debe agregar una copia aislada
del trace seleccionado, sin escribir ni borrar bajo `automations/apps/<app>/recordings/`.

## Continuación: auditoría de grabaciones persistidas

El job local ahora audita en memoria el corpus bajo `automations/apps/*/recordings/` antes de
capturar el fixture. Rehidrata las proyecciones con el contrato vigente, clasifica los casos
incompletos como bloqueados y compara SHA-256 de `trace.json`, `scenarios.json` y
`semantic-recording.json`. No copia trazas fuente ni emite sus contenidos a los logs. Excluye
perfiles `recording-regression-*` para que un staging anterior no se convierta en nueva entrada.

El panel muestra los conteos por proyecto de forma separada del conteo de promoción. Resultado del
job local `8ae71a5d-c31d-4004-9671-653c5850254f`: fixture promovido 1/1; 19 grabaciones auditadas,
10 válidas, 9 bloqueadas y 0 fallidas; todos los hashes fuente verificados. Los bloqueos fueron 7
trazas que no estaban detenidas y 2 grabaciones de plataforma no web. Sin navegación a aplicaciones
reales y sin escrituras TestRail.

**Pendiente para completar el objetivo multiproyecto:** el runner todavía no reproduce cada grabación
guardada en Discovery/AutoPOM. El pipeline Discovery/AutoPOM probado sigue siendo el fixture local.
El próximo cambio debe preparar replay aislado por `appSlug`, conservar la URL de cada perfil y
transportar datos solo mediante referencias de runtime seguras. No guardar valores sensibles en los
inputs/reportes, ni modificar specs/perfiles oficiales. Verificar con fixtures sintéticos de al menos
dos proyectos antes de habilitar el replay real desde el launcher; no lanzar ese replay durante la
implementación.
