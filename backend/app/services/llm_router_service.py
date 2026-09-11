"""
LLM Router Service
==================
Selecciona automáticamente el LLM más adecuado según la tarea y disponibilidad.

Capacidades reales (mayo 2026):
  - Groq Llama 4 Scout 17B   → Muy rápido (11-14s), gratis, 8K contexto.
                               Ideal para conversación, análisis AS-IS/TO-BE,
                               consultas BPM simples. Puede fallar en XML estricto.
  - Gemini 2.5 Flash          → Rápido (15-20s), 1M contexto, gratis (1500 RPD).
                               Ideal para BPMN XML (con prompt estricto),
                               análisis cuantitativo/cualitativo, código.
  - Gemini 2.5 Pro            → El mejor, 1M contexto, cuota limitada.
                               Solo para tareas que realmente lo necesitan:
                               Process Mining y Simulación.
  - Deepseek V3 API           → Sin saldo (402). Marcado automáticamente.
  - Ollama deepseek-r1:7b     → Offline, razonamiento (~30-60s).
  - Ollama qwen2.5-coder:7b   → Offline, BPMN/código (~24s).
"""

from __future__ import annotations

from app.core.logging import get_logger
from enum import Enum

logger = get_logger(__name__)


class LLMProvider(str, Enum):
    gemini = "gemini"
    gemini_flash = "gemini_flash"
    deepseek_api = "deepseek_api"
    groq = "groq"
    deepseek_local = "deepseek_local"
    deepseek_coder_local = "deepseek_coder_local"
    qwen_local = "qwen_local"


class AgentTask(str, Enum):
    # Tareas simples / rápidas
    clasificacion = "clasificacion"
    normalizacion = "normalizacion"
    chat_simple = "chat_simple"

    # Código / estructuras
    bpmn_xml = "bpmn_xml"
    codigo_python = "codigo_python"
    sql = "sql"
    analisis_datos = "analisis_datos"

    # Análisis complejos
    process_mining = "process_mining"
    simulacion = "simulacion"
    consulta_bpm = "consulta_bpm"
    analisis_cualitativo = "analisis_cualitativo"
    metodologia = "metodologia"
    as_is = "as_is"
    to_be = "to_be"
    analisis_cuantitativo = "analisis_cuantitativo"

    # Levantamiento jerárquico de procesos (diálogo focalizado)
    porter_chain = "porter_chain"    # Cadena de Valor de Porter — Nivel 0
    macro_mapa = "macro_mapa"        # Macro-Procesos — Nivel 1


# Mapa agente → tarea principal
AGENT_TASK_MAP: dict[str, AgentTask] = {
    "orquestador": AgentTask.clasificacion,
    "consultor_bpm": AgentTask.consulta_bpm,
    "metodologias": AgentTask.metodologia,
    "as_is": AgentTask.as_is,
    "to_be": AgentTask.to_be,
    "bpmn": AgentTask.bpmn_xml,
    "simulacion": AgentTask.simulacion,
    "process_mining": AgentTask.process_mining,
    "analisis_cuantitativo": AgentTask.analisis_cuantitativo,
    "analisis_cualitativo": AgentTask.analisis_cualitativo,
    "chat": AgentTask.chat_simple,
}

# ── Grupos por capacidad óptima ──────────────────────────────────────────────

# Groq Llama 4 Scout: muy rápido, conversacional, suficiente para estas tareas
_GROQ_TASKS = {
    AgentTask.clasificacion,
    AgentTask.normalizacion,
    AgentTask.chat_simple,
    AgentTask.consulta_bpm,    # preguntas BPM generalmente no necesitan más
    AgentTask.metodologia,     # explicar metodologías (Lean, Six Sigma, etc.)
    AgentTask.as_is,           # levantamiento conversacional del proceso actual
    AgentTask.to_be,           # propuestas de mejora conversacionales
}

# Gemini Flash: estructurado, preciso, buen contexto — mejor para XML y análisis
_GEMINI_FLASH_TASKS = {
    AgentTask.bpmn_xml,              # XML estricto: Flash más confiable que Groq
    AgentTask.codigo_python,
    AgentTask.sql,
    AgentTask.analisis_datos,
    AgentTask.analisis_cuantitativo, # cálculos: tiempos ciclo, sigma, DPMO
    AgentTask.analisis_cualitativo,  # stakeholders, madurez, cultura
    AgentTask.porter_chain,          # diálogo largo: 30 msg historial > 6 de Groq
    AgentTask.macro_mapa,            # idem — conversación extendida
}

# Gemini Pro: máxima calidad — solo donde realmente se necesita
_GEMINI_PRO_TASKS = {
    AgentTask.process_mining,  # análisis de logs de eventos (complejo)
    AgentTask.simulacion,      # modelado de escenarios (razonamiento profundo)
}


