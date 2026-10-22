<#
.SYNOPSIS
  Deja el motor y el BFF de QA Lab corriendo como servicio del servidor (tareas programadas
  que arrancan con Windows), sin depender de que alguien tenga una consola abierta.

.DESCRIPTION
  Crea dos tareas programadas que:
    - arrancan al iniciar Windows, sin que nadie inicie sesion;
    - corren con una cuenta de servicio (por defecto SYSTEM), no con la del usuario conectado;
    - se reinician solas si node se cae (bucle en el lanzador, espera 10 s entre intentos);
    - escriben un log diario en <Raiz>\logs.

  Cualquier usuario entra al panel por el navegador (http://<servidor>:<puerto BFF>); nadie
  necesita abrir terminales. Para gestionar el servicio basta una consola de administrador
  con este mismo script (-Accion iniciar | detener | reiniciar | estado | desinstalar).

  Los nombres por defecto ("QA Lab - motor" / "QA Lab - BFF") son los que ya espera
  4-actualizar.ps1: con las tareas creadas, la actualizacion las detiene y relanza sola.

.PARAMETER Accion
  instalar (por defecto) | iniciar | detener | reiniciar | estado | desinstalar
.PARAMETER Raiz
  Carpeta de la instalacion (contiene app\qa-engine y app\qa-lab). Por defecto la que contiene
  este script, o C:\qa / D:\qa. Para la instancia paralela: -Raiz D:\qa-v2 -Sufijo v2
.PARAMETER Sufijo
  Se anade al nombre de las tareas, para tener dos instancias. Ej. "v2" -> "QA Lab v2 - motor".
.PARAMETER Usuario
  Cuenta con la que corren. Por defecto SYSTEM (no caduca, no necesita contrasena).
  Para una cuenta dedicada: -Usuario ".\svc_qalab" (pedira la contrasena).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\qa\app\qa-engine\deploy\servicios-qa-lab.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File D:\qa-v2\app\qa-engine\deploy\servicios-qa-lab.ps1 -Raiz D:\qa-v2 -Sufijo v2
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\qa\app\qa-engine\deploy\servicios-qa-lab.ps1 -Accion estado
#>
param(
  [ValidateSet("instalar", "iniciar", "detener", "reiniciar", "estado", "desinstalar")]
  [string]$Accion = "instalar",
  [string]$Raiz,
  [string]$Sufijo,
  [string]$Usuario = "SYSTEM"
)

$ErrorActionPreference = "Stop"
function Ok($t)    { Write-Host "  [ok] $t" }
function Aviso($t) { Write-Host "  [aviso] $t" -ForegroundColor Yellow }
function Muere($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red; exit 1 }

$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin -and $Accion -ne "estado") { Muere "Ejecuta esta consola como administrador." }

# --- Localizar la instalacion -----------------------------------------------------------------
if (-not $Raiz) {
  # Por defecto, la instalacion que contiene a este script (<Raiz>\app\qa-engine\deploy).
  $propia = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
  if (Test-Path -LiteralPath (Join-Path $propia "app\qa-engine") -ErrorAction SilentlyContinue) { $Raiz = $propia }
}
if (-not $Raiz) {
  foreach ($c in @("C:\qa", "D:\qa")) {
    if (Test-Path -LiteralPath "$c\app\qa-engine" -ErrorAction SilentlyContinue) { $Raiz = $c; break }
  }
}
if (-not $Raiz) { Muere "No encontre la instalacion (app\qa-engine). Pasala con -Raiz." }
$appEngine = Join-Path $Raiz "app\qa-engine"
$appLab    = Join-Path $Raiz "app\qa-lab"
$logs      = Join-Path $Raiz "logs"
$dirSvc    = Join-Path $Raiz "servicios"

# Si esta instancia ya corre como servicio de Windows (p. ej. WinSW en <Raiz>\winsw), este script
# NO debe crear tareas: duplicaria motor y BFF en los mismos puertos.
$raizSvc = $Raiz.TrimEnd('\') + '\'
$serviciosWin = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -and $_.PathName.Trim('"') -like "$raizSvc*" })
if ($serviciosWin.Count -gt 0 -and $Accion -ne "estado") {
  Muere ("$Raiz ya corre como servicio de Windows (" + (($serviciosWin | ForEach-Object { $_.Name }) -join ", ") + "). Gestionalo con Get-Service / Restart-Service; no uses este script.")
}

$etiqueta = if ($Sufijo) { "QA Lab $Sufijo" } else { "QA Lab" }
$tareaMotor = "$etiqueta - motor"
$tareaBff   = "$etiqueta - BFF"

