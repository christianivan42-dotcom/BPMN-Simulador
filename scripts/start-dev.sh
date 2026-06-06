#!/bin/bash
# ── Inicia backend + frontend en paralelo (Mac) ──────────────────────────────
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=============================================="
echo "  Agente BPMS — Iniciando sistema completo"
echo "  Backend:  http://127.0.0.1:8010/api/docs"
echo "  Frontend: http://127.0.0.1:5173"
echo "=============================================="

# Iniciar backend en background
cd "$ROOT/backend"
if [ ! -d "venv_mac" ]; then
  python3 -m venv venv_mac
  venv_mac/bin/pip install -r requirements.txt
fi
if [ ! -f ".env" ]; then
  cp .env.example .env
fi
mkdir -p storage/documents storage/vector_store storage/obsidian-bpm-vault
venv_mac/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Iniciar frontend
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo ""
echo "Presiona Ctrl+C para detener ambos servicios."
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
