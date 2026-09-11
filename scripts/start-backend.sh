#!/usr/bin/env bash
# ── Inicia el backend FastAPI (Mac / Linux) ──────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/../backend"
# shellcheck source=_common.sh
. "$(dirname "$0")/../scripts/_common.sh"

VENV="$(ensure_backend_env)"

echo "Backend en http://127.0.0.1:8010  ·  API docs: /api/v1/docs"
exec "$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
