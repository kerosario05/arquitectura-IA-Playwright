# Despliegue de QA Lab

Runbook del despliegue en **srvdevqaca01**, escrito después de hacerlo por
primera vez a mano. Incluye lo que funcionó y lo que nos costó descubrir.

---

## 1. Qué se despliega

Dos procesos Node y un estático. **No hace falta IIS.**

```
navegador  →  BFF :3001  ─┬→  estático (dist del front)
                          ├→  /api/*
                          └→  motor :3002   (solo 127.0.0.1)
                                  ↓
                          C:\qa\  (base, artefactos, respaldos)
```

| Pieza | Repo | Qué hace |
|---|---|---|
| **Motor** | `arquitectura-IA-Playwright` | API de automatización, base de datos, Playwright |
| **BFF + front** | `QA-lab` | Sirve el front compilado y expone `/api`; habla con el motor |

**El motor nunca se expone.** Escucha en `127.0.0.1:3002` y solo el BFF lo
alcanza. Exponerlo permitiría saltarse la capa que propaga la sesión del usuario.

### Por qué no IIS

El plan original era IIS como proxy inverso (estático + `/api` → BFF). Requiere
el módulo **ARR**, que no estaba instalado y había que tramitar.

En vez de esperar, el BFF —que ya era Express— pasó a servir también el front.
Un solo origen, sin CORS, sin proxy, sin ARR. Se pierde HTTPS y el puerto 443;
para una herramienta interna es aceptable.

Si algún día se quiere HTTPS, el camino limpio es instalar ARR y volver al proxy
inverso: mantiene un origen único y no obliga a recompilar el front.

---

## 2. Requisitos del servidor

| Requisito | Por qué |
|---|---|
| **Node ≥ 22** | La base usa `node:sqlite`, nativo de Node, que no existe antes |
| Permiso de escritura en la raíz elegida | `C:\inetpub` no sirve: está protegido |
| Puerto 3001 alcanzable | Es el único que ven los usuarios |

Comprobación rápida, sin instalar nada:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\0-verificar-sin-node.ps1
```

Funciona en un servidor recién entregado — PowerShell viene con Windows. El
verificador equivalente en TypeScript (`1-verificar-servidor.ts`) necesita Node,
y por eso existe también la versión en PowerShell.

Prueba definitiva de que la versión de Node sirve:

```cmd
node -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync(':memory:'); console.log('ok', process.version)"
```

---

## 3. Estructura en el servidor

```
C:\qa\
├── app\
│   ├── qa-engine\      código del motor + node_modules
│   └── qa-lab\         código del BFF + dist + node_modules
├── data\               qa-lab.db
├── backups\
├── logs\
├── ms-playwright\      Chromium
└── .artifacts\         evidencias, manifiestos de ejecución
```

**El estado vive fuera de las carpetas de código.** Un redespliegue reemplaza
`app\` sin tocar la base de datos, el historial ni las evidencias.

No uses `C:\inetpub`: escribir ahí exige elevación en cada paso y no aporta nada
ahora que IIS no interviene.

---

## 4. Preparar el paquete (en la máquina de desarrollo)

```cmd
cd C:\Users\<usuario>\Documents\QA-lab
set VITE_API_URL=
npx vite build

cd ..\arquitectura-IA-Playwright
npx tsx deploy\3-empaquetar.ts
```

Sale `deploy\paquete\qa-lab-despliegue-<fecha>.zip`, unos 3,7 MB.

> **`VITE_API_URL` vacío no es opcional.** Compilado con
> `VITE_API_URL=http://localhost:3001`, esa URL queda *dentro* del bundle: cada
> usuario llamaría a su propia máquina. Vacío, el front usa rutas relativas al
> origen y funciona desde cualquier host.
>
> Verificar antes de desplegar:
> ```powershell
> Select-String -Path dist\assets\*.js -Pattern "localhost:3001" -Quiet
> ```
> Debe dar `False`.

### Qué se compila y qué no

