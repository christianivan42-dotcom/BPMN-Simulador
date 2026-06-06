@echo off
REM ── Inicia backend + frontend en Windows (cada uno en su ventana) ────────────
REM Uso: doble clic en este archivo, o desde cmd:  scripts\start-dev.bat
cd /d "%~dp0\.."

echo ==============================================
echo   Agente BPMS - Iniciando sistema completo
echo   Backend:  http://127.0.0.1:8010/api/docs
echo   Frontend: http://127.0.0.1:5173
echo ==============================================

REM --- Backend (API, puerto 8010) en una ventana nueva ---
start "BPMS Backend" cmd /k "cd backend && if not exist venv python -m venv venv && call venv\Scripts\activate && pip install -r requirements.txt && if not exist .env copy .env.example .env && uvicorn app.main:app --reload --port 8010"

REM --- Frontend (UI, puerto 5173) en otra ventana nueva ---
start "BPMS Frontend" cmd /k "cd frontend && if not exist node_modules npm install && if not exist .env copy .env.example .env && npm run dev"

echo.
echo Se abrieron dos ventanas (backend y frontend). Cierralas para detener.
