"""
Catálogo de análisis por nivel BPM — la matriz maestra.

Única fuente de verdad de QUÉ análisis aplica en cada nivel (N0–N4) y a qué fase
del ciclo de vida BPM pertenece.

Ciclo de vida BPM: Identificación → Descubrimiento (AS-IS) → Análisis
(cualitativo + cuantitativo) → Rediseño (TO-BE) → Implementación → Monitoreo.

Consumido por `node_context.build_node_context` (lo inyecta al AI Workspace y a la
vista de Contexto) para que cada nodo "sepa" qué le toca según su nivel.
Ver docs/architecture/PROCESS_LEVELS_AND_ANALYSIS_FRAMEWORK.md §3–§4.
"""
from __future__ import annotations

from typing import Any

# Fases del ciclo de vida BPM (id → etiqueta legible).
BPM_PHASES: dict[str, str] = {
    "identificacion": "Identificación / Arquitectura",
    "seleccion": "Selección / Cartera",
    "descubrimiento": "Descubrimiento AS-IS",
    "cualitativo": "Análisis cualitativo",
    "cuantitativo": "Análisis cuantitativo",
    "simulacion": "Simulación",
    "metodologias": "Metodologías de mejora",
    "rediseno": "Rediseño TO-BE",
    "implementacion": "Implementación",
    "monitoreo": "Monitoreo / Minería",
}

# Catálogo de técnicas: id → {label, phase, book (referencia al libro)}.
ANALYSES: dict[str, dict[str, str]] = {
    # Identificación / arquitectura
    "arquitectura":      {"label": "Arquitectura de procesos (categorías)", "phase": "identificacion", "book": "Cap 2 §2.2"},
    "panorama":          {"label": "Panorama de procesos (relaciones)",     "phase": "identificacion", "book": "§2.2.4"},
    "cartera":           {"label": "Cartera / priorización de procesos",    "phase": "seleccion",      "book": "§2.3.3"},
    "kpi_estrategico":   {"label": "Medidas de rendimiento estratégicas",   "phase": "seleccion",      "book": "§2.3.2"},
    "dependencias":      {"label": "Dependencias y transversalidad",        "phase": "identificacion", "book": "§2.2.2"},
    # Descubrimiento AS-IS
    "as_is":             {"label": "Descubrimiento AS-IS (entrevistas/talleres)", "phase": "descubrimiento", "book": "Cap 5 §5.2"},
    "sipoc":             {"label": "SIPOC y límites del proceso",           "phase": "descubrimiento", "book": "§5.3"},
    "qa_modelo":         {"label": "Aseguramiento de calidad del modelo",   "phase": "descubrimiento", "book": "§5.4"},
    # Cualitativo (Cap 6)
    "valor_anadido":     {"label": "Análisis de valor añadido (VA/BVA/NVA)", "phase": "cualitativo", "book": "§6.1"},
    "desperdicios":      {"label": "Análisis de desperdicios / TKO",        "phase": "cualitativo", "book": "§6.2"},
    "stakeholders":      {"label": "Partes interesadas + registro de cuestiones", "phase": "cualitativo", "book": "§6.3"},
    "pareto":            {"label": "Pareto / gráficos PICK",                "phase": "cualitativo", "book": "§6.3.3"},
    "causa_raiz":        {"label": "Causa-efecto (Ishikawa) / why-why",     "phase": "cualitativo", "book": "§6.4"},
    # Cuantitativo (Cap 7)
    "flujo":             {"label": "Análisis de flujo (ciclo, CTE, Little, cuellos)", "phase": "cuantitativo", "book": "§7.1"},
    "colas":             {"label": "Teoría de colas (M/M/1, M/M/c)",        "phase": "cuantitativo", "book": "§7.2"},
    "kpi_agregado":      {"label": "KPIs agregados (bottom-up)",            "phase": "cuantitativo", "book": "§2.3.2"},
    "simulacion":        {"label": "Simulación (Monte Carlo + DES)",        "phase": "simulacion",   "book": "§7.3"},
    # Metodologías de mejora
    "lean":              {"label": "Lean (8 mudas, VSM)",                   "phase": "metodologias", "book": "Cap 6 + Lean"},
    "six_sigma":         {"label": "Six Sigma / DMAIC (Cp/Cpk, FMEA)",      "phase": "metodologias", "book": "DMAIC"},
    "toc":               {"label": "TOC (5 pasos de focalización)",         "phase": "metodologias", "book": "TOC"},
    "micro_mejora":      {"label": "5S / Poka-yoke / trabajo estándar",     "phase": "metodologias", "book": "Lean micro"},
    # Rediseño (Cap 8)
    "rediseno_transaccional":   {"label": "Rediseño transaccional (7FE, heurísticas)", "phase": "rediseno", "book": "§8.2"},
    "rediseno_transformacional":{"label": "Rediseño transformacional (BPR/PBD, sin AS-IS)", "phase": "rediseno", "book": "§8.3"},
    "cuadrilatero":      {"label": "Cuadrilátero del Diablo (tiempo/costo/calidad/flex.)", "phase": "rediseno", "book": "§8.1.3"},
    # Implementación / monitoreo
    "documentacion":     {"label": "Documentación (SOP/instructivo/formulario)", "phase": "implementacion", "book": "ISO 9001 §7.5"},
    "mineria":           {"label": "Minería de procesos / conformance",    "phase": "monitoreo", "book": "Cap 11 §11.3"},
    "tablero":           {"label": "Tablero de KPIs y obsolescencia",      "phase": "monitoreo", "book": "Cap 11"},
}