function Get-EnvValue($archivo, $clave) {
  if (-not (Test-Path -LiteralPath $archivo)) { return $null }
  $patron = "^\s*" + [regex]::Escape($clave) + "\s*=\s*(.*)$"
  foreach ($l in Get-Content -LiteralPath $archivo) { if ($l -match $patron) { return $Matches[1].Trim().Trim('"') } }
  return $null
}
$puertoBff = Get-EnvValue (Join-Path $appLab ".env") "PORT"; if (-not $puertoBff) { $puertoBff = "3001" }
$puertoMotor = Get-EnvValue (Join-Path $appEngine ".env") "PORT"
if (-not $puertoMotor) { $puertoMotor = Get-EnvValue (Join-Path $appEngine ".env") "API_PORT" }
if (-not $puertoMotor) { $puertoMotor = "3002" }

function Tarea($nombre) { Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue }

# Mata los procesos de ESTA instalacion (por ruta), por si quedo alguno lanzado a mano o huerfano.
function MatarNodeDeLaInstalacion {
  $raices = @($appEngine, $appLab, $dirSvc) | ForEach-Object { $_.TrimEnd('\') }
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" | Where-Object {
    $cmd = $_.CommandLine; $cmd -and ($raices | Where-Object { $cmd -like "*$_*" })
  }
  foreach ($p in $procs) {
    if (-not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)) { continue }
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Ok "proceso $($p.ProcessId) detenido" } catch { }
  }
}

function Detener {
  foreach ($t in @($tareaMotor, $tareaBff)) {
    if (Tarea $t) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue; Ok "tarea detenida: $t" }
  }
  Start-Sleep -Seconds 2
  MatarNodeDeLaInstalacion
}

function Iniciar {
  foreach ($t in @($tareaMotor, $tareaBff)) {
    if (-not (Tarea $t)) { Muere "No existe la tarea '$t'. Ejecuta primero -Accion instalar." }
    Start-ScheduledTask -TaskName $t; Ok "tarea lanzada: $t"
  }
}

