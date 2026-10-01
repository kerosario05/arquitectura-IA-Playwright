param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('ensure', 'restart')]
  [string] $Action,

  [Parameter(Mandatory = $true)]
  [string] $FrontendRoot
)

$ErrorActionPreference = 'Stop'
$engineRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frontendRoot = [IO.Path]::GetFullPath($FrontendRoot)
$stateDirectory = Join-Path $env:LOCALAPPDATA 'OrchestratorStudio\qa-lab-runtime'
$statePath = Join-Path $stateDirectory 'managed-processes.json'
$backendPort = 3002
$qaLabApiPort = 3001
$vitePort = 5173

foreach ($project in @(@{ Root = $engineRoot; Script = 'server' }, @{ Root = $frontendRoot; Script = 'dev:all' })) {
  $packagePath = Join-Path $project.Root 'package.json'
  if (-not (Test-Path -LiteralPath $packagePath)) { throw "QA Lab runtime package is missing: $($project.Root)" }
  $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
  if (-not $package.scripts.($project.Script)) { throw "Required npm script '$($project.Script)' is missing in $($project.Root)." }
}

function Get-ProjectProcessRoot([int] $listenerPid, [string] $expectedRoot) {
  # Stop only the process that owns the service port. Walking to an ancestor can select
  # the Orchestrator worker (which launched this helper) and kill the active task on restart.
  $listener = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid" -ErrorAction SilentlyContinue
  if (-not $listener -or -not $listener.CommandLine -or
      $listener.CommandLine.IndexOf($expectedRoot, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    return $null
  }
  return [int]$listener.ProcessId
}

function Get-ServiceProcessRoots {
  $backend = @()
  $frontend = @()
  foreach ($port in @($backendPort, $qaLabApiPort, $vitePort)) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      if ($port -eq $backendPort) {
        $processRootPid = Get-ProjectProcessRoot ([int]$listener.OwningProcess) $engineRoot
        if (-not $processRootPid) { throw "Port $port is occupied by a process outside the configured Orchestrator engine root." }
        $backend += $processRootPid
      } else {
        $processRootPid = Get-ProjectProcessRoot ([int]$listener.OwningProcess) $frontendRoot
        if (-not $processRootPid) { throw "Port $port is occupied by a process outside the configured QA Lab frontend root." }
        $frontend += $processRootPid
      }
    }
  }
  return @{ Backend = @($backend | Sort-Object -Unique); Frontend = @($frontend | Sort-Object -Unique) }
}

function Stop-ProjectProcesses([int[]] $processIds, [string] $expectedRoot) {
  foreach ($processId in @($processIds | Sort-Object -Unique)) {
    if ($processId -le 0) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if (-not $process.CommandLine -or $process.CommandLine.IndexOf($expectedRoot, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
      throw "Managed QA Lab process id $processId no longer belongs to its configured project; refusing to stop it."
    }
    & taskkill.exe /PID $processId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not stop managed QA Lab process tree $processId." }
  }
}

function Test-Endpoint([string] $url) {
  $null = & curl.exe --noproxy "*" --fail --silent --max-time 2 --output NUL $url 2>&1
  return $LASTEXITCODE -eq 0
}

function Wait-ForRuntime {
  $delayMilliseconds = 500
  while ($true) {
    if ((Test-Endpoint "http://127.0.0.1:$backendPort/health") -and
        (Test-Endpoint "http://127.0.0.1:$qaLabApiPort/api/health") -and
        (Test-Endpoint "http://localhost:$vitePort/")) { return }
    Start-Sleep -Milliseconds $delayMilliseconds
    $delayMilliseconds = [Math]::Min(5000, $delayMilliseconds * 2)
  }
}

$managed = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
$healthy = (Test-Endpoint "http://127.0.0.1:$backendPort/health") -and
  (Test-Endpoint "http://127.0.0.1:$qaLabApiPort/api/health") -and
  (Test-Endpoint "http://localhost:$vitePort/")

if ($Action -eq 'ensure' -and $healthy) {
  $roots = Get-ServiceProcessRoots
  if ($roots.Backend.Count -and $roots.Frontend.Count) {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    @{ backendPids = $roots.Backend; frontendPids = $roots.Frontend; engineRoot = $engineRoot; frontendRoot = $frontendRoot } |
      ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    Write-Output 'QA_LAB_RUNTIME_READY action=ensure existing=true'
    exit 0
  }
}

if ($Action -eq 'restart' -or $managed -or -not $healthy) {
  $roots = Get-ServiceProcessRoots
  Stop-ProjectProcesses $roots.Backend $engineRoot
  Stop-ProjectProcesses $roots.Frontend $frontendRoot
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$backendCommand = "Set-Location -LiteralPath '$engineRoot'; `$env:PORT='3002'; npm.cmd run server 2>&1 | Tee-Object -FilePath '.\qalab-backend.log' -Append"
$frontendCommand = "Set-Location -LiteralPath '$frontendRoot'; npm.cmd run dev:all 2>&1 | Tee-Object -FilePath '.\qalab-frontend.log' -Append"
$backendProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $backendCommand) -WorkingDirectory $engineRoot -WindowStyle Hidden -PassThru
$frontendProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $frontendCommand) -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru
@{ backendPids = @($backendProcess.Id); frontendPids = @($frontendProcess.Id); engineRoot = $engineRoot; frontendRoot = $frontendRoot } |
  ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

Wait-ForRuntime
$roots = Get-ServiceProcessRoots
@{ backendPids = @($roots.Backend); frontendPids = @($roots.Frontend); engineRoot = $engineRoot; frontendRoot = $frontendRoot } |
  ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Write-Output "QA_LAB_RUNTIME_READY action=$Action existing=false backendPort=$backendPort qaLabBaseUrl=http://localhost:$qaLabApiPort frontendPort=$vitePort"
