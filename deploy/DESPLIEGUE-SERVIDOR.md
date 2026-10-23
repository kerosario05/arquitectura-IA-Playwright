# QA Lab v2 en SRVDEVQACA01 — despliegue, servicio de Windows (WinSW) y actualizaciones

Instrucciones para el agente de IA que trabaja **en el servidor** SRVDEVQACA01 (172.27.4.97,
Windows Server, sin salida a internet). Léelo entero antes de tocar nada. Si un paso falla,
**detente y reporta**: no improvises arreglos.

> Este documento reemplaza a versiones anteriores (`completo.txt`, `falta.txt` y la versión previa
> de este `.md` que usaba tareas programadas y el puerto 3101).

---

## 1. Estado actual (2026-10-05)

| | Producción (NO SE TOCA) | Instancia v2 |
|---|---|---|
| Raíz | `C:\qa` | `C:\qa-v2` |
| Panel / API (BFF) | 3001 | **3003** (todas las interfaces) → `http://SRVDEVQACA01:3003` |
| Motor | 3002 | 127.0.0.1:**3102** (solo local, nunca se expone) |
| Base de datos | la suya | `C:\qa-v2\data\qa-lab.db` (copia de la de producción) |
| Cómo corre | — | **Servicios de Windows con WinSW** |

### Servicios (services.msc)

| Nombre visible | Servicio | Inicio | Cuenta |
|---|---|---|---|
| QA Lab v2 - motor | `QALabV2-motor` | Automático | LocalSystem |
| QA Lab v2 - BFF | `QALabV2-BFF` | Automático | LocalSystem |

- El BFF depende del motor (Windows arranca primero el motor).
- Si node se cae, el servicio lo reinicia a los 10 s.
- WinSW 2.12.0 (`C:\temp\WinSW-x64.exe`, SHA256
  `05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA`).
  **No usar** `C:\temp\WinSW-x64F.exe` (v3 de origen no verificado).
- Configuración: `C:\qa-v2\winsw\QALabV2-motor.exe/.xml` y `QALabV2-BFF.exe/.xml`.
  - motor: `C:\Program Files\nodejs\node.exe node_modules\tsx\dist\cli.mjs src\server\server.ts` en `C:\qa-v2\app\qa-engine`
  - BFF: `C:\Program Files\nodejs\node.exe node_modules\tsx\dist\cli.mjs server\index.ts` en `C:\qa-v2\app\qa-lab`
- Logs: `C:\qa-v2\logs\QALabV2-<servicio>_AAAAMMDD.out.log` / `.err.log` y `QALabV2-*.wrapper.log`.

### Variables relevantes del `.env` (no imprimas otras: pueden tener secretos)

- `C:\qa-v2\app\qa-lab\.env`: `PORT=3003`
- `C:\qa-v2\app\qa-engine\.env`: `PORT=3102`, `PLAYWRIGHT_BROWSERS_PATH=C:\qa\ms-playwright`,
  `AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED=true`, `HEADLESS=true`

### Red

- La red perimetral **solo deja pasar algunos puertos** desde los equipos de usuarios. Probado desde
  172.20.247.74: pasan 3003, 3000, 5000, 443, 8443; **no pasan 3101 ni 8000**. Por eso el panel va en 3003.
- El **firewall de Windows está desactivado por GPO** en el perfil de dominio: las reglas locales
  (`New-NetFirewallRule`) no tienen efecto hoy. La regla "QA Lab v2 (BFF 3101)" es inútil y se puede
  borrar. Si la GPO lo activa algún día, crear una regla para TCP 3003.

---

## 2. Reglas

1. PowerShell **como administrador**.
2. No tocar, detener ni modificar `C:\qa` ni los puertos 3001/3002.
3. No ejecutar `npm install` ni `npm ci` (el servidor no tiene internet).
4. No editar código fuente. Solo los `.env` de la v2 y los `.xml` de `C:\qa-v2\winsw`.
5. No imprimir secretos de los `.env`.
6. **No usar `servicios-qa-lab.ps1` para la v2** (crea tareas programadas; con los servicios WinSW
   presentes, el script ahora se niega a ejecutarse).

---

## 3. Gestión diaria

```powershell
Get-Service QALabV2*
Restart-Service QALabV2-motor, QALabV2-BFF
Stop-Service    QALabV2-BFF, QALabV2-motor
Start-Service   QALabV2-motor, QALabV2-BFF
```

Comprobación rápida:

```powershell
Invoke-WebRequest http://127.0.0.1:3102/health     -UseBasicParsing | Select StatusCode   # 200
Invoke-WebRequest http://127.0.0.1:3003/api/health -UseBasicParsing | Select StatusCode   # 200
Invoke-WebRequest http://127.0.0.1:3003/           -UseBasicParsing | Select StatusCode   # 200
```

Si se cambia un `.env` de la v2: `Restart-Service QALabV2-motor, QALabV2-BFF`.

---

## 4. Actualizar la v2 con un paquete nuevo

Hay dos tipos de paquete:

