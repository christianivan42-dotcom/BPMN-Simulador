"""
Specialized Cognitive Agents

Implementación concreta de los agentes que componen el sistema multi-agente.
Cada agente tiene un rol bien acotado y se comunica vía SharedState.

Lista:
    - PlannerAgent: descompone consultas en sub-tareas
    - OrganizationalAgent: comprende estructura jerárquica
    - GraphAgent: navega el knowledge graph
    - KPIAgent: análisis de métricas
    - RiskAgent: detecta riesgos y obsolescencia
    - BottleneckAgent: análisis de cuellos de botella
    - OptimizationAgent: recomienda mejoras
    - InsightsAgent: genera insights ejecutivos
    - MemoryAgent: gestiona recuerdo episódico/semántico
    - DocumentaryAgent: RAG sobre documentos
    - ComplianceAgent: valida contra marcos normativos
    - LearningAgent: refleja y consolida en semantic memory
    - SynthesisAgent: integra hallazgos en respuesta ejecutiva
"""
from __future__ import annotations

import time
from typing import Any

from app.cognitive.agents.base import AgentCapability, AgentContext, AgentResult, BaseAgent
from app.cognitive.tools.registry import TOOL_REGISTRY


# ═══════════════════════════════════════════════════════════════════════════════
# 1. PLANNER — descompone la query del usuario en sub-tareas
# ═══════════════════════════════════════════════════════════════════════════════

