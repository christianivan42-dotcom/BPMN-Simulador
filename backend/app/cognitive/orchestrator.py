"""
CognitiveOrchestrator — Planner-Executor maestro del sistema multi-agente.

Flujo por turno:
    1. Recibe query + session_id
    2. Crea / recupera SharedState
    3. Invoca PlannerAgent → genera plan
    4. Ejecuta cada paso del plan en orden (cada agente puede leer hallazgos previos)
    5. Cierra con SynthesisAgent → respuesta integrada
    6. Registra la interacción en EpisodicMemory
    7. Invoca LearningAgent en background (opcional) para consolidar

Patrones:
    - Blackboard Architecture
    - Planner-Executor
    - Hierarchical Multi-Agent
"""
from __future__ import annotations

from app.core.logging import get_logger
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.cognitive.agents.base import AgentContext, AgentResult
from app.cognitive.agents.registry import AGENT_REGISTRY
from app.cognitive.event_bus import EVENT_BUS, EVT_AGENT_COMPLETED, EVT_AGENT_FAILED, EVT_AGENT_INVOKED
from app.cognitive.memory.episodic import EPISODIC_MEMORY
from app.cognitive.memory.organizational import OrganizationalMemory
from app.cognitive.shared_state import SHARED_STATES
from app.graph.factory import get_graph_service
from app.graph.service import KnowledgeGraphService  # used as type annotation below

logger = get_logger(__name__)


