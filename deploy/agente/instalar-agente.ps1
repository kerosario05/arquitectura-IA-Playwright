<#
  QA Lab - instalador del agente local de grabacion (para TI: GPO de inicio de sesion o Intune)

  Instala o actualiza el agente en la sesion del usuario, sin administrador y sin ventanas:
    - descarga qalab-agente.zip del servidor de QA Lab (solo si cambio la version)
    - lo deja en %LOCALAPPDATA%\QALab\agente\app
    - lo registra para arrancar al iniciar sesion (acceso directo en la carpeta Inicio)
    - lo arranca ya, en segundo plano

  Chromium NO se descarga aqui: lo instala el propio panel la primera vez que el usuario entra.

  Debe correr COMO EL USUARIO (no como SYSTEM): el agente abre Chromium en su escritorio.
    GPO: Configuracion de usuario > Directivas > Configuracion de Windows > Scripts > Inicio de sesion
         Programa:   powershell.exe
         Parametros: -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \\ruta\instalar-agente.ps1 -Servidor http://SRVDEVQACA01:3003
    Intune: script de PowerShell con "Ejecutar este script con las credenciales del usuario que inicio sesion" = Si

  El script mismo se puede bajar del servidor:  http://SRVDEVQACA01:3003/descargas/instalar-agente.ps1

  Parametros:
    -Servidor     URL del panel de QA Lab (la misma que abre el usuario en el navegador)
    -ClaveAgente  clave compartida, solo si el servidor tiene LOCAL_AGENT_KEY configurada
    -Desinstalar  detiene el agente y borra todo (incluido Chromium)
    -CarpetaInicio  donde va el acceso directo de inicio de sesion (por defecto, la carpeta Inicio del usuario)

  Registro: %LOCALAPPDATA%\QALab\agente\logs\instalador.log
  Codigo de salida: 0 instalado o al dia; 1 error (el inicio de sesion no se bloquea igualmente).