Solo el front. El motor y el BFF **corren TypeScript con `tsx`** y viajan como
código fuente. El motor además no puede compilarse: arrastra 349 errores de tipo
previos, así que `tsc` falla. No es un problema en ejecución, pero descarta
cualquier plan de publicar un `dist` del backend.

---

## 5. Transferir al servidor

Por RDP, con el disco local montado (*Recursos locales → Más… → Unidades*) o por
portapapeles.

| Qué | Tamaño | Cuándo |
|---|---:|---|
| `qa-lab-despliegue-<fecha>.zip` | 3,7 MB | Siempre |
| `node_modules` del motor | 290 MB | Solo la primera vez, o si cambian dependencias |
| `node_modules` de qa-lab | 258 MB | Íd. |
| Chromium (2 carpetas) | 271 MB | Solo la primera vez |

### Si el proxy bloquea npm

Es el caso en esta red: `npm ci` resuelve el árbol y falla al bajar los `.tgz`
grandes (`appium-uiautomator2-driver` es el que revienta). `npx` también va a la
red y se cuelga.

Entonces hay que llevar `node_modules` ya instalado. **Es seguro** si la máquina
de origen tiene la misma versión mayor de Node y la misma plataforma: los únicos
binarios nativos son `oracledb` y `sharp`, ambos de Windows x64.

```powershell
# en la máquina de desarrollo
cd C:\Users\<usuario>\Documents\QA-lab
tar -a -c -f C:\temp\qalab-node-modules.zip node_modules
```

```powershell
# en el servidor
cd C:\qa\app\qa-lab
tar -xf C:\temp\qalab-node-modules.zip
```

Usa `tar`, nunca el Explorador ni `Compress-Archive`: con decenas de miles de
archivos pequeños el Explorador se atasca y `Compress-Archive` consume tanta
memoria que puede morir a mitad.

**Verifica el tamaño en bytes** antes de extraer. Regenerar paquetes con el mismo
nombre nos costó una hora persiguiendo un ZIP viejo:

```powershell
(Get-Item C:\temp\qalab-node-modules.zip).Length
```

### Chromium: solo 271 MB, no 2,3 GB

La carpeta `ms-playwright` completa tiene varias versiones y tres navegadores.
El servidor solo corre headless, y para eso basta:

```
chromium_headless_shell-<build>    267 MB
ffmpeg-<build>                       3 MB
```

Para saber qué *build* pide la versión instalada:

```cmd
node node_modules\@playwright\test\cli.js install --dry-run chromium
```

Copia esas dos carpetas a `C:\qa\ms-playwright`. Verificado: Chromium headless
arranca sin la carpeta `chromium-<build>` completa, que son 412 MB de navegador
con ventana que el servidor nunca usa.

---

## 6. Instalar

```powershell
# 1. colocar el código
cd C:\temp
tar -xf qa-lab-despliegue-<fecha>.zip
robocopy C:\temp\qa-engine C:\qa\app\qa-engine /E /XD node_modules /XF .env /NFL /NDL /NJH /NJS /NP
robocopy C:\temp\qa-lab    C:\qa\app\qa-lab    /E /XD node_modules /XF .env /NFL /NDL /NJH /NJS /NP
```

Los `/XD node_modules /XF .env` conservan las dependencias y la configuración:
son exactamente lo que no se debe pisar al actualizar.

### `.env` del motor

