"""Process-boundary contracts shared by orchestrator and isolated runner."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig


class RuntimeMode(str, Enum):
    BACKTEST = "backtest"


class RunnerStatus(str, Enum):
    OK = "ok"
    INVALID_STRATEGY = "invalid_strategy"
    TIMEOUT = "timeout"
    RUNTIME_ERROR = "runtime_error"
    MEMORY_EXCEEDED = "memory_exceeded"


@dataclass(frozen=True)
class RunnerError:
    type: str
    message: str
    traceback_tail: str = ""


@dataclass(frozen=True)
class RunnerJob:
    job_id: str
    mode: RuntimeMode
    source_code: str
    strategy_class_name: str
    parameters: dict[str, Any]
    config: BacktestConfig
    warmup_rows: int
    timeout_seconds: float


@dataclass(frozen=True)
class RunnerResult:
    job_id: str
    status: RunnerStatus
    metrics: BacktestMetrics | None = None
    equity_curve: tuple[EquityPoint, ...] = ()
    error: RunnerError | None = None
