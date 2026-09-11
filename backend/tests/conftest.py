"""Configuración común de los tests.

Se ejecuta ANTES de importar `app.*`, así que aquí se fija el entorno del que
depende `Settings` (que es un singleton creado al importar `app.core.config`).

Las variables de entorno tienen prioridad sobre `backend/.env`, de modo que la
suite da el mismo resultado en la máquina de cualquiera: base de datos propia y
LLM en modo demo, sin depender de las API keys que tenga configuradas.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test.db")
# Sin esto, un desarrollador con API keys reales dispararía llamadas de verdad
# (y con .env sin claves el health check daba "degraded" y el test fallaba).
os.environ.setdefault("USE_MOCK_LLM", "true")
os.environ.setdefault("APP_ENV", "test")
