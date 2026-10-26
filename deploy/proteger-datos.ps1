<#
  QA Lab - proteccion de ejecuciones y datos durante un despliegue.

  Lo cargan (dot-source) 4-actualizar.ps1 e instalar-paralelo.ps1; usa sus funciones
  Ok / Aviso / Muere. No se ejecuta solo.

    Esperar-EjecucionesActivas  antes de detener: si el motor corre ejecuciones, espera a que
                                terminen (o sigue con -Forzar: quedan "Interrumpidas" y se
                                pueden re-ejecutar desde el panel).
    Respaldar-Datos             con los servicios ya detenidos: copia la base SQLite y el
                                historial de ejecuciones a <Raiz>\backups\despliegue-<fecha>.

  Las ejecuciones en curso se leen del disco (.artifacts\qa-lab-run-history), donde el motor
  guarda cada ejecucion desde que empieza: no hace falta usuario ni clave de la API.
#>

function Get-ValorEnv([string]$Archivo, [string]$Clave) {
  if (-not (Test-Path -LiteralPath $Archivo)) { return $null }
  foreach ($linea in Get-Content -LiteralPath $Archivo -Encoding UTF8) {
    if ($linea -match "^\s*$([regex]::Escape($Clave))\s*=\s*(.*?)\s*$") { return $Matches[1].Trim('"', "'") }
  }
  return $null
}

function Get-RutasPersistentes([string]$Proyecto) {
  # Excluir solo las carpetas de primer nivel del proyecto. No usar nombres sueltos
  # con robocopy: excluir "data" o "evidence" por nombre también omitiría src/data
  # y src/evidence, que son código fuente.
  return @("data", "backups", "logs", ".artifacts", "automations", "evidence", "ms-playwright") |
    ForEach-Object { Join-Path $Proyecto $_ }
}

function Test-MotorVivo([string]$AppEngine) {
  $puerto = Get-ValorEnv (Join-Path $AppEngine ".env") "PORT"
  if (-not $puerto) { $puerto = Get-ValorEnv (Join-Path $AppEngine ".env") "API_PORT" }
  if (-not $puerto) { $puerto = "3001" }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$puerto/health" -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-EjecucionesActivas([string]$AppEngine) {
  $dir = Join-Path $AppEngine ".artifacts\qa-lab-run-history"
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  return @(Get-ChildItem -LiteralPath $dir -Filter "*.json" -File | ForEach-Object {
    try { $j = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
    # Las hijas (subconjuntos de un re-lanzamiento) se cuentan con su ejecucion padre.
    if ($j.status -in @("queued", "running") -and -not $j.parentJobId) { $j }
  })
}

function Describir-Ejecucion($j) {
  $p = $j.params
  $titulo = @($p.huTitle, $p.scenarioTitle, $p.title, $p.huKey, $p.jiraKey) | Where-Object { $_ } | Select-Object -First 1
  $proyecto = @($p.appSlug, $p.projectSlug, $p.targetAppSlug) | Where-Object { $_ } | Select-Object -First 1
  return ("{0} | {1} | {2} | desde {3}" -f $j.id, $proyecto, $titulo, $j.startedAt)
}

function Esperar-EjecucionesActivas([string]$AppEngine, [int]$Minutos = 15, [switch]$Forzar) {
  if (-not (Test-MotorVivo $AppEngine)) {
    Aviso "el motor no responde: no hay ejecuciones vivas que esperar (las que quedaron a medias se marcan como interrumpidas al arrancar)"
    return
  }
  $limite = (Get-Date).AddMinutes($Minutos)
  $listadas = $false
  while ($true) {
    $activas = @(Get-EjecucionesActivas $AppEngine)
    if ($activas.Count -eq 0) { Ok "no hay ejecuciones en curso"; return }
    if (-not $listadas) {
      Aviso ("{0} ejecucion(es) en curso:" -f $activas.Count)
      foreach ($j in $activas) { Write-Host ("      " + (Describir-Ejecucion $j)) }
      $listadas = $true
    }
    if ($Forzar) {
      Aviso "-Forzar: se continua. Esas ejecuciones quedaran como 'Interrumpida' en el panel y se pueden re-ejecutar."
      return
    }
    if ((Get-Date) -ge $limite) {
      Muere "Siguen $($activas.Count) ejecucion(es) en curso tras $Minutos min. Espera a que terminen y repite, o usa -Forzar."
    }
    Write-Host ("  ... esperando a que terminen {0} ejecucion(es) (hasta {1:HH:mm})" -f $activas.Count, $limite)
    Start-Sleep -Seconds 30
  }
}

function Respaldar-Datos([string]$AppEngine, [string]$Raiz) {
  $carpeta = Join-Path $Raiz "backups"
  $destino = Join-Path $carpeta ("despliegue-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Force -Path $destino | Out-Null

  $envMotor = Join-Path $AppEngine ".env"
  if ((Get-ValorEnv $envMotor "DB_DRIVER") -eq "sqlserver") {
    Aviso "DB_DRIVER=sqlserver: la base la respalda SQL Server, no este script"
  } else {
    $db = Get-ValorEnv $envMotor "SQLITE_DB_PATH"
    if (-not $db) { $db = "data\qa-lab.db" }
    if (-not [System.IO.Path]::IsPathRooted($db)) { $db = Join-Path $AppEngine $db }
    if (Test-Path -LiteralPath $db) {
      # Con los servicios detenidos el -wal ya esta volcado; se copia igual por si acaso.
      foreach ($f in @($db, "$db-wal", "$db-shm")) {
        if (Test-Path -LiteralPath $f) { Copy-Item -LiteralPath $f -Destination $destino -Force }
      }
      Ok "base respaldada ($([System.IO.Path]::GetFileName($db)))"
    } else {
      Aviso "no encontre la base SQLite en $db (instalacion nueva?)"
    }
  }

  $artefactos = Join-Path $AppEngine ".artifacts"
  $historial = Join-Path $artefactos "qa-lab-run-history"
  if (Test-Path -LiteralPath $historial) {
    & robocopy $historial (Join-Path $destino "qa-lab-run-history") /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Muere "robocopy devolvio $LASTEXITCODE respaldando el historial de ejecuciones" }
    Ok "historial de ejecuciones respaldado"
  }
  $lanzamientos = Join-Path $artefactos "scenario-launch-runs"
  if (Test-Path -LiteralPath $lanzamientos) {
    # Solo los manifiestos (estado y resultados de cada lanzamiento), no las evidencias.
    & robocopy $lanzamientos (Join-Path $destino "scenario-launch-runs") "launch-manifest.json" /S /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Muere "robocopy devolvio $LASTEXITCODE respaldando los lanzamientos" }
    Ok "manifiestos de lanzamientos respaldados"
  }

  # No borrar respaldos anteriores automaticamente: el despliegue no decide cuanto
  # tiempo debe conservarse el historial operativo del usuario.
  Ok "respaldo en $destino"
}
