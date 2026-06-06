from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company import CompanyModel
from app.schemas.company import (
    CompanyCreate,
    CompanyResponse,
    CompanyUpdate,
    Kpi,
    PoaItem,
    ProcessMapItem,
    PorterChain,
)


class CompanyService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def crear(self, payload: CompanyCreate) -> CompanyResponse:
        company = CompanyModel(
            id=str(uuid4()),
            razon_social=payload.razon_social,
            nombre_corto=payload.nombre_corto,
            sector=payload.sector,
            tamano=payload.tamano,
            mision=payload.mision,
            vision=payload.vision,
            valores=payload.valores,
            objetivos_estrategicos=json.dumps(payload.objetivos_estrategicos or [], ensure_ascii=False),
            estrategias=json.dumps(payload.estrategias or [], ensure_ascii=False),
            kpis=json.dumps([k.model_dump() for k in (payload.kpis or [])], ensure_ascii=False),
            poa=json.dumps([p.model_dump() for p in (payload.poa or [])], ensure_ascii=False),
            mapa_procesos=json.dumps([m.model_dump() for m in (payload.mapa_procesos or [])], ensure_ascii=False),
            planificacion_estrategica=payload.planificacion_estrategica,
            cadena_valor=json.dumps(PorterChain.default().model_dump(), ensure_ascii=False),
        )
        self.db.add(company)
        self.db.commit()
        self.db.refresh(company)
        return self._to_response(company)

    def listar(self) -> list[CompanyResponse]:
        rows = self.db.scalars(select(CompanyModel).order_by(CompanyModel.created_at)).all()
        return [self._to_response(r) for r in rows]

    def obtener(self, company_id: UUID) -> CompanyResponse | None:
        row = self.db.get(CompanyModel, str(company_id))
        return self._to_response(row) if row else None

    def obtener_primera(self) -> CompanyResponse | None:
        row = self.db.scalars(select(CompanyModel).limit(1)).first()
        return self._to_response(row) if row else None

    def actualizar(self, company_id: UUID, payload: CompanyUpdate) -> CompanyResponse | None:
        row = self.db.get(CompanyModel, str(company_id))
        if not row:
            return None
        if payload.razon_social is not None:
            row.razon_social = payload.razon_social
        if payload.nombre_corto is not None:
            row.nombre_corto = payload.nombre_corto
        if payload.sector is not None:
            row.sector = payload.sector
        if payload.tamano is not None:
            row.tamano = payload.tamano
        if payload.mision is not None:
            row.mision = payload.mision
        if payload.vision is not None:
            row.vision = payload.vision
        if payload.valores is not None:
            row.valores = payload.valores
        if payload.objetivos_estrategicos is not None:
            row.objetivos_estrategicos = json.dumps(payload.objetivos_estrategicos, ensure_ascii=False)
        if payload.estrategias is not None:
            row.estrategias = json.dumps(payload.estrategias, ensure_ascii=False)
        if payload.kpis is not None:
            row.kpis = json.dumps([k.model_dump() for k in payload.kpis], ensure_ascii=False)
        if payload.poa is not None:
            row.poa = json.dumps([p.model_dump() for p in payload.poa], ensure_ascii=False)
        if payload.mapa_procesos is not None:
            row.mapa_procesos = json.dumps([m.model_dump() for m in payload.mapa_procesos], ensure_ascii=False)
        if payload.planificacion_estrategica is not None:
            row.planificacion_estrategica = payload.planificacion_estrategica
        if payload.cadena_valor is not None:
            row.cadena_valor = json.dumps(payload.cadena_valor.model_dump(), ensure_ascii=False)
        row.updated_at = datetime.now(UTC)
        self.db.commit()
        self.db.refresh(row)
        return self._to_response(row)

    def eliminar(self, company_id: UUID) -> bool:
        row = self.db.get(CompanyModel, str(company_id))
        if not row:
            return False
        self.db.delete(row)
        self.db.commit()
        return True

    @staticmethod
    def _to_response(row: CompanyModel) -> CompanyResponse:
        def _load(raw: str | None) -> list:
            if not raw:
                return []
            try:
                return json.loads(raw)
            except Exception:
                return []

        objetivos = _load(row.objetivos_estrategicos)
        estrategias = _load(row.estrategias)
        kpis = [Kpi(**k) for k in _load(row.kpis)]
        poa = [PoaItem(**p) for p in _load(row.poa)]
        mapa_procesos = [ProcessMapItem(**m) for m in _load(row.mapa_procesos)]

        cadena_raw = row.cadena_valor
        if cadena_raw:
            try:
                cadena = PorterChain(**json.loads(cadena_raw))
            except Exception:
                cadena = PorterChain.default()
        else:
            cadena = PorterChain.default()

        return CompanyResponse(
            id=UUID(row.id),
            razon_social=row.razon_social,
            nombre_corto=row.nombre_corto,
            sector=row.sector,
            tamano=row.tamano,
            mision=row.mision,
            vision=row.vision,
            valores=row.valores,
            objetivos_estrategicos=objetivos,
            estrategias=estrategias,
            kpis=kpis,
            poa=poa,
            mapa_procesos=mapa_procesos,
            planificacion_estrategica=row.planificacion_estrategica,
            cadena_valor=cadena,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
