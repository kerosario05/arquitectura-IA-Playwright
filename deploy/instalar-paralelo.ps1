<#
.SYNOPSIS
  Instala una SEGUNDA instancia de QA Lab junto a la actual, en otros puertos, sin tocarla.

.DESCRIPTION
  La instancia actual (C:\qa o D:\qa, puertos 3001/3002) no se detiene, no se modifica y no
  comparte nada que pueda romperse: carpeta, base de datos, logs y puertos son propios.

  Que hace, en orden:
    1. Localiza la instalacion actual (de ahi copia los .env y la base de datos).
    2. Detiene la instancia paralela si ya corria (tareas de servicio incluidas).
    3. Copia el codigo del paquete. node_modules: los del paquete si vienen (paquete armado
       con --con-dependencias, la opcion recomendada); si no, los de la instalacion actual.
       Nunca ejecuta npm install (el servidor no tiene salida a internet).
    4. Crea los .env de la nueva instancia a partir de los actuales, cambiando puertos,
       base de datos, evidencias y URL del motor. Si ya existen, solo reaplica esos valores.
    5. Base de datos: copia la actual (usuarios, roles, proyectos) la primera vez, o una base
       nueva vacia con -BaseLimpia. Nunca toca la base de la instancia actual.
    6. Opcional (-CopiarGrabaciones): copia grabaciones y casos (automations\) actuales.
    7. Aplica el esquema (db-init, crea las tablas que falten) y arranca; espera /health.

  Volver a ejecutarlo con un paquete nuevo actualiza el codigo de la instancia paralela sin
  perder su .env, su base ni sus grabaciones.

.PARAMETER Origen
  Carpeta donde descomprimiste el ZIP. Debe contener qa-engine\ y qa-lab\.
.PARAMETER Raiz
  Carpeta de la nueva instancia. Por defecto D:\qa-v2 (o C:\qa-v2 si no hay unidad D:).
.PARAMETER RaizActual
  Instalacion actual. Por defecto se detecta en C:\qa o D:\qa.
.PARAMETER PuertoBff
  Puerto que veran los usuarios (panel + API). Por defecto el que ya tenga la instancia en su
  .env (PORT); si es una instalacion nueva, 3101. Solo cambia si se pasa explicitamente.
.PARAMETER PuertoMotor
  Puerto del motor, solo local (127.0.0.1). Por defecto el de su .env; si es nueva, 3102.
.PARAMETER CopiarGrabaciones
  Copia automations\ (grabaciones, casos, specs) de la instalacion actual.
.PARAMETER BaseLimpia
  Empieza con una base nueva en vez de copiar la actual (habra que crear usuarios y proyectos).
.PARAMETER EsperarMinutos
  Si la instancia tiene ejecuciones en curso, cuanto esperar a que terminen (por defecto 15).
.PARAMETER Forzar
  Despliega aunque haya ejecuciones en curso: quedan como "Interrumpida" y se pueden re-ejecutar.
  Con o sin -Forzar, al detener se respalda la base y el historial en <Raiz>\backups.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\temp\qa-engine\deploy\instalar-paralelo.ps1 -Origen C:\temp -CopiarGrabaciones
#>
param(
  [Parameter(Mandatory = $true)][string]$Origen,
  [string]$Raiz,
  [string]$RaizActual,
  [int]$PuertoBff = 0,
  [int]$PuertoMotor = 0,
  [switch]$CopiarGrabaciones,
  [switch]$BaseLimpia,
  [int]$EsperarMinutos = 15,
  [switch]$Forzar
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "proteger-datos.ps1")

function Titulo($t) { Write-Host ""; Write-Host "============================================================"; Write-Host "  $t"; Write-Host "============================================================"; Write-Host "" }
function Paso($n, $t) { Write-Host "[$n] $t" }
function Ok($t)    { Write-Host "  [ok] $t" }
function Aviso($t) { Write-Host "  [aviso] $t" -ForegroundColor Yellow }
function Muere($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red; exit 1 }

