@echo off
REM -- Inicia backend + frontend en Windows (cada uno en su ventana) -----------
REM Uso: doble clic en este archivo, o desde cmd:  scripts\start-dev.bat
REM
REM NOTA: cada servicio se lanza mediante su propio .bat. No encadenes comandos
REM con "if not exist X ... && ..." en una sola linea: en cmd.exe el cuerpo del
REM IF se traga el resto de la linea y el servidor no llega a arrancar.

echo ==============================================
echo   Agente BPMS - Iniciando sistema completo
echo   Backend:  http://127.0.0.1:8010/api/v1/docs
echo   Frontend: http://127.0.0.1:5173
echo ==============================================

start "BPMS Backend"  cmd /k call "%~dp0start-backend.bat"
start "BPMS Frontend" cmd /k call "%~dp0start-frontend.bat"

echo.
echo Se abrieron dos ventanas (backend y frontend). Cierralas para detener.
echo La primera vez tardan unos minutos instalando dependencias.
