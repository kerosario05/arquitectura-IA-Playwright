<#
  QA Lab - prueba del PC de un usuario para el agente local (fase 0/1)

  Comprueba, SIN instalar nada, si este PC podra correr el agente de grabacion:
    1. AppLocker / antivirus dejan ejecutar programas desde %LOCALAPPDATA%\QALab
    2. Windows trae tar.exe (descomprime Chromium)
    3. Hay espacio en disco (~700 MB)
    4. El PC llega al panel de QA Lab por HTTP y por WebSocket
    5. Edge permite la depuracion remota (alternativa a descargar Chromium)

  Uso (PowerShell normal, no hace falta administrador):
    powershell -ExecutionPolicy Bypass -File prueba-pc-usuario.ps1
    powershell -ExecutionPolicy Bypass -File prueba-pc-usuario.ps1 -Servidor http://SRVDEVQACA01:3003

  Deja el resultado en el Escritorio: qalab-prueba-pc.txt (enviarlo a desarrollo).
  Al terminar borra todo lo que creo.
#>
param(
  [string]$Servidor = 'http://SRVDEVQACA01:3003',
  [string]$Informe = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'qalab-prueba-pc.txt')
)

$ErrorActionPreference = 'Continue'
$lineas = New-Object System.Collections.Generic.List[string]
$fallos = 0
function Linea([string]$t) { $lineas.Add($t); Write-Host $t }
function Resultado([string]$nombre, [bool]$ok, [string]$detalle) {
  if (-not $ok) { $script:fallos++ }
  Linea ("  [{0}] {1} - {2}" -f $(if ($ok) { 'OK   ' } else { 'FALLO' }), $nombre, $detalle)
}

Linea "QA Lab - prueba de PC para el agente local"
Linea ("Fecha: {0}   Equipo: {1}   Usuario: {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $env:COMPUTERNAME, $env:USERNAME)
$os = Get-CimInstance Win32_OperatingSystem
Linea ("Windows: {0} (build {1})" -f $os.Caption, $os.BuildNumber)
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Linea ("Sesion con privilegios de administrador: {0}" -f $esAdmin)
Linea ""

# --- 1. Ejecutar desde %LOCALAPPDATA%\QALab ------------------------------------
Linea "1. Ejecucion de programas desde %LOCALAPPDATA%\QALab"
$prueba = Join-Path $env:LOCALAPPDATA 'QALab\prueba-pc'
New-Item -ItemType Directory -Force $prueba | Out-Null
# where.exe renombrado: prueba las reglas por RUTA y por NOMBRE (las que hay hoy).
foreach ($nombre in 'chrome.exe', 'qalab-agente.exe') {
  $destino = Join-Path $prueba $nombre
  try {
    Copy-Item "$env:SystemRoot\System32\where.exe" $destino -Force -ErrorAction Stop
    $p = Start-Process $destino -ArgumentList '/?' -WindowStyle Hidden -PassThru -Wait -ErrorAction Stop
    Resultado "ejecutar $nombre" ($p.ExitCode -eq 0) ("codigo de salida {0}" -f $p.ExitCode)
  } catch {
    Resultado "ejecutar $nombre" $false $_.Exception.Message
  }
}
try {
  $pol = Get-AppLockerPolicy -Effective -ErrorAction Stop
  foreach ($c in $pol.RuleCollections) {
    if ($c.Count -gt 0) { Linea ("     AppLocker {0}: modo={1}, reglas={2}" -f $c.RuleCollectionType, $c.EnforcementMode, $c.Count) }
  }
  $exe = $pol.RuleCollections | Where-Object { $_.RuleCollectionType -eq 'Exe' }
  foreach ($r in $exe) {
    $cond = if ($r.PathConditions) { ($r.PathConditions | ForEach-Object { $_.Path }) -join ';' } elseif ($r.PublisherConditions) { 'editor: ' + (($r.PublisherConditions | ForEach-Object { $_.PublisherName }) -join ';') } else { 'hash' }
    if ($r.Action -eq 'Allow') { Linea ("     permite: {0}" -f $cond) }
  }
} catch {
  Linea "     AppLocker: no se pudo leer la politica (puede no estar configurado)"
}
Linea ""

# --- 2. tar.exe ---------------------------------------------------------------
Linea "2. Herramientas de Windows"
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
Resultado 'tar.exe' (Test-Path $tar) $tar
Linea ""

# --- 3. Espacio ---------------------------------------------------------------
Linea "3. Espacio en disco"
$unidad = (Get-Item $env:LOCALAPPDATA).PSDrive
$libreMb = [math]::Round($unidad.Free / 1MB)
Resultado "espacio libre en $($unidad.Name):" ($libreMb -ge 700) ("{0} MB libres (hacen falta ~700 MB)" -f $libreMb)
Linea ""

# --- 4. Red hacia el panel ------------------------------------------------------
Linea "4. Conexion con el panel de QA Lab ($Servidor)"
$uri = [Uri]$Servidor
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tarea = $tcp.ConnectAsync($uri.Host, $uri.Port)
  $okTcp = $tarea.Wait(5000) -and $tcp.Connected
  $tcp.Close()
  Resultado "puerto $($uri.Port)" $okTcp $(if ($okTcp) { 'abierto' } else { 'no responde en 5 s' })
} catch { Resultado "puerto $($uri.Port)" $false $_.Exception.Message }

