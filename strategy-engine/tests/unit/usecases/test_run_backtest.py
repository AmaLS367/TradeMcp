import pytest

from engine.adapters.sandbox.fake_runner import FakeRunner
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DatasetRef, DateRange
from engine.domain.runtime.contracts import RunnerError, RunnerResult, RunnerStatus
from engine.domain.shared.errors import (
    RunnerCrashed,
    RunnerTimeout,
    SourceValidationError,
)
from engine.usecases.backtest.run_backtest import (
    BacktestCommand,
    EngineVersions,
    RunBacktest,
)

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""

RANGE = DateRange(1_600_000_000_000, 1_600_086_400_000)
CONFIG = BacktestConfig(
    exchange="Binance",
    symbol="BTC-USDT",
    timeframe="1h",
    initial_balance=10_000.0,
    fee_rate=0.0006,
)
VERSIONS = EngineVersions(engine="0.2.0+abc1234", jesse="3.1.3")


def _bundle(dataset_hash: str = "d" * 64) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance",
        symbol="BTC-USDT",
        timeframe="1h",
        date_range=RANGE,
        warmup_rows=10,
        trading_rows=100,
        columns=6,
        dtype="float64",
        dataset_hash=dataset_hash,
    )
    return CandleBundle(
        ref=ref,
        warmup=b"\x01" * 480,
        trading=b"\x02" * 4_800,
    )


class _Repo:
    def __init__(self, bundle: CandleBundle) -> None:
        self.bundle = bundle
        self.calls: list[tuple[str, dict]] = []

    def ensure(self, **kwargs) -> None:
        self.calls.append(("ensure", kwargs))

    def load(self, **kwargs) -> CandleBundle:
        self.calls.append(("load", kwargs))
        return self.bundle


def _ok_runner() -> FakeRunner:
    return FakeRunner(
        RunnerResult(
            job_id="ignored-by-fake",
            status=RunnerStatus.OK,
            metrics=BacktestMetrics(net_return_percent=12.5, total_trades=3),
            equity_curve=(EquityPoint(1_600_000_000_000, 10_000.0),),
        )
    )


def _command() -> BacktestCommand:
    return BacktestCommand(
        source_code=GOOD,
        parameters={"period": 14},
        config=CONFIG,
        date_range=RANGE,
        warmup_candles_num=10,
        timeout_seconds=60.0,
    )


async def test_successful_run_returns_all_three_hashes_and_equity() -> None:
    outcome = await RunBacktest(_Repo(_bundle()), _ok_runner(), VERSIONS).execute(
        _command()
    )

    assert len(outcome.strategy_hash) == 64
    assert outcome.dataset_ref.dataset_hash == "d" * 64
    assert len(outcome.run_hash) == 64
    assert outcome.metrics.net_return_percent == 12.5
    assert outcome.equity_curve == (
        EquityPoint(1_600_000_000_000, 10_000.0),
    )


async def test_same_inputs_give_the_same_run_hash() -> None:
    first = await RunBacktest(_Repo(_bundle()), _ok_runner(), VERSIONS).execute(
        _command()
    )
    second = await RunBacktest(_Repo(_bundle()), _ok_runner(), VERSIONS).execute(
        _command()
    )

    assert first.run_hash == second.run_hash


async def test_different_dataset_gives_a_different_run_hash() -> None:
    first = await RunBacktest(
        _Repo(_bundle("d" * 64)), _ok_runner(), VERSIONS
    ).execute(_command())
    second = await RunBacktest(
        _Repo(_bundle("e" * 64)), _ok_runner(), VERSIONS
    ).execute(_command())

    assert first.run_hash != second.run_hash


async def test_invalid_source_never_reaches_dataset_or_runner() -> None:
    repo = _Repo(_bundle())
    runner = _ok_runner()
    command = BacktestCommand(
        source_code="import os\n",
        parameters={},
        config=CONFIG,
        date_range=RANGE,
        warmup_candles_num=0,
        timeout_seconds=60.0,
    )

    with pytest.raises(SourceValidationError):
        await RunBacktest(repo, runner, VERSIONS).execute(command)

    assert repo.calls == []
    assert runner.calls == []


async def test_runner_timeout_becomes_domain_error() -> None:
    runner = FakeRunner(
        RunnerResult(
            job_id="ignored-by-fake",
            status=RunnerStatus.TIMEOUT,
            error=RunnerError(type="RunnerTimeout", message="deadline exceeded"),
        )
    )

    with pytest.raises(RunnerTimeout, match="deadline exceeded"):
        await RunBacktest(_Repo(_bundle()), runner, VERSIONS).execute(_command())


async def test_runner_failure_becomes_domain_error() -> None:
    runner = FakeRunner(
        RunnerResult(
            job_id="ignored-by-fake",
            status=RunnerStatus.RUNTIME_ERROR,
            error=RunnerError(type="ValueError", message="strategy exploded"),
        )
    )

    with pytest.raises(RunnerCrashed, match="strategy exploded"):
        await RunBacktest(_Repo(_bundle()), runner, VERSIONS).execute(_command())


async def test_complete_job_reaches_the_runner() -> None:
    repo = _Repo(_bundle())
    runner = _ok_runner()

    await RunBacktest(repo, runner, VERSIONS).execute(_command())

    job, bundle = runner.calls[0]
    assert job.parameters == {"period": 14}
    assert job.strategy_class_name == "Good"
    assert job.timeout_seconds == 60.0
    assert bundle.ref.dataset_hash == "d" * 64
    assert repo.calls[0][1]["timeframe"] == "1h"
    assert repo.calls[0][1]["warmup_candles_num"] == 10


@pytest.mark.parametrize(
    ("field", "value"),
    [("warmup_candles_num", -1), ("timeout_seconds", 0.0)],
)
def test_command_rejects_invalid_execution_limits(field: str, value: float) -> None:
    values = {
        "source_code": GOOD,
        "parameters": {},
        "config": CONFIG,
        "date_range": RANGE,
        "warmup_candles_num": 10,
        "timeout_seconds": 60.0,
    }
    values[field] = value

    with pytest.raises(ValueError):
        BacktestCommand(**values)