# Escribe CLAVE=valor en un .env: reemplaza la linea si existe, la agrega si no.
function Set-EnvValue($archivo, $clave, $valor) {
  $lineas = @()
  if (Test-Path -LiteralPath $archivo) { $lineas = @(Get-Content -LiteralPath $archivo) }
  $patron = "^\s*" + [regex]::Escape($clave) + "\s*="
  $hecho = $false
  $nuevas = foreach ($l in $lineas) {
    if (-not $hecho -and $l -match $patron) { $hecho = $true; "$clave=$valor" } else { $l }
  }
  if (-not $hecho) { $nuevas = @($nuevas) + "$clave=$valor" }
  # Sin BOM: con BOM, la primera variable del .env se leeria con un caracter invisible delante.
  [System.IO.File]::WriteAllLines($archivo, [string[]]@($nuevas), (New-Object System.Text.UTF8Encoding($false)))
}

function Get-EnvValue($archivo, $clave) {
  if (-not (Test-Path -LiteralPath $archivo)) { return $null }
  $patron = "^\s*" + [regex]::Escape($clave) + "\s*=\s*(.*)$"
  foreach ($l in Get-Content -LiteralPath $archivo) {
    if ($l -match $patron) { return $Matches[1].Trim().Trim('"') }
  }
  return $null
}

function PuertoOcupado($p) {
  return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

Titulo "Instancia paralela de QA Lab"

# --- 1. Localizar ------------------------------------------------------------------------------
Paso 1 "Localizando instalaciones"

$srcEngine = Join-Path $Origen "qa-engine"
$srcLab    = Join-Path $Origen "qa-lab"
if (-not (Test-Path -LiteralPath $srcEngine) -or -not (Test-Path -LiteralPath $srcLab)) {
  Muere "En $Origen no estan qa-engine\ y qa-lab\. Descomprime ahi el ZIP del paquete."
}

if (-not $RaizActual) {
  foreach ($c in @("C:\qa", "D:\qa")) {
    if (Test-Path -LiteralPath "$c\app\qa-engine" -ErrorAction SilentlyContinue) { $RaizActual = $c; break }
  }
}
if (-not $RaizActual) { Muere "No encontre la instalacion actual en C:\qa ni D:\qa. Pasala con -RaizActual." }
$actEngine = Join-Path $RaizActual "app\qa-engine"
$actLab    = Join-Path $RaizActual "app\qa-lab"

if (-not $Raiz) {
  # Primero una instancia paralela que ya exista; si no hay, D:\qa-v2 (o C:\qa-v2 sin unidad D:).
  foreach ($c in @("C:\qa-v2", "D:\qa-v2")) {
    if (Test-Path -LiteralPath "$c\app\qa-engine" -ErrorAction SilentlyContinue) { $Raiz = $c; break }
  }
}
if (-not $Raiz) {
  if (Test-Path -LiteralPath "D:\" -ErrorAction SilentlyContinue) { $Raiz = "D:\qa-v2" } else { $Raiz = "C:\qa-v2" }
}
# Puertos: los que la instancia ya usa (su .env) salvo que se pasen; asi una actualizacion nunca
# devuelve el panel a 3101 por olvido (en SRVDEVQACA01 la red solo deja pasar el 3003).
if ($PuertoBff -eq 0) {
  $p = Get-EnvValue (Join-Path $Raiz "app\qa-lab\.env") "PORT"
  $PuertoBff = if ($p) { [int]$p } else { 3101 }
}
if ($PuertoMotor -eq 0) {
  $p = Get-EnvValue (Join-Path $Raiz "app\qa-engine\.env") "PORT"
  $PuertoMotor = if ($p) { [int]$p } else { 3102 }
}
Ok "puertos: panel $PuertoBff, motor $PuertoMotor"
if ($Raiz.TrimEnd('\') -ieq $RaizActual.TrimEnd('\')) { Muere "La nueva instancia no puede ir en la misma carpeta que la actual ($RaizActual)." }
if ($PuertoBff -in 3001, 3002 -or $PuertoMotor -in 3001, 3002) { Muere "Los puertos 3001/3002 son de la instancia actual. Usa otros." }
if ($PuertoBff -eq $PuertoMotor) { Muere "PuertoBff y PuertoMotor deben ser distintos." }

$appEngine = Join-Path $Raiz "app\qa-engine"
$appLab    = Join-Path $Raiz "app\qa-lab"
$logs      = Join-Path $Raiz "logs"
foreach ($d in @($appEngine, $appLab, $logs, (Join-Path $Raiz "data"), (Join-Path $Raiz "backups"), (Join-Path $Raiz "evidence"))) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
Ok "actual : $RaizActual (no se toca)"
Ok "nueva  : $Raiz"

# --- 2. Detener la instancia paralela si ya corria ---------------------------------------------
Paso 2 "Revisando ejecuciones en curso"
Esperar-EjecucionesActivas -AppEngine $appEngine -Minutos $EsperarMinutos -Forzar:$Forzar

Paso 2 "Deteniendo la instancia paralela anterior (si existe)"
# Si ya se instalo como servicio (servicios-qa-lab.ps1), sus tareas se detienen y se relanzan
# como tareas; arrancarla a mano duplicaria procesos en el mismo puerto.
$dirSvc = Join-Path $Raiz "servicios"
$tareasSvc = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.Actions | Where-Object { $_.Arguments -like "*$dirSvc*" } })
foreach ($t in $tareasSvc) { Stop-ScheduledTask -TaskName $t.TaskName -ErrorAction SilentlyContinue; Ok "tarea detenida: $($t.TaskName)" }
# Servicios de Windows de ESTA instancia (p. ej. WinSW en <Raiz>\winsw): se detienen aqui y se
# vuelven a arrancar al final, en vez de lanzar procesos sueltos.
$raizSvc = $Raiz.TrimEnd('\') + '\'
$serviciosWin = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -and $_.PathName.Trim('"') -like "$raizSvc*" })
foreach ($sv in $serviciosWin) {
  if ($sv.State -ne "Stopped") { Stop-Service -Name $sv.Name -Force -ErrorAction SilentlyContinue; Ok "servicio detenido: $($sv.Name)" }
  else { Ok "servicio ya detenido: $($sv.Name)" }
}
$raices = @($appEngine, $appLab, $dirSvc) | ForEach-Object { $_.TrimEnd('\') }
$procesos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" | Where-Object {
  $cmd = $_.CommandLine; $cmd -and ($raices | Where-Object { $cmd -like "*$_*" })
}
foreach ($p in $procesos) {
  if (-not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)) { continue } # ya cerro con su proceso padre
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Ok "proceso $($p.ProcessId) detenido" }
  catch { if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) { Aviso "no pude detener $($p.ProcessId)" } }
}
Start-Sleep -Seconds 2
foreach ($p in @($PuertoBff, $PuertoMotor)) {
  if (PuertoOcupado $p) { Muere "El puerto $p esta ocupado por otro proceso. Elige otro con -PuertoBff / -PuertoMotor." }
}
Ok "puertos $PuertoBff y $PuertoMotor libres"

