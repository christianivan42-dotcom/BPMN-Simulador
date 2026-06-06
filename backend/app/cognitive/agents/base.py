"""
BaseAgent — abstract base for all cognitive agents.

Every specialized agent implements `execute(context) -> AgentResult`.
The orchestrator invokes agents with a shared context object that gives access to:
    - SharedState (blackboard)
    - Memory (episodic + semantic + organizational)
    - EventBus
    - ToolRegistry
    - KnowledgeGraphService
    - LLMClientService (for agents that need a language model)
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from app.cognitive.shared_state import SharedState
    from app.cognitive.memory.organizational import OrganizationalMemory
    from app.cognitive.event_bus import EventBus
    from app.graph.service import KnowledgeGraphService
    from sqlalchemy.orm import Session


class AgentCapability(StrEnum):
    """Tagged capabilities an agent declares — used by the orchestrator to plan."""
    QUERY_INTENT_CLASSIFICATION = "query_intent_classification"
    TASK_PLANNING = "task_planning"
    INFO_RETRIEVAL = "info_retrieval"
    GRAPH_NAVIGATION = "graph_navigation"
    QUANTITATIVE_ANALYSIS = "quantitative_analysis"
    QUALITATIVE_ANALYSIS = "qualitative_analysis"
    KPI_ANALYSIS = "kpi_analysis"
    RISK_DETECTION = "risk_detection"
    BOTTLENECK_DETECTION = "bottleneck_detection"
    OPTIMIZATION = "optimization"
    DOCUMENT_QA = "document_qa"
    MEMORY_RECALL = "memory_recall"
    LEARNING = "learning"
    COMPLIANCE_CHECK = "compliance_check"
    EXECUTIVE_SYNTHESIS = "executive_synthesis"
    METHODOLOGY_SELECTION = "methodology_selection"
    PROCESS_DISCOVERY = "process_discovery"
    SIMULATION = "simulation"
    BPMN_MODELING = "bpmn_modeling"
    TO_BE_DESIGN = "to_be_design"


@dataclass
class AgentContext:
    """Everything an agent needs to execute. Built by the orchestrator per turn."""
    session_id: str
    user_query: str
    shared_state: "SharedState"
    organizational_memory: "OrganizationalMemory"
    event_bus: "EventBus"
    graph: "KnowledgeGraphService"
    db: "Session"
    plan_step: dict[str, Any] | None = None  # optional: planner's instructions
    # BPM node context — if the AI Workspace was invoked from a specific BPM node,
    # the orchestrator pre-loads the node + parent chain + BPMN xml for agents.
    process_case_id: str | None = None
    node_context: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentResult:
    """Standard output contract for any agent execution."""
    agent: str
    success: bool
    summary: str  # 1-3 sentence summary of what the agent produced
    findings: list[dict[str, Any]] = field(default_factory=list)
    blackboard_entries: list[str] = field(default_factory=list)  # IDs of published entries
    tools_used: list[str] = field(default_factory=list)
    confidence: float = 1.0
    error: str | None = None
    duration_ms: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    """Base class — concrete agents implement `execute()`."""

    name: str = "base"
    description: str = "Agente base abstracto"
    capabilities: list[AgentCapability] = []
    # Routing hints for the planner (keywords that activate this agent)
    keywords: list[str] = []
    # If True, the orchestrator will inject organizational memory into the context_brief
    needs_org_context: bool = True

    @abstractmethod
    def execute(self, ctx: AgentContext) -> AgentResult:
        """Run the agent's work. Must return an AgentResult."""
        raise NotImplementedError

    # ── Helpers for subclasses ────────────────────────────────────────────────

    def publish(
        self,
        ctx: AgentContext,
        topic: str,
        content: Any,
        *,
        confidence: float = 1.0,
        related: list[str] | None = None,
    ) -> str:
        """Publish a finding to the blackboard and return its entry id."""
        entry = ctx.shared_state.publish(
            topic=topic,
            content=content,
            agent=self.name,
            confidence=confidence,
            related=related,
        )
        return entry.id

    def matches(self, query: str) -> int:
        """Score how relevant this agent is for a query (keyword overlap)."""
        ql = query.lower()
        return sum(1 for kw in self.keywords if kw in ql)
