@echo off
REM ---------------------------------------------------------------------------
REM Respaldo diario de la base qa-lab, para el Programador de tareas de Windows.
REM
REM Es seguro con el servicio corriendo: usa VACUUM INTO, que pide a SQLite un
REM snapshot consistente en vez de copiar el archivo (con WAL, copiarlo puede
REM dar una base a medias).
REM
REM Alta de la tarea (como administrador, una sola vez):
REM   schtasks /create /tn "QA Lab - respaldo" /tr "C:\inetpub\qa-engine\scripts\backup-qa-lab.bat" ^
REM            /sc daily /st 02:00 /ru "DOMINIO\cuenta-servicio" /rp *
REM ---------------------------------------------------------------------------

setlocal

REM Raiz del motor: la carpeta padre de este script.
set "ENGINE_DIR=%~dp0.."
cd /d "%ENGINE_DIR%" || exit /b 1

REM Donde dejar los respaldos y cuantos dias conservarlos. Ajusta a tu servidor;
REM conviene que sea un disco distinto al de la base.
if "%BACKUP_DIR%"=="" set "BACKUP_DIR=D:\qa\backups"
if "%BACKUP_RETENTION_DAYS%"=="" set "BACKUP_RETENTION_DAYS=14"

set "LOG_DIR=%BACKUP_DIR%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul

for /f "tokens=1-3 delims=/- " %%a in ("%DATE%") do set "STAMP=%%c%%b%%a"
set "LOG_FILE=%LOG_DIR%\backup-%STAMP%.log"

echo [%DATE% %TIME%] iniciando respaldo>>"%LOG_FILE%"
call npm run db:backup --silent >>"%LOG_FILE%" 2>&1
set "RESULT=%ERRORLEVEL%"

if "%RESULT%"=="0" (
  echo [%DATE% %TIME%] respaldo correcto>>"%LOG_FILE%"
) else (
  echo [%DATE% %TIME%] RESPALDO FALLIDO ^(codigo %RESULT%^)>>"%LOG_FILE%"
)

endlocal & exit /b %RESULT%
