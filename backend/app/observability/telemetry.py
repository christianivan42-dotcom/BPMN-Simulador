"""
OpenTelemetry instrumentation bootstrap.

Call `setup_telemetry(app)` once at FastAPI startup.  When `settings.otel_enabled`
is False (default in dev), this is a no-op — no imports from opentelemetry packages
are executed so the server starts even if the packages are not installed.
"""
from __future__ import annotations

from app.core.logging import get_logger

logger = get_logger(__name__)


def setup_telemetry(app) -> None:  # `app` is the FastAPI instance
    from app.core.config import settings

    if not settings.otel_enabled:
        logger.info("OpenTelemetry disabled (OTEL_ENABLED=false)")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        resource = Resource.create({"service.name": settings.otel_service_name})
        provider = TracerProvider(resource=resource)

        otlp_exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
        provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

        trace.set_tracer_provider(provider)

        # Instrument FastAPI (auto-traces every request)
        FastAPIInstrumentor.instrument_app(app)

        # Instrument SQLAlchemy (auto-traces every query)
        SQLAlchemyInstrumentor().instrument()

        logger.info(
            "OpenTelemetry configured",
            service=settings.otel_service_name,
            endpoint=settings.otel_exporter_otlp_endpoint,
        )

    except ImportError as exc:
        logger.warning(
            "OpenTelemetry packages not installed — tracing disabled. Install "
            "opentelemetry-sdk, opentelemetry-instrumentation-fastapi, "
            "opentelemetry-exporter-otlp-proto-grpc. Error: %s",
            exc,
        )
    except Exception:
        logger.exception("Failed to configure OpenTelemetry — continuing without tracing")