Paso 2 "Respaldando base e historial de ejecuciones"
Respaldar-Datos -AppEngine $appEngine -Raiz $Raiz

# --- 3. Codigo y dependencias ------------------------------------------------------------------
Paso 3 "Copiando codigo y node_modules"
$comunes = @("/E", "/XD", "node_modules", "/XF", ".env", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1")
foreach ($par in @(@($srcEngine, $appEngine, "motor"), @($srcLab, $appLab, "qa-lab"))) {
  & robocopy $par[0] $par[1] @comunes | Out-Null
  if ($LASTEXITCODE -ge 8) { Muere "robocopy devolvio $LASTEXITCODE copiando $($par[2])" }
  Ok "$($par[2]): codigo copiado"
}
foreach ($par in @(@($srcEngine, $actEngine, $appEngine, "motor"), @($srcLab, $actLab, $appLab, "qa-lab"))) {
  $delPaquete = Join-Path $par[0] "node_modules"
  $delActual  = Join-Path $par[1] "node_modules"
  $destino    = Join-Path $par[2] "node_modules"
  if (Test-Path -LiteralPath (Join-Path $delPaquete "tsx\dist\cli.mjs")) {
    # /MIR: las dependencias quedan EXACTAMENTE como las trae el paquete, sin restos de versiones viejas.
    & robocopy $delPaquete $destino /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Muere "robocopy devolvio $LASTEXITCODE copiando node_modules de $($par[3])" }
    Ok "$($par[3]): node_modules del paquete"
  } elseif (Test-Path -LiteralPath (Join-Path $destino "tsx\dist\cli.mjs")) {
    Ok "$($par[3]): node_modules ya presente, se conserva"
  } elseif (Test-Path -LiteralPath $delActual) {
    & robocopy $delActual $destino /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Muere "robocopy devolvio $LASTEXITCODE copiando node_modules de $($par[3])" }
    Aviso "$($par[3]): el paquete no trae node_modules; copiados de la instalacion actual"
  } else {
    Muere "No hay node_modules para $($par[3]) ni en el paquete ni en la instalacion actual."
  }
}

