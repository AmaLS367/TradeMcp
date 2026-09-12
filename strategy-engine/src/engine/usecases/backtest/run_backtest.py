from __future__ import annotations

import asyncio
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from engine.domain.backtest.hashing import run_hash
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DatasetRef, DateRange
from engine.domain.runtime.contracts import RunnerJob, RunnerStatus, RuntimeMode
from engine.domain.shared.errors import (
    RunnerCrashed,
    RunnerTimeout,
    SourceValidationError,
)
from engine.usecases.dataset.ensure_dataset import EnsureDataset
from engine.usecases.ports.candles import CandleRepository
from engine.usecases.ports.runner import StrategyRunner
from engine.usecases.strategy.validate_strategy import ValidateStrategy


@dataclass(frozen=True)
class EngineVersions:
    engine: str
    jesse: str


@dataclass(frozen=True)
class BacktestCommand:
    source_code: str
    parameters: Mapping[str, Any]
    config: BacktestConfig
    date_range: DateRange
    warmup_candles_num: int
    timeout_seconds: float

    def __post_init__(self) -> None:
        if (
            isinstance(self.warmup_candles_num, bool)
            or not isinstance(self.warmup_candles_num, int)
            or self.warmup_candles_num < 0
        ):
            raise ValueError("warmup_candles_num must be a non-negative integer")
        if (
            isinstance(self.timeout_seconds, bool)
            or not isinstance(self.timeout_seconds, (int, float))
            or self.timeout_seconds <= 0
        ):
            raise ValueError("timeout_seconds must be positive")


@dataclass(frozen=True)
class BacktestOutcome:
    strategy_hash: str
    dataset_ref: DatasetRef
    run_hash: str
    metrics: BacktestMetrics
    equity_curve: tuple[EquityPoint, ...] = field(default_factory=tuple)


class RunBacktest:
    def __init__(
        self,
        candles: CandleRepository,
        runner: StrategyRunner,
        versions: EngineVersions,
    ) -> None:
        self._ensure_dataset = EnsureDataset(candles)
        self._validate = ValidateStrategy()
        self._runner = runner
        self._versions = versions

    async def execute(self, command: BacktestCommand) -> BacktestOutcome:
        validated = self._validate.execute(
            command.source_code,
            command.parameters,
        )
        if not validated.validation.valid or validated.strategy_hash is None:
            raise SourceValidationError(validated.validation.errors)
        strategy_class_name = validated.validation.strategy_class_name
        if strategy_class_name is None:
            raise SourceValidationError(("strategy class was not detected",))

        # Jesse's repository API is synchronous and may import minutes of data.
        # Keep that work away from the async API event loop.
        bundle = await asyncio.to_thread(
            self._ensure_dataset.execute,
            exchange=command.config.exchange,
            symbol=command.config.symbol,
            timeframe=command.config.timeframe,
            date_range=command.date_range,
            warmup_candles_num=command.warmup_candles_num,
        )

        computed_run_hash = run_hash(
            strategy_hash=validated.strategy_hash,
            dataset_hash=bundle.ref.dataset_hash,
            engine_version=self._versions.engine,
            jesse_version=self._versions.jesse,
            config=command.config,
            date_range=command.date_range,
            warmup_rows=bundle.ref.warmup_rows,
        )
        job = RunnerJob(
            job_id=str(uuid.uuid4()),
            mode=RuntimeMode.BACKTEST,
            source_code=command.source_code,
            strategy_class_name=strategy_class_name,
            parameters=dict(command.parameters),
            config=command.config,
            warmup_rows=bundle.ref.warmup_rows,
            timeout_seconds=float(command.timeout_seconds),
        )

        result = await self._runner.run(job, bundle)
        if result.job_id != job.job_id:
            raise RunnerCrashed("runner returned a response for a different job")
        if result.status is RunnerStatus.TIMEOUT:
            raise RunnerTimeout(
                result.error.message if result.error else "runner deadline exceeded"
            )
        if result.status is RunnerStatus.INVALID_STRATEGY:
            raise SourceValidationError(
                (result.error.message,)
                if result.error
                else ("strategy was rejected by the runner",)
            )
        if result.status is not RunnerStatus.OK or result.metrics is None:
            raise RunnerCrashed(
                result.error.message
                if result.error
                else f"runner returned status {result.status.value}"
            )

        return BacktestOutcome(
            strategy_hash=validated.strategy_hash,
            dataset_ref=bundle.ref,
            run_hash=computed_run_hash,
            metrics=result.metrics,
            equity_curve=result.equity_curve,
        )
