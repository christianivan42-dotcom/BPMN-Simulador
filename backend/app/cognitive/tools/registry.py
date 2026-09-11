"""
ToolRegistry — registry of callable tools.

Each Tool has:
    - name, description
    - input_schema (JSON-schema-like dict, optional)
    - runner: callable(args, ctx) -> Any

Tools are stateless — they get a context (DB, graph, etc.) at call time.
"""
from __future__ import annotations

from app.core.logging import get_logger
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from app.cognitive.agents.base import AgentContext

logger = get_logger(__name__)


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    runner: Callable[[dict[str, Any], "AgentContext"], Any]
    category: str = "general"  # graph | memory | analytics | document | general
    cost_estimate: str = "low"  # low | medium | high


@dataclass
class ToolCall:
    tool: str
    args: dict[str, Any]
    started_at: float = field(default_factory=time.time)


@dataclass
class ToolResult:
    tool: str
    success: bool
    output: Any
    duration_ms: int
    error: str | None = None


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}
        self._lock = threading.RLock()

    def register(self, tool: Tool) -> None:
        with self._lock:
            self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        with self._lock:
            return self._tools.get(name)

    def list(self) -> list[Tool]:
        with self._lock:
            return list(self._tools.values())

    def call(self, name: str, args: dict[str, Any], ctx: "AgentContext") -> ToolResult:
        tool = self.get(name)
        if tool is None:
            return ToolResult(tool=name, success=False, output=None, duration_ms=0, error=f"Tool '{name}' no encontrada")
        start = time.time()
        try:
            output = tool.runner(args, ctx)
            duration = int((time.time() - start) * 1000)
            ctx.shared_state.add_trace(
                agent=ctx.metadata.get("calling_agent", "unknown"),
                action="tool_call",
                tool=name,
                args=args,
                success=True,
                duration_ms=duration,
            )
            return ToolResult(tool=name, success=True, output=output, duration_ms=duration)
        except Exception as e:
            duration = int((time.time() - start) * 1000)
            logger.exception("Tool %s failed: %s", name, e)
            ctx.shared_state.add_trace(
                agent=ctx.metadata.get("calling_agent", "unknown"),
                action="tool_call",
                tool=name,
                args=args,
                success=False,
                error=str(e),
                duration_ms=duration,
            )
            return ToolResult(tool=name, success=False, output=None, duration_ms=duration, error=str(e))

    def manifest(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                    "category": t.category,
                    "cost": t.cost_estimate,
                }
                for t in self._tools.values()
            ]


TOOL_REGISTRY = ToolRegistry()