# --- 4. .env de la nueva instancia -------------------------------------------------------------
Paso 4 "Configurando .env (puertos, base, evidencias, URL del motor)"
$envEngine = Join-Path $appEngine ".env"
$envLab    = Join-Path $appLab ".env"
if (-not (Test-Path -LiteralPath $envEngine)) { Copy-Item -LiteralPath (Join-Path $actEngine ".env") -Destination $envEngine; Ok "motor: .env copiado del actual" }
if (-not (Test-Path -LiteralPath $envLab))    { Copy-Item -LiteralPath (Join-Path $actLab ".env") -Destination $envLab; Ok "qa-lab: .env copiado del actual" }

$dbNueva = Join-Path $Raiz "data\qa-lab.db"
Set-EnvValue $envEngine "PORT" $PuertoMotor
Set-EnvValue $envEngine "API_PORT" $PuertoMotor
Set-EnvValue $envEngine "SQLITE_DB_PATH" $dbNueva
Set-EnvValue $envEngine "BACKUP_DIR" (Join-Path $Raiz "backups")
Set-EnvValue $envEngine "EVIDENCE_DIR" (Join-Path $Raiz "evidence")
$motorUrl = "http://127.0.0.1:$PuertoMotor"
Set-EnvValue $envLab "PORT" $PuertoBff
Set-EnvValue $envLab "SCENARIO_PREVIEW_BASE_URL" $motorUrl
Set-EnvValue $envLab "RUN_PROVIDER_BASE_URL" $motorUrl
Set-EnvValue $envLab "NEWMAN_API_URL" $motorUrl
Ok "motor  -> 127.0.0.1:$PuertoMotor, base $dbNueva"
Ok "qa-lab -> :$PuertoBff, motor en $motorUrl"

# --- 5. Base de datos --------------------------------------------------------------------------
Paso 5 "Base de datos"
if (Test-Path -LiteralPath $dbNueva) {
  Ok "ya existe ${dbNueva}, se conserva"
} elseif ($BaseLimpia) {
  Ok "base nueva vacia (-BaseLimpia): db-init la creara en el paso 7"
} else {
  $dbActual = Get-EnvValue (Join-Path $actEngine ".env") "SQLITE_DB_PATH"
  if (-not $dbActual) { $dbActual = "data\qa-lab.db" }
  if (-not [System.IO.Path]::IsPathRooted($dbActual)) { $dbActual = Join-Path $actEngine $dbActual }
  if (-not (Test-Path -LiteralPath $dbActual)) {
    Aviso "No encontre la base actual ($dbActual): la nueva instancia empezara con una base vacia."
  } else {
    # VACUUM INTO hace una copia consistente aunque el motor actual este escribiendo.
    # Solo comillas simples en el JS: PowerShell 5.1 rompe las dobles al pasarlas a node.
    $js = "const {DatabaseSync}=require('node:sqlite');const q=String.fromCharCode(39);const db=new DatabaseSync(process.argv[1]);db.exec('VACUUM INTO '+q+process.argv[2].split(q).join(q+q)+q);db.close();"
    Push-Location $appEngine
    try { & node -e $js $dbActual $dbNueva } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dbNueva)) {
      Aviso "VACUUM INTO fallo; copio el archivo directamente."
      Copy-Item -LiteralPath $dbActual -Destination $dbNueva
    }
    Ok "base copiada: $dbActual -> $dbNueva"
  }
}

# --- 6. Grabaciones (opcional) -----------------------------------------------------------------
Paso 6 "Grabaciones y casos"
if ($CopiarGrabaciones) {
  $autoAct = Join-Path $actEngine "automations"
  if (Test-Path -LiteralPath $autoAct) {
    & robocopy $autoAct (Join-Path $appEngine "automations") /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Muere "robocopy devolvio $LASTEXITCODE copiando automations" }
    Ok "automations copiado (sin pisar lo que ya tenga la instancia paralela)"
  } else { Aviso "La instalacion actual no tiene automations\" }
} else {
  Ok "omitido (usa -CopiarGrabaciones para traer las grabaciones actuales)"
}

