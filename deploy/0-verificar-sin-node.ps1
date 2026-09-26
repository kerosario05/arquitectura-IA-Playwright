# ---------------------------------------------------------------------------
#  PASO 0 — Requisitos del servidor, SIN instalar nada
#
#  El verificador del paso 1 corre con Node, y una de las cosas que comprueba es
#  justamente si hay Node. Este script existe para romper ese círculo: PowerShell
#  viene con Windows, así que se puede ejecutar en un servidor recién entregado.
#
#  No modifica nada. Solo mira y reporta.
#
#  Uso (consola de PowerShell, preferible como administrador):
#     powershell -ExecutionPolicy Bypass -File 0-verificar-sin-node.ps1
#
#  Escrito para PowerShell 5.1, que es el que trae Windows Server por defecto.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'SilentlyContinue'
$script:Hallazgos = @()

function Nota {
    param([string]$Nivel, [string]$Etiqueta, [string]$Detalle = '')
    $script:Hallazgos += [pscustomobject]@{ Nivel = $Nivel; Etiqueta = $Etiqueta; Detalle = $Detalle }
    $marca = switch ($Nivel) { 'ok' { ' OK  ' } 'aviso' { 'AVISO' } default { 'FALTA' } }
    if ($Detalle) { Write-Host ("  [{0}] {1} - {2}" -f $marca, $Etiqueta, $Detalle) }
    else          { Write-Host ("  [{0}] {1}" -f $marca, $Etiqueta) }
}

Write-Host ""
Write-Host "============================================================"
Write-Host "  PASO 0 - Requisitos del servidor (sin Node)"
Write-Host "============================================================"
Write-Host ""

# --- Sistema ---------------------------------------------------------------
Write-Host "Sistema"
Write-Host ""

$os = Get-CimInstance Win32_OperatingSystem
Nota 'ok' 'equipo' ("$env:COMPUTERNAME - " + $os.Caption + " " + $os.Version)

$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Nota 'aviso' 'consola sin elevar' 'algunas lecturas de IIS quedaran incompletas; reabre como administrador'
}

$ramGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
if ($ramGb -ge 12)     { Nota 'ok'    'memoria' "$ramGb GB (con 16 GB caben 3 ejecuciones simultaneas)" }
elseif ($ramGb -ge 8)  { Nota 'aviso' 'memoria' "$ramGb GB - habra que bajar MAX_CONCURRENT_EXECUTIONS a 2" }
else                   { Nota 'falta' 'memoria' "$ramGb GB - insuficiente para ejecutar navegadores" }

$cpu = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if ($cpu -ge 4) { Nota 'ok' 'CPU' "$cpu nucleos" } else { Nota 'aviso' 'CPU' "$cpu nucleos" }

# --- Node ------------------------------------------------------------------
Write-Host ""
Write-Host "Node y herramientas"
Write-Host ""

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = (& node --version) 2>$null
    $mayor = 0
    if ($nodeVer -match '^v(\d+)') { $mayor = [int]$Matches[1] }
    if ($mayor -ge 22) {
        Nota 'ok' 'Node.js' "$nodeVer"
    } else {
        Nota 'falta' 'Node.js' "$nodeVer - se necesita 22 o superior: la base de datos usa node:sqlite, que no existe antes"
    }
} else {
    Nota 'falta' 'Node.js' 'no instalado - descargar la version LTS 22 o superior de nodejs.org'
}

foreach ($h in @(@('npm','npm'), @('git','git'))) {
    $c = Get-Command $h[1] -ErrorAction SilentlyContinue
    if ($c) {
        $v = (& $h[1] --version) 2>$null
        Nota 'ok' $h[0] "$v"
    } else {
        $nivel = 'aviso'
        Nota $nivel $h[0] 'no encontrado en PATH'
    }
}

# --- IIS -------------------------------------------------------------------
Write-Host ""
Write-Host "IIS"
Write-Host ""

$w3svc = Get-Service W3SVC -ErrorAction SilentlyContinue
if ($w3svc) {
    Nota 'ok' 'IIS instalado' ("servicio W3SVC " + $w3svc.Status)
} else {
    Nota 'falta' 'IIS instalado' 'falta el rol Servidor web (IIS)'
}

$rutaRewrite = 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite'
if (Test-Path $rutaRewrite) {
    Nota 'ok' 'URL Rewrite' 'instalado'
} else {
    Nota 'falta' 'URL Rewrite' 'descargar de iis.net/downloads/microsoft/url-rewrite'
}

$rutaArr = 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing'
if (Test-Path $rutaArr) {
    Nota 'ok' 'Application Request Routing' 'instalado'
    # El proxy de ARR viene APAGADO por defecto: es el olvido mas comun.
    if ($esAdmin) {
        Import-Module WebAdministration -ErrorAction SilentlyContinue
        $proxy = (Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -ErrorAction SilentlyContinue).Value
        if ("$proxy" -eq 'True') {
            Nota 'ok' 'proxy de ARR habilitado' 'si'
        } else {
            Nota 'falta' 'proxy de ARR habilitado' 'IIS Manager > servidor > Application Request Routing Cache > Server Proxy Settings > Enable proxy'
        }
    } else {
        Nota 'aviso' 'proxy de ARR habilitado' 'no se pudo leer sin elevar'
    }
} else {
    Nota 'falta' 'Application Request Routing' 'descargar de iis.net/downloads/microsoft/application-request-routing'
}

