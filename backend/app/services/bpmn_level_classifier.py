"""
BPMN Level Classifier — clasifica un elemento dibujado en un BPMN para decidir
QUÉ tipo de nodo BPM representa y, por tanto, EN QUÉ NIVEL del árbol vive.

Contexto del modelo jerárquico (canónico del proyecto):

    N0  Cadena de Valor / Macro-procesos (Porter, no BPMN)
    N1  Mapa de Procesos (se diagrama el flujo entre los N2)
    N2  Proceso
    N3  Procedimiento
    N4  Actividad / Instructivo

Cuando el usuario está en la capa N1 (mapa de procesos) y dibuja un "subproceso"
(la caja con el "+", un <bpmn:subProcess> colapsado) o cualquier actividad nombrada,
este clasificador mira el CONTEXTO del elemento —su nombre y su tipo BPMN— para
identificar de qué nivel se trata:

    · si es un Proceso        → N2
    · si es un Procedimiento  → N3
    · si es una Actividad/    → N4
      Instructivo

El nivel resultante NO es ciegamente `parent_level + 1`: lo determina el TIPO
clasificado (un procedimiento siempre es N3, una actividad siempre es N4),
acotado para que nunca quede más arriba que `parent_level + 1`.

El BPMN es la fuente de verdad (Regla 1): dibujar la caja en el diagrama es lo que
crea —y ahora también clasifica— el nodo hijo navegable.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

# ── Nivel canónico por tipo de proceso ────────────────────────────────────────
# El tipo manda sobre el nivel. Estos son niveles ABSOLUTOS dentro del árbol BPM.
CANONICAL_LEVEL: dict[str, int] = {
    "proceso":       2,
    "subproceso":    2,   # un subproceso de alto nivel sigue siendo de nivel proceso
    "procedimiento": 3,
    "politica":      3,
    "instructivo":   4,
    "actividad":     4,
    "registro":      4,
    "indicador":     4,
}

# Nombres legibles de cada nivel (alineados con node_context.LEVEL_NAMES).
LEVEL_NAMES: dict[int, str] = {
    0: "Cadena de Valor",
    1: "Mapa de Procesos",
    2: "Proceso",
    3: "Procedimiento",
    4: "Actividad / Instructivo",
    5: "Tarea",
    6: "Registro",
}

# Tipo de proceso por defecto para cada nivel (mapeo inverso de CANONICAL_LEVEL).
# Se usa al RECLASIFICAR manualmente: el analista elige un nivel y el tipo se deriva.
DEFAULT_TYPE_BY_LEVEL: dict[int, str] = {
    2: "proceso",
    3: "procedimiento",
    4: "actividad",
    5: "instructivo",
    6: "registro",
}


def type_for_level(new_level: int, current_type: str | None = None) -> str:
    """
    Tipo de proceso coherente con `new_level`. Si el tipo actual ya pertenece a ese
    nivel (p. ej. 'instructivo' es N4 igual que 'actividad'), se conserva; si no, se
    usa el tipo por defecto del nivel.
    """
    if current_type and CANONICAL_LEVEL.get(current_type) == new_level:
        return current_type
    return DEFAULT_TYPE_BY_LEVEL.get(new_level, "proceso")


def child_level_options(parent_level: int) -> list[dict[str, Any]]:
    """
    Niveles válidos para un hijo dibujado bajo un nodo de nivel `parent_level`:
    siempre más profundos que el padre, hasta N6. Cada opción trae su nombre y el
    tipo por defecto — alimenta el selector de reclasificación del frontend.
    """
    start = max((parent_level or 0) + 1, 2)
    return [
        {
            "level": lvl,
            "level_name": LEVEL_NAMES.get(lvl, f"N{lvl}"),
            "process_type": DEFAULT_TYPE_BY_LEVEL.get(lvl, "proceso"),
        }
        for lvl in range(start, 7)
    ]


def _normalize(name: str) -> str:
    """Minúsculas, sin acentos, espacios colapsados — para casar palabras clave."""
    nfkd = unicodedata.normalize("NFKD", name or "")
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    return " ".join(no_accents.lower().split())


# ── Pistas por palabra clave en el NOMBRE (señal de mayor confianza) ───────────
# Orden = prioridad: el primero que casa, gana. De más específico a más genérico.
_NAME_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("indicador",     re.compile(r"\b(indicador|kpi|metrica)\b")),
    ("registro",      re.compile(r"\b(registro|formato|formulario|plantilla|bitacora)\b")),
    ("instructivo",   re.compile(r"\b(instructivo|instruccion(es)?|instructiv\w*|sop|paso a paso|checklist|lista de verificacion|guia rapida|ficha)\b")),
    ("actividad",     re.compile(r"\b(actividad(es)?|tarea(s)?)\b")),
    ("procedimiento", re.compile(r"\b(procedimiento(s)?|protocolo|rutina|metodo)\b")),
    ("politica",      re.compile(r"\b(politica(s)?|norma(tiva)?|reglamento|policy)\b")),
    ("proceso",       re.compile(r"\b(macroproceso|proceso(s)?|gestion|ciclo)\b")),
]

# Pista para distinguir un userTask/manualTask que documenta un instructivo.
INSTRUCT_RE: re.Pattern[str] = re.compile(r"instruct|\bsop\b", re.I)


def _type_from_name(norm_name: str) -> tuple[str, str] | None:
    """Devuelve (process_type, palabra_que_caso) si el nombre da una pista; si no, None."""
    for ptype, pattern in _NAME_RULES:
        m = pattern.search(norm_name)
        if m:
            return ptype, m.group(0)
    return None


def _type_from_tag(tag: str, norm_name: str, parent_level: int) -> str:
    """Tipo por convención del elemento BPMN cuando el nombre no da pista."""
    t = tag.lower()
    if t == "subprocess":
        # La "caja con el +": desde el mapa (N1) baja a un Proceso N2;
        # más abajo representa un Procedimiento.
        return "proceso" if parent_level <= 1 else "procedimiento"
    if t == "callactivity":
        # Llamada a un artefacto reutilizable → procedimiento.
        return "procedimiento"
    if t == "businessruletask":
        return "politica"
    if t in ("usertask", "manualtask"):
        if INSTRUCT_RE.search(norm_name):
            return "instructivo"
        # En el mapa N1 una caja de usuario sin pista es un proceso; más abajo, una actividad.
        return "proceso" if parent_level <= 1 else "instructivo"
    # task, serviceTask, sendTask, receiveTask, scriptTask, …
    return "proceso"


def classify_bpmn_node(
    *,
    tag: str,
    name: str,
    parent_level: int,
) -> dict[str, Any]:
    """
    Clasifica un elemento BPMN dibujado bajo un nodo de nivel `parent_level`.

    Devuelve:
        {
          "process_type": str,    # proceso | procedimiento | instructivo | actividad | ...
          "level":        int,    # nivel absoluto en el árbol BPM (N2/N3/N4/…)
          "level_name":   str,    # nombre legible del nivel
          "confidence":   str,    # alta (por nombre) | media (por tipo BPMN) | baja
          "rationale":    str,    # explicación legible de por qué se clasificó así
        }
    """
    norm = _normalize(name)

    matched = _type_from_name(norm)
    if matched is not None:
        ptype, keyword = matched
        confidence = "alta"
        why = f"el nombre menciona «{keyword}»"
    else:
        ptype = _type_from_tag(tag, norm, parent_level)
        confidence = "media"
        why = f"el elemento BPMN <{tag}> no trae pista en el nombre, se usa la convención del tipo"

    canonical = CANONICAL_LEVEL.get(ptype, parent_level + 1)
    # Un hijo nunca queda más arriba que un nivel por debajo de su padre, y nunca pasa de N6.
    level = max(canonical, min(parent_level + 1, 6))
    level = min(level, 6)
    if level != canonical:
        confidence = "baja" if confidence != "alta" else confidence

    level_name = LEVEL_NAMES.get(level, "Desconocido")
    rationale = (
        f"Clasificado como {level_name} (N{level}) porque {why}."
    )

    return {
        "process_type": ptype,
        "level": level,
        "level_name": level_name,
        "confidence": confidence,
        "rationale": rationale,
    }


__all__ = [
    "classify_bpmn_node",
    "type_for_level",
    "child_level_options",
    "CANONICAL_LEVEL",
    "DEFAULT_TYPE_BY_LEVEL",
    "LEVEL_NAMES",
    "INSTRUCT_RE",
]