class PlannerAgent(BaseAgent):
    name = "planner"
    description = "Descompone la consulta del usuario en un plan de pasos para los agentes ejecutores."
    capabilities = [AgentCapability.TASK_PLANNING, AgentCapability.QUERY_INTENT_CLASSIFICATION]
    keywords = []  # always available — orchestrator invokes it first

    # Mapas de palabras clave → agentes recomendados
    INTENT_HINTS = {
        # BPMN-céntricos
        "levantar":      ["as_is_discovery_agent"],
        "levantamiento": ["as_is_discovery_agent"],
        "as-is":         ["as_is_discovery_agent", "bpmn_interpreter_agent"],
        "asis":          ["as_is_discovery_agent", "bpmn_interpreter_agent"],
        "como funciona": ["as_is_discovery_agent"],
        "interpretar bpmn": ["bpmn_interpreter_agent"],
        "leer bpmn":     ["bpmn_interpreter_agent"],
        "describir diagrama": ["bpmn_interpreter_agent"],
        "analizar bpmn": ["bpmn_analyzer_agent"],
        "analizar diagrama": ["bpmn_analyzer_agent"],
        "loop":          ["bpmn_analyzer_agent"],
        "redundan":      ["bpmn_analyzer_agent"],
        "duplica":       ["bpmn_analyzer_agent"],
        "simular":       ["quantitative_process_agent"],
        "simulación":    ["quantitative_process_agent"],
        "simulacion":    ["quantitative_process_agent"],
        "monte carlo":   ["quantitative_process_agent"],
        "tiempo de ciclo": ["quantitative_process_agent"],
        "throughput":    ["quantitative_process_agent"],
        "utilización":   ["quantitative_process_agent"],
        "utilizacion":   ["quantitative_process_agent"],
        "cola":          ["quantitative_process_agent"],
        "lean":          ["lean_agent"],
        "muda":          ["lean_agent"],
        "desperdicio":   ["lean_agent"],
        "valor agregado": ["lean_agent"],
        "vsm":           ["lean_agent"],
        "kaizen":        ["lean_agent"],
        "six sigma":     ["six_sigma_agent"],
        "sigma":         ["six_sigma_agent"],
        "dmaic":         ["six_sigma_agent"],
        "dpmo":          ["six_sigma_agent"],
        "variabilidad":  ["six_sigma_agent"],
        "ctq":           ["six_sigma_agent"],
        "toc":           ["toc_agent"],
        "restriccion":   ["toc_agent"],
        "restricción":   ["toc_agent"],
        "goldratt":      ["toc_agent"],
        "to-be":         ["to_be_redesign_agent"],
        "tobe":          ["to_be_redesign_agent"],
        "rediseñ":       ["to_be_redesign_agent"],
        "rediseno":      ["to_be_redesign_agent"],
        "futuro":        ["to_be_redesign_agent"],
        "reporte":       ["documentation_agent"],
        "entregable":    ["documentation_agent"],
        "informe":       ["documentation_agent"],
        "consolidar":    ["documentation_agent"],

        # Generales (existentes)
        "kpi":           ["kpi_agent"],
        "métrica":       ["kpi_agent"],
        "metrica":       ["kpi_agent"],
        "indicador":     ["kpi_agent"],
        "cuello":        ["bottleneck_agent", "toc_agent"],
        "bottleneck":    ["bottleneck_agent", "toc_agent"],
        "lento":         ["bottleneck_agent", "kpi_agent"],
        "tiempo":        ["kpi_agent"],
        "riesgo":        ["risk_agent"],
        "control":       ["risk_agent", "compliance_agent"],
        "compliance":    ["compliance_agent"],
        "iso":           ["compliance_agent"],
        "uafe":          ["compliance_agent"],
        "lopdp":         ["compliance_agent"],
        "estructura":    ["organizational_agent"],
        "jerarquía":     ["organizational_agent"],
        "jerarquia":     ["organizational_agent"],
        "macro":         ["organizational_agent"],
        "proceso":       ["organizational_agent"],
        "subproceso":    ["organizational_agent"],
        "procedimiento": ["organizational_agent"],
        "instrucción":   ["organizational_agent"],
        "instruccion":   ["organizational_agent"],
        "relación":      ["graph_agent"],
        "relacion":      ["graph_agent"],
        "depend":        ["graph_agent"],
        "afecta":        ["graph_agent"],
        "mejorar":       ["optimization_agent", "to_be_redesign_agent"],
        "optimizar":     ["optimization_agent", "to_be_redesign_agent"],
        "mejora":        ["optimization_agent"],
        "documento":     ["documentary_agent"],
        "norma":         ["documentary_agent", "compliance_agent"],
        "libro":         ["documentary_agent"],
        "buscar":        ["documentary_agent"],
        "recomenda":     ["optimization_agent", "insights_agent"],
        "insight":       ["insights_agent"],
        "resumen":       ["insights_agent", "synthesis_agent"],
        "anomalía":      ["risk_agent"],
        "anomalia":      ["risk_agent"],
    }

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        query = ctx.user_query.lower()

        # Detectar agentes recomendados
        recommended: list[str] = []
        for kw, agents in self.INTENT_HINTS.items():
            if kw in query:
                for a in agents:
                    if a not in recommended:
                        recommended.append(a)

        # Si no hay match, fallback al organizational + insights
        if not recommended:
            recommended = ["organizational_agent", "insights_agent"]

        # Construir un plan simple: cada agente es un paso
        plan = []
        for i, agent_name in enumerate(recommended):
            plan.append({
                "step": i + 1,
                "agent": agent_name,
                "objective": f"Aportar análisis de {agent_name.replace('_', ' ')} para: {ctx.user_query}",
            })
        # Siempre cerrar con síntesis
        plan.append({
            "step": len(plan) + 1,
            "agent": "synthesis_agent",
            "objective": "Integrar todos los hallazgos en respuesta ejecutiva al usuario.",
        })

        entry_id = self.publish(ctx, topic="plan", content=plan, confidence=0.8)
        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"Plan generado con {len(plan)} pasos.",
            findings=[{"plan": plan}],
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 2. ORGANIZATIONAL — entiende estructura jerárquica de la empresa
# ═══════════════════════════════════════════════════════════════════════════════