# --- Discos ----------------------------------------------------------------
Write-Host ""
Write-Host "Discos"
Write-Host ""

$unidades = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null }
$resumen = ($unidades | ForEach-Object { "{0}: {1} GB libres" -f $_.Name, [math]::Round($_.Free/1GB,1) }) -join '   '
Nota 'ok' 'unidades' $resumen

$raizEstado = if ($env:QA_STATE_ROOT) { $env:QA_STATE_ROOT } else { 'D:\qa' }
$unidadEstado = $raizEstado.Substring(0,2)
if (Test-Path ($unidadEstado + '\')) {
    $libre = ($unidades | Where-Object { $_.Name -eq $unidadEstado.Substring(0,1) }).Free
    $libreGb = [math]::Round($libre/1GB,1)
    if ($libreGb -ge 20) {
        Nota 'ok' "unidad para el estado ($unidadEstado)" "$libreGb GB libres - se usara $raizEstado"
    } else {
        Nota 'aviso' "unidad para el estado ($unidadEstado)" "solo $libreGb GB libres; los navegadores ocupan ~200 MB y las evidencias crecen"
    }
} else {
    Nota 'aviso' "unidad para el estado ($unidadEstado)" "no existe - habra que usar otra ruta (variable QA_STATE_ROOT)"
}

# --- Red -------------------------------------------------------------------
Write-Host ""
Write-Host "Red"
Write-Host ""

foreach ($p in 80, 443, 3001, 3002) {
    $ocupado = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($p -eq 80 -or $p -eq 443) {
        if ($ocupado) { Nota 'ok' "puerto $p" 'ocupado (IIS escuchando)' }
        else          { Nota 'aviso' "puerto $p" 'libre - IIS aun no publica nada' }
    } else {
        if ($ocupado) { Nota 'aviso' "puerto $p" 'ocupado - lo necesitan el BFF (3001) y el motor (3002)' }
        else          { Nota 'ok' "puerto $p" 'libre' }
    }
}

# Internet: decide si se puede instalar alla o hay que llevar todo en el paquete.
#
# Cualquier respuesta HTTP cuenta como alcanzable, incluido un 403. El CDN de
# Playwright rechaza la peticion a su raiz, pero para responder ya resolvio DNS,
# negocio TLS y contesto: eso ES conectividad. Solo un fallo de conexion, de
# nombre o un timeout significan que no hay ruta.
foreach ($destino in @(
    @('registro npm','https://registry.npmjs.org'),
    @('descarga de navegadores','https://playwright.download.prss.microsoft.com')
)) {
    $alcanzable = $false
    $detalle = ''
    try {
        $r = Invoke-WebRequest -Uri $destino[1] -UseBasicParsing -TimeoutSec 10 -Method Head
        $alcanzable = $true
        $detalle = "alcanzable (HTTP " + $r.StatusCode + ")"
    } catch {
        $resp = $_.Exception.Response
        if ($resp -ne $null) {
            $alcanzable = $true
            $codigo = [int]$resp.StatusCode
            $detalle = "alcanzable (el servidor respondio HTTP $codigo)"
        } else {
            $detalle = 'sin salida - habra que llevar node_modules y los navegadores en el paquete'
        }
    }
    if ($alcanzable) { Nota 'ok' $destino[0] $detalle } else { Nota 'aviso' $destino[0] $detalle }
}

# --- Veredicto -------------------------------------------------------------
Write-Host ""
Write-Host "============================================================"
Write-Host "  RESULTADO"
Write-Host "============================================================"
Write-Host ""

$faltan = @($script:Hallazgos | Where-Object { $_.Nivel -eq 'falta' })
$avisos = @($script:Hallazgos | Where-Object { $_.Nivel -eq 'aviso' })

if ($faltan.Count -eq 0) {
    Write-Host "  Requisitos cubiertos. Copia el ZIP del despliegue y sigue con el paso 2."
} else {
    Write-Host ("  Faltan {0} requisito(s):" -f $faltan.Count)
    Write-Host ""
    foreach ($f in $faltan) { Write-Host ("    - " + $f.Etiqueta + ": " + $f.Detalle) }
}

if ($avisos.Count -gt 0) {
    Write-Host ""
    Write-Host ("  {0} punto(s) a revisar (no bloquean):" -f $avisos.Count)
    Write-Host ""
    foreach ($a in $avisos) { Write-Host ("    - " + $a.Etiqueta + ": " + $a.Detalle) }
}

Write-Host ""
Write-Host "  Copia TODO este texto y pasalo a quien prepara el despliegue."
Write-Host ""
