#!/bin/bash
# ── Inicia el frontend React (Mac) ───────────────────────────────────────────
set -e
cd "$(dirname "$0")/../frontend"

if [ ! -d "node_modules" ]; then
  echo "Instalando dependencias del frontend..."
  npm install
fi

echo "Iniciando frontend en http://127.0.0.1:5173 ..."
npm run dev
