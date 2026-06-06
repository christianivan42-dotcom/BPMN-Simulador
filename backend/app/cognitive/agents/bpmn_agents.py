"""
BPMN-centric specialized agents.

These agents reason on BPMN 2.0 process graphs and use:
    - bpmn_intel/  (parser, analyzer, paths)
    - simulation/  (Monte Carlo, M/M/c)
    - methodologies/ (Lean, Six Sigma, TOC, qualitative)

Agents:
    - AsIsDiscoveryAgent: conversational levantamiento
    - BpmnInterpreterAgent: parses + summarizes a given BPMN
    - BpmnAnalyzerAgent: detects loops/redundancies/etc.
    - QuantitativeProcessAgent: cycle times, throughput, queue theory
    - LeanAgent: 8 mudas + VSM
    - SixSigmaAgent: DMAIC framework + DPMO/sigma
    - TocAgent: constraint identification + 5 steps
    - ToBeRedesignAgent: combines findings → TO-BE proposal
    - DocumentationAgent: executive deliverable
"""
from __future__ import annotations

import time
from typing import Any

from app.cognitive.agents.base import AgentCapability, AgentContext, AgentResult, BaseAgent
from app.cognitive.tools.registry import TOOL_REGISTRY


# ── Helper to fetch BPMN XML from context ────────────────────────────────────

def _get_bpmn_xml(ctx: AgentContext) -> str | None:
    """Get BPMN XML from working memory, blackboard, or metadata."""
    xml = ctx.shared_state.get_working("bpmn_xml")
    if xml:
        return xml
    if ctx.metadata.get("bpmn_xml"):
        return ctx.metadata["bpmn_xml"]
    if ctx.plan_step and ctx.plan_step.get("bpmn_xml"):
        return ctx.plan_step["bpmn_xml"]
    return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. AsIsDiscoveryAgent
# ═════════════════════════════════════════════════════════════════════════════

