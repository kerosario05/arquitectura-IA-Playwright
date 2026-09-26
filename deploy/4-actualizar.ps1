<#
.SYNOPSIS
  Actualiza una instalacion EXISTENTE de QA Lab en el servidor.

.DESCRIPTION
  Para el primer despliegue usa LEEME.md secciones 5 a 7. Este script es solo para
  reemplazar el codigo de una instalacion que ya funciona.

  Que hace, en orden:
    1. Localiza la raiz (C:\qa o D:\qa) y verifica que este completa.
    2. Detiene el motor y el BFF: por tarea programada si existe, si no matando
       los procesos node que ejecutan cada uno.
    3. Copia el codigo con robocopy, SIN /MIR y excluyendo node_modules y .env.
    4. Aplica el esquema de la base (db:init). Las tablas nuevas se crean solas.
    5. Rearranca los dos procesos y espera /health de verdad.

  Lo que NUNCA toca: data\, backups\, logs\, .artifacts\, ms-playwright\, ni el
  .env de ninguno de los dos proyectos.

  NO ejecuta npm install, y no debes ejecutarlo tu tampoco: `odbc` figura como
  dependencia pero solo se carga con DB_DRIVER=sqlserver, y al ser modulo nativo
  su compilacion falla en un servidor sin internet ni herramientas de build. El
  node_modules que ya esta instalado sirve.

.PARAMETER Origen
  Carpeta donde descomprimiste el ZIP. Debe contener qa-engine\ y qa-lab\.

.PARAMETER Raiz
  Opcional. Fuerza la raiz de instalacion en vez de detectarla.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\4-actualizar.ps1 -Origen C:\temp
#>
param(
  [Parameter(Mandatory = $true)][string]$Origen,
  [string]$Raiz
)

$ErrorActionPreference = "Stop"

function Titulo($t) {
  Write-Host ""
  Write-Host "============================================================"
  Write-Host "  $t"
  Write-Host "============================================================"
  Write-Host ""
}
function Paso($n, $t) { Write-Host "[$n] $t" }
function Ok($t)    { Write-Host "  [ok] $t" }
function Aviso($t) { Write-Host "  [aviso] $t" -ForegroundColor Yellow }
function Muere($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red; exit 1 }

Titulo "Actualizacion de QA Lab"

# --- 1. Localizar la instalacion --------------------------------------------------------------
Paso 1 "Localizando la instalacion"

if (-not $Raiz) {
  # Concatenacion en vez de Join-Path: si la unidad no existe, Join-Path lanza
  # DriveNotFoundException y con ErrorActionPreference=Stop abortaria la deteccion
  # en vez de pasar a la siguiente candidata.
  foreach ($candidata in @("C:\qa", "D:\qa")) {
    $sonda = "$candidata\app\qa-engine"
    if (Test-Path -LiteralPath $sonda -ErrorAction SilentlyContinue) { $Raiz = $candidata; break }
  }
}
if (-not $Raiz) {
  Muere "No encontre la instalacion en C:\qa ni D:\qa. Pasa la ruta con -Raiz."
}

$appEngine = Join-Path $Raiz "app\qa-engine"
$appLab    = Join-Path $Raiz "app\qa-lab"
$srcEngine = Join-Path $Origen "qa-engine"
$srcLab    = Join-Path $Origen "qa-lab"

foreach ($p in @($appEngine, $appLab, $srcEngine, $srcLab)) {
  if (-not (Test-Path $p)) { Muere "No existe: $p" }
}
# Sin .env no arranca, y este script no lo crea: se conserva el que ya hay.
foreach ($p in @((Join-Path $appEngine ".env"), (Join-Path $appLab ".env"))) {
  if (-not (Test-Path $p)) { Muere "Falta $p. Esta instalacion no esta completa; revisa LEEME.md seccion 6." }
}
foreach ($p in @((Join-Path $appEngine "node_modules"), (Join-Path $appLab "node_modules"))) {
  if (-not (Test-Path $p)) { Muere "Falta $p. Este script no instala dependencias; revisa LEEME.md seccion 5." }
}
Ok "raiz    : $Raiz"
Ok "origen  : $Origen"

# --- 2. Detener --------------------------------------------------------------------------------
Paso 2 "Deteniendo motor y BFF"

# schtasks escribe en stderr cuando la tarea no existe, que es el caso normal aqui
# mientras las tareas programadas sigan sin registrarse. En PowerShell 5.1 redirigir
# el stderr de un ejecutable nativo (2>$null) envuelve cada linea en un
# NativeCommandError, y con ErrorActionPreference=Stop eso aborta el script entero.
# Delegando en cmd, el stderr muere dentro de cmd y PowerShell solo ve el codigo de
# salida, que es lo unico que nos interesa.
function TareaExiste($nombre) {
  & cmd /c "schtasks /query /tn ""$nombre"" >nul 2>nul"
  return ($LASTEXITCODE -eq 0)
}
function DetenerTarea($nombre) {
  & cmd /c "schtasks /end /tn ""$nombre"" >nul 2>nul"
}

