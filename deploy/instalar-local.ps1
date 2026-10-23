# ---------------------------------------------------------------------------
#  Instalacion LOCAL de QA Lab (maquina de un QA)
#
#  El servidor no puede grabar: un servicio de Windows no tiene escritorio donde
#  mostrar el navegador, y aunque lo tuviera, la ventana estaria en el servidor y
#  no delante de la persona. Por eso se graba en local y se promueve al servidor.
#
#  Esta instalacion es para grabar y derivar escenarios. Deja:
#    - HEADLESS=false        se ve el navegador
#    - RECORDING_ENABLED=true
#    - base de datos propia en data\qa-lab.db
#
#  Uso, desde la raiz del repo del motor:
#     powershell -ExecutionPolicy Bypass -File deploy\instalar-local.ps1
#
#  Es idempotente: si ya hay .env o administrador, no los toca.
# ---------------------------------------------------------------------------

param(
    # URL de la aplicacion a probar. Solo un valor por defecto: cada proyecto
    # guarda la suya en la base de datos.
    [string]$AppUrl = "https://172.27.4.50",
    # Rehace el .env aunque ya exista (guarda copia del anterior).
    [switch]$RehacerEnv
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot

function Titulo($texto) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "  $texto"
    Write-Host "============================================================"
    Write-Host ""
}

function Paso($n, $texto) { Write-Host "[$n] $texto" }

Titulo "QA Lab - instalacion local"
Write-Host "  carpeta : $raiz"
Write-Host "  app     : $AppUrl"

Set-Location $raiz

# --- 1. Requisitos ---------------------------------------------------------
Paso 1 "Comprobando requisitos"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "    FALTA Node.js. Instala la version 22 o superior desde nodejs.org" -ForegroundColor Red
    exit 1
}
$nodeVer = (& node --version)
$mayor = 0
if ($nodeVer -match '^v(\d+)') { $mayor = [int]$Matches[1] }
if ($mayor -lt 22) {
    Write-Host "    Node $nodeVer es demasiado antiguo. La base usa node:sqlite, que necesita 22+" -ForegroundColor Red
    exit 1
}
Write-Host "    Node $nodeVer  OK"

if (-not (Test-Path "$raiz\node_modules\tsx\dist\cli.mjs")) {
    Write-Host "    Faltan dependencias. Ejecuta:  npm ci" -ForegroundColor Red
    Write-Host "    (si la red corporativa lo bloquea, copia node_modules de otra maquina)"
    exit 1
}
Write-Host "    node_modules  OK"

# --- 2. Configuracion ------------------------------------------------------
Paso 2 "Configuracion (.env)"

$envPath = Join-Path $raiz ".env"
if ((Test-Path $envPath) -and -not $RehacerEnv) {
    Write-Host "    ya existe, no se toca.  (usa -RehacerEnv para regenerarlo)"
} else {
    if (Test-Path $envPath) {
        $copia = "$envPath.anterior-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
        Copy-Item $envPath $copia
        Write-Host "    copia del anterior en $(Split-Path -Leaf $copia)"
    }

    $datos = Join-Path $raiz "data"
    $artefactos = Join-Path $raiz ".artifacts\evidence"
    New-Item -ItemType Directory -Force -Path $datos, $artefactos | Out-Null

    @"
# QA Lab - instalacion LOCAL para grabar.
# Generado por deploy\instalar-local.ps1

API_HOST=127.0.0.1
API_PORT=3002
API_CORS_ORIGIN=*

AUTH_ENABLED=true
AUTH_SESSION_TTL_HOURS=12

SQLITE_DB_PATH=$datos\qa-lab.db
BACKUP_DIR=$raiz\data\backups
EVIDENCE_DIR=$artefactos

# En local SI se ve el navegador: es justo lo que hace falta para grabar.
HEADLESS=false
RECORDING_ENABLED=true

BROWSER=chromium
DEFAULT_TIMEOUT_MS=30000

# Una sola ejecucion a la vez: es una laptop, no un servidor.
MAX_CONCURRENT_EXECUTIONS=1
MAX_CONCURRENT_RECORDINGS=1

APP_BASE_URL=$AppUrl
APP_LOGIN_MODE=password
"@ | Set-Content -Path $envPath -Encoding UTF8

    if (Test-Path $envPath) { Write-Host "    .env creado  OK" }
    else { Write-Host "    FALLO al crear el .env" -ForegroundColor Red; exit 1 }
}

# --- 3. Navegadores --------------------------------------------------------
Paso 3 "Navegadores de Playwright"

$marca = Join-Path $raiz "node_modules\@playwright\test\cli.js"
$instalados = $false
try {
    $salida = & node $marca install --dry-run chromium 2>&1 | Out-String
    if ($salida -match 'Install location:\s*(.+)') {
        $ruta = $Matches[1].Trim()
        $instalados = Test-Path $ruta
    }
} catch { }

if ($instalados) {
    Write-Host "    ya instalados  OK"
} else {
    Write-Host "    descargando Chromium (puede tardar unos minutos)..."
    & node $marca install chromium
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    No se pudieron descargar." -ForegroundColor Yellow
        Write-Host "    Si la red corporativa bloquea el CDN, copia estas dos carpetas"
        Write-Host "    de otra maquina a %LOCALAPPDATA%\ms-playwright :"
        Write-Host "      chromium_headless_shell-<build>   y   ffmpeg-<build>"
        Write-Host "    Para grabar hace falta ademas chromium-<build> (navegador con ventana)."
    }
}

# --- 4. Base de datos ------------------------------------------------------
Paso 4 "Base de datos"
& npm run db:init --silent
if ($LASTEXITCODE -ne 0) { Write-Host "    FALLO al crear la base" -ForegroundColor Red; exit 1 }

# --- 5. Administrador ------------------------------------------------------
Paso 5 "Usuario administrador"
Write-Host ""
& npm run auth:init --silent

# --- Cierre ----------------------------------------------------------------
Titulo "Listo"

Write-Host "  Arranca los dos procesos, cada uno en su consola:"
Write-Host ""
Write-Host "    cd $raiz"
Write-Host "    npm run server"
Write-Host ""
Write-Host "    cd <carpeta de QA-lab>"
Write-Host "    npm run dev:all"
Write-Host ""
Write-Host "  Y entra en http://localhost:5173"
Write-Host ""
Write-Host "  Si arriba se imprimio una contrasena temporal, copiala ahora:"
Write-Host "  se muestra una sola vez y habra que cambiarla al entrar."
Write-Host ""