function EsperarSalud {
  $bff = $false; $motor = $false
  foreach ($i in 1..90) {
    Start-Sleep -Seconds 2
    if (-not $motor) { try { $motor = ((Invoke-WebRequest "http://127.0.0.1:$puertoMotor/health" -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200) } catch { } }
    if (-not $bff)   { try { $bff   = ((Invoke-WebRequest "http://127.0.0.1:$puertoBff/api/health" -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200) } catch { } }
    if ($bff -and $motor) { break }
  }
  if ($motor) { Ok "motor responde en 127.0.0.1:$puertoMotor" } else { Aviso "el motor no respondio en 3 min; revisa $logs" }
  if ($bff)   { Ok "panel responde en http://$($env:COMPUTERNAME):$puertoBff" } else { Aviso "el BFF no respondio en 3 min; revisa $logs" }
}

function Estado {
  foreach ($t in @($tareaMotor, $tareaBff)) {
    $x = Tarea $t
    if (-not $x) { Write-Host "  $t : no instalada"; continue }
    $info = Get-ScheduledTaskInfo -TaskName $t
    Write-Host ("  {0} : {1} (ultimo arranque {2}, cuenta {3})" -f $t, $x.State, $info.LastRunTime, $x.Principal.UserId)
  }
  foreach ($p in @(@("motor", "http://127.0.0.1:$puertoMotor/health"), @("BFF", "http://127.0.0.1:$puertoBff/api/health"))) {
    $ok = $false; try { $ok = ((Invoke-WebRequest $p[1] -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200) } catch { }
    Write-Host ("  {0} {1}: {2}" -f $p[0], $p[1], $(if ($ok) { "responde" } else { "NO responde" }))
  }
}

# Lanzador con reinicio automatico: si node termina (caida), espera 10 s y vuelve a arrancar.
# Usa node + tsx local (sin npx: en el servidor npx intentaria descargar tsx).
function EscribirLanzador($archivo, $nombre, $carpeta, $entrada, $node) {
  $contenido = @"
@echo off
REM Generado por servicios-qa-lab.ps1. Lo ejecuta la tarea "$nombre". No editar a mano.
setlocal
cd /d "$carpeta" || exit /b 1
if not exist "$logs" mkdir "$logs" 2>nul
:bucle
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set "DIA=%%i"
set "LOG=$logs\$nombre-%DIA%.log"
echo [%DATE% %TIME%] arrancando $nombre >>"%LOG%"
"$node" node_modules\tsx\dist\cli.mjs $entrada >>"%LOG%" 2>&1
echo [%DATE% %TIME%] $nombre termino con codigo %ERRORLEVEL%; reinicio en 10 s >>"%LOG%"
timeout /t 10 /nobreak >nul
goto bucle
"@
  [System.IO.File]::WriteAllText($archivo, $contenido, (New-Object System.Text.ASCIIEncoding))
}

switch ($Accion) {
  "estado"    { Estado; exit 0 }
  "detener"   { Detener; exit 0 }
  "iniciar"   { Iniciar; EsperarSalud; exit 0 }
  "reiniciar" { Detener; Iniciar; EsperarSalud; exit 0 }
  "desinstalar" {
    Detener
    foreach ($t in @($tareaMotor, $tareaBff)) {
      if (Tarea $t) { Unregister-ScheduledTask -TaskName $t -Confirm:$false; Ok "tarea eliminada: $t" }
    }
    exit 0
  }
}

# --- instalar ---------------------------------------------------------------------------------
Write-Host ""; Write-Host "Instalando $etiqueta como servicio ($Raiz)"; Write-Host ""

foreach ($c in @($appEngine, $appLab)) {
  if (-not (Test-Path -LiteralPath (Join-Path $c "node_modules\tsx\dist\cli.mjs"))) { Muere "Falta node_modules (tsx) en $c." }
  if (-not (Test-Path -LiteralPath (Join-Path $c ".env"))) { Muere "Falta el .env en $c." }
}
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { Muere "No encuentro node.exe en el PATH." }
if ($node -like "*\Users\*") {
  Aviso "node.exe esta en un perfil de usuario ($node): la cuenta del servicio quiza no pueda leerlo. Mejor instalar Node para todos los usuarios."
}
Ok "node: $node"

# Navegadores: con SYSTEM (u otra cuenta) el perfil cambia; Playwright debe saber donde estan.
$pwPath = Get-EnvValue (Join-Path $appEngine ".env") "PLAYWRIGHT_BROWSERS_PATH"
if (-not $pwPath) { $pwPath = [Environment]::GetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", "Machine") }
if (-not $pwPath) {
  Aviso "PLAYWRIGHT_BROWSERS_PATH no esta definido (ni en el .env del motor ni a nivel de sistema). La cuenta del servicio no encontrara Chromium."
} elseif (-not (Test-Path -LiteralPath $pwPath)) {
  Aviso "PLAYWRIGHT_BROWSERS_PATH=$pwPath no existe."
} else { Ok "navegadores: $pwPath" }

New-Item -ItemType Directory -Force -Path $dirSvc, $logs | Out-Null
$lanzMotor = Join-Path $dirSvc "motor.cmd"
$lanzBff   = Join-Path $dirSvc "bff.cmd"
$sufijoLog = if ($Sufijo) { "-$Sufijo" } else { "" }
EscribirLanzador $lanzMotor "motor$sufijoLog" $appEngine "src\server\server.ts" $node
EscribirLanzador $lanzBff   "bff$sufijoLog"   $appLab    "server\index.ts"     $node
Ok "lanzadores en $dirSvc"

# Si estaba corriendo a mano o con tareas viejas, se para antes de registrar.
Detener

$principal = if ($Usuario -eq "SYSTEM") {
  New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
} else { $null }
$credencial = $null
if (-not $principal) {
  $credencial = Get-Credential -UserName $Usuario -Message "Contrasena de la cuenta del servicio"
}
$disparador = New-ScheduledTaskTrigger -AtStartup
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

foreach ($par in @(@($tareaMotor, $lanzMotor), @($tareaBff, $lanzBff))) {
  $accionTarea = New-ScheduledTaskAction -Execute "$env:ComSpec" -Argument "/c ""$($par[1])""" -WorkingDirectory $dirSvc
  if (Tarea $par[0]) { Unregister-ScheduledTask -TaskName $par[0] -Confirm:$false }
  if ($principal) {
    Register-ScheduledTask -TaskName $par[0] -Action $accionTarea -Trigger $disparador -Settings $ajustes -Principal $principal | Out-Null
  } else {
    Register-ScheduledTask -TaskName $par[0] -Action $accionTarea -Trigger $disparador -Settings $ajustes `
      -User $credencial.UserName -Password $credencial.GetNetworkCredential().Password -RunLevel Limited | Out-Null
  }
  Ok "tarea registrada: $($par[0]) (arranca con Windows, cuenta $Usuario)"
}

Iniciar
EsperarSalud

Write-Host ""
Write-Host "  Listo. Ya no hace falta dejar terminales abiertas."
Write-Host "  Panel para todos:  http://$($env:COMPUTERNAME):$puertoBff"
Write-Host "  Logs:              $logs"
Write-Host "  Gestion:           -Accion estado | reiniciar | detener | iniciar | desinstalar"
Write-Host "  Si otros equipos no entran, abre el puerto (una vez):"
Write-Host "    New-NetFirewallRule -DisplayName ""$etiqueta (BFF $puertoBff)"" -Direction Inbound -Protocol TCP -LocalPort $puertoBff -Action Allow -Profile Domain"
