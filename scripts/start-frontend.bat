@echo off
REM -- Arranca SOLO el frontend (Vite/React, puerto 5173) ----------------------
setlocal
cd /d "%~dp0..\frontend"

if not exist node_modules (
  echo [1/2] Instalando dependencias ^(solo la primera vez^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: fallo npm install. Comprueba que Node 20.19+ o 22.12+ este instalado ^(node --version^).
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependencias ya instaladas ^(borra frontend\node_modules para reinstalar^).
)

if not exist .env copy .env.example .env >nul

echo [2/2] Frontend en http://127.0.0.1:5173
call npm run dev
if errorlevel 1 pause
endlocal
