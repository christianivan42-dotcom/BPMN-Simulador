"""
Cognitive Tools — callable capabilities agents can invoke.

Pattern: tools are pure functions wrapped in a Tool object that declares
its name, description, JSON-schema for input, and a runner.

Tools can: query graph, query metrics, fetch documents, search memory, etc.

Each tool call is recorded in the SharedState trace for observability.
"""
from app.cognitive.tools.registry import Tool, ToolRegistry, TOOL_REGISTRY, ToolCall, ToolResult
from app.cognitive.tools import core_tools as _core_tools  # noqa: F401  - registers tools
from app.cognitive.tools import bpmn_tools as _bpmn_tools  # noqa: F401  - registers BPMN tools

__all__ = ["Tool", "ToolRegistry", "TOOL_REGISTRY", "ToolCall", "ToolResult"]
