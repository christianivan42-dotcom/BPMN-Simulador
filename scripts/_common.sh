# ── Utilidades compartidas por los scripts de arranque (Mac / Linux) ─────────
# Se hace "source" desde start-backend.sh / start-frontend.sh / start-dev.sh.

# Elige el intérprete de Python disponible (python3 o python).
pick_python() {
  if command -v python3 >/dev/null 2>&1; then echo "python3"
  elif command -v python  >/dev/null 2>&1; then echo "python"
  else
    echo "ERROR: no se encontró Python. Instala Python 3.11+ (https://python.org)." >&2
    exit 1
  fi
}

# Devuelve el directorio del entorno virtual del backend.
# Reutiliza venv_mac si ya existe (compatibilidad con instalaciones previas).
venv_dir() {
  if [ -d "venv_mac" ]; then echo "venv_mac"; else echo "venv"; fi
}

# Crea el venv e instala dependencias solo si hace falta. Marca la instalación
# con un sello, para no reinstalar en cada arranque pero sí tras cambiar
# requirements.txt.
ensure_backend_env() {
  local venv; venv="$(venv_dir)"
  local py;   py="$(pick_python)"

  if [ ! -d "$venv" ]; then
    echo "Creando entorno virtual ($venv)…"
    "$py" -m venv "$venv"
  fi

  local stamp="$venv/.requirements.sha"
  local current; current="$(cksum requirements.txt | awk '{print $1}')"
  if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$current" ]; then
    echo "Instalando dependencias del backend…"
    "$venv/bin/python" -m pip install --upgrade pip >/dev/null
    "$venv/bin/python" -m pip install -r requirements.txt
    echo "$current" > "$stamp"
  fi

  [ -f ".env" ] || cp .env.example .env
  mkdir -p storage/documents storage/vector_store storage/obsidian-bpm-vault
  echo "$venv"
}

ensure_frontend_env() {
  if [ ! -d "node_modules" ]; then
    echo "Instalando dependencias del frontend…"
    npm install
  fi
  [ -f ".env" ] || cp .env.example .env
}