# Matriz: nivel → técnicas aplicables (en orden de relevancia).
LEVEL_MATRIX: dict[int, list[str]] = {
    0: ["arquitectura", "cartera", "kpi_estrategico", "dependencias"],
    1: ["panorama", "cartera", "dependencias", "kpi_agregado", "tablero"],
    2: ["as_is", "sipoc", "valor_anadido", "stakeholders", "pareto", "causa_raiz",
        "kpi_agregado", "rediseno_transformacional"],
    3: ["as_is", "qa_modelo", "valor_anadido", "desperdicios", "flujo", "colas",
        "simulacion", "lean", "six_sigma", "toc", "causa_raiz",
        "rediseno_transaccional", "rediseno_transformacional", "cuadrilatero",
        "mineria"],
    4: ["documentacion", "micro_mejora", "flujo", "valor_anadido", "as_is"],
}


def analysis_catalog_for_level(level: int | None) -> dict[str, Any]:
    """
    Devuelve, para un nivel, las fases BPM aplicables y la lista de análisis con su
    etiqueta, fase y referencia al libro. Si el nivel no está en la matriz, cae a N3
    (el nivel operativo más rico).
    """
    lvl = level if level in LEVEL_MATRIX else 3
    ids = LEVEL_MATRIX.get(lvl, [])
    analyses = [
        {
            "id": aid,
            "label": ANALYSES[aid]["label"],
            "phase": ANALYSES[aid]["phase"],
            "phase_label": BPM_PHASES.get(ANALYSES[aid]["phase"], ANALYSES[aid]["phase"]),
            "book_ref": ANALYSES[aid]["book"],
        }
        for aid in ids
        if aid in ANALYSES
    ]
    # Fases distintas presentes en este nivel, en orden de aparición.
    seen: list[str] = []
    for a in analyses:
        if a["phase"] not in seen:
            seen.append(a["phase"])
    phases = [{"id": p, "label": BPM_PHASES[p]} for p in seen]
    return {"bpm_phases": phases, "analyses": analyses}


__all__ = ["analysis_catalog_for_level", "BPM_PHASES", "ANALYSES", "LEVEL_MATRIX"]
