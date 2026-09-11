from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, field_validator
import json


# ── Porter Value Chain schemas ─────────────────────────────────────────────────

class PorterActivity(BaseModel):
    id: str
    nombre: str
    descripcion: str = ""
    procesos: list[str] = []


class PorterChain(BaseModel):
    actividades_primarias: list[PorterActivity] = []
    actividades_apoyo: list[PorterActivity] = []
    margen: str = ""

    @classmethod
    def default(cls) -> "PorterChain":
        return cls(
            actividades_primarias=[
                PorterActivity(id="p1", nombre="Logística de Entrada", descripcion="Recepción y gestión de insumos y materiales"),
                PorterActivity(id="p2", nombre="Operaciones", descripcion="Producción y entrega del producto/servicio"),
                PorterActivity(id="p3", nombre="Logística de Salida", descripcion="Distribución y entrega al cliente"),
                PorterActivity(id="p4", nombre="Marketing y Ventas", descripcion="Estrategias comerciales y captación de clientes"),
                PorterActivity(id="p5", nombre="Servicio Posventa", descripcion="Soporte, garantía y fidelización"),
            ],
            actividades_apoyo=[
                PorterActivity(id="a1", nombre="Infraestructura", descripcion="Finanzas, planificación y dirección general"),
                PorterActivity(id="a2", nombre="Gestión de RRHH", descripcion="Selección, formación y desarrollo del talento"),
                PorterActivity(id="a3", nombre="Desarrollo Tecnológico", descripcion="TI, innovación y automatización"),
                PorterActivity(id="a4", nombre="Abastecimiento", descripcion="Gestión de proveedores y compras"),
            ],
            margen="Diferencia entre el valor creado y el costo de crearlo",
        )


# ── Planificación estratégica: KPI y POA ───────────────────────────────────────

class Kpi(BaseModel):
    id: str
    nombre: str
    meta: str = ""           # valor objetivo (texto: admite %, unidades)
    unidad: str = ""
    frecuencia: str = ""     # mensual / trimestral / anual
    responsable: str = ""


class PoaItem(BaseModel):
    """Actividad del Plan Operativo Anual, ligada a un objetivo estratégico."""
    id: str
    objetivo: str = ""       # objetivo estratégico al que tributa
    actividad: str = ""
    responsable: str = ""
    periodo: str = ""        # Q1/Q2/Q3/Q4 o mes
    indicador: str = ""
    meta: str = ""
    presupuesto: str = ""


class ProcessMapItem(BaseModel):
    """Proceso del mapa de procesos (estratégico / operativo / de apoyo)."""
    id: str
    nombre: str
    descripcion: str = ""
    categoria: str = "operativo"   # estrategico | operativo | apoyo


# ── Company schemas ────────────────────────────────────────────────────────────

class CompanyCreate(BaseModel):
    razon_social: str
    nombre_corto: str | None = None
    sector: str | None = None
    tamano: str | None = None
    mision: str | None = None
    vision: str | None = None
    valores: str | None = None
    objetivos_estrategicos: list[str] | None = None
    estrategias: list[str] | None = None
    kpis: list[Kpi] | None = None
    poa: list[PoaItem] | None = None
    mapa_procesos: list[ProcessMapItem] | None = None
    planificacion_estrategica: str | None = None


class CompanyUpdate(BaseModel):
    razon_social: str | None = None
    nombre_corto: str | None = None
    sector: str | None = None
    tamano: str | None = None
    mision: str | None = None
    vision: str | None = None
    valores: str | None = None
    objetivos_estrategicos: list[str] | None = None
    estrategias: list[str] | None = None
    kpis: list[Kpi] | None = None
    poa: list[PoaItem] | None = None
    mapa_procesos: list[ProcessMapItem] | None = None
    planificacion_estrategica: str | None = None
    cadena_valor: PorterChain | None = None


class CompanyResponse(BaseModel):
    id: UUID
    razon_social: str
    nombre_corto: str | None
    sector: str | None
    tamano: str | None
    mision: str | None
    vision: str | None
    valores: str | None
    objetivos_estrategicos: list[str]
    estrategias: list[str]
    kpis: list[Kpi]
    poa: list[PoaItem]
    mapa_procesos: list[ProcessMapItem]
    planificacion_estrategica: str | None
    cadena_valor: PorterChain
    created_at: datetime
    updated_at: datetime
