"""The only place where domain errors meet HTTP."""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from engine.domain.shared.errors import (
    DatasetUnavailable,
    RunnerCrashed,
    RunnerTimeout,
    SourceValidationError,
)

logger = logging.getLogger(__name__)

_STATUS_BY_ERROR: dict[type[Exception], int] = {
    SourceValidationError: 422,
    DatasetUnavailable: 409,
    RunnerTimeout: 504,
    RunnerCrashed: 502,
}


def _domain_handler(status_code: int):
    async def _handler(_: Request, exc: Exception) -> JSONResponse:
        detail = getattr(exc, "errors", None) or (str(exc),)
        return JSONResponse(
            status_code=status_code,
            content={"error": type(exc).__name__, "detail": list(detail)},
        )

    return _handler


def register_error_handlers(app: FastAPI) -> None:
    for error_type, status_code in _STATUS_BY_ERROR.items():
        app.add_exception_handler(error_type, _domain_handler(status_code))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        request_id = str(uuid.uuid4())
        # The traceback stays in the logs; clients only get an id to look it up.
        logger.exception(
            "unhandled error on %s %s [request_id=%s]",
            request.method,
            request.url.path,
            request_id,
            exc_info=exc,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "InternalError", "request_id": request_id},
        )