```powershell
$estado = "C:\qa"
$appUrl = "https://172.27.4.50"
cd C:\qa\app\qa-engine

@"
API_HOST=127.0.0.1
API_PORT=3002
API_CORS_ORIGIN=*

AUTH_ENABLED=true
AUTH_SESSION_TTL_HOURS=12
AUTH_MAX_FAILED_ATTEMPTS=5
AUTH_LOCKOUT_MINUTES=15

SQLITE_DB_PATH=$estado\data\qa-lab.db
BACKUP_DIR=$estado\backups
BACKUP_RETENTION_DAYS=14
JOB_RETENTION_DAYS=30

PLAYWRIGHT_BROWSERS_PATH=$estado\ms-playwright
EVIDENCE_DIR=$estado\.artifacts\evidence
HEADLESS=true
BROWSER=chromium
DEFAULT_TIMEOUT_MS=30000

RECORDING_ENABLED=false

MAX_CONCURRENT_EXECUTIONS=3
MAX_CONCURRENT_RECORDINGS=2
MAX_CONCURRENT_EMULATORS=1

APP_BASE_URL=$appUrl
APP_LOGIN_MODE=password

NODE_ENV=production
"@ | Set-Content -Path ".env" -Encoding UTF8

if (Test-Path ".env") { Write-Host "ok" } else { Write-Host "FALLO: sin permisos" }
```

**Seis variables son obligatorias** — sin ellas el motor no arranca y muere con
`Missing required environment variable`:

`APP_BASE_URL`, `APP_LOGIN_MODE`, `BROWSER`, `DEFAULT_TIMEOUT_MS`,
`EVIDENCE_DIR`, `HEADLESS`.

`APP_BASE_URL` **no es el servidor**: es un valor por defecto del framework.
Cada proyecto guarda su propia URL en la base, y esa es la que manda al ejecutar.

Jira, TestRail y Oracle no hacen falta para arrancar. El login y la
administración de usuarios funcionan sin ellas; se agregan cuando se vayan a usar
esos módulos.

### `.env` del BFF

```powershell
cd C:\qa\app\qa-lab

@"
PORT=3001
SCENARIO_PREVIEW_BASE_URL=http://127.0.0.1:3002
RUN_PROVIDER_BASE_URL=http://127.0.0.1:3002
"@ | Set-Content -Path ".env" -Encoding UTF8
```

Sin `SCENARIO_PREVIEW_BASE_URL` el BFF no sabe dónde está el motor y el login
responde `engine_not_configured`.

### Base de datos y primer administrador

```cmd
cd /d C:\qa\app\qa-engine
npm run db:init      :: crea las 18 tablas
npm run auth:init    :: roles del sistema + primer admin
```

`auth:init` imprime una contraseña temporal **una sola vez**. Guárdala. Si se
pierde, se crea otro administrador con `npm run auth:init -- --username otro`.

---

## 7. Arrancar

### A mano, para validar

```cmd
:: consola 1
cd /d C:\qa\app\qa-engine
npm run server
```
```cmd
:: consola 2
cd /d C:\qa\app\qa-lab
node node_modules\tsx\dist\cli.mjs server\index.ts
```

Líneas que confirman que todo está bien:

```
[server] Auth        : sesiones de usuario (Bearer)
[server] jobs        : 0 recuperados de SQLite
[qa-lab-server] front servido desde C:\qa\app\qa-lab\dist
[qa-lab-server] API listening on http://localhost:3001
```

Prueba de que la cadena completa responde:

```cmd
curl -X POST http://127.0.0.1:3001/api/auth/login -H "content-type: application/json" -d "{\"username\":\"x\",\"password\":\"y\"}"
```

Debe devolver `invalid_credentials` — significa que el BFF llegó al motor y este
rechazó unas credenciales falsas.

### Como tareas programadas

Node no se convierte en servicio solo. Los `.cmd` de `deploy\` se posicionan en
la carpeta correcta, evitan `npx` y escriben un log diario en `C:\qa\logs`.

Consola **elevada**, una vez:

```cmd
schtasks /create /tn "QA Lab - motor" /tr "C:\qa\app\qa-engine\deploy\servicio-motor.cmd" /sc onstart /ru "DOMINIO\cuenta" /rp * /rl LIMITED
schtasks /create /tn "QA Lab - BFF"   /tr "C:\qa\app\qa-lab\deploy\servicio-bff.cmd"     /sc onstart /ru "DOMINIO\cuenta" /rp * /rl LIMITED

