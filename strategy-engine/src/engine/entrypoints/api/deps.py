"""Composition root: the only place where adapters are wired into use cases.

Everything reads settings from ``app.state`` rather than the global cache, so an
app built with explicit Settings (tests, multiple configurations) never falls
back to environment variables.
"""

from __future__ import annotations

import secrets
from importlib.metadata import PackageNotFoundError, version
from typing import Annotated

from fastapi import Header, HTTPException, Request

from engine.adapters.jesse.candles import JesseCandleRepository
from engine.adapters.sandbox.uds_runner import SocketStrategyRunner
from engine.settings import Settings
from engine.usecases.backtest.run_backtest import EngineVersions, RunBacktest
from engine.usecases.strategy.validate_strategy import ValidateStrategy


def detect_versions(settings: Settings) -> EngineVersions:
    try:
        jesse_version = version("jesse")
    except PackageNotFoundError:
        jesse_version = "unknown"
    return EngineVersions(engine=settings.full_engine_version, jesse=jesse_version)


def get_validate_strategy() -> ValidateStrategy:
    return ValidateStrategy()


def get_run_backtest(request: Request) -> RunBacktest:
    return RunBacktest(
        candles=JesseCandleRepository(),
        runner=SocketStrategyRunner(request.app.state.settings),
        versions=request.app.state.versions,
    )


async def require_token(
    request: Request,
    x_engine_token: Annotated[str | None, Header()] = None,
) -> None:
    expected: str | None = request.app.state.settings.api_token
    if not expected:
        return
    if x_engine_token is None or not secrets.compare_digest(
        x_engine_token.encode(), expected.encode()
    ):
        raise HTTPException(status_code=401, detail="invalid or missing X-Engine-Token")