class OrganizationalAgent(BaseAgent):
    name = "organizational_agent"
    description = "Comprende y explica la estructura organizacional, jerarquía y dependencias."
    capabilities = [
        AgentCapability.INFO_RETRIEVAL,
        AgentCapability.PROCESS_DISCOVERY,
    ]
    keywords = ["estructura", "jerarquía", "jerarquia", "proceso", "macro", "subproceso", "instrucción"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        result = TOOL_REGISTRY.call("org.process_tree", {}, ctx)
        snapshot = TOOL_REGISTRY.call("org.snapshot", {}, ctx)
        tree = result.output if result.success else {"tree": []}
        snap = snapshot.output if snapshot.success else {}

        # Construir resumen
        total = 0
        by_level: dict[int, int] = {}
        def walk(nodes):
            nonlocal total
            for n in nodes:
                total += 1
                by_level[n["level"] or 0] = by_level.get(n["level"] or 0, 0) + 1
                walk(n.get("children", []))
        walk(tree.get("tree", []))

        summary_text = (
            f"Empresa con {total} nodos en árbol de procesos. "
            f"Distribución: {dict(sorted(by_level.items()))}. "
            f"Documentos: {snap.get('total_documents', 0)}. "
            f"Procesos con análisis obsoleto: {snap.get('stale_count', 0)}."
        )

        entry_id = self.publish(
            ctx,
            topic="organizational_structure",
            content={"summary": summary_text, "tree": tree["tree"], "snapshot": snap},
            confidence=1.0,
        )

        return AgentResult(
            agent=self.name,
            success=True,
            summary=summary_text,
            findings=[{"by_level": by_level, "total": total}],
            blackboard_entries=[entry_id],
            tools_used=["org.process_tree", "org.snapshot"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 3. GRAPH AGENT — traverses the knowledge graph
# ═══════════════════════════════════════════════════════════════════════════════

class GraphAgent(BaseAgent):
    name = "graph_agent"
    description = "Navega el grafo organizacional para identificar relaciones, dependencias y caminos."
    capabilities = [AgentCapability.GRAPH_NAVIGATION]
    keywords = ["relación", "relacion", "depend", "afecta", "conecta", "vincul"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        # Asegurar sincronización del grafo desde process_cases
        synced = ctx.graph.sync_from_process_cases()
        stats = ctx.graph.stats()

        entry_id = self.publish(
            ctx,
            topic="graph_overview",
            content={"stats": stats, "synced_nodes": synced},
        )

        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"Grafo: {stats['total_nodes']} nodos, {stats['total_edges']} edges. {synced} sincronizados.",
            findings=[stats],
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 4. KPI AGENT — métricas y rendimiento
# ═══════════════════════════════════════════════════════════════════════════════

class KPIAgent(BaseAgent):
    name = "kpi_agent"
    description = "Calcula y analiza KPIs operacionales y organizacionales."
    capabilities = [AgentCapability.KPI_ANALYSIS, AgentCapability.QUANTITATIVE_ANALYSIS]
    keywords = ["kpi", "métrica", "metrica", "indicador", "tiempo", "ciclo", "throughput", "sigma", "dpmo"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        # En esta fase, devolvemos un esquema de KPIs aplicables basado en el árbol
        snap = ctx.organizational_memory.snapshot()
        applicable_kpis = [
            {"kpi": "Tiempo de ciclo", "scope": "proceso/subproceso/procedimiento", "unit": "horas"},
            {"kpi": "Tasa de defectos", "scope": "proceso/procedimiento", "unit": "%"},
            {"kpi": "DPMO", "scope": "proceso", "unit": "defectos por millón"},
            {"kpi": "Nivel Sigma", "scope": "proceso", "unit": "σ"},
            {"kpi": "VAR (Valor Agregado Ratio)", "scope": "proceso", "unit": "%"},
            {"kpi": "Throughput", "scope": "proceso", "unit": "unidades/día"},
            {"kpi": "Lead Time", "scope": "proceso", "unit": "días"},
            {"kpi": "OEE", "scope": "proceso", "unit": "%"},
            {"kpi": "Costo por transacción", "scope": "proceso/procedimiento", "unit": "$"},
            {"kpi": "Satisfacción del cliente (NPS/CSAT)", "scope": "proceso", "unit": "puntos"},
        ]
        diag = "KPIs aplicables identificados. Para cálculo real se requieren event logs o tiempos medidos."
        entry_id = self.publish(
            ctx,
            topic="kpi_panel",
            content={"applicable_kpis": applicable_kpis, "available_data": "limitada — falta event log"},
            confidence=0.5,
        )
        return AgentResult(
            agent=self.name,
            success=True,
            summary=diag,
            findings=[{"kpis": applicable_kpis}],
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 5. RISK AGENT — detección de riesgos y obsolescencia
# ═══════════════════════════════════════════════════════════════════════════════

class RiskAgent(BaseAgent):
    name = "risk_agent"
    description = "Detecta riesgos operacionales, anomalías y nodos con análisis obsoleto."
    capabilities = [AgentCapability.RISK_DETECTION]
    keywords = ["riesgo", "anomalía", "anomalia", "control", "fallo", "incidente"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        snapshot = ctx.organizational_memory.snapshot()
        stale = [n for n in snapshot.process_tree if n.get("staleness") and n["staleness"] != "ok"]
        unanalyzed_high = [
            n for n in snapshot.process_tree
            if n.get("analysis_status") == "pendiente" and (n.get("level") or 0) <= 2
        ]
        risks = []
        if stale:
            risks.append({
                "type": "analysis_staleness",
                "severity": "media",
                "count": len(stale),
                "description": f"{len(stale)} nodos con análisis obsoleto que requieren re-evaluación.",
            })
        if unanalyzed_high:
            risks.append({
                "type": "missing_analysis",
                "severity": "alta",
                "count": len(unanalyzed_high),
                "description": f"{len(unanalyzed_high)} procesos críticos (N1-N2) sin análisis iniciado.",
            })

        entry_id = self.publish(
            ctx,
            topic="risks",
            content={"risks": risks, "stale_nodes": [n["name"] for n in stale[:10]]},
            confidence=0.7,
        )
        summary = (
            f"Detectados {len(risks)} riesgo(s) sistémicos. "
            f"Obsoletos: {len(stale)}. Sin analizar (críticos): {len(unanalyzed_high)}."
        )
        return AgentResult(
            agent=self.name,
            success=True,
            summary=summary,
            findings=risks,
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 6. BOTTLENECK AGENT
# ═══════════════════════════════════════════════════════════════════════════════

class BottleneckAgent(BaseAgent):
    name = "bottleneck_agent"
    description = "Identifica cuellos de botella en el árbol de procesos."
    capabilities = [AgentCapability.BOTTLENECK_DETECTION]
    keywords = ["cuello", "bottleneck", "lento", "demora", "retraso", "espera"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        result = TOOL_REGISTRY.call("bottleneck.detect", {}, ctx)
        data = result.output if result.success else {"candidates": []}
        entry_id = self.publish(
            ctx,
            topic="bottlenecks",
            content=data,
            confidence=0.6,
        )
        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"Candidatos a cuello de botella: {data.get('candidates_count', 0)}.",
            findings=[data],
            blackboard_entries=[entry_id],
            tools_used=["bottleneck.detect"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 7. OPTIMIZATION AGENT
# ═══════════════════════════════════════════════════════════════════════════════

class OptimizationAgent(BaseAgent):
    name = "optimization_agent"
    description = "Recomienda metodologías y optimizaciones según los hallazgos de otros agentes."
    capabilities = [AgentCapability.OPTIMIZATION, AgentCapability.METHODOLOGY_SELECTION]
    keywords = ["mejor", "optimi", "rediseñ", "to-be", "mejora"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        # Leer el blackboard para basarse en hallazgos previos
        risks = ctx.shared_state.latest("risks")
        bottlenecks = ctx.shared_state.latest("bottlenecks")

        recommendations = []
        # Reglas simples basadas en el clásico selector Lean/Six Sigma/TOC
        if bottlenecks and bottlenecks.content.get("candidates_count", 0) > 0:
            recommendations.append({
                "methodology": "Teoría de Restricciones (TOC)",
                "rationale": "Hay cuellos de botella sistémicos detectados — aplicar los 5 pasos de Goldratt.",
                "first_actions": [
                    "Identificar la restricción principal",
                    "Explotar la restricción al máximo",
                    "Subordinar todo lo demás a la restricción",
                ],
            })
        if risks and len(risks.content.get("risks", [])) > 0:
            recommendations.append({
                "methodology": "Six Sigma DMAIC + Gestión de Riesgos",
                "rationale": "Hay riesgos sistémicos — reducir variabilidad y establecer controles.",
                "first_actions": [
                    "Definir alcance del proyecto Six Sigma",
                    "Medir baseline de variabilidad",
                    "FMEA por nodo crítico",
                ],
            })
        if not recommendations:
            recommendations.append({
                "methodology": "Lean / Kaizen",
                "rationale": "Sin hallazgos críticos previos — enfocar en eliminación de desperdicios (8 mudas).",
                "first_actions": ["VSM por proceso primario", "Identificación de las 8 mudas"],
            })

        entry_id = self.publish(
            ctx,
            topic="optimization_recommendations",
            content={"recommendations": recommendations},
            confidence=0.7,
        )
        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"Recomendaciones generadas: {len(recommendations)} metodología(s).",
            findings=recommendations,
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 8. INSIGHTS AGENT
# ═══════════════════════════════════════════════════════════════════════════════

class InsightsAgent(BaseAgent):
    name = "insights_agent"
    description = "Genera insights ejecutivos a partir de todos los hallazgos del blackboard."
    capabilities = [AgentCapability.EXECUTIVE_SYNTHESIS]
    keywords = ["insight", "resumen", "executivo"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        # Combinar todos los hallazgos del blackboard en insights breves
        entries = ctx.shared_state.all_entries()
        if not entries:
            return AgentResult(
                agent=self.name, success=True,
                summary="Sin hallazgos previos para generar insights.",
                duration_ms=int((time.time() - start) * 1000),
            )

        insights = []
        for e in entries:
            if e.topic in ("organizational_structure", "risks", "bottlenecks", "optimization_recommendations"):
                insights.append({
                    "topic": e.topic,
                    "agent": e.agent,
                    "key_point": (
                        e.content.get("summary") if isinstance(e.content, dict) and "summary" in e.content
                        else str(e.content)[:300]
                    ),
                })
        entry_id = self.publish(ctx, topic="insights", content={"insights": insights}, confidence=0.8)
        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"{len(insights)} insights consolidados desde el blackboard.",
            findings=insights,
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 9. MEMORY AGENT
# ═══════════════════════════════════════════════════════════════════════════════

class MemoryAgent(BaseAgent):
    name = "memory_agent"
    description = "Recupera memoria episódica y semántica relevante para la query."
    capabilities = [AgentCapability.MEMORY_RECALL]
    keywords = ["recordar", "antes", "anterior", "pasado", "histori"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        recent = TOOL_REGISTRY.call("memory.episodic.recent", {"n": 5}, ctx)
        semantic = TOOL_REGISTRY.call(
            "memory.semantic.search",
            {"terms": ctx.user_query.lower().split()[:5]},
            ctx,
        )
        recalled = {
            "recent_turns": recent.output.get("turns", []) if recent.success else [],
            "learned_facts": semantic.output.get("facts", []) if semantic.success else [],
        }
        entry_id = self.publish(ctx, topic="memory_recall", content=recalled, confidence=0.9)
        return AgentResult(
            agent=self.name,
            success=True,
            summary=(
                f"Recordados {len(recalled['recent_turns'])} turnos recientes "
                f"y {len(recalled['learned_facts'])} hechos aprendidos."
            ),
            findings=[recalled],
            blackboard_entries=[entry_id],
            tools_used=["memory.episodic.recent", "memory.semantic.search"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 10. DOCUMENTARY AGENT — RAG over documents
# ═══════════════════════════════════════════════════════════════════════════════

class DocumentaryAgent(BaseAgent):
    name = "documentary_agent"
    description = "Búsqueda RAG sobre la base de conocimiento documental (libros, normas, políticas)."
    capabilities = [AgentCapability.DOCUMENT_QA, AgentCapability.INFO_RETRIEVAL]
    keywords = ["documento", "libro", "norma", "iso", "política", "buscar", "qué dice"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        result = TOOL_REGISTRY.call("rag.search", {"query": ctx.user_query, "top_k": 5}, ctx)
        fragments = result.output.get("fragments", []) if result.success else []
        entry_id = self.publish(
            ctx,
            topic="documentary_evidence",
            content={"fragments": fragments[:5]},
            confidence=0.7,
        )
        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"Encontradas {len(fragments)} evidencias documentales relevantes.",
            findings=fragments,
            blackboard_entries=[entry_id],
            tools_used=["rag.search"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 11. COMPLIANCE AGENT — multi-framework validation
# ═══════════════════════════════════════════════════════════════════════════════

class ComplianceAgent(BaseAgent):
    name = "compliance_agent"
    description = "Valida procesos contra marcos normativos (ISO 9001, UAFE, LOPDP, COSO)."
    capabilities = [AgentCapability.COMPLIANCE_CHECK]
    keywords = ["iso", "uafe", "lopdp", "compliance", "norma", "cumplimiento", "regulación", "regulacion"]

    FRAMEWORKS = {
        "ISO 9001": "Sistema de gestión de calidad — requiere documentación, control de cambios, auditorías.",
        "UAFE": "Ecuador antilavado — requiere PEPs, debida diligencia, reporte de operaciones sospechosas.",
        "LOPDP": "Ecuador protección de datos — requiere base legal, consentimiento, registro de tratamientos.",
        "COSO": "Control interno — requiere matriz de riesgos, controles, monitoreo.",
        "ITIL": "Gestión de servicios TI — requiere catálogo, SLAs, gestión de cambios.",
    }

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        q = ctx.user_query.lower()
        relevant = []
        for name, desc in self.FRAMEWORKS.items():
            if name.lower() in q or any(k in q for k in name.lower().split()):
                relevant.append({"framework": name, "description": desc})
        if not relevant:
            # Default coverage list
            relevant = [{"framework": name, "description": desc} for name, desc in self.FRAMEWORKS.items()]
        entry_id = self.publish(
            ctx,
            topic="compliance_check",
            content={"applicable_frameworks": relevant},
            confidence=0.85,
        )
        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"Marcos aplicables identificados: {len(relevant)}.",
            findings=relevant,
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 12. LEARNING AGENT — reflects and consolidates
# ═══════════════════════════════════════════════════════════════════════════════

class LearningAgent(BaseAgent):
    name = "learning_agent"
    description = "Refleja sobre la sesión y consolida patrones en memoria semántica."
    capabilities = [AgentCapability.LEARNING]
    keywords = []
    needs_org_context = False

    def execute(self, ctx: AgentContext) -> AgentResult:
        from app.cognitive.memory.semantic import SEMANTIC_MEMORY
        start = time.time()

        # Heurística: si la sesión usó varios agentes y produjo recomendaciones,
        # generar una nota de patrón.
        entries = ctx.shared_state.all_entries()
        agents_involved = {e.agent for e in entries}
        learned = 0
        if len(agents_involved) >= 3 and any(e.topic == "optimization_recommendations" for e in entries):
            fact = SEMANTIC_MEMORY.add(
                statement=(
                    f"Consultas tipo '{ctx.user_query[:80]}' suelen requerir colaboración entre "
                    f"{', '.join(sorted(agents_involved))}."
                ),
                topic="query_pattern",
                confidence=0.5,
                tags=list(agents_involved),
            )
            learned = 1
        return AgentResult(
            agent=self.name,
            success=True,
            summary=f"Aprendizaje: {learned} nuevo(s) patrón(es) consolidado(s).",
            findings=[{"learned": learned}],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 13. SYNTHESIS AGENT — produces the final user-facing answer
# ═══════════════════════════════════════════════════════════════════════════════

class SynthesisAgent(BaseAgent):
    name = "synthesis_agent"
    description = "Integra todos los hallazgos del blackboard en una respuesta ejecutiva al usuario."
    capabilities = [AgentCapability.EXECUTIVE_SYNTHESIS]
    keywords = []
    needs_org_context = True

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        entries = ctx.shared_state.all_entries()

        # Construir respuesta estructurada en markdown
        sections: list[str] = []
        sections.append(f"### Respuesta a tu consulta\n> {ctx.user_query}\n")

        # 1. Estructura Organizacional
        org = ctx.shared_state.latest("organizational_structure")
        if org and isinstance(org.content, dict):
            sections.append(f"**Contexto organizacional:** {org.content.get('summary', '-')}\n")

        # 2. Guía de Levantamiento AS-IS (Discovery)
        discovery = ctx.shared_state.latest("discovery_scaffold")
        if discovery and isinstance(discovery.content, dict):
            sections.append("\n**📋 Guía de Levantamiento AS-IS (Discovery):**")
            sipoc = discovery.content.get("sipoc_template")
            if sipoc:
                sections.append(f"- **Plantilla SIPOC propuesta** para el proceso: *{sipoc.get('process_name', 'Proceso')}*")
            questions = discovery.content.get("questions", [])
            if questions:
                sections.append("- **Preguntas de descubrimiento recomendadas:**")
                for q in questions[:10]:
                    sections.append(f"  - {q}")
            next_step = discovery.content.get("next_step")
            if next_step:
                sections.append(f"- **Próximo paso de levantamiento:** {next_step}")

        # 3. Interpretación de BPMN
        bpmn_interp = ctx.shared_state.latest("bpmn_interpretation")
        if bpmn_interp and isinstance(bpmn_interp.content, dict):
            sections.append(f"\n**🔍 Interpretación de BPMN (Proceso: '{bpmn_interp.content.get('process_name', '-')}')**")
            stats = bpmn_interp.content.get("stats", {})
            sections.append(f"- **Estructura del diagrama:** {stats.get('tasks', 0)} tareas, {stats.get('gateways', 0)} compuertas (gateways), {stats.get('events', 0)} eventos, y {stats.get('total_flows', 0)} flujos de secuencia.")
            pools = bpmn_interp.content.get("pools", [])
            if pools:
                sections.append(f"- **Carriles / Pools identificados:** {', '.join(pools)}")

        # 4. Hallazgos del Análisis BPMN
        bpmn_findings = ctx.shared_state.latest("bpmn_findings")
        if bpmn_findings and isinstance(bpmn_findings.content, dict):
            sections.append("\n**⚠️ Hallazgos del Análisis BPMN:**")
            counts = bpmn_findings.content.get("severity_counts", {})
            sections.append(f"- **Resumen de alertas:** {counts.get('error', 0)} errores, {counts.get('warning', 0)} advertencias, {counts.get('info', 0)} notificaciones informativas.")
            findings = bpmn_findings.content.get("findings", [])
            if findings:
                sections.append("- **Alertas clave detectadas:**")
                for f in findings[:5]:
                    sections.append(f"  - **[{f.get('severity', 'info').upper()}]** {f.get('title')}: {f.get('detail', '')}")

        # 5. Análisis Cuantitativo y Simulación
        quant = ctx.shared_state.latest("quantitative_analysis")
        if quant and isinstance(quant.content, dict):
            sections.append("\n**📊 Análisis Cuantitativo y Simulación (Monte Carlo):**")
            sim = quant.content.get("simulation", {})
            if isinstance(sim, dict) and "mean_cycle_time" in sim:
                unit = sim.get("time_unit", "minutos")
                sections.append(
                    f"- **Tiempo de ciclo medio simulado:** {sim.get('mean_cycle_time')} {unit} "
                    f"(p5: {sim.get('p5_cycle_time')}, p95: {sim.get('p95_cycle_time')})"
                )
                sections.append(f"- **Variabilidad:** Desviación estándar de {sim.get('stdev_cycle_time')} {unit} (basado en {sim.get('iterations')} iteraciones).")
            paths = quant.content.get("paths", {})
            if isinstance(paths, dict) and paths.get("items"):
                sections.append(f"- **Rutas alternativas:** {paths.get('total', 0)} caminos de ejecución modelados.")

        # 6. Riesgos y obsolescencia
        risks = ctx.shared_state.latest("risks")
        if risks and isinstance(risks.content, dict) and risks.content.get("risks"):
            sections.append("\n**⚡️ Riesgos detectados:**")
            for r in risks.content["risks"]:
                sections.append(f"- {r.get('description')} (severidad: {r.get('severity')})")

        # 7. Cuellos de botella
        bn = ctx.shared_state.latest("bottlenecks")
        if bn and isinstance(bn.content, dict) and bn.content.get("candidates_count", 0) > 0:
            sections.append(f"\n**🐢 Cuellos de botella candidatos:** {bn.content['candidates_count']}")

        # 8. Análisis Lean (Mudas)
        lean = ctx.shared_state.latest("lean_analysis")
        if lean and isinstance(lean.content, dict):
            sections.append(f"\n**🌱 Análisis Lean (Mudas / Desperdicios):**")
            sections.append(f"- **Mudas detectadas:** {lean.content.get('muda_count', 0)} desperdicios en el flujo.")
            mudas = lean.content.get("mudas", [])
            if mudas:
                for m in mudas[:5]:
                    sections.append(f"  - **[{m.get('severity').upper()}] {m.get('type')}**: {m.get('description')} → *Acción sugerida:* {m.get('recommendation')}")

        # 9. Análisis Six Sigma
        six_sigma = ctx.shared_state.latest("six_sigma_analysis")
        if six_sigma and isinstance(six_sigma.content, dict):
            sections.append("\n**📈 Análisis Six Sigma DMAIC:**")
            dpmo = six_sigma.content.get("dpmo_result")
            if dpmo:
                sections.append(f"- **DPMO (Defectos por Millón):** {dpmo.get('dpmo')} (Rendimiento: {dpmo.get('yield_pct')}%)")
                sections.append(f"- **Nivel Sigma del Proceso:** {dpmo.get('sigma_level')}σ")
            rec = six_sigma.content.get("recommendation")
            if rec:
                sections.append(f"- **Recomendación DMAIC:** {rec}")

        # 10. Teoría de Restricciones (TOC)
        toc = ctx.shared_state.latest("toc_analysis")
        if toc and isinstance(toc.content, dict):
            sections.append("\n**🎯 Teoría de Restricciones (TOC):**")
            cands = toc.content.get("candidates", [])
            if cands:
                sections.append("- **Restricciones potenciales identificadas:**")
                for c in cands[:3]:
                    sections.append(f"  - **{c.get('name')}**: {c.get('reason')}")
            rec = toc.content.get("recommendation")
            if rec:
                sections.append(f"- **Acción de mejora TOC:** {rec}")

        # 11. KPIs aplicables
        kpi = ctx.shared_state.latest("kpi_panel")
        if kpi and isinstance(kpi.content, dict):
            sections.append(f"\n**📈 KPIs recomendados:** {len(kpi.content.get('applicable_kpis', []))} métricas clave.")

        # 12. Cumplimiento regulatorio
        comp = ctx.shared_state.latest("compliance_check")
        if comp and isinstance(comp.content, dict):
            fws = [f["framework"] for f in comp.content.get("applicable_frameworks", [])]
            if fws:
                sections.append(f"**Marcos normativos de cumplimiento:** {', '.join(fws)}")

        # 13. Evidencia documental RAG
        docs = ctx.shared_state.latest("documentary_evidence")
        if docs and isinstance(docs.content, dict) and docs.content.get("fragments"):
            sections.append(f"\n**📚 Evidencia documental:** {len(docs.content['fragments'])} fragmentos relevantes en base documental.")

        # 14. Recomendaciones generales de optimización
        opt = ctx.shared_state.latest("optimization_recommendations")
        if opt and isinstance(opt.content, dict) and opt.content.get("recommendations"):
            sections.append("\n**💡 Recomendaciones metodológicas:**")
            for rec in opt.content["recommendations"]:
                sections.append(f"- **{rec.get('methodology')}**: {rec.get('rationale')}")

        # 15. Rediseño TO-BE
        tobe = ctx.shared_state.latest("to_be_proposal")
        if tobe and isinstance(tobe.content, dict):
            sections.append("\n**✨ Propuesta de Rediseño TO-BE:**")
            changes = tobe.content.get("proposed_changes", [])
            if changes:
                sections.append("- **Optimizaciones a incorporar:**")
                for c in changes[:5]:
                    if c.get("source") == "Lean":
                         sections.append(f"  - *[Lean]* Eliminar muda de {c.get('muda')} en '{', '.join(c.get('affected_nodes', []))}': {c.get('action')}")
                    elif c.get("source") == "TOC":
                         sections.append(f"  - *[TOC]* Corregir restricción en '{c.get('node')}': {c.get('action')}")
                    else:
                         sections.append(f"  - *[{c.get('source')}]* {c.get('action')}")
            next_actions = tobe.content.get("next_actions", [])
            if next_actions:
                sections.append("- **Siguientes pasos recomendados:**")
                for a in next_actions:
                    sections.append(f"  - {a}")

        # 16. Reporte ejecutivo consolidado
        exec_doc = ctx.shared_state.latest("executive_document")
        if exec_doc and isinstance(exec_doc.content, str):
            sections.append(f"\n\n---\n## 📄 Reporte Ejecutivo BPM Consolidado\n{exec_doc.content}")

        # 17. Insights consolidados
        ins = ctx.shared_state.latest("insights")
        if ins and isinstance(ins.content, dict) and ins.content.get("insights"):
            sections.append(f"\n**💡 Insights consolidados:** {len(ins.content['insights'])} conclusiones clave en la pizarra.")

        agents_involved = sorted({e.agent for e in entries})
        sections.append(f"\n---\n*Agentes que colaboraron en este análisis: {', '.join(agents_involved)}*")

        synthesis_text = "\n".join(sections)
        entry_id = self.publish(ctx, topic="final_synthesis", content=synthesis_text, confidence=1.0)

        return AgentResult(
            agent=self.name,
            success=True,
            summary=synthesis_text,
            blackboard_entries=[entry_id],
            duration_ms=int((time.time() - start) * 1000),
        )


# ── Registration ─────────────────────────────────────────────────────────────

def register_all_agents() -> None:
    from app.cognitive.agents.registry import AGENT_REGISTRY
    for agent_cls in [
        PlannerAgent,
        OrganizationalAgent,
        GraphAgent,
        KPIAgent,
        RiskAgent,
        BottleneckAgent,
        OptimizationAgent,
        InsightsAgent,
        MemoryAgent,
        DocumentaryAgent,
        ComplianceAgent,
        LearningAgent,
        SynthesisAgent,
    ]:
        AGENT_REGISTRY.register(agent_cls)
