"""
Specialized cognitive agents.

Each agent:
    - has a unique name and capability set
    - inherits from BaseAgent
    - declares input/output contract via Pydantic
    - is registered in AgentRegistry
    - can read from SharedState and publish findings to it
    - can call Tools from the ToolRegistry
"""
from app.cognitive.agents.base import BaseAgent, AgentResult, AgentCapability
from app.cognitive.agents.registry import AGENT_REGISTRY, AgentRegistry

__all__ = ["BaseAgent", "AgentResult", "AgentCapability", "AGENT_REGISTRY", "AgentRegistry"]
