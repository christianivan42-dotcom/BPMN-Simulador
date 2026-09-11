@echo off
REM -- Arranca SOLO el backend (FastAPI, puerto 8010) --------------------------
setlocal
cd /d "%~dp0..\backend"

if not exist venv (
  echo [1/3] Creando entorno virtual...
  python -m venv venv
  if errorlevel 1 (
    echo.
    echo ERROR: no se pudo crear el entorno virtual.
    echo Comprueba que Python 3.11+ este instalado y en el PATH ^(python --version^).
    pause
    exit /b 1
  )
  echo [2/3] Instalando dependencias ^(solo la primera vez^)...
  venv\Scripts\python.exe -m pip install --upgrade pip
  venv\Scripts\python.exe -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo ERROR: fallo la instalacion de dependencias.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Entorno virtual ya existe, se reutiliza.
  echo [2/3] Dependencias ya instaladas ^(borra backend\venv para reinstalar^).
)

if not exist .env copy .env.example .env >nul

echo [3/3] Backend en http://127.0.0.1:8010/api/v1/docs
venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8010
if errorlevel 1 pause
endlocal