# --- 7. Esquema, arranque y verificacion -------------------------------------------------------
Paso 7 "Aplicando esquema y arrancando"
Push-Location $appEngine
try {
  # Sin npx: con la salida a internet filtrada intentaria descargar tsx.
  & node node_modules\tsx\dist\cli.mjs src/cli/db-init.ts
  if ($LASTEXITCODE -ne 0) { Muere "db-init fallo con codigo $LASTEXITCODE" }
  Ok "esquema aplicado en $dbNueva (tablas que faltaban creadas)"
} finally { Pop-Location }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
function Lanzar($etiqueta, $carpeta, $entrada, $log) {
  Start-Process -FilePath "$env:ComSpec" -ArgumentList "/c", "cd /d ""$carpeta"" && node node_modules\tsx\dist\cli.mjs $entrada > ""$log"" 2>&1" -WindowStyle Hidden
  Ok "$etiqueta lanzado (log: $log)"
}
if ($serviciosWin.Count -gt 0) {
  # El motor primero: el BFF depende de el.
  foreach ($sv in ($serviciosWin | Sort-Object { if ($_.Name -like "*motor*") { 0 } else { 1 } })) {
    Start-Service -Name $sv.Name; Ok "servicio arrancado: $($sv.Name)"
  }
} elseif ($tareasSvc.Count -gt 0) {
  foreach ($t in $tareasSvc) { Start-ScheduledTask -TaskName $t.TaskName; Ok "tarea lanzada: $($t.TaskName)" }
} else {
  Lanzar "motor" $appEngine "src/server/server.ts" (Join-Path $logs "motor-$stamp.log")
  Lanzar "BFF"   $appLab    "server/index.ts"      (Join-Path $logs "bff-$stamp.log")
}

# El motor tarda mas que el BFF en arrancar: se esperan los dos.
$listo = $false
$motorOk = $false
foreach ($i in 1..90) {
  Start-Sleep -Seconds 2
  if (-not $listo) {
    try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$PuertoBff/api/health" -UseBasicParsing -TimeoutSec 4; $listo = ($r.StatusCode -eq 200) } catch { }
  }
  if (-not $motorOk) {
    try { $m = Invoke-WebRequest -Uri "http://127.0.0.1:$PuertoMotor/health" -UseBasicParsing -TimeoutSec 4; $motorOk = ($m.StatusCode -eq 200) } catch { }
  }
  if ($listo -and $motorOk) { break }
}

if ($listo -and $motorOk) {
  Titulo "Instancia paralela lista"
  Write-Host "  Panel:  http://$($env:COMPUTERNAME):$PuertoBff"
  Write-Host "  Motor:  http://127.0.0.1:$PuertoMotor (solo local)"
  Write-Host "  Logs:   $logs"
  Write-Host ""
  if ($serviciosWin.Count -gt 0) {
    Write-Host "  Corre como servicio de Windows: $(($serviciosWin | ForEach-Object { $_.Name }) -join ', ')"
    Write-Host "  Gestion: Get-Service / Restart-Service / Stop-Service / Start-Service"
  } elseif ($tareasSvc.Count -eq 0) {
    Write-Host "  Para dejarla como servicio (arranca con Windows, sin terminales):"
    Write-Host "    powershell -ExecutionPolicy Bypass -File $appEngine\deploy\servicios-qa-lab.ps1 -Raiz $Raiz -Sufijo v2"
  }
  Write-Host ""
  Write-Host "  Para que otros equipos entren, abre el puerto (una vez, como administrador):"
  Write-Host "    New-NetFirewallRule -DisplayName ""QA Lab v2 (BFF $PuertoBff)"" -Direction Inbound -Protocol TCP -LocalPort $PuertoBff -Action Allow -Profile Domain"
  Write-Host ""
  Write-Host "  La instancia actual ($RaizActual, 3001/3002) sigue igual."
} else {
  Aviso "No respondio a tiempo (BFF: $listo, motor: $motorOk)."
  Write-Host "  Revisa los logs en $logs. El motor puede tardar si recupera muchos jobs."
}