#>
param(
  [string]$Servidor = 'http://SRVDEVQACA01:3003',
  [string]$ClaveAgente = '',
  [switch]$Desinstalar,
  [string]$CarpetaInicio = [Environment]::GetFolderPath('Startup')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest es muy lento con la barra de progreso
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$raiz = Join-Path $env:LOCALAPPDATA 'QALab\agente'
$app = Join-Path $raiz 'app'
$logs = Join-Path $raiz 'logs'
$exe = Join-Path $app 'qalab-agente.exe'
$bundle = Join-Path $app 'qalab-agente.cjs'
$acceso = Join-Path $CarpetaInicio 'QA Lab agente.lnk'
$Servidor = $Servidor.TrimEnd('/')

New-Item -ItemType Directory -Force -Path $logs | Out-Null
function Log([string]$t) {
  $linea = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $t
  try { Add-Content -Path (Join-Path $logs 'instalador.log') -Value $linea -Encoding UTF8 } catch { }
  Write-Host $linea
}

function Detener-Agente {
  $procesos = @(Get-CimInstance Win32_Process -Filter "Name='qalab-agente.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $exe })
  foreach ($p in $procesos) {
    Log ("deteniendo agente (PID {0})" -f $p.ProcessId)
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  # Chromium abierto por el agente desde su carpeta: si siguiera vivo bloquearia los archivos.
  $navegadores = Join-Path $raiz 'navegadores'
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($navegadores, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($procesos.Count) { Start-Sleep -Milliseconds 800 }
}

function Agente-EnMarcha {
  return [bool](@(Get-CimInstance Win32_Process -Filter "Name='qalab-agente.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $exe }).Count)
}

function Crear-AccesoInicio {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($acceso)
  $lnk.TargetPath = $exe
  $lnk.Arguments = ('"{0}" --segundo-plano' -f $bundle)
  $lnk.WorkingDirectory = $app
  $lnk.WindowStyle = 7   # minimizado: el agente se relanza sin consola y esta ventana se cierra sola
  $lnk.Description = 'Agente de grabacion de QA Lab'
  $lnk.Save()
}

function Escribir-Configuracion {
  $archivo = Join-Path $raiz 'agente.json'
  $config = [ordered]@{}
  if (Test-Path $archivo) {
    try {
      $previa = Get-Content $archivo -Raw | ConvertFrom-Json
      foreach ($p in $previa.PSObject.Properties) { $config[$p.Name] = $p.Value }   # conserva agentId
    } catch { Log "agente.json ilegible: se rehace (el equipo tendra un identificador nuevo)" }
  }
  $config['serverUrl'] = $Servidor
  if ($ClaveAgente) { $config['agentKey'] = $ClaveAgente }
  # UTF-8 sin BOM (el agente acepta ambos, pero asi lo leen igual otras herramientas).
  [IO.File]::WriteAllText($archivo, ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}

try {
  if ($Desinstalar) {
    Log "desinstalando el agente de QA Lab"
    Detener-Agente
    Remove-Item -Force -ErrorAction SilentlyContinue $acceso
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $app, (Join-Path $raiz 'navegadores'), (Join-Path $raiz 'agente.json')
    Log "desinstalado (se conservan los registros en $logs)"
    exit 0
  }

  Log ("instalador del agente: servidor {0}, equipo {1}, usuario {2}" -f $Servidor, $env:COMPUTERNAME, $env:USERNAME)
  $manifiesto = Invoke-RestMethod -UseBasicParsing -TimeoutSec 120 -Uri "$Servidor/descargas/qalab-agente.json"
  $instalada = if (Test-Path (Join-Path $app 'version.txt')) { (Get-Content (Join-Path $app 'version.txt') -Raw).Trim() } else { '' }
  $hashLocal = if (Test-Path (Join-Path $app 'paquete.sha256')) { (Get-Content (Join-Path $app 'paquete.sha256') -Raw).Trim() } else { '' }

  if ($instalada -eq $manifiesto.version -and $hashLocal -eq $manifiesto.sha256 -and (Test-Path $exe) -and (Test-Path $bundle)) {
    Log ("agente {0} ya instalado" -f $instalada)
  } else {
    Log ("instalando agente {0} (antes: {1}), {2:N0} MB" -f $manifiesto.version, $(if ($instalada) { $instalada } else { 'ninguno' }), ($manifiesto.sizeBytes / 1MB))
    $tmp = Join-Path $env:TEMP ("qalab-agente-{0}.zip" -f [guid]::NewGuid().ToString('N'))
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 900 -Uri "$Servidor/descargas/qalab-agente.zip" -OutFile $tmp
      $hash = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
      if ($hash -ne $manifiesto.sha256.ToLower()) { throw "el zip descargado no coincide con el sha256 del servidor ($hash)" }
      Detener-Agente
      $nueva = "$app.nueva"
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $nueva
      Expand-Archive -Path $tmp -DestinationPath $nueva -Force
      if (-not (Test-Path (Join-Path $nueva 'qalab-agente.exe'))) { throw "el zip no trae qalab-agente.exe" }
      [IO.File]::WriteAllText((Join-Path $nueva 'paquete.sha256'), $hash)
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $app
      Rename-Item -Path $nueva -NewName 'app'
    } finally {
      Remove-Item -Force -ErrorAction SilentlyContinue $tmp
    }
    Log ("agente {0} instalado en {1}" -f $manifiesto.version, $app)
  }

  Escribir-Configuracion
  Crear-AccesoInicio
  if (Agente-EnMarcha) {
    Log "el agente ya esta en marcha"
  } else {
    Start-Process -FilePath $exe -ArgumentList ('"{0}"' -f $bundle), '--segundo-plano' -WorkingDirectory $app -WindowStyle Hidden
    Log "agente arrancado en segundo plano"
  }
  exit 0
} catch {
  Log ("ERROR: {0}" -f $_.Exception.Message)
  exit 1
}
