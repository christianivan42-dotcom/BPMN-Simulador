from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.company import CompanyCreate, CompanyResponse, CompanyUpdate
from app.services.company_service import CompanyService

router = APIRouter()


@router.get("", response_model=list[CompanyResponse])
def listar_empresas(db: Session = Depends(get_db)):
    return CompanyService(db).listar()


@router.get("/primera", response_model=CompanyResponse | None)
def obtener_primera_empresa(db: Session = Depends(get_db)):
    """Retorna la primera empresa registrada (útil para onboarding single-tenant)."""
    return CompanyService(db).obtener_primera()


@router.post("", response_model=CompanyResponse, status_code=status.HTTP_201_CREATED)
def crear_empresa(payload: CompanyCreate, db: Session = Depends(get_db)):
    return CompanyService(db).crear(payload)


@router.get("/{company_id}", response_model=CompanyResponse)
def obtener_empresa(company_id: UUID, db: Session = Depends(get_db)):
    result = CompanyService(db).obtener(company_id)
    if not result:
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    return result


@router.patch("/{company_id}", response_model=CompanyResponse)
def actualizar_empresa(company_id: UUID, payload: CompanyUpdate, db: Session = Depends(get_db)):
    result = CompanyService(db).actualizar(company_id, payload)
    if not result:
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    return result


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_empresa(company_id: UUID, db: Session = Depends(get_db)):
    if not CompanyService(db).eliminar(company_id):
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
