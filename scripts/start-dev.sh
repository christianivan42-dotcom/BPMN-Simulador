#!/usr/bin/env bash
# ── Inicia backend + frontend en paralelo (Mac / Linux) ─────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=_common.sh
. "$ROOT/scripts/_common.sh"

echo "=============================================="
echo "  Agente BPMS — Iniciando sistema completo"
echo "  Backend:  http://127.0.0.1:8010/api/v1/docs"
echo "  Frontend: http://127.0.0.1:5173"
echo "=============================================="

cd "$ROOT/backend"
VENV="$(ensure_backend_env)"
"$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload &
BACKEND_PID=$!

cd "$ROOT/frontend"
ensure_frontend_env
npm run dev &
FRONTEND_PID=$!

# Al salir (Ctrl+C o error) se detienen AMBOS procesos, no solo el del frente.
cleanup() {
  trap - INT TERM EXIT
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo ""
echo "Backend PID: $BACKEND_PID · Frontend PID: $FRONTEND_PID"
echo "Presiona Ctrl+C para detener ambos servicios."
wait
