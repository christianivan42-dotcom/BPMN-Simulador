"""
Organizational Memory — Persistent enterprise knowledge state.

Unlike episodic (per-conversation) and semantic (learned patterns),
this is the system's "always-on" knowledge of the organization:

    - Cadena de Valor (from Porter)
    - Macro-Procesos
    - Procesos / Sub-procesos / Procedimientos / Instrucciones
    - Compañía: misión, visión, sector, objetivos
    - KPIs activos
    - Stakeholders y dueños
    - Riesgos identificados
    - Decisiones tomadas

Backed by the SQL database for durability; queries go through this layer
for caching and consistent access.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session


@dataclass
class OrganizationalSnapshot:
    """A point-in-time view of organizational state for agent context injection."""
    company: dict[str, Any] | None
    porter_chain: dict[str, Any] | None
    macro_processes: list[dict[str, Any]]
    process_tree: list[dict[str, Any]]
    active_risks_count: int
    stale_analyses_count: int
    total_documents: int


class OrganizationalMemory:
    """
    Per-DB-session view of organizational state.

    Used by agents to inject high-level context without re-querying everything.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def snapshot(self) -> OrganizationalSnapshot:
        from app.models.company import CompanyModel
        from app.models.process_case import ProcessCaseModel
        from app.models.knowledge import KnowledgeDocumentModel

        # Company
        company_row = self.db.execute(select(CompanyModel).limit(1)).scalar_one_or_none()
        company_dict: dict[str, Any] | None = None
        porter_dict: dict[str, Any] | None = None
        if company_row:
            company_dict = {
                "id": company_row.id,
                "razon_social": company_row.razon_social,
                "nombre_corto": company_row.nombre_corto,
                "sector": company_row.sector,
                "tamano": company_row.tamano,
                "mision": company_row.mision,
                "vision": company_row.vision,
            }
            try:
                import json as _json
                porter_dict = _json.loads(company_row.cadena_valor) if company_row.cadena_valor else None
            except Exception:
                porter_dict = None

        # Process tree (flat for now — caller can build hierarchy)
        all_cases = self.db.execute(select(ProcessCaseModel)).scalars().all()
        macro = [
            {"id": c.id, "name": c.name, "level": c.level, "owner": c.owner}
            for c in all_cases if c.level == 1
        ]
        process_tree = [
            {
                "id": c.id, "name": c.name, "level": c.level,
                "parent_id": c.parent_id, "analysis_status": c.analysis_status,
                "staleness": c.staleness,
            }
            for c in all_cases
        ]
        stale_count = sum(1 for c in all_cases if c.staleness and c.staleness != "ok")

        # Documents
        doc_count = self.db.execute(select(KnowledgeDocumentModel)).scalars().all()

        return OrganizationalSnapshot(
            company=company_dict,
            porter_chain=porter_dict,
            macro_processes=macro,
            process_tree=process_tree,
            active_risks_count=0,  # TODO: when risk model exists
            stale_analyses_count=stale_count,
            total_documents=len(doc_count),
        )

    def context_brief(self) -> str:
        """Compact natural-language summary for LLM prompt injection."""
        s = self.snapshot()
        lines = []
        if s.company:
            c = s.company
            lines.append(
                f"Empresa: {c['razon_social']} | Sector: {c.get('sector') or 'n/d'} | "
                f"Tamaño: {c.get('tamano') or 'n/d'}"
            )
            if c.get("mision"):
                lines.append(f"Misión: {c['mision']}")
        if s.porter_chain:
            prim = [a.get("nombre") for a in s.porter_chain.get("actividades_primarias", []) if a.get("nombre")]
            apoy = [a.get("nombre") for a in s.porter_chain.get("actividades_apoyo", []) if a.get("nombre")]
            if prim:
                lines.append(f"Actividades primarias: {', '.join(prim)}")
            if apoy:
                lines.append(f"Actividades apoyo: {', '.join(apoy)}")
        if s.macro_processes:
            lines.append(f"Macro-procesos definidos: {len(s.macro_processes)}")
            for mp in s.macro_processes[:5]:
                lines.append(f"  • {mp['name']}")
            if len(s.macro_processes) > 5:
                lines.append(f"  • ... y {len(s.macro_processes) - 5} más")
        total = len(s.process_tree)
        if total:
            lines.append(f"Nodos del árbol de procesos: {total} (obsoletos: {s.stale_analyses_count})")
        if s.total_documents:
            lines.append(f"Base de conocimiento: {s.total_documents} documentos")
        return "\n".join(lines) if lines else "(sin contexto organizacional)"
