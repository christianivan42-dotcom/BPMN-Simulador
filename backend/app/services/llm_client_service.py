"""
LLM Client Service
==================
Cliente unificado que abstrae la llamada real a cada proveedor LLM:
  - Gemini Pro / Flash      (API REST, vía httpx)
  - Deepseek V3 API         (API compatible con OpenAI)
  - Groq + Llama 4          (groq SDK)
  - Ollama local            (httpx directo)

No depende de LangChain para mantener el proyecto liviano y auditable.
"""

from __future__ import annotations

from app.core.logging import get_logger
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings
from app.services.llm_router_service import AgentTask, LLMProvider, LLMRouterService

logger = get_logger(__name__)

# Temperatura por defecto si no hay tarea disponible
_DEFAULT_TEMP = 0.3
_REQUEST_TIMEOUT = 60.0   # timeout por llamada; fallback intenta el siguiente
_REQUEST_TIMEOUT_GROQ = 45.0  # Groq es más rápido

# Máximo de proveedores alternativos que se prueban tras un fallo. Sin este tope,
# una caída general encadenaba 6 intentos × 60 s y el usuario esperaba minutos
# ante una petición que iba a fallar igual.
_MAX_FALLBACK_ATTEMPTS = 3

# ── Cooldown de proveedores (antes: lista negra permanente) ───────────────────
# Un 429 casi siempre es un límite POR MINUTO, no la cuota diaria agotada.
# Marcar el proveedor como muerto hasta reiniciar el backend dejaba al usuario
# sin IA por una ráfaga de peticiones. Ahora se aparta durante un rato y vuelve.
_COOLDOWN_RATE_LIMIT = 90.0        # s — 429 / "too many requests"
_COOLDOWN_QUOTA_EXHAUSTED = 900.0  # s — cuota o saldo agotado
_COOLDOWN_UNTIL: dict[LLMProvider, float] = {}

# Resultado cacheado del sondeo a Ollama: (instante, disponible).
_OLLAMA_PROBE: tuple[float, bool] | None = None
_OLLAMA_PROBE_TTL = 60.0  # s

# ── Gemini por REST ───────────────────────────────────────────────────────────
_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Los modelos 2.5 "piensan" y ese razonamiento sale del mismo presupuesto de
# tokens: con 4096 las respuestas largas (diagnóstico, veredicto) salían cortadas.
_GEMINI_MAX_OUTPUT_TOKENS = 8192
# Flash suele responder en 10–20 s, pero en la capa gratuita hay picos que pasaban
# de los 60 s generales. El frontend espera 120 s: 90 deja margen a un respaldo.
_GEMINI_TIMEOUT = 90.0


def _cooldown(provider: LLMProvider, seconds: float, reason: str) -> None:
    """Aparta un proveedor temporalmente en lugar de descartarlo para siempre."""
    _COOLDOWN_UNTIL[provider] = time.monotonic() + seconds
    logger.warning(
        "llm.provider_cooldown", provider=str(provider), seconds=int(seconds), reason=reason
    )


def _in_cooldown(provider: LLMProvider) -> bool:
    until = _COOLDOWN_UNTIL.get(provider)
    if until is None:
        return False
    if time.monotonic() >= until:
        del _COOLDOWN_UNTIL[provider]  # se le vuelve a dar una oportunidad
        return False
    return True


def _note_provider_error(provider: LLMProvider, message: str) -> None:
    """Traduce el error del proveedor al cooldown que le corresponde."""
    low = message.lower()
    if any(k in low for k in ("insufficient", "saldo", "billing", "402", "exceeded your current quota")):
        _cooldown(provider, _COOLDOWN_QUOTA_EXHAUSTED, "cuota/saldo agotado")
    elif any(k in low for k in ("quota", "resource_exhausted", "429", "too many", "rate limit")):
        _cooldown(provider, _COOLDOWN_RATE_LIMIT, "límite de peticiones")


def _gemini_error_message(response: httpx.Response) -> str:
    """Mensaje legible de un error de Gemini (su JSON trae error.message)."""
    try:
        return str(response.json().get("error", {}).get("message") or response.text)[:300]
    except ValueError:
        return response.text[:300]


