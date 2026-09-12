"""Integration tests for the socket-backed StrategyRunner adapter."""

import numpy as np
import pytest

from engine.adapters.sandbox.uds_runner import SocketStrategyRunner
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DatasetRef, DateRange
from engine.domain.runtime.contracts import RunnerJob, RunnerStatus, RuntimeMode
from engine.domain.shared.errors import RunnerCrashed
from engine.entrypoints.runner.server import RunnerServer
from engine.settings import Settings

pytestmark = pytest.mark.integration

FAST = """
from jesse.strategies import Strategy

class Fast(Strategy):
    def should_long(self) -> bool:
        return self.index == 10
    def go_long(self) -> None:
        self.buy = 1, self.price
    def should_short(self) -> bool:
        return False
"""


def _bundle(trading: np.ndarray) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance Perpetual Futures",
        symbol="BTC-USDT",
        timeframe="1m",
        date_range=DateRange(int(trading[0, 0]), int(trading[-1, 0]) + 60_000),
        warmup_rows=0,
        trading_rows=len(trading),
        columns=6,
        dtype="float64",
        dataset_hash="d" * 64,
    )
    return CandleBundle(ref=ref, warmup=b"", trading=trading.tobytes())


def _job() -> RunnerJob:
    return RunnerJob(
        job_id="job-1",
        mode=RuntimeMode.BACKTEST,
        source_code=FAST,
        strategy_class_name="Fast",
        parameters={},
        config=BacktestConfig(
            exchange="Binance Perpetual Futures",
            symbol="BTC-USDT",
            timeframe="1m",
            initial_balance=10_000.0,
            fee_rate=0.0,
        ),
        warmup_rows=0,
        timeout_seconds=60.0,
    )


async def test_client_and_server_speak_the_same_protocol() -> None:
    from jesse.research import fake_range_candles

    server_settings = Settings(
        runner_transport="tcp",
        runner_host="127.0.0.1",
        runner_port=0,
    )
    server = RunnerServer(server_settings)
    await server.start()
    host, port = server.bound_address
    try:
        runner = SocketStrategyRunner(
            Settings(
                runner_transport="tcp",
                runner_host=host,
                runner_port=port,
            )
        )
        result = await runner.run(_job(), _bundle(fake_range_candles(300)))
    finally:
        await server.stop()

    assert result.status is RunnerStatus.OK
    assert result.job_id == "job-1"


async def test_unreachable_runner_raises_runner_crashed() -> None:
    runner = SocketStrategyRunner(
        Settings(
            runner_transport="tcp",
            runner_host="127.0.0.1",
            runner_port=1,
            runner_timeout_seconds=1.0,
        )
    )

    with pytest.raises(RunnerCrashed, match="unavailable"):
        await runner.run(
            _job(),
            _bundle(np.ones((2, 6), dtype=np.float64)),
        )
