"""
RFC 7807 Problem Details para todas las respuestas de error HTTP.

El handler registrado en main.py convierte cualquier HTTPException lanzada
en los routers al formato estándar:

    {
      "type": "https://bpms.local/errors/not-found",
      "title": "Not Found",
      "status": 404,
      "detail": "...",
      "instance": "/api/v1/process-cases/abc"
    }

Los routers existentes no necesitan cambios — siguen usando raise HTTPException().
"""

from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse

_STATUS_TITLES: dict[int, str] = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
}

_STATUS_TYPES: dict[int, str] = {
    400: "https://bpms.local/errors/bad-request",
    401: "https://bpms.local/errors/unauthorized",
    403: "https://bpms.local/errors/forbidden",
    404: "https://bpms.local/errors/not-found",
    409: "https://bpms.local/errors/conflict",
    422: "https://bpms.local/errors/validation-error",
    500: "https://bpms.local/errors/internal-server-error",
}

_DEFAULT_TYPE = "https://bpms.local/errors/error"


def _problem(status: int, detail: str, instance: str) -> dict:
    return {
        "type": _STATUS_TYPES.get(status, _DEFAULT_TYPE),
        "title": _STATUS_TITLES.get(status, "Error"),
        "status": status,
        "detail": detail,
        "instance": instance,
    }


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    body = _problem(
        status=exc.status_code,
        detail=str(exc.detail),
        instance=str(request.url.path),
    )
    return JSONResponse(status_code=exc.status_code, content=body)


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    detail = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in errors)
    body = _problem(status=422, detail=detail, instance=str(request.url.path))
    return JSONResponse(status_code=422, content=body)