schtasks /run /tn "QA Lab - motor"
schtasks /run /tn "QA Lab - BFF"
```

El Programador de tareas **no reinicia si un proceso se cae**. Se activa desde la
interfaz: Propiedades → Configuración → *Si la tarea falla, reiniciar cada 1
minuto*. Para algo más sólido, **NSSM** (350 KB, `nssm.cc`) da reinicio
automático y aparece en `services.msc`.

### Cuenta de servicio

Usa una cuenta dedicada, no la personal. Una cuenta de persona tumba el servicio
el día que caduque su contraseña —a los 60 o 90 días, de madrugada y en
silencio— y deja a su nombre todo lo que haga el motor.

No hace falta que sea de dominio: nada aquí usa autenticación de Windows. Basta
una cuenta local con escritura en `C:\qa`:

```powershell
New-LocalUser -Name svc_qalab -Password (Read-Host -AsSecureString) -PasswordNeverExpires
icacls C:\qa /grant "svc_qalab:(OI)(CI)F" /T
```

---

## 8. Acceso desde la red

El BFF escucha en todas las interfaces (`::` en modo dual, acepta IPv4 e IPv6).

```
http://srvdevqaca01:3001
```

Si hace falta abrir el firewall (consola elevada):

```powershell
New-NetFirewallRule -DisplayName "QA Lab (BFF 3001)" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Domain
```

**No abras el 3002.**

Para diagnosticar desde otro equipo — ejecutándolo **en ese equipo**, no en el
servidor, o `Test-NetConnection` resuelve a loopback y no prueba nada:

```powershell
Resolve-DnsName srvdevqaca01
Test-NetConnection 172.27.4.97 -Port 3001
```

| Resultado | Causa |
|---|---|
| Por IP sí, por nombre no | DNS: usar la IP o registrar el nombre |
| Ninguna de las dos | Segmentación entre VLAN — es de infraestructura |
| Ambas sí, el navegador no | Falta `http://` explícito: el BFF no habla HTTPS |

---

## 9. Operación

### Respaldo

```cmd
schtasks /create /tn "QA Lab - respaldo" /tr "C:\qa\app\qa-engine\scripts\backup-qa-lab.bat" /sc daily /st 02:00 /ru "DOMINIO\cuenta" /rp *
```

Usa `VACUUM INTO`: snapshot consistente sin detener el servicio, y **verificado**
antes de contar como respaldo — si no pasa `integrity_check`, el archivo se borra.
Copiar el `.db` en caliente no sirve: con WAL activo puede quedar inconsistente.

Conviene que `BACKUP_DIR` esté en otro disco.

### Logs

```
C:\qa\logs\motor-<fecha>.log
C:\qa\logs\bff-<fecha>.log
```

### Qué sobrevive a un reinicio

| Dato | ¿Sobrevive? |
|---|---|
| Usuarios, roles, permisos, sesiones | Sí (SQLite) |
| Proyectos y su configuración | Sí (SQLite) |
| Specs promovidos, planes, Page Objects | Sí (disco) |
| Historial de ejecuciones y evidencias | Sí (disco) |
| Lista de corridas y sus logs | Sí (SQLite) |
| Ejecuciones **en curso** | No — se marcan `failed` con *"Interrumpido por un reinicio del servidor"* |
| Grabación a medias | No — los frames se descartan al arrancar |

### Concurrencia

Dimensionado para 16 GB: **3 ejecuciones simultáneas**. La cuarta espera en cola
con estado `queued` y arranca sola cuando se libera un espacio; ninguna se pierde.

Las grabaciones no se encolan: se rechazan con 503 y un mensaje claro, porque hay
una persona esperando ver un navegador.

### Grabación: no funciona en el servidor, y es correcto

Grabar abre un navegador **visible** que alguien conduce a mano. Un servicio de
Windows corre en la Sesión 0, que no tiene escritorio; y aunque lo tuviera, la
ventana estaría en el servidor y no delante de quien graba.

