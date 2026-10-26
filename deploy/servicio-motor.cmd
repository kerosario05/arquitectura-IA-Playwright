@echo off
REM ---------------------------------------------------------------------------
REM  Arranca el MOTOR (API de automatizacion) en segundo plano.
REM
REM  Existe porque el Programador de tareas no tiene "iniciar en esta carpeta":
REM  Node resuelve node_modules y el .env desde el directorio de trabajo, asi que
REM  hay que posicionarse antes de lanzarlo.
REM
REM  Tampoco se usa npx: en este servidor la salida a internet esta filtrada y
REM  npx intentaria descargar tsx en vez de usar el local.
REM
REM  Alta de la tarea (consola elevada, una sola vez):
REM    schtasks /create /tn "QA Lab - motor" /tr "C:\qa\app\qa-engine\deploy\servicio-motor.cmd" ^
REM             /sc onstart /ru "DOMINIO\cuenta" /rp * /rl LIMITED
REM ---------------------------------------------------------------------------

setlocal

REM La carpeta del motor es la padre de este script.
set "APP_DIR=%~dp0.."
cd /d "%APP_DIR%" || exit /b 1

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo [motor] FALTA node_modules o tsx en %APP_DIR%
  exit /b 1
)

set "LOG_DIR=C:\qa\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul

REM Un log por dia: evita un unico archivo que crece sin limite.
for /f "tokens=1-3 delims=/- " %%a in ("%DATE%") do set "STAMP=%%c%%b%%a"
set "LOG=%LOG_DIR%\motor-%STAMP%.log"

echo. >>"%LOG%"
echo ============================================================ >>"%LOG%"
echo [%DATE% %TIME%] arrancando motor >>"%LOG%"

node node_modules\tsx\dist\cli.mjs src\server\server.ts >>"%LOG%" 2>&1

echo [%DATE% %TIME%] el motor termino con codigo %ERRORLEVEL% >>"%LOG%"
endlocal
