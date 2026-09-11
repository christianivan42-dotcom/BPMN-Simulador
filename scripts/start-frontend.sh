#!/usr/bin/env bash
# ── Inicia el frontend React (Mac / Linux) ───────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/../frontend"
# shellcheck source=_common.sh
. "$(dirname "$0")/../scripts/_common.sh"

ensure_frontend_env

echo "Frontend en http://127.0.0.1:5173"
exec npm run dev