class AsIsDiscoveryAgent(BaseAgent):
    name = "as_is_discovery_agent"
    description = "Levantamiento AS-IS conversacional: identifica actores, actividades, decisiones, eventos."
    capabilities = [
        AgentCapability.PROCESS_DISCOVERY,
        AgentCapability.INFO_RETRIEVAL,
    ]
    keywords = ["levantar", "levantamiento", "as-is", "asis", "actual", "describir proceso", "como funciona"]

    DISCOVERY_QUESTIONS = [
        "¿Cuál es el evento o trigger que inicia el proceso?",
        "¿Cuáles son los actores involucrados y qué rol tiene cada uno?",
        "¿Qué áreas o departamentos participan?",
        "¿Cuáles son las actividades principales en orden secuencial?",
        "¿Hay puntos de decisión donde el flujo puede tomar caminos distintos?",
        "¿Existen actividades paralelas que ocurren al mismo tiempo?",
        "¿Qué sistemas o herramientas se usan en cada actividad?",
        "¿Qué documentos se generan o se consumen?",
        "¿Cuál es la salida final (output) y para quién?",
        "¿Cuáles son las excepciones o casos especiales más frecuentes?",
        "¿Qué KPIs miden hoy este proceso (si los hay)?",
        "¿Cuánto tarda en promedio cada actividad?",
    ]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        # Build a SIPOC scaffold + suggested questions
        from app.methodologies.qualitative import SIPOC
        sipoc = SIPOC(process_name=ctx.metadata.get("process_name", "Proceso a levantar"))
        entry = self.publish(ctx, topic="discovery_scaffold", content={
            "sipoc_template": sipoc.to_dict(),
            "questions": self.DISCOVERY_QUESTIONS,
            "next_step": "Iniciar entrevista con stakeholder responsable del proceso",
        })
        return AgentResult(
            agent=self.name,
            success=True,
            summary=(
                f"Generado scaffold SIPOC + {len(self.DISCOVERY_QUESTIONS)} preguntas guía "
                f"para levantamiento AS-IS."
            ),
            findings=[{"questions": self.DISCOVERY_QUESTIONS}],
            blackboard_entries=[entry],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 2. BpmnInterpreterAgent
# ═════════════════════════════════════════════════════════════════════════════

class BpmnInterpreterAgent(BaseAgent):
    name = "bpmn_interpreter_agent"
    description = "Interpreta un BPMN 2.0: extrae estructura, actores, decisiones, eventos."
    capabilities = [AgentCapability.BPMN_MODELING, AgentCapability.INFO_RETRIEVAL]
    keywords = ["interpret", "leer bpmn", "explicar bpmn", "estructura del proceso", "describir diagrama"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        xml = _get_bpmn_xml(ctx)
        if not xml:
            return AgentResult(
                agent=self.name, success=False,
                summary="No hay BPMN XML disponible para interpretar.",
                error="missing bpmn_xml",
                duration_ms=int((time.time() - start) * 1000),
            )
        result = TOOL_REGISTRY.call("bpmn.parse", {"xml": xml}, ctx)
        if not result.success:
            return AgentResult(
                agent=self.name, success=False,
                summary="Error parseando BPMN", error=result.error,
                duration_ms=int((time.time() - start) * 1000),
            )
        data = result.output
        stats = data["stats"]
        summary = (
            f"Proceso '{data['process_name']}': "
            f"{stats['tasks']} tareas, {stats['gateways']} gateways, "
            f"{stats['events']} eventos, {stats['total_flows']} flujos."
        )
        entry = self.publish(ctx, topic="bpmn_interpretation", content=data)
        return AgentResult(
            agent=self.name, success=True, summary=summary,
            findings=[data], blackboard_entries=[entry],
            tools_used=["bpmn.parse"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 3. BpmnAnalyzerAgent
# ═════════════════════════════════════════════════════════════════════════════

class BpmnAnalyzerAgent(BaseAgent):
    name = "bpmn_analyzer_agent"
    description = "Analiza BPMN: detecta loops, dead-ends, cadenas de aprobación, redundancias."
    capabilities = [
        AgentCapability.BPMN_MODELING,
        AgentCapability.QUALITATIVE_ANALYSIS,
        AgentCapability.BOTTLENECK_DETECTION,
    ]
    keywords = ["analiz", "detect", "bpmn", "loop", "redundan", "duplica", "cuello"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        xml = _get_bpmn_xml(ctx)
        if not xml:
            return AgentResult(
                agent=self.name, success=False,
                summary="No hay BPMN XML disponible para analizar.",
                error="missing bpmn_xml",
                duration_ms=int((time.time() - start) * 1000),
            )
        result = TOOL_REGISTRY.call("bpmn.analyze", {"xml": xml}, ctx)
        if not result.success:
            return AgentResult(
                agent=self.name, success=False, summary="Error en análisis",
                error=result.error, duration_ms=int((time.time() - start) * 1000),
            )
        analysis = result.output
        sev = analysis["severity_counts"]
        summary = (
            f"Análisis BPMN: {sev['error']} errores, {sev['warning']} warnings, {sev['info']} infos."
        )
        entry = self.publish(ctx, topic="bpmn_findings", content=analysis)
        return AgentResult(
            agent=self.name, success=True, summary=summary,
            findings=analysis.get("findings", []),
            blackboard_entries=[entry], tools_used=["bpmn.analyze"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 4. QuantitativeProcessAgent
# ═════════════════════════════════════════════════════════════════════════════

class QuantitativeProcessAgent(BaseAgent):
    name = "quantitative_process_agent"
    description = "Análisis cuantitativo: tiempos de ciclo, throughput, M/M/c, simulación Monte Carlo."
    capabilities = [
        AgentCapability.QUANTITATIVE_ANALYSIS,
        AgentCapability.SIMULATION,
        AgentCapability.KPI_ANALYSIS,
    ]
    keywords = ["tiempo", "ciclo", "throughput", "simulación", "simulacion", "monte carlo", "cola", "queue", "utilización", "utilizacion"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        xml = _get_bpmn_xml(ctx)
        if not xml:
            return AgentResult(
                agent=self.name, success=False,
                summary="No hay BPMN XML disponible para simular.",
                error="missing bpmn_xml",
                duration_ms=int((time.time() - start) * 1000),
            )
        # Run Monte Carlo with defaults
        sim_args = {
            "xml": xml,
            "iterations": int(ctx.metadata.get("sim_iterations", 1000)),
            "default_task_mean": float(ctx.metadata.get("default_task_mean", 5.0)),
            "default_task_stdev": float(ctx.metadata.get("default_task_stdev", 2.0)),
            "timings": ctx.metadata.get("timings", {}),
            "gateway_probs": ctx.metadata.get("gateway_probs", {}),
        }
        sim_result = TOOL_REGISTRY.call("bpmn.simulate", sim_args, ctx)
        # Enumerate paths
        path_result = TOOL_REGISTRY.call("bpmn.paths", {
            "xml": xml,
            "gateway_probs": ctx.metadata.get("gateway_probs", {}),
        }, ctx)

        out: dict[str, Any] = {
            "simulation": sim_result.output if sim_result.success else {"error": sim_result.error},
            "paths": path_result.output if path_result.success else {"error": path_result.error},
        }
        sim = out["simulation"]
        if isinstance(sim, dict) and "mean_cycle_time" in sim:
            unit = sim.get("time_unit", "minutos")
            summary = (
                f"Simulación Monte Carlo: {sim['iterations']} iteraciones · "
                f"tiempo de ciclo medio = {sim['mean_cycle_time']} {unit} "
                f"(p5={sim['p5_cycle_time']}, p95={sim['p95_cycle_time']})."
            )
        else:
            summary = "Análisis cuantitativo ejecutado con errores."

        entry = self.publish(ctx, topic="quantitative_analysis", content=out)
        return AgentResult(
            agent=self.name, success=True, summary=summary,
            findings=[out], blackboard_entries=[entry],
            tools_used=["bpmn.simulate", "bpmn.paths"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 5. LeanAgent
# ═════════════════════════════════════════════════════════════════════════════

class LeanAgent(BaseAgent):
    name = "lean_agent"
    description = "Aplica Lean al BPMN: detecta 8 mudas y propone eliminación de desperdicios."
    capabilities = [
        AgentCapability.METHODOLOGY_SELECTION,
        AgentCapability.OPTIMIZATION,
    ]
    keywords = ["lean", "muda", "desperdicio", "valor agregado", "vsm", "kaizen"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        xml = _get_bpmn_xml(ctx)
        if not xml:
            return AgentResult(
                agent=self.name, success=False,
                summary="No hay BPMN XML para análisis Lean.",
                error="missing bpmn_xml",
                duration_ms=int((time.time() - start) * 1000),
            )
        result = TOOL_REGISTRY.call("lean.mudas", {"xml": xml}, ctx)
        data = result.output if result.success else {"mudas": [], "muda_count": 0}
        summary = f"Lean: {data['muda_count']} desperdicios (mudas) detectados."
        entry = self.publish(ctx, topic="lean_analysis", content=data)
        return AgentResult(
            agent=self.name, success=True, summary=summary,
            findings=data.get("mudas", []),
            blackboard_entries=[entry], tools_used=["lean.mudas"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 6. SixSigmaAgent
# ═════════════════════════════════════════════════════════════════════════════

class SixSigmaAgent(BaseAgent):
    name = "six_sigma_agent"
    description = "Aplica Six Sigma DMAIC: define, mide (DPMO/sigma), analiza, mejora, controla."
    capabilities = [
        AgentCapability.METHODOLOGY_SELECTION,
        AgentCapability.QUANTITATIVE_ANALYSIS,
    ]
    keywords = ["six sigma", "sigma", "dmaic", "dpmo", "variabilidad", "ctq", "ishikawa", "fmea"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        from app.methodologies.six_sigma import DMAIC_FRAMEWORK
        start = time.time()
        framework = [
            {"phase": p.phase.value, "name": p.name, "objective": p.objective,
             "tools": p.tools, "deliverables": p.deliverables}
            for p in DMAIC_FRAMEWORK.values()
        ]
        # If user provided defect data, compute DPMO/Sigma
        dpmo_result: dict[str, Any] | None = None
        if "defects" in ctx.metadata:
            dpmo_call = TOOL_REGISTRY.call("sixsigma.dpmo", {
                "defects": ctx.metadata.get("defects", 0),
                "opportunities": ctx.metadata.get("opportunities", 1),
                "units": ctx.metadata.get("units", 1),
            }, ctx)
            if dpmo_call.success:
                dpmo_result = dpmo_call.output

        content = {
            "framework_dmaic": framework,
            "dpmo_result": dpmo_result,
            "recommendation": (
                "Comenzar por Define con SIPOC + CTQ Tree. Sin baseline cuantitativo, "
                "Measure no entrega valor."
            ),
        }
        summary = "Framework DMAIC desplegado" + (
            f" + DPMO={dpmo_result['dpmo']}, Sigma={dpmo_result['sigma_level']}"
            if dpmo_result else " (sin datos de defectos para cálculo)."
        )
        entry = self.publish(ctx, topic="six_sigma_analysis", content=content)
        return AgentResult(
            agent=self.name, success=True, summary=summary,
            findings=[content], blackboard_entries=[entry],
            tools_used=["sixsigma.dpmo"] if dpmo_result else [],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 7. TocAgent
# ═════════════════════════════════════════════════════════════════════════════

class TocAgent(BaseAgent):
    name = "toc_agent"
    description = "Aplica Teoría de Restricciones (5 pasos de Goldratt) — identifica cuellos sistémicos."
    capabilities = [AgentCapability.BOTTLENECK_DETECTION, AgentCapability.METHODOLOGY_SELECTION]
    keywords = ["toc", "restriccion", "restricción", "goldratt", "cuello", "bottleneck"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        xml = _get_bpmn_xml(ctx)
        content: dict[str, Any]
        if xml:
            result = TOOL_REGISTRY.call("toc.constraints", {"xml": xml}, ctx)
            content = result.output if result.success else {"candidates": []}
        else:
            from app.methodologies.toc import TocMethodology
            content = {
                "candidates": [],
                "framework": [
                    {"step": s.number, "name": s.name, "objective": s.objective, "actions": s.actions}
                    for s in TocMethodology.framework()
                ],
                "recommendation": "Sin BPMN no se puede identificar la restricción concreta. Levantar primero el AS-IS.",
            }
        summary = (
            f"TOC: {len(content.get('candidates', []))} candidatos a restricción identificados."
            if content.get("candidates") else
            "TOC: framework desplegado, falta levantamiento concreto."
        )
        entry = self.publish(ctx, topic="toc_analysis", content=content)
        return AgentResult(
            agent=self.name, success=True, summary=summary,
            findings=content.get("candidates", []),
            blackboard_entries=[entry],
            tools_used=["toc.constraints"] if xml else [],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 8. ToBeRedesignAgent
# ═════════════════════════════════════════════════════════════════════════════

class ToBeRedesignAgent(BaseAgent):
    name = "to_be_redesign_agent"
    description = "Integra hallazgos Lean/Six Sigma/TOC para proponer el proceso TO-BE."
    capabilities = [
        AgentCapability.TO_BE_DESIGN,
        AgentCapability.OPTIMIZATION,
    ]
    keywords = ["to-be", "tobe", "rediseñ", "rediseno", "propuesta", "futuro", "mejora"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        # Get methodology recommendations
        xml = _get_bpmn_xml(ctx)
        rec_result = TOOL_REGISTRY.call("methodology.recommend", {
            "xml": xml,
            "signals": ctx.metadata.get("signals", {}),
        }, ctx)
        methodologies = rec_result.output.get("recommendations", []) if rec_result.success else []

        # Gather findings from blackboard
        lean = ctx.shared_state.latest("lean_analysis")
        six_sigma = ctx.shared_state.latest("six_sigma_analysis")
        toc = ctx.shared_state.latest("toc_analysis")
        bpmn_findings = ctx.shared_state.latest("bpmn_findings")

        # Build proposed changes
        changes: list[dict[str, Any]] = []
        if lean and isinstance(lean.content, dict):
            for m in lean.content.get("mudas", [])[:5]:
                changes.append({
                    "source": "Lean", "type": "eliminate_waste",
                    "muda": m["type"], "severity": m["severity"],
                    "action": m["recommendation"],
                    "affected_nodes": m["affected_nodes"],
                })
        if toc and isinstance(toc.content, dict):
            for c in toc.content.get("candidates", [])[:3]:
                changes.append({
                    "source": "TOC", "type": "address_bottleneck",
                    "node": c.get("name"),
                    "action": "Aplicar pasos 2-3 de TOC: Explotar + Subordinar",
                })
        if bpmn_findings and isinstance(bpmn_findings.content, dict):
            for f in bpmn_findings.content.get("findings", [])[:5]:
                if f["severity"] in ("warning", "error") and f.get("recommendation"):
                    changes.append({
                        "source": "BPMN Analysis",
                        "type": f["code"],
                        "action": f["recommendation"],
                        "affected_nodes": f.get("affected_nodes", []),
                    })

        content = {
            "methodologies_to_apply": methodologies[:3],
            "proposed_changes": changes,
            "next_actions": [
                "Validar cambios con dueños de proceso",
                "Construir BPMN TO-BE",
                "Re-simular para validar mejoras esperadas",
                "Elaborar plan de implementación con KPIs",
            ],
        }
        summary = (
            f"TO-BE propuesto: {len(changes)} cambios derivados de "
            f"{len(set(c['source'] for c in changes))} metodologías."
        )
        entry = self.publish(ctx, topic="to_be_proposal", content=content)
        return AgentResult(
            agent=self.name, success=True, summary=summary,
            findings=changes, blackboard_entries=[entry],
            tools_used=["methodology.recommend"],
            duration_ms=int((time.time() - start) * 1000),
        )


# ═════════════════════════════════════════════════════════════════════════════
# 9. DocumentationAgent
# ═════════════════════════════════════════════════════════════════════════════

class DocumentationAgent(BaseAgent):
    name = "documentation_agent"
    description = "Consolida análisis y propuestas en un entregable ejecutivo en markdown."
    capabilities = [AgentCapability.EXECUTIVE_SYNTHESIS]
    keywords = ["reporte", "entregable", "documento", "consolidar", "informe"]

    def execute(self, ctx: AgentContext) -> AgentResult:
        start = time.time()
        # Pull everything from the blackboard
        bb = ctx.shared_state
        sections: list[str] = []
        sections.append(f"# Entregable BPM\n> {ctx.user_query}\n")

        interp = bb.latest("bpmn_interpretation")
        if interp and isinstance(interp.content, dict):
            stats = interp.content.get("stats", {})
            sections.append(
                f"## Proceso analizado: {interp.content.get('process_name', '-')}\n"
                f"- {stats.get('tasks', 0)} tareas · {stats.get('gateways', 0)} gateways · "
                f"{stats.get('events', 0)} eventos · {stats.get('total_flows', 0)} flujos"
            )

        bpmn_f = bb.latest("bpmn_findings")
        if bpmn_f and isinstance(bpmn_f.content, dict):
            sev = bpmn_f.content.get("severity_counts", {})
            sections.append(
                f"\n## Hallazgos BPMN\n"
                f"- Errores: {sev.get('error', 0)} · Warnings: {sev.get('warning', 0)} · Info: {sev.get('info', 0)}"
            )
            findings = bpmn_f.content.get("findings", [])
            for f in findings[:10]:
                sections.append(f"- **[{f['severity']}]** {f['title']}: {f.get('detail', '')}")

        quant = bb.latest("quantitative_analysis")
        if quant and isinstance(quant.content, dict):
            sim = quant.content.get("simulation", {})
            if isinstance(sim, dict) and "mean_cycle_time" in sim:
                sections.append(
                    f"\n## Análisis cuantitativo\n"
                    f"- Tiempo de ciclo medio: **{sim['mean_cycle_time']} {sim.get('time_unit','min')}**\n"
                    f"- Rango (p5-p95): {sim['p5_cycle_time']} → {sim['p95_cycle_time']}\n"
                    f"- Std dev: {sim['stdev_cycle_time']} · Iteraciones: {sim['iterations']}"
                )

        lean = bb.latest("lean_analysis")
        if lean and isinstance(lean.content, dict):
            mudas = lean.content.get("mudas", [])
            sections.append(f"\n## Lean — desperdicios detectados ({len(mudas)})")
            for m in mudas[:8]:
                sections.append(f"- **{m['type']}** [{m['severity']}]: {m['description']}")

        ss = bb.latest("six_sigma_analysis")
        if ss and isinstance(ss.content, dict):
            sections.append("\n## Six Sigma DMAIC")
            dpmo = ss.content.get("dpmo_result")
            if dpmo:
                sections.append(f"- DPMO: **{dpmo['dpmo']}** · Sigma: **{dpmo['sigma_level']}σ** · Yield: {dpmo['yield_pct']}%")
            sections.append(f"- {ss.content.get('recommendation', '')}")

        toc = bb.latest("toc_analysis")
        if toc and isinstance(toc.content, dict):
            cands = toc.content.get("candidates", [])
            sections.append(f"\n## Teoría de Restricciones ({len(cands)} candidatos)")
            for c in cands[:5]:
                sections.append(f"- {c.get('name')}: {c.get('reason', '-')}")

        tobe = bb.latest("to_be_proposal")
        if tobe and isinstance(tobe.content, dict):
            changes = tobe.content.get("proposed_changes", [])
            sections.append(f"\n## Propuesta TO-BE ({len(changes)} cambios)")
            for c in changes[:10]:
                sections.append(f"- [{c['source']}] {c.get('action', '')}")
            sections.append("\n### Próximas acciones")
            for action in tobe.content.get("next_actions", []):
                sections.append(f"- {action}")

        agents = sorted({e.agent for e in bb.all_entries()})
        sections.append(f"\n---\n_Elaborado por {len(agents)} agentes colaborativos: {', '.join(agents)}_")

        document = "\n".join(sections)
        entry = self.publish(ctx, topic="executive_document", content=document)

        return AgentResult(
            agent=self.name, success=True,
            summary="Entregable ejecutivo consolidado.",
            findings=[{"document_length": len(document)}],
            blackboard_entries=[entry],
            duration_ms=int((time.time() - start) * 1000),
        )


# ── Registration ─────────────────────────────────────────────────────────────

def register_bpmn_agents() -> None:
    from app.cognitive.agents.registry import AGENT_REGISTRY
    for cls in [
        AsIsDiscoveryAgent,
        BpmnInterpreterAgent,
        BpmnAnalyzerAgent,
        QuantitativeProcessAgent,
        LeanAgent,
        SixSigmaAgent,
        TocAgent,
        ToBeRedesignAgent,
        DocumentationAgent,
    ]:
        AGENT_REGISTRY.register(cls)