$tareas = @("QA Lab - motor", "QA Lab - BFF")
$detenidoPorTarea = $false
foreach ($t in $tareas) {
  if (TareaExiste $t) {
    DetenerTarea $t
    Ok "tarea detenida: $t"
    $detenidoPorTarea = $true
  }
}
if (-not $detenidoPorTarea) {
  Aviso "No hay tareas programadas registradas; matando los procesos node por su linea de comandos."
  # Se compara contra las rutas RESUELTAS de esta instalacion, no contra los textos
  # "qa-engine"/"qa-lab" sueltos: cualquier carpeta de trabajo que contenga esos
  # nombres (un repo llamado QA-lab, por ejemplo) caeria en la coincidencia y este
  # script mataria procesos que no son suyos. Ya paso durante una prueba.
  $raices = @($appEngine, $appLab) | ForEach-Object { $_.TrimEnd('\') }
  $procesos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $cmd = $_.CommandLine
      $cmd -and ($raices | Where-Object { $cmd -like "*$_*" })
    }
  if (-not $procesos) {
    Aviso "No habia ninguno corriendo."
  } else {
    foreach ($p in $procesos) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Ok "proceso $($p.ProcessId) detenido" }
      catch { Aviso "no pude detener $($p.ProcessId): $($_.Exception.Message)" }
    }
  }
}
Start-Sleep -Seconds 3

# --- 3. Copiar ---------------------------------------------------------------------------------
Paso 3 "Copiando codigo"

# Sin /MIR a proposito: borraria node_modules y el .env, que no viajan en el paquete.
$comunes = @("/E", "/XD", "node_modules", "/XF", ".env", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1")
foreach ($par in @(@($srcEngine, $appEngine, "motor"), @($srcLab, $appLab, "qa-lab"))) {
  & robocopy $par[0] $par[1] @comunes | Out-Null
  # robocopy usa codigos < 8 para exito con matices; solo >= 8 es fallo real.
  if ($LASTEXITCODE -ge 8) { Muere "robocopy devolvio $LASTEXITCODE copiando $($par[2])" }
  Ok "$($par[2]) actualizado"
}

# --- 4. Esquema de la base ---------------------------------------------------------------------
Paso 4 "Aplicando el esquema de la base"

Push-Location $appEngine
try {
  # Idempotente: CREATE TABLE IF NOT EXISTS mas migraciones aditivas. Las tablas
  # que no existian todavia (Jobs, JobLogs, RecordingRouteObservation) se crean aqui.
  & npx tsx src/cli/db-init.ts
  if ($LASTEXITCODE -ne 0) { Muere "db:init fallo con codigo $LASTEXITCODE" }
  Ok "esquema aplicado"
} finally {
  Pop-Location
}

# --- 5. Arrancar -------------------------------------------------------------------------------
Paso 5 "Arrancando"

if ($detenidoPorTarea) {
  # Por cmd, por el mismo motivo que en el paso 2.
  foreach ($t in $tareas) {
    & cmd /c "schtasks /run /tn ""$t"" >nul 2>nul"
    if ($LASTEXITCODE -eq 0) { Ok "tarea lanzada: $t" } else { Aviso "no pude lanzar la tarea $t (codigo $LASTEXITCODE)" }
  }
} else {
  $logs = Join-Path $Raiz "logs"
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Start-Process -FilePath "npx" -ArgumentList "tsx","src/server/server.ts" `
    -WorkingDirectory $appEngine -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "motor-$stamp.log") `
    -RedirectStandardError  (Join-Path $logs "motor-$stamp.err.log")
  Ok "motor lanzado (log en $logs)"
  Start-Process -FilePath "npx" -ArgumentList "tsx","server/index.ts" `
    -WorkingDirectory $appLab -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "bff-$stamp.log") `
    -RedirectStandardError  (Join-Path $logs "bff-$stamp.err.log")
  Ok "BFF lanzado"
}

# --- 6. Verificar ------------------------------------------------------------------------------
Paso 6 "Esperando /health"

$puerto = 3001
$listo = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$puerto/health" -UseBasicParsing -TimeoutSec 4
    if ($r.StatusCode -eq 200) { $listo = $true; break }
  } catch { }
}

if ($listo) {
  Ok "el BFF responde en http://127.0.0.1:$puerto/health"
  Titulo "Actualizacion completa"
  Write-Host "  Comprueba desde tu PC:  http://<ip-del-servidor>:$puerto"
  Write-Host "  Si algo va mal, los logs estan en $(Join-Path $Raiz 'logs')"
} else {
  Aviso "No respondio en 60 segundos."
  Write-Host "  Revisa los logs en $(Join-Path $Raiz 'logs') antes de dar por fallida la actualizacion:"
  Write-Host "  el motor puede tardar mas si esta recuperando muchos jobs de la base."
  exit 1
}