try {
  $r = Invoke-WebRequest -Uri $Servidor -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  Resultado 'HTTP' $true ("respuesta {0}" -f $r.StatusCode)
} catch {
  $code = $null
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  Resultado 'HTTP' ($null -ne $code) $(if ($code) { "respuesta $code (el servidor contesta)" } else { $_.Exception.Message })
}

# WebSocket: el agente usa conexiones WebSocket salientes. Un proxy o filtro
# que solo deje pasar HTTP normal las cortaria.
$wsUrl = ($Servidor -replace '^http', 'ws').TrimEnd('/') + '/api/recordings/prueba-pc/live'
try {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $cts = New-Object System.Threading.CancellationTokenSource 10000
  $ws.ConnectAsync([Uri]$wsUrl, $cts.Token).Wait()
  Resultado 'WebSocket' ($ws.State -eq 'Open') ("estado {0}" -f $ws.State)
  try { $ws.CloseAsync('NormalClosure', 'prueba', [Threading.CancellationToken]::None).Wait(2000) | Out-Null } catch {}
} catch {
  $msg = $_.Exception.InnerException
  while ($msg -and $msg.InnerException) { $msg = $msg.InnerException }
  $texto = if ($msg) { $msg.Message } else { $_.Exception.Message }
  # 404 = la conexion WebSocket llego hasta el motor y este contesto que no existe
  # la grabacion 'prueba-pc' (lo esperado). Un bloqueo de red daria tiempo agotado,
  # conexion rechazada o una pagina del proxy (403/407/502).
  if ($texto -match '\(404\)') {
    Resultado 'WebSocket' $true 'la conexion llega al servidor (404 esperado: no existe la grabacion de prueba)'
  } else {
    Resultado 'WebSocket' $false $texto
  }
}
Linea ""

# --- 5. Edge ------------------------------------------------------------------
Linea "5. Microsoft Edge (alternativa a descargar Chromium)"
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) {
  Resultado 'Edge instalado' $false 'no se encontro msedge.exe'
} else {
  Linea ("     Edge {0}" -f (Get-Item $edge).VersionInfo.ProductVersion)
  foreach ($k in 'HKLM:\SOFTWARE\Policies\Microsoft\Edge', 'HKCU:\SOFTWARE\Policies\Microsoft\Edge') {
    $v = (Get-ItemProperty $k -ErrorAction SilentlyContinue).RemoteDebuggingAllowed
    if ($null -ne $v) { Linea ("     politica {0} RemoteDebuggingAllowed={1}" -f $k, $v) }
  }
  $perfil = Join-Path $env:TEMP ('qalab-prueba-edge-' + [guid]::NewGuid())
  $p = Start-Process $edge -ArgumentList '--remote-debugging-port=0', "--user-data-dir=$perfil", '--no-first-run', '--no-startup-window' -PassThru
  $ok = $false
  for ($i = 0; $i -lt 75 -and -not $ok; $i++) { Start-Sleep -Milliseconds 200; $ok = Test-Path "$perfil\DevToolsActivePort" }
  Resultado 'Edge depuracion remota' $ok $(if ($ok) { 'permitida' } else { 'bloqueada o no arranco en 15 s' })
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$perfil*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Remove-Item -Recurse -Force $perfil -ErrorAction SilentlyContinue
}
Linea ""

# --- Antivirus ----------------------------------------------------------------
try {
  $mp = Get-MpComputerStatus -ErrorAction Stop
  Linea ("Defender: proteccion en tiempo real={0}" -f $mp.RealTimeProtectionEnabled)
} catch {
  Linea "Defender: no se pudo consultar (otro antivirus o sin permisos)"
}

# --- Limpieza y resumen -------------------------------------------------------
Remove-Item -Recurse -Force $prueba -ErrorAction SilentlyContinue
$qalab = Join-Path $env:LOCALAPPDATA 'QALab'
if ((Test-Path $qalab) -and -not (Get-ChildItem $qalab -Force)) { Remove-Item $qalab -Force -ErrorAction SilentlyContinue }

Linea ""
if ($fallos -eq 0) { Linea "RESULTADO: este PC puede correr el agente." }
else { Linea ("RESULTADO: {0} comprobacion(es) fallaron; enviar este informe a desarrollo." -f $fallos) }

$lineas | Set-Content -Path $Informe -Encoding UTF8
Write-Host ""
Write-Host "Informe guardado en $Informe"
