"""HTTP entrypoint.

Run with the factory so nothing executes at import time:
    uvicorn --factory engine.entrypoints.api.main:create_app
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engine.adapters.jesse.bootstrap import assert_jesse_project
from engine.entrypoints.api.deps import detect_versions
from engine.entrypoints.api.errors import register_error_handlers
from engine.entrypoints.api.routers import backtest, health, strategy
from engine.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    # Fail at startup with a clear message instead of on the first backtest:
    # Jesse only enables its DB when strategies/ and storage/ exist in cwd and
    # reads .env as a file; missing either ends in an opaque os._exit(1).
    if settings.require_jesse_project:
        assert_jesse_project()

    # The git SHA is part of every run_hash. With a placeholder, a rebuilt
    # engine would hash the same backtest identically to the previous build.
    if not settings.has_git_sha:
        raise RuntimeError(
            f"ENGINE_GIT_SHA must be the engine's commit SHA, got {settings.git_sha!r}"
        )

    app = FastAPI(
        title="TradeMCP Strategy Engine",
        version=settings.engine_version,
        description="Quant research and strategy execution on Jesse",
    )
    app.state.settings = settings
    app.state.versions = detect_versions(settings)

    # The engine is not browser-facing: CORS stays closed unless configured.
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["POST", "GET"],
            allow_headers=["*"],
        )

    app.include_router(health.router)
    app.include_router(strategy.router)
    app.include_router(backtest.router)
    register_error_handlers(app)
    return app