class LLMRouterService:
    """
    Selecciona el LLM correcto según la lógica del sistema BPMS.
    No instancia clientes — eso lo hace LLMClientService.
    """

    def __init__(
        self,
        empresa_modo_privado: bool = False,
        internet_disponible: bool = True,
        gemini_con_cuota: bool = True,
        deepseek_con_cuota: bool = True,
        groq_con_cuota: bool = True,
        ollama_disponible: bool = False,
    ) -> None:
        self.empresa_modo_privado = empresa_modo_privado
        self.internet_disponible = internet_disponible
        self.gemini_con_cuota = gemini_con_cuota
        self.deepseek_con_cuota = deepseek_con_cuota
        self.groq_con_cuota = groq_con_cuota
        self.ollama_disponible = ollama_disponible

    def seleccionar(
        self,
        tarea: AgentTask,
        tokens_requeridos: int = 0,
    ) -> LLMProvider:
        """Retorna el LLMProvider más adecuado para la tarea dada."""

        # 0. Empresa modo privado → solo Ollama local
        if self.empresa_modo_privado:
            if tarea in {AgentTask.bpmn_xml, AgentTask.codigo_python, AgentTask.sql}:
                return LLMProvider.deepseek_coder_local
            return LLMProvider.deepseek_local

        # 1. Sin internet → Ollama local
        if not self.internet_disponible:
            if tarea in {AgentTask.bpmn_xml, AgentTask.codigo_python}:
                return LLMProvider.deepseek_coder_local
            return LLMProvider.deepseek_local

        # 2. Tareas conversacionales/rápidas → Groq (11-14s, gratis)
        if tarea in _GROQ_TASKS and self.groq_con_cuota:
            return LLMProvider.groq

        # 3. BPMN, código, análisis estructurado → Gemini Flash (preciso, 1M contexto)
        if tarea in _GEMINI_FLASH_TASKS and self.gemini_con_cuota:
            return LLMProvider.gemini_flash

        # 4. Contexto muy largo → Gemini Flash o Pro según complejidad
        if tokens_requeridos > 30_000 and self.gemini_con_cuota:
            return LLMProvider.gemini  # Pro para contextos masivos

        # 5. Tareas de máxima complejidad → Gemini Pro
        if tarea in _GEMINI_PRO_TASKS and self.gemini_con_cuota:
            return LLMProvider.gemini

        # 6. Gemini Flash como comodín si Pro no está disponible
        if self.gemini_con_cuota:
            return LLMProvider.gemini_flash

        # 7. Groq como fallback general
        if self.groq_con_cuota:
            return LLMProvider.groq

        # 8. Deepseek API como último recurso en línea
        if self.deepseek_con_cuota:
            return LLMProvider.deepseek_api

        # 9. Todo agotado → Ollama local
        if self.ollama_disponible:
            return LLMProvider.deepseek_local

        logger.warning("No hay LLM disponible con cuota confirmada, intentando Gemini Flash")
        return LLMProvider.gemini_flash

    def seleccionar_por_agente(
        self,
        agente: str,
        tokens_requeridos: int = 0,
    ) -> LLMProvider:
        """Atajo: dado un nombre de agente, retorna el LLM correspondiente."""
        tarea = AGENT_TASK_MAP.get(agente, AgentTask.chat_simple)
        return self.seleccionar(tarea, tokens_requeridos)

    # ── Metadatos de cada LLM ──────────────────────────────────────────────────

    @staticmethod
    def max_contexto_rag(provider: LLMProvider) -> int:
        """Número máximo de fragmentos RAG a incluir según el provider."""
        limits = {
            LLMProvider.gemini: 20,
            LLMProvider.gemini_flash: 15,
            LLMProvider.deepseek_api: 3,
            LLMProvider.groq: 3,          # aumentado: Llama 4 maneja bien 3 frags
            LLMProvider.deepseek_local: 4,
            LLMProvider.deepseek_coder_local: 3,
            LLMProvider.qwen_local: 2,
        }
        return limits.get(provider, 5)

    @staticmethod
    def max_historial(provider: LLMProvider) -> int:
        """Número máximo de mensajes de historial a incluir."""
        limits = {
            LLMProvider.gemini: 50,
            LLMProvider.gemini_flash: 30,
            LLMProvider.deepseek_api: 5,
            LLMProvider.groq: 6,           # aumentado para mejor contexto conversacional
            LLMProvider.deepseek_local: 10,
            LLMProvider.deepseek_coder_local: 5,
            LLMProvider.qwen_local: 3,
        }
        return limits.get(provider, 10)

    @staticmethod
    def temperatura(provider: LLMProvider, tarea: AgentTask) -> float:
        """Temperatura recomendada según provider y tarea."""
        # XML/código: temperatura muy baja para salida determinista
        if tarea in {AgentTask.bpmn_xml, AgentTask.codigo_python, AgentTask.sql}:
            return 0.05
        # Análisis cuantitativo: baja para precisión numérica
        if tarea == AgentTask.analisis_cuantitativo:
            return 0.1
        # Conversacional (Groq): algo más creativo
        if provider == LLMProvider.groq:
            return 0.5
        # Gemini: moderado
        if provider in {LLMProvider.gemini, LLMProvider.gemini_flash}:
            return 0.3
        return 0.3
