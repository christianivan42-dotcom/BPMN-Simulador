#!/bin/bash
# ── Inicia el backend FastAPI (Mac) ──────────────────────────────────────────
set -e
cd "$(dirname "$0")/../backend"

if [ ! -d "venv_mac" ]; then
  echo "Creando entorno virtual Mac..."
  python3 -m venv venv_mac
  venv_mac/bin/pip install -r requirements.txt
fi

if [ ! -f ".env" ]; then
  echo "Copiando .env.example → .env (configura tus API keys luego)"
  cp .env.example .env
fi

mkdir -p storage/documents storage/vector_store storage/obsidian-bpm-vault

echo "Iniciando backend en http://127.0.0.1:8010 ..."
venv_mac/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
