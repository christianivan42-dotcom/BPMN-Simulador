# 🧠 Agente BPMS — Copiloto Cognitivo de Procesos

Plataforma web para **gestión de procesos de negocio (BPM)** asistida por IA: mapa de
procesos, modelado **BPMN 2.0 (AS-IS / TO-BE)**, un **simulador visual de procesos**
propio (motor de eventos discretos) y un **asistente de IA** que ayuda al analista a
configurar, interpretar y mejorar sus procesos.

> **Stack:** FastAPI + SQLAlchemy (backend) · React + Vite + TypeScript (frontend) · SQLite por defecto.

---

## ✨ Características

- **Mapa de procesos** ISO-9001 (estratégicos / operativos / apoyo), editable y diseñable con IA.
- **Editor BPMN 2.0** propio (paleta completa, minimapa, colores) para **AS-IS** y **TO-BE**,
  con nombre del proceso y ubicación dentro del mapa.
- **Simulador de procesos visual** integrado en el diagrama:
  - Tokens que **recorren las líneas** como una carrera, con tareas activas resaltadas.
  - Motor de **eventos discretos (DES)** con KPIs: cycle time (reloj y hábil), espera,
    eficiencia, throughput, costo, utilización de recursos y cuellos de botella.
  - **7 distribuciones**, unidades de tiempo, **recursos con horarios/calendarios**,
    costos fijos, umbrales y **eventos de borde** (boundary events). Sin límite de corridas.
  - Edición **por elemento** haciendo clic en el diagrama.
- **AI Workspace**: asistente experto que **lee el diagrama**, ayuda a **llenar los datos**,
  **interpreta resultados**, **compara AS-IS vs TO-BE** y recomienda **metodología de mejora**
  (Lean, Six Sigma/DMAIC, Teoría de Restricciones, BPR, automatización).

---

## 📦 Requisitos previos

| Herramienta | Versión | Para qué |
|---|---|---|
| **Python** | 3.11 o superior | Backend (FastAPI) |
| **Node.js** | 18 o superior | Frontend (Vite/React) |
| **Git** | cualquiera | Clonar el repositorio |

Comprueba que los tienes:

```bash
python3 --version    # >= 3.11
node --version       # >= 18
git --version
```

---

## 🚀 Instalación y ejecución

### Opción A — Automática (Mac / Linux)

```bash
git clone <URL-DE-TU-REPO>.git
cd agente-IA-prueba-master
bash scripts/start-dev.sh
```

El script crea el entorno virtual, instala dependencias, copia `.env.example → .env` y
levanta **backend + frontend** juntos.

### Opción B — Manual (cualquier sistema)

**1) Backend** (terminal 1):

```bash
cd backend
python3 -m venv venv               # crea el entorno virtual
source venv/bin/activate           # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # Windows: copy .env.example .env
uvicorn app.main:app --reload --port 8010
```

**2) Frontend** (terminal 2):

```bash
cd frontend
npm install
cp .env.example .env               # Windows: copy .env.example .env
npm run dev
```

### Abrir la aplicación

| Servicio | URL |
|---|---|
| **Aplicación** | <http://127.0.0.1:5173> |
| **API + documentación** | <http://127.0.0.1:8010/api/docs> |

> **Modo demo sin IA:** por defecto `USE_MOCK_LLM=true` en `backend/.env` → la app funciona
> sin consumir cuota de IA (respuestas simuladas). Para respuestas reales del asistente,
> pon `USE_MOCK_LLM=false` y añade **tu** clave de un proveedor (Gemini, Groq o Deepseek;
> todos con plan gratuito).

---

## 📖 Guía de uso del programa

> La aplicación es de **acceso libre**: no requiere usuario ni contraseña. El menú está a la izquierda.

### 1. Inicio — contexto de la organización
Define misión, visión, valores, cadena de valor, objetivos y KPIs. Este contexto alimenta
al asistente de IA y al diseño automático del mapa de procesos.

### 2. Procesos → Mapa de procesos
Crea el mapa en tres bandas (**estratégicos / operativos / apoyo**). Pulsa **+** para añadir
procesos, o **«Diseñar con IA»** para proponerlo desde tu cadena de valor. Pulsa **Guardar**.

### 3. Procesos → BPMN (AS-IS / TO-BE)
1. Escribe el **Nombre del proceso** y elige a qué proceso del mapa **pertenece**.
2. Cambia entre **AS-IS** (actual) y **TO-BE** (propuesto). Usa *«Partir del AS-IS»* para
   copiar el actual como base del mejorado.
3. **Modela** arrastrando elementos desde la paleta (tareas, compuertas, eventos, flujos).
4. Pulsa **Guardar diagrama** (también se autoguarda al editar).

### 4. Simular el proceso
1. En el editor BPMN pulsa **Simular** (icono ⚡).
2. **Haz clic en cada elemento** del diagrama (tarea, compuerta, evento) para editar sus datos:
   duración y distribución, recurso, probabilidad de las ramas, duración de los eventos de borde, etc.
3. Configura el **Escenario** (nº de instancias, llegadas, moneda, fecha), los **Recursos** y los **Horarios**.
4. Pulsa **Ejecutar simulación**: verás los **tokens recorriendo el diagrama** y, en
   **Resultados**, los KPIs (cycle time, espera, costo, utilización, cuellos de botella).

### 5. Asistente de IA de la simulación
Dentro del panel de simulación, pestaña **IA**:
- **«Ayúdame a llenar los datos»** — explica cada parámetro y sugiere valores leyendo tu diagrama.
- **«Interpretar resultados»** — analiza los KPIs y dice qué mejorar.
- **«¿Qué metodología de mejora usar?»** — recomienda Lean / Six Sigma / TOC / BPR / automatización.
- **«Comparar AS-IS vs TO-BE»** — compara ambos escenarios (ejecuta los dos antes).

### 6. AI Workspace (chat experto)
El botón **IA** (arriba a la derecha) abre un consultor experto contextualizado al módulo activo.

### 7. Conocimiento
Mapa de conocimiento de los nodos (procesos, documentos y relaciones).

---

## 🗂️ Estructura del proyecto

```
backend/    FastAPI + SQLAlchemy (API, simulación, agentes de IA)
frontend/   React + Vite + TypeScript (UI, editor BPMN, simulador visual)
scripts/    Scripts de arranque (dev / backend / frontend)
```

---

## 🔐 Seguridad

- Las claves de API viven en `backend/.env`, **excluido por `.gitignore`** (nunca se publica).
- Usa `backend/.env.example` como plantilla. Nunca subas claves reales al repositorio.

---

## 📄 Licencia

MIT — úsalo, modifícalo y compártelo libremente.
