"""
Cognitive Layer — Enterprise Organizational Cognitive Operating System.

Architecture:
    - SharedState (Blackboard): cognitive state shared across agents
    - Memory: 3-tier system (episodic, semantic, organizational)
    - EventBus: in-process pub-sub for cross-agent reactivity
    - AgentRegistry: registry of specialized agents
    - Orchestrator: planner-executor that coordinates agents
    - Tools: registry of cognitive tools agents can invoke
    - Graph: organizational knowledge graph
    - Analytics: KPI, bottleneck, anomaly engines

External experience: one unified AI — internally: multi-agent collaboration.
"""

from app.cognitive.shared_state import SharedState, BlackboardEntry
from app.cognitive.event_bus import EventBus, CognitiveEvent

__all__ = ["SharedState", "BlackboardEntry", "EventBus", "CognitiveEvent"]
