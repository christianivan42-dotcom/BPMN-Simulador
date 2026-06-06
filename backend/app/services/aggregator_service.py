"""
Aggregator Service — agregación bottom-up desde descendientes hacia el nodo padre.

Recorre el subárbol de un ProcessCase, ejecuta los análisis especializados
sobre cada descendiente (si tiene BPMN), y consolida los resultados al nodo raíz.

Métricas agregadas:
  - tiempo total (sum de Monte Carlo means de descendientes con BPMN)
  - lean mudas (concat + cuenta por severidad)
  - hallazgos BPMN (concat + cuenta por severidad)
  - cobertura de análisis (% descendientes con BPMN)
  - dpmo / sigma estimado (placeholder)

No bloquea: ejecuta secuencialmente por simplicidad (los volúmenes son pequeños).
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.process_case import ProcessCaseModel


def collect_descendants(db: Session, root_id: str) -> list[ProcessCaseModel]:
    """Devuelve TODOS los descendientes (hijos, nietos, …) del nodo raíz."""
    out: list[ProcessCaseModel] = []
    queue = [root_id]
    visited: set[str] = set()
    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        stmt = select(ProcessCaseModel).where(ProcessCaseModel.parent_id == current)
        children = db.scalars(stmt).all()
        for c in children:
            out.append(c)
            queue.append(c.id)
    return out


def _try_get_bpmn(db: Session, case_id: str) -> str | None:
    try:
        from app.services.bpmn_modeler_service import BpmnModelerService
        draft = BpmnModelerService(db).preview_as_is_bpmn(UUID(case_id))
        return draft.bpmn_xml if draft is not None else None
    except Exception:
        return None


def aggregate_down(db: Session, root_id: str) -> dict[str, Any]:
    """
    Ejecuta análisis sobre cada descendiente con BPMN disponible y consolida al raíz.

    Returns un dict con:
      - root_id, root_name
      - descendants: total
      - with_bpmn: count
      - coverage_pct
      - per_descendant: lista con resultados individuales
      - aggregated:
          * total_cycle_time_minutes (sum)
          * mudas_total (count)
          * findings_total (count)
          * mudas_by_severity, findings_by_severity
          * by_type (count de cada tipo de descendiente)
    """
    root = db.get(ProcessCaseModel, root_id)
    if root is None:
        return {"error": "root not found"}

    descendants = collect_descendants(db, root_id)

    per_descendant: list[dict[str, Any]] = []
    total_cycle = 0.0
    mudas: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    by_type: dict[str, int] = {}

    for desc in descendants:
        ptype = desc.process_type or "sin_tipo"
        by_type[ptype] = by_type.get(ptype, 0) + 1

        xml = _try_get_bpmn(db, desc.id)
        record: dict[str, Any] = {
            "id": desc.id,
            "name": desc.name,
            "level": desc.level,
            "process_type": desc.process_type,
            "has_bpmn": xml is not None,
            "cycle_time_minutes": None,
            "mudas_count": 0,
            "findings_count": 0,
        }

        if xml is not None:
            # Analyze + simulate
            try:
                from app.bpmn_intel.analyzer import BpmnAnalyzer
                from app.bpmn_intel.parser import BpmnParser
                from app.methodologies.lean import LeanMethodology
                from app.simulation.monte_carlo import (
                    MonteCarloSimulator, SimulationConfig,
                )
                graph = BpmnParser.parse(xml)

                # Analysis findings
                analysis = BpmnAnalyzer.analyze(graph)
                node_findings = analysis.get("findings", [])
                findings.extend([
                    {**f, "source_id": desc.id, "source_name": desc.name}
                    for f in node_findings
                ])
                record["findings_count"] = len(node_findings)

                # Lean mudas
                node_mudas = LeanMethodology.detect_mudas(graph)
                mudas.extend([
                    {
                        "type": m.type.value, "severity": m.severity,
                        "description": m.description,
                        "source_id": desc.id, "source_name": desc.name,
                    }
                    for m in node_mudas
                ])
                record["mudas_count"] = len(node_mudas)

                # Monte Carlo: tiempo de ciclo medio
                if graph.start_events():
                    config = SimulationConfig(iterations=200)
                    sim = MonteCarloSimulator.run(graph, config).to_dict()
                    record["cycle_time_minutes"] = sim.get("mean_cycle_time")
                    if sim.get("mean_cycle_time"):
                        total_cycle += float(sim["mean_cycle_time"])
            except Exception as e:
                record["error"] = str(e)

        per_descendant.append(record)

    # Cuenta por severidad
    def count_by_sev(items: list[dict[str, Any]]) -> dict[str, int]:
        out: dict[str, int] = {"info": 0, "warning": 0, "error": 0, "low": 0, "medium": 0, "high": 0}
        for it in items:
            sev = str(it.get("severity", "")).lower()
            if sev in out:
                out[sev] += 1
        return out

    with_bpmn = sum(1 for d in per_descendant if d["has_bpmn"])
    coverage = (with_bpmn / len(descendants) * 100.0) if descendants else 0.0

    return {
        "root_id": root.id,
        "root_name": root.name,
        "root_level": root.level,
        "descendants_total": len(descendants),
        "with_bpmn": with_bpmn,
        "coverage_pct": round(coverage, 1),
        "by_type": by_type,
        "per_descendant": per_descendant,
        "aggregated": {
            "total_cycle_time_minutes": round(total_cycle, 1),
            "mudas_total": len(mudas),
            "findings_total": len(findings),
            "mudas_by_severity": count_by_sev(mudas),
            "findings_by_severity": count_by_sev(findings),
        },
        "mudas": mudas[:50],          # top 50 para no inflar response
        "findings": findings[:50],
    }


def aggregate_by_chains(db: Session, macro_id: str) -> dict[str, Any]:
    """
    Para un macro N1 con flow_definition (cadenas de hijos N2), agrega los
    análisis de los descendientes de cada cadena por separado.

    Devuelve:
      - chains: lista de {index, processes:[…], aggregated:{…}, descendants_total}
      - has_flow: bool indicando si había flow_definition
      - root_id, root_name
    """
    from app.services.macro_flow_service import get_flow_definition

    root = db.get(ProcessCaseModel, macro_id)
    if root is None:
        return {"error": "root not found", "chains": [], "has_flow": False}

    chains_ids = get_flow_definition(db, macro_id)
    if not chains_ids:
        return {
            "root_id": root.id, "root_name": root.name,
            "has_flow": False, "chains": [],
        }

    per_chain: list[dict[str, Any]] = []
    for i, chain in enumerate(chains_ids):
        # Para cada N2 de la cadena, recolectar sus descendientes + el propio N2
        # y sumar las métricas
        chain_processes: list[dict[str, Any]] = []
        agg_total_cycle = 0.0
        agg_mudas: list[dict[str, Any]] = []
        agg_findings: list[dict[str, Any]] = []

        for cid in chain:
            child = db.get(ProcessCaseModel, cid)
            if child is None:
                continue
            # Analizar el N2 + sus descendientes
            sub_result = aggregate_down(db, cid)
            # El propio N2 también puede tener BPMN: medirlo
            own_xml = _try_get_bpmn(db, cid)
            own_cycle: float | None = None
            own_mudas_count = 0
            own_findings_count = 0
            if own_xml is not None:
                try:
                    from app.bpmn_intel.analyzer import BpmnAnalyzer
                    from app.bpmn_intel.parser import BpmnParser
                    from app.methodologies.lean import LeanMethodology
                    from app.simulation.monte_carlo import MonteCarloSimulator, SimulationConfig
                    graph = BpmnParser.parse(own_xml)
                    analysis = BpmnAnalyzer.analyze(graph)
                    own_findings_count = len(analysis.get("findings", []))
                    agg_findings.extend([
                        {**f, "source_id": child.id, "source_name": child.name}
                        for f in analysis.get("findings", [])
                    ])
                    mudas = LeanMethodology.detect_mudas(graph)
                    own_mudas_count = len(mudas)
                    agg_mudas.extend([
                        {
                            "type": m.type.value, "severity": m.severity,
                            "description": m.description,
                            "source_id": child.id, "source_name": child.name,
                        }
                        for m in mudas
                    ])
                    if graph.start_events():
                        sim = MonteCarloSimulator.run(graph, SimulationConfig(iterations=200)).to_dict()
                        own_cycle = sim.get("mean_cycle_time")
                except Exception as e:
                    pass

            # Sumar métricas del subárbol del N2
            sub_agg = sub_result.get("aggregated", {})
            agg_total_cycle += float(sub_agg.get("total_cycle_time_minutes", 0) or 0)
            if own_cycle:
                agg_total_cycle += float(own_cycle)
            agg_mudas.extend(sub_result.get("mudas", []) or [])
            agg_findings.extend(sub_result.get("findings", []) or [])

            chain_processes.append({
                "id": child.id,
                "name": child.name,
                "level": child.level,
                "has_bpmn": own_xml is not None,
                "own_cycle_time_minutes": own_cycle,
                "own_mudas_count": own_mudas_count,
                "own_findings_count": own_findings_count,
                "descendants_total": sub_result.get("descendants_total", 0),
                "descendants_with_bpmn": sub_result.get("with_bpmn", 0),
                "sub_aggregated": sub_agg,
            })

        def count_sev(items: list[dict[str, Any]]) -> dict[str, int]:
            out: dict[str, int] = {"info": 0, "warning": 0, "error": 0, "low": 0, "medium": 0, "high": 0}
            for it in items:
                sev = str(it.get("severity", "")).lower()
                if sev in out:
                    out[sev] += 1
            return out

        per_chain.append({
            "index": i + 1,
            "kind": "Independiente" if len(chain) == 1 else f"Cadena ({len(chain)} pasos)",
            "processes": chain_processes,
            "descendants_total": sum(p["descendants_total"] for p in chain_processes),
            "aggregated": {
                "total_cycle_time_minutes": round(agg_total_cycle, 1),
                "mudas_total": len(agg_mudas),
                "findings_total": len(agg_findings),
                "mudas_by_severity": count_sev(agg_mudas),
                "findings_by_severity": count_sev(agg_findings),
            },
            "mudas": agg_mudas[:20],
            "findings": agg_findings[:20],
        })

    return {
        "root_id": root.id,
        "root_name": root.name,
        "has_flow": True,
        "chains": per_chain,
    }


__all__ = ["aggregate_down", "collect_descendants", "aggregate_by_chains"]