@dataclass
class LLMResponse:
    content: str
    provider: str
    model: str
    tokens_used: int | None = None
    error: str | None = None

    @property
    def success(self) -> bool:
        return self.error is None and bool(self.content)


class LLMClientService:
    """
    Llama al LLM seleccionado por el router y retorna LLMResponse.
    Maneja el fallback automático si el provider falla.
    """

    def __init__(
        self,
        router: LLMRouterService | None = None,
        empresa_modo_privado: bool = False,
    ) -> None:
        self._router = router or LLMRouterService(
            empresa_modo_privado=empresa_modo_privado,
            internet_disponible=True,
            gemini_con_cuota=bool(settings.gemini_api_key) and not _in_cooldown(LLMProvider.gemini),
            deepseek_con_cuota=bool(settings.deepseek_api_key) and not _in_cooldown(LLMProvider.deepseek_api),
            groq_con_cuota=bool(settings.groq_api_key) and not _in_cooldown(LLMProvider.groq),
            ollama_disponible=self._check_ollama(),
        )

    # ── Punto de entrada principal ─────────────────────────────────────────────

    def completar(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]] | None = None,
        tarea: AgentTask = AgentTask.chat_simple,
        tokens_requeridos: int = 0,
        forzar_provider: LLMProvider | None = None,
    ) -> LLMResponse:
        """
        Genera una respuesta del LLM elegido con fallback automático.

        Args:
            system_prompt: Instrucciones del sistema (rol del agente).
            user_message:  Mensaje actual del usuario.
            historial:     Lista de {"role": "user"|"assistant", "content": "..."}.
            tarea:         Tipo de tarea para la selección del LLM.
            tokens_requeridos: Estimación de tokens del contexto RAG.
            forzar_provider: Si se especifica, ignora la selección automática.
        """
        historial = historial or []
        provider = forzar_provider or self._router.seleccionar(tarea, tokens_requeridos)

        # Si el provider seleccionado está en cooldown, ir directo al fallback
        if _in_cooldown(provider):
            logger.info("llm.provider_skipped", provider=str(provider), reason="cooldown")
            return self._fallback(provider, system_prompt, user_message, historial, "proveedor en cooldown")

        temperatura = LLMRouterService.temperatura(provider, tarea)

        try:
            return self._llamar(provider, system_prompt, user_message, historial, temperatura)
        except Exception as exc:  # noqa: BLE001
            _note_provider_error(provider, str(exc))
            logger.warning("llm.provider_failed", provider=str(provider), error=str(exc)[:300])
            return self._fallback(provider, system_prompt, user_message, historial, str(exc))

    # ── Dispatcher por provider ────────────────────────────────────────────────

    def _llamar(
        self,
        provider: LLMProvider,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        import json

        # MOCK GLOBAL PARA PRUEBAS SIN LLM (activar con USE_MOCK_LLM=true en .env)
        if settings.use_mock_llm:
            logger.info("llm.mock_response", provider=str(provider))
            user_lower = user_message.lower()

            # Detectar si el caller espera JSON estructurado (servicios internos)
            espera_json = (
                "devuelve SOLO un JSON" in system_prompt
                or "responde SOLO con JSON" in system_prompt
                or "Return a JSON" in system_prompt
                or '"next_action_es"' in system_prompt
            )

            if espera_json:
                content = json.dumps({
                    "code": "MOCK-001",
                    "title": "Documento generado en modo demo",
                    "objective": "Objetivo de prueba (modo MOCK_LLM=true).",
                    "scope": "Alcance de prueba.",
                    "responsibilities": "Especialista BPM",
                    "content": "# Modo Demo\nEste contenido es generado sin LLM real.\nConfigure su API key en backend/.env para respuestas reales.",
                    "next_action_es": "Avanzar a la siguiente etapa del proceso.",
                    "findings": [],
                    "metrics": [],
                    "risks_controls": [],
                    "improvement_candidates": [],
                    "alternatives": [],
                    "scenarios": [],
                    "sensitivity": [],
                    "comparison": {"recommended_option_title_es": "Opción base", "rationale_es": "Demo", "recommended_scenario_es": "AS-IS", "interpretation_es": "Demo", "cycle_time_reduction_percent": 0},
                    "executive_summary_es": "Resumen ejecutivo generado en modo demo.",
                    "technical_summary_es": "Resumen técnico generado en modo demo.",
                    "implementation_plan": [],
                    "kpis_es": [],
                    "analysis_score": 75,
                })
            elif (
                any(v in user_lower for v in ("generar", "genera", "crear", "crea", "dibujar", "dibuja", "modelar", "modela"))
                and any(n in user_lower for n in ("bpmn", "diagrama", "xml", "proceso"))
            ):
                content = '<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_Demo" targetNamespace="http://bpmn.io/schema/bpmn">\n  <bpmn:process id="Process_Demo" isExecutable="false" name="Proceso Demo">\n    <bpmn:startEvent id="Start_1" name="Inicio"/>\n    <bpmn:task id="Task_1" name="Actividad 1"/>\n    <bpmn:task id="Task_2" name="Actividad 2"/>\n    <bpmn:endEvent id="End_1" name="Fin"/>\n    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>\n    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Task_2"/>\n    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_2" targetRef="End_1"/>\n  </bpmn:process>\n</bpmn:definitions>'
            else:
                content = (
                    "**Modo Demo** — Agente BPMS respondiendo sin LLM real.\n\n"
                    f"He recibido tu consulta: *\"{user_message[:120]}\"*\n\n"
                    "Para recibir respuestas reales del agente experto, configura al menos una API key en `backend/.env`:\n\n"
                    "| Proveedor | Variable | Dónde obtener |\n"
                    "|---|---|---|\n"
                    "| Gemini | `GEMINI_API_KEY` | aistudio.google.com |\n"
                    "| Groq + Llama 4 | `GROQ_API_KEY` | console.groq.com |\n"
                    "| Deepseek V3 | `DEEPSEEK_API_KEY` | platform.deepseek.com |\n\n"
                    "Luego cambia `MOCK_LLM=false` y reinicia el backend."
                )

            return LLMResponse(content=content, provider="mock_local", model="mock-model", tokens_used=10)

        dispatch = {
            LLMProvider.gemini: self._gemini,
            LLMProvider.gemini_flash: self._gemini_flash,
            LLMProvider.deepseek_api: self._deepseek_api,
            LLMProvider.groq: self._groq,
            LLMProvider.deepseek_local: self._ollama_reasoning,
            LLMProvider.deepseek_coder_local: self._ollama_coder,
            LLMProvider.qwen_local: self._ollama_fast,
        }
        handler = dispatch.get(provider)
        if handler is None:
            raise ValueError(f"Provider desconocido: {provider}")
        return handler(system_prompt, user_message, historial, temperatura)


    def _fallback(
        self,
        failed_provider: LLMProvider,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        original_error: str,
    ) -> LLMResponse:
        """Intenta la cadena de fallback si el provider principal falla.

        Orden de prioridad: Groq (gratis/rápido) → Gemini Flash → Ollama local → Deepseek API.
        Salta los providers en cooldown y prueba como mucho
        _MAX_FALLBACK_ATTEMPTS alternativas.
        """
        # Orden de fallback: Flash primero (más capaz y rápido), luego Groq,
        # luego Pro si los anteriores fallan, por último Ollama offline y Deepseek.
        fallback_order = [
            LLMProvider.gemini_flash,
            LLMProvider.groq,
            LLMProvider.gemini,
            LLMProvider.deepseek_local,
            LLMProvider.deepseek_coder_local,
            LLMProvider.deepseek_api,
        ]
        def configured(p: LLMProvider) -> bool:
            # Sin este filtro los intentos se gastaban en proveedores sin clave
            # (o en un Ollama apagado) y el usuario esperaba para nada.
            if p in (LLMProvider.gemini, LLMProvider.gemini_flash):
                return bool(settings.gemini_api_key)
            if p == LLMProvider.groq:
                return bool(settings.groq_api_key)
            if p == LLMProvider.deepseek_api:
                return bool(settings.deepseek_api_key)
            return self._check_ollama()

        attempts = 0
        # El fallo del proveedor elegido va primero: antes se perdía y el mensaje
        # solo listaba los intentos de respaldo.
        errors: list[str] = [f"{failed_provider}: {original_error[:200]}"]
        for candidate in fallback_order:
            if candidate == failed_provider or not configured(candidate):
                continue
            if _in_cooldown(candidate):
                logger.info("llm.provider_skipped", provider=str(candidate), reason="cooldown")
                continue
            if attempts >= _MAX_FALLBACK_ATTEMPTS:
                break
            attempts += 1
            try:
                logger.info("llm.fallback_attempt", provider=str(candidate))
                result = self._llamar(candidate, system_prompt, user_message, historial, _DEFAULT_TEMP)
                if result.success:
                    logger.info("llm.fallback_ok", provider=str(candidate))
                    return result
                errors.append(f"{candidate}: respuesta vacía")
            except Exception as exc:  # noqa: BLE001
                _note_provider_error(candidate, str(exc))
                logger.warning("llm.fallback_failed", provider=str(candidate), error=str(exc)[:300])
                errors.append(f"{candidate}: {str(exc)[:160]}")

        # Mensaje accionable: el usuario necesita saber QUÉ configurar, no solo
        # que "todo falló".
        if not any((settings.gemini_api_key, settings.groq_api_key, settings.deepseek_api_key)):
            hint = (
                "No hay ninguna API key configurada. Pon USE_MOCK_LLM=true en backend/.env "
                "para el modo demo, o añade GEMINI_API_KEY / GROQ_API_KEY / DEEPSEEK_API_KEY "
                "y reinicia el backend."
            )
        else:
            hint = (
                "Revisa que la API key sea válida y que el nombre del modelo exista "
                "(GEMINI_MODEL / GROQ_MODEL / DEEPSEEK_MODEL en backend/.env)."
            )
        detail = "; ".join(errors[:3]) or original_error
        return LLMResponse(
            content="",
            provider=failed_provider.value,
            model="none",
            error=f"No se pudo obtener respuesta del LLM. {hint} Detalle: {detail}",
        )

    # ── Implementaciones por proveedor ─────────────────────────────────────────

    def _gemini(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        return self._gemini_rest(
            LLMProvider.gemini, settings.gemini_model,
            system_prompt, user_message, historial, temperatura,
        )

    def _gemini_flash(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        return self._gemini_rest(
            LLMProvider.gemini_flash, settings.gemini_flash_model,
            system_prompt, user_message, historial, temperatura,
        )

    def _gemini_rest(
        self,
        provider: LLMProvider,
        model: str,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        """Llama a Gemini por su API REST.

        Antes se usaba el SDK `google-generativeai`, que Google dio por obsoleto.
        Además arrastra dependencias con rutas de archivo muy largas: en Windows,
        dentro de una carpeta algo profunda, `pip install` fallaba por el límite de
        260 caracteres y el asistente se quedaba sin Gemini. La API REST solo
        necesita httpx, que ya es dependencia, y acepta cualquier formato de clave.
        """
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": self._to_gemini_contents(historial, user_message),
            "generationConfig": {"temperature": temperatura, "maxOutputTokens": _GEMINI_MAX_OUTPUT_TOKENS},
        }
        try:
            with httpx.Client(timeout=_GEMINI_TIMEOUT) as client:
                response = client.post(
                    _GEMINI_URL.format(model=model),
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json=payload,
                )
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Gemini {model}: HTTP {response.status_code} — {_gemini_error_message(response)}"
                )
            data: dict[str, Any] = response.json()
        except Exception as exc:
            _note_provider_error(provider, str(exc))
            raise

        candidate = (data.get("candidates") or [{}])[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text:
            reason = (
                candidate.get("finishReason")
                or (data.get("promptFeedback") or {}).get("blockReason")
                or "sin contenido"
            )
            raise RuntimeError(f"Gemini {model}: respuesta vacía ({reason})")
        usage = data.get("usageMetadata") or {}
        return LLMResponse(
            content=text,
            provider=provider.value,
            model=model,
            tokens_used=usage.get("totalTokenCount"),
        )

    def _deepseek_api(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        messages = self._build_openai_messages(system_prompt, historial, user_message)
        with httpx.Client(timeout=_REQUEST_TIMEOUT) as client:
            response = client.post(
                "https://api.deepseek.com/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.deepseek_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.deepseek_model,
                    "messages": messages,
                    "temperature": temperatura,
                    "max_tokens": 4096,
                },
            )
            if response.status_code == 402:
                _cooldown(LLMProvider.deepseek_api, _COOLDOWN_QUOTA_EXHAUSTED, "saldo insuficiente (402)")
                raise RuntimeError("Deepseek API: saldo insuficiente")
            response.raise_for_status()
            data: dict[str, Any] = response.json()
        content: str = data["choices"][0]["message"]["content"]
        usage: dict[str, Any] = data.get("usage", {})
        return LLMResponse(
            content=content,
            provider="deepseek_api",
            model=settings.deepseek_model,
            tokens_used=usage.get("total_tokens"),
        )

    def _groq(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        try:
            from groq import Groq  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError("groq no instalado. Ejecuta: pip install groq") from exc

        client = Groq(api_key=settings.groq_api_key, timeout=50.0)
        messages = self._build_openai_messages(system_prompt, historial, user_message)
        completion = client.chat.completions.create(
            model=settings.groq_model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperatura,
            max_tokens=8192,  # suficiente para XML BPMN completo
        )
        content = completion.choices[0].message.content or ""
        return LLMResponse(
            content=content,
            provider="groq",
            model=settings.groq_model,
            tokens_used=completion.usage.total_tokens if completion.usage else None,
        )

    def _ollama_reasoning(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        return self._ollama_call(
            model=settings.ollama_reasoning_model,
            system_prompt=system_prompt,
            user_message=user_message,
            historial=historial,
            temperatura=temperatura,
            provider_name="deepseek_local",
        )

    def _ollama_coder(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        return self._ollama_call(
            model=settings.ollama_coder_model,
            system_prompt=system_prompt,
            user_message=user_message,
            historial=historial,
            temperatura=temperatura,
            provider_name="deepseek_coder_local",
        )

    def _ollama_fast(
        self,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
    ) -> LLMResponse:
        return self._ollama_call(
            model=settings.ollama_fast_model,
            system_prompt=system_prompt,
            user_message=user_message,
            historial=historial,
            temperatura=temperatura,
            provider_name="qwen_local",
        )

    def _ollama_call(
        self,
        model: str,
        system_prompt: str,
        user_message: str,
        historial: list[dict[str, str]],
        temperatura: float,
        provider_name: str,
    ) -> LLMResponse:
        messages = self._build_openai_messages(system_prompt, historial, user_message)
        with httpx.Client(timeout=_REQUEST_TIMEOUT) as client:
            response = client.post(
                f"{settings.ollama_base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "options": {"temperature": temperatura},
                },
            )
            response.raise_for_status()
            data: dict[str, Any] = response.json()
        content: str = data.get("message", {}).get("content", "")
        return LLMResponse(content=content, provider=provider_name, model=model)

    # ── Helpers de formato ─────────────────────────────────────────────────────

    @staticmethod
    def _build_openai_messages(
        system_prompt: str,
        historial: list[dict[str, str]],
        user_message: str,
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for msg in historial:
            if msg.get("role") in {"user", "assistant"} and msg.get("content"):
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})
        return messages

    @staticmethod
    def _to_gemini_contents(
        historial: list[dict[str, str]],
        user_message: str,
    ) -> list[dict[str, Any]]:
        """Historial OpenAI-style + mensaje actual en el formato `contents` de Gemini."""
        contents: list[dict[str, Any]] = []
        for msg in historial:
            content = msg.get("content", "")
            if content:
                role = "model" if msg.get("role") == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": content}]})
        contents.append({"role": "user", "parts": [{"text": user_message}]})
        return contents

    @staticmethod
    def _check_ollama() -> bool:
        """¿Hay un Ollama local escuchando? Resultado cacheado.

        Antes se sondeaba en CADA construcción del cliente — es decir, en cada
        petición al asistente — añadiendo hasta 2 s de latencia bloqueante a
        quienes no tienen Ollama instalado (el caso mayoritario).
        """
        global _OLLAMA_PROBE
        now = time.monotonic()
        if _OLLAMA_PROBE is not None and now - _OLLAMA_PROBE[0] < _OLLAMA_PROBE_TTL:
            return _OLLAMA_PROBE[1]
        try:
            response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
            available = response.status_code < 500
        except Exception:  # noqa: BLE001 — red caída, DNS, timeout…
            available = False
        _OLLAMA_PROBE = (now, available)
        return available