- **Completo** (`qa-lab-despliegue-<fecha>-completo.zip`, ~140 MB): código + panel + `node_modules`.
  Úsalo cuando cambien dependencias o en una instalación desde cero.
- **Actualización ligera** (`qa-lab-actualizacion-<fecha>.zip`, ~7 MB): código + panel, **sin**
  `node_modules`. Solo sobre una v2 ya instalada con un paquete completo.

`instalar-paralelo.ps1` (desde esta versión) hace todo solo:
- detecta la v2 existente en `C:\qa-v2`;
- **conserva sus puertos** (lee `PORT` de sus `.env`: 3003 / 3102), no hace falta `-PuertoBff`;
- **detiene los servicios WinSW** `QALabV2-*`, actualiza código (y `node_modules` si el paquete los
  trae), aplica el esquema de la base y **vuelve a arrancar los servicios** (no lanza procesos sueltos);
- conserva `.env`, base de datos y grabaciones.

### 4.1 Extraer

```powershell
Remove-Item -Recurse -Force C:\temp\qa     # solo la copia extraída anterior, NUNCA C:\qa
New-Item -ItemType Directory -Force C:\temp\qa | Out-Null
tar -xf C:\temp\<paquete>.zip -C C:\temp\qa
Test-Path C:\temp\qa\qa-engine\deploy\instalar-paralelo.ps1    # True
Test-Path C:\temp\qa\qa-lab\dist\index.html                     # True
Test-Path C:\temp\qa\qa-engine\node_modules\tsx\dist\cli.mjs    # True en el completo; False en el ligero (normal)
```

Con el paquete **ligero**, comprueba además que la v2 ya tiene dependencias:

```powershell
Test-Path C:\qa-v2\app\qa-engine\node_modules\tsx\dist\cli.mjs   # True
Test-Path C:\qa-v2\app\qa-lab\node_modules\tsx\dist\cli.mjs      # True
```

### 4.2 Instalar

```powershell
powershell -ExecutionPolicy Bypass -File C:\temp\qa\qa-engine\deploy\instalar-paralelo.ps1 -Origen C:\temp\qa
```

**Ejecuciones en curso y respaldo** (`proteger-datos.ps1`, lo usan `instalar-paralelo.ps1` y
`4-actualizar.ps1`):

- Antes de detener los servicios revisa si el motor tiene ejecuciones en curso. Si las hay, las
  lista y **espera** hasta 15 min (`-EsperarMinutos N`) a que terminen. Si siguen, el script se
  detiene sin tocar nada: repite más tarde.
- `-Forzar` despliega igual. Esas ejecuciones aparecen en el panel como **Interrumpida** (con su
  log hasta ese momento) y se pueden volver a ejecutar.
- Con los servicios ya detenidos copia la base SQLite, el historial de ejecuciones y los manifiestos
  de lanzamientos a `<raíz>\backups\despliegue-<fecha>` (se conservan los 10 más recientes).
- Specs, Page Objects, grabaciones y evidencias no se copian ni se tocan: viven en `automations\`
  y `.artifacts\`, que el paquete no trae.
- La primera vez que se despliega esta versión, el motor anterior todavía no guardaba en disco las
  ejecuciones en curso, así que esta revisión no las verá: confirma en el panel que no haya nada
  corriendo antes de ese primer despliegue.

Debe mostrar, entre otras:

```
[ok] puertos: panel 3003, motor 3102
[ok] servicio detenido: QALabV2-BFF
[ok] servicio detenido: QALabV2-motor
[ok] motor: node_modules del paquete        (completo)   |  node_modules ya presente, se conserva  (ligero)
[ok] esquema aplicado en C:\qa-v2\data\qa-lab.db
[ok] servicio arrancado: QALabV2-motor
[ok] servicio arrancado: QALabV2-BFF
Instancia paralela lista
```

Si dice `puertos: panel 3101` → **detente**: no encontró `C:\qa-v2\app\qa-lab\.env`. No continúes.

> Si el instalador que trae el paquete es **anterior a esta versión** (no muestra la línea
> `puertos: ...` ni `servicio detenido`), usa el procedimiento manual: `Stop-Service QALabV2-BFF,
> QALabV2-motor`; instalar con `-PuertoBff 3003`; matar los node sueltos de `C:\qa-v2`
> (`Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" | ? { $_.CommandLine -like '*C:\qa-v2*' } | % { Stop-Process -Id $_.ProcessId -Force }`);
> y `Start-Service QALabV2-motor, QALabV2-BFF`.

### 4.3 Verificar

```powershell
Get-Service QALabV2*                                              # ambos Running
Select-String C:\qa-v2\app\qa-lab\.env -Pattern '^PORT='          # PORT=3003
Select-String C:\qa-v2\app\qa-engine\.env -Pattern '^(PLAYWRIGHT_BROWSERS_PATH|AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED|HEADLESS)='
# Comprobación rápida de la sección 3 (tres 200)
Get-NetTCPConnection -LocalPort 3001,3002 -State Listen           # producción sigue igual
```