Por eso `RECORDING_ENABLED=false`: el motor responde 503 con la explicación y el
front oculta el módulo. **Se graba desde la máquina de cada QA**, y lo promovido
se lleva al servidor.

---

## 10. Actualizar

```powershell
# en desarrollo
cd ...\QA-lab
set VITE_API_URL=
npx vite build
cd ...\arquitectura-IA-Playwright
npx tsx deploy\3-empaquetar.ts
```

```powershell
# en el servidor
schtasks /end /tn "QA Lab - motor"
schtasks /end /tn "QA Lab - BFF"

cd C:\temp
tar -xf qa-lab-despliegue-<fecha>.zip
robocopy C:\temp\qa-engine C:\qa\app\qa-engine /E /XD node_modules /XF .env /NFL /NDL /NJH /NJS /NP
robocopy C:\temp\qa-lab    C:\qa\app\qa-lab    /E /XD node_modules /XF .env /NFL /NDL /NJH /NJS /NP

schtasks /run /tn "QA Lab - motor"
schtasks /run /tn "QA Lab - BFF"
```

`node_modules` solo se retransfiere si cambiaron las dependencias.

**Nunca uses `robocopy /MIR` sobre `C:\qa\app`**: borraría lo que no está en el
origen, incluido `node_modules` y el `.env`.

---

## 11. Errores que nos costaron tiempo

| Síntoma | Causa | Solución |
|---|---|---|
| `EPERM` al escribir en `C:\inetpub` | Carpeta protegida de Windows | Desplegar en `C:\qa`, no en `inetpub` |
| `ETIMEDOUT` en `npm ci` | El proxy corta las descargas grandes | Llevar `node_modules` ya instalado |
| `npx <algo>` se cuelga | `npx` va a la red si no lo encuentra local | `node node_modules\tsx\dist\cli.mjs …` |
| `The token '&&' is not a valid statement separator` | PowerShell 5.1 no soporta `&&` | Escribir `cmd`, o una línea por comando |
| `Cannot find module '../../evidence/...'` | El empaquetador excluía carpetas **por nombre**, y hay `src/data`, `src/evidence`, `src/automations` | Corregido: se excluyen por ruta absoluta |
| El ZIP no traía los cambios | Se regeneró con el mismo nombre y se copió el viejo | Verificar el tamaño en bytes antes de extraer |
| `__dirname is not defined` | qa-lab es ESM | `fileURLToPath(import.meta.url)` |
| `engine_not_configured` al entrar | Falta `SCENARIO_PREVIEW_BASE_URL` en el `.env` del BFF | Crearlo y reiniciar el BFF |
| `Executable doesn't exist at …\AppData\Local\ms-playwright\…` | `PLAYWRIGHT_BROWSERS_PATH` no definida en esa consola | El `.env` solo lo lee la app; para pruebas sueltas, definirla a mano |
| `item is in use` al mover una carpeta | La consola está dentro de ella | `cd C:\` primero |
| El front funciona en el servidor pero no desde otro PC | `localhost` embebido en el bundle | Compilar con `VITE_API_URL=` vacío |
| Se copiaron `.env.backup-*` con credenciales | La exclusión era `.env`, no `.env*` | Corregido en el empaquetador |

---

## 12. Pendiente

- **Permisos de administrador** para quien opere el servidor, o control total
  sobre `C:\qa`. Cuatro pasos del despliegue tropezaron con esto.
- **Cuenta de servicio dedicada** en lugar de una personal.
- **NSSM** en lugar del Programador de tareas, para reinicio automático.
- **HTTPS**: requiere ARR y volver al proxy inverso de IIS.
- **Repositorio de automatizaciones**: hoy los specs promovidos viven solo en el
  servidor. Lo mínimo es `git init` en `C:\qa\.artifacts` más una tarea que
  commitee; un remoto compartido si se quiere copia fuera del servidor.
- **Proyectos**: la base arranca vacía. Hay que darlos de alta desde Configuración.