@dataclass
class CognitiveResponse:
    session_id: str
    user_query: str
    final_answer: str
    agents_invoked: list[str]
    plan: list[dict[str, Any]]
    findings: list[dict[str, Any]]
    tools_used: list[str]
    blackboard_size: int
    duration_ms: int
    trace: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class CognitiveOrchestrator:
    """
    Master orchestrator — coordinates planner and executors.

    Single entry point: `process_query(session_id, query, db)`.
    """

    def __init__(self) -> None:
        # Ensure all specialized agents are registered
        from app.cognitive.agents.bpmn_agents import register_bpmn_agents
        from app.cognitive.agents.specialized import register_all_agents
        if not AGENT_REGISTRY.names():
            register_all_agents()
            register_bpmn_agents()

    def process_query(
        self,
        session_id: str,
        query: str,
        db: Session,
        process_case_id: str | None = None,
    ) -> CognitiveResponse:
        overall_start = time.time()

        shared_state = SHARED_STATES.get_or_create(session_id)
        org_memory = OrganizationalMemory(db)
        graph = get_graph_service(db)

        # Build node context if invoked from a specific BPM node
        node_ctx_dict: dict[str, Any] | None = None
        if process_case_id:
            from app.cognitive.node_context import build_node_context
            node_ctx_dict = build_node_context(db, process_case_id)
            if node_ctx_dict is not None:
                shared_state.publish(
                    topic="node_context",
                    content=node_ctx_dict,
                    agent="orchestrator",
                    confidence=1.0,
                )

        agents_invoked: list[str] = []
        all_findings: list[dict[str, Any]] = []
        all_tools: list[str] = []
        errors: list[str] = []

        # ── Fase 1: Planning ──────────────────────────────────────────────────
        planner = AGENT_REGISTRY.get("planner")
        if planner is None:
            return CognitiveResponse(
                session_id=session_id, user_query=query,
                final_answer="Sistema cognitivo no inicializado (sin planner).",
                agents_invoked=[], plan=[], findings=[], tools_used=[],
                blackboard_size=0, duration_ms=0, errors=["planner not registered"],
            )
        plan_ctx = self._build_context(
            session_id=session_id, query=query,
            shared_state=shared_state, org_memory=org_memory, graph=graph, db=db,
            process_case_id=process_case_id, node_context=node_ctx_dict,
        )
        plan_ctx.metadata["calling_agent"] = "orchestrator"

        EVENT_BUS.publish(EVT_AGENT_INVOKED, {"agent": "planner", "session": session_id}, source="orchestrator")
        plan_result = self._run(planner, plan_ctx)
        agents_invoked.append("planner")
        all_findings.extend(plan_result.findings)
        if plan_result.error:
            errors.append(f"planner: {plan_result.error}")

        plan_entry = shared_state.latest("plan")
        plan: list[dict[str, Any]] = plan_entry.content if plan_entry else []

        # ── Fase 2: Execute plan ──────────────────────────────────────────────
        for step in plan:
            agent_name = step.get("agent")
            if not agent_name or agent_name == "planner":
                continue
            agent = AGENT_REGISTRY.get(agent_name)
            if agent is None:
                logger.warning("Plan references unknown agent: %s", agent_name)
                errors.append(f"unknown agent: {agent_name}")
                continue

            ctx = self._build_context(
                session_id=session_id, query=query,
                shared_state=shared_state, org_memory=org_memory, graph=graph, db=db,
                plan_step=step,
                process_case_id=process_case_id, node_context=node_ctx_dict,
            )
            ctx.metadata["calling_agent"] = agent_name

            EVENT_BUS.publish(EVT_AGENT_INVOKED, {"agent": agent_name, "step": step.get("step")}, source="orchestrator")
            result = self._run(agent, ctx)
            agents_invoked.append(agent_name)
            all_findings.extend(result.findings)
            all_tools.extend(result.tools_used)
            if result.error:
                errors.append(f"{agent_name}: {result.error}")

        # ── Fase 3: Compose final answer ──────────────────────────────────────
        final_synthesis = shared_state.latest("final_synthesis")
        if final_synthesis:
            final_answer = final_synthesis.content
        else:
            # Fallback if synthesis didn't run
            final_answer = self._fallback_synthesis(shared_state, query)

        duration_ms = int((time.time() - overall_start) * 1000)

        # ── Fase 4: Episodic record ───────────────────────────────────────────
        EPISODIC_MEMORY.create_turn(
            session_id=session_id,
            user_input=query,
            agents_invoked=agents_invoked,
            tools_called=list(set(all_tools)),
            final_response=str(final_answer),
            duration_ms=duration_ms,
            confidence=0.85,
        )

        # ── Fase 5: Persist cognitive context to node (L2 → L3) ─────────────
        if process_case_id:
            try:
                from app.cognitive.session_context_bridge import SessionContextBridge
                SessionContextBridge.extract_and_persist(
                    session_id=session_id,
                    process_case_id=process_case_id,
                    shared_state=shared_state,
                    db=db,
                )
            except Exception as e:
                logger.exception("session_context_bridge failed: %s", e)
                errors.append(f"context_bridge: {e}")

        # ── Fase 6: AI Explainability — persist findings as explanations ────────
        try:
            from app.services import explainability_service
            explainability_service.extract_from_cognitive_response(
                db,
                session_id=session_id,
                process_case_id=process_case_id,
                agents_invoked=agents_invoked,
                findings=all_findings,
            )
        except Exception as e:
            logger.exception("explainability extraction failed: %s", e)
            errors.append(f"explainability: {e}")

        # ── Fase 7: Background learning ──────────────────────────────────────
        learning = AGENT_REGISTRY.get("learning_agent")
        if learning:
            try:
                self._run(learning, plan_ctx)
            except Exception as e:
                logger.exception("learning agent failed: %s", e)

        return CognitiveResponse(
            session_id=session_id,
            user_query=query,
            final_answer=str(final_answer),
            agents_invoked=agents_invoked,
            plan=plan,
            findings=all_findings,
            tools_used=list(set(all_tools)),
            blackboard_size=len(shared_state.all_entries()),
            duration_ms=duration_ms,
            trace=shared_state.get_trace(),
            errors=errors,
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _build_context(
        self,
        *,
        session_id: str,
        query: str,
        shared_state,
        org_memory: OrganizationalMemory,
        graph: KnowledgeGraphService,
        db: Session,
        plan_step: dict[str, Any] | None = None,
        process_case_id: str | None = None,
        node_context: dict[str, Any] | None = None,
    ) -> AgentContext:
        return AgentContext(
            session_id=session_id,
            user_query=query,
            shared_state=shared_state,
            organizational_memory=org_memory,
            event_bus=EVENT_BUS,
            graph=graph,
            db=db,
            plan_step=plan_step,
            process_case_id=process_case_id,
            node_context=node_context,
        )

    def _run(self, agent, ctx: AgentContext) -> AgentResult:
        from app.cognitive.observability import OBSERVABILITY
        try:
            result = agent.execute(ctx)
            EVENT_BUS.publish(
                EVT_AGENT_COMPLETED,
                {"agent": agent.name, "success": result.success, "duration_ms": result.duration_ms},
                source="orchestrator",
            )
            OBSERVABILITY.record_agent(agent.name, result.duration_ms, result.success)
            return result
        except Exception as e:
            logger.exception("Agent %s failed: %s", agent.name, e)
            EVENT_BUS.publish(
                EVT_AGENT_FAILED,
                {"agent": agent.name, "error": str(e)},
                source="orchestrator",
            )
            OBSERVABILITY.record_agent(agent.name, 0, False)
            return AgentResult(
                agent=agent.name, success=False, summary="",
                error=str(e), duration_ms=0,
            )

    @staticmethod
    def _fallback_synthesis(shared_state, query: str) -> str:
        topics = shared_state.topics()
        if not topics:
            return f"Pude entender tu consulta '{query}' pero no se generaron hallazgos. Verifica configuración."
        agents = sorted({e.agent for e in shared_state.all_entries()})
        return (
            f"Consulta procesada: {query}\n\n"
            f"Tópicos cubiertos: {', '.join(sorted(topics))}\n"
            f"Agentes participantes: {', '.join(agents)}"
        )


# Singleton
ORCHESTRATOR = CognitiveOrchestrator()
