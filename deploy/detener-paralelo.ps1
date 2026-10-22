<#
.SYNOPSIS
  Detiene la instancia paralela de QA Lab (la de instalar-paralelo.ps1). No toca la actual.

.DESCRIPTION
  Solo mata los procesos cuya linea de comandos apunta a <Raiz>\app\qa-engine, <Raiz>\app\qa-lab
  o <Raiz>\servicios. La instancia actual (C:\qa o D:\qa) no se ve afectada. Si la instancia
  esta instalada como servicio, mejor: servicios-qa-lab.ps1 -Raiz <Raiz> -Sufijo v2 -Accion detener

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File D:\qa-v2\app\qa-engine\deploy\detener-paralelo.ps1
#>
param([string]$Raiz)

if (-not $Raiz) {
  foreach ($c in @("D:\qa-v2", "C:\qa-v2")) {
    if (Test-Path -LiteralPath "$c\app\qa-engine" -ErrorAction SilentlyContinue) { $Raiz = $c; break }
  }
}
if (-not $Raiz) { Write-Host "  [ERROR] No encontre la instancia paralela en D:\qa-v2 ni C:\qa-v2. Pasala con -Raiz." -ForegroundColor Red; exit 1 }

$raices = @((Join-Path $Raiz "app\qa-engine"), (Join-Path $Raiz "app\qa-lab"), (Join-Path $Raiz "servicios")) | ForEach-Object { $_.TrimEnd('\') }
$procesos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" | Where-Object {
  $cmd = $_.CommandLine; $cmd -and ($raices | Where-Object { $cmd -like "*$_*" })
}
if (-not $procesos) { Write-Host "  [ok] La instancia paralela ($Raiz) no estaba corriendo."; exit 0 }
foreach ($p in $procesos) {
  if (-not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)) { continue } # ya cerro con su proceso padre
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host "  [ok] proceso $($p.ProcessId) detenido" }
  catch { if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) { Write-Host "  [aviso] no pude detener $($p.ProcessId)" -ForegroundColor Yellow } }
}