Si el Playwright del paquete cambió de versión, comprueba que en `C:\qa\ms-playwright` existe
`chromium_headless_shell-<revision>` (revisión en `C:\qa-v2\app\qa-engine\node_modules\playwright-core\browsers.json`).

Los usuarios deben recargar el panel con **Ctrl+F5** para ver la versión nueva.

---

## 5. Instalación desde cero (solo si C:\qa-v2 no existe)

1. Extraer el paquete **completo** (4.1).
2. `instalar-paralelo.ps1 -Origen C:\temp\qa -Raiz C:\qa-v2 -PuertoBff 3003 -PuertoMotor 3102 -CopiarGrabaciones`
   (copia `.env`, base y grabaciones de producción; arranca motor y BFF como procesos).
3. Ajustar el `.env` del motor (sección 1) y detener esos procesos (comando de la nota de 4.2).
4. Crear los servicios WinSW (sección 6) y `Start-Service QALabV2-motor, QALabV2-BFF`.

---

## 6. Reinstalar / cambiar la configuración de los servicios

Si se edita un `.xml` de `C:\qa-v2\winsw` (argumentos, cuenta, logs…):

```powershell
Stop-Service QALabV2-BFF, QALabV2-motor
C:\qa-v2\winsw\QALabV2-BFF.exe uninstall
C:\qa-v2\winsw\QALabV2-motor.exe uninstall
C:\qa-v2\winsw\QALabV2-motor.exe install
C:\qa-v2\winsw\QALabV2-BFF.exe install
Start-Service QALabV2-motor, QALabV2-BFF
```

Solo la descripción se cambia sin reinstalar: `sc.exe description <servicio> "<texto>"`.

Si se cambia el puerto del BFF: editar `PORT` en `C:\qa-v2\app\qa-lab\.env` y
`Restart-Service QALabV2-BFF`. Antes, comprobar que la red deja pasar ese puerto desde los equipos
de usuarios. Las actualizaciones posteriores conservarán el puerto nuevo.

---

## 7. Rollback (quitar la v2)

```powershell
Stop-Service QALabV2-BFF, QALabV2-motor
C:\qa-v2\winsw\QALabV2-BFF.exe uninstall
C:\qa-v2\winsw\QALabV2-motor.exe uninstall
Remove-NetFirewallRule -DisplayName "QA Lab v2 (BFF 3101)" -ErrorAction SilentlyContinue
```

`C:\qa-v2` puede quedarse (no se borra sin autorización). Producción no depende de nada de esto.

---

## 8. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Servicio en `Stopped` tras arrancar | node termina al iniciar | Leer `C:\qa-v2\logs\QALabV2-*_<fecha>.err.log`. |
| `port ... is already in use` en el log | Quedó un node suelto | Matar los node de `C:\qa-v2` (nota de 4.2) y `Restart-Service`. |
| `Cannot find module ...tsx...` | Paquete ligero sobre una v2 sin dependencias | Instalar el paquete **completo**. |
| `Executable doesn't exist` (Chromium) | `PLAYWRIGHT_BROWSERS_PATH` o revisión de Chromium | Sección 4.3; `Restart-Service QALabV2-motor`. |
| El panel abre en el servidor pero no desde los usuarios | Puerto bloqueado por la red | Mantener 3003 (o un puerto de la lista permitida). |
| Pruebas que pasan aparecen "fallidas" | Spec pendiente sin ejecución funcional | `AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED=true` y reiniciar el motor. |
| El panel no muestra cambios | Caché del navegador | Ctrl+F5. |

## 8.1 Planificación de pruebas (repositorio git)

El módulo lee los `test-plan-<HU>.md` de un repositorio y hace commit y push de los cambios.

1. **git** instalado y en el PATH de la cuenta del servicio del motor (`git --version`; el paso 1 lo revisa).
2. **PAT de Azure DevOps** con permiso *Code (Read & Write)*, en el `.env` del motor:
   `AZDO_GIT_PAT=<token>` (el nombre debe contener `GIT_PAT` o `GIT_TOKEN`). Reiniciar el motor.
3. En el panel: **Configuración → proyecto → Repositorio de planes de prueba**, elegir
   "Token (PAT) en una variable de entorno", poner `env:AZDO_GIT_PAT` y **Probar conexión**.
4. Opcional: `GIT_REPOS_DIR` (por defecto `data/repos`) si los clones deben ir a otro disco.

En local no hace falta el PAT: con la credencial vacía el motor usa las credenciales de git
de la máquina (Git Credential Manager).

| Síntoma | Qué hacer |
|---|---|
| `git no está instalado o no está en el PATH` | Instalar Git for Windows y reiniciar el servicio del motor. |
| `git_auth_failed` | PAT vencido, sin permiso Code o variable no cargada: revisar `.env` y reiniciar. |
| `Credencial del repositorio no disponible` | La variable de `env:` no existe en el `.env` del motor. |

## 9. Avisos sobre esta versión

- El historial de ejecuciones se pierde al reiniciar el motor (esperado; no corregir).
- No hay respaldo automático de la base.
- Appium no viene en el paquete: las pruebas móviles no funcionan en la v2; las web sí.
