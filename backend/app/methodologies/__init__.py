"""
BPM Methodologies catalog — Lean, Six Sigma, TOC, plus core techniques.

Each methodology has:
    - applicability heuristics (what problem it solves)
    - framework steps (phases / mudas / 5 steps)
    - artifacts it produces
    - detection helpers that take a ProcessGraph and return findings
"""
from app.methodologies.lean import LeanMethodology, MudaType
from app.methodologies.six_sigma import SixSigmaMethodology, DMAICPhase
from app.methodologies.toc import TocMethodology
from app.methodologies.qualitative import (
    SIPOC, FiveWhys, IshikawaDiagram, FMEAEntry, ValueStreamMap,
)
from app.methodologies.selector import MethodologySelector

__all__ = [
    "LeanMethodology", "MudaType",
    "SixSigmaMethodology", "DMAICPhase",
    "TocMethodology",
    "SIPOC", "FiveWhys", "IshikawaDiagram", "FMEAEntry", "ValueStreamMap",
    "MethodologySelector",
]
