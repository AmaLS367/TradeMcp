"""Exercise the runner worker through its real subprocess boundary."""

import subprocess
import sys

import numpy as np
import pytest

from engine.adapters.sandbox.codec import decode_result, encode_job
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DatasetRef, DateRange
from engine.domain.runtime.contracts import RunnerJob, RunnerStatus, RuntimeMode

pytestmark = pytest.mark.integration

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return self.index == 10
    def go_long(self) -> None:
        self.buy = 1, self.price
    def should_short(self) -> bool:
        return False
"""

EXPLODING = """
from jesse.strategies import Strategy

class Boom(Strategy):
    def should_long(self) -> bool:
        return 1 / 0
    def go_long(self) -> None:
        pass
"""


def _bundle(trading: np.ndarray) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance",
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


def _job(source: str, class_name: str) -> RunnerJob:
    return RunnerJob(
        job_id="job-1",
        mode=RuntimeMode.BACKTEST,
        source_code=source,
        strategy_class_name=class_name,
        parameters={},
        config=BacktestConfig(
            exchange="Binance",
            symbol="BTC-USDT",
            timeframe="1m",
            initial_balance=10_000.0,
            fee_rate=0.0,
        ),
        warmup_rows=0,
        timeout_seconds=60.0,
    )


def _run_worker(payload: bytes) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-m", "engine.entrypoints.runner.worker"],
        input=payload,
        capture_output=True,
        timeout=180,
        check=False,
    )


def test_worker_returns_metrics_for_valid_strategy() -> None:
    from jesse.research import fake_range_candles

    proc = _run_worker(encode_job(_job(GOOD, "Good"), _bundle(fake_range_candles(300))))
    assert proc.returncode == 0, proc.stderr.decode()

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.OK
    assert result.metrics is not None


def test_worker_reports_runtime_error_without_crashing() -> None:
    from jesse.research import fake_range_candles

    proc = _run_worker(
        encode_job(_job(EXPLODING, "Boom"), _bundle(fake_range_candles(300)))
    )
    assert proc.returncode == 0, "worker must return a frame instead of crashing"

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.RUNTIME_ERROR
    assert result.error is not None
    assert "ZeroDivisionError" in result.error.type


def test_worker_rejects_source_failing_policy() -> None:
    from jesse.research import fake_range_candles

    bad = GOOD + "\nimport os\n"
    proc = _run_worker(
        encode_job(_job(bad, "Good"), _bundle(fake_range_candles(300)))
    )

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.INVALID_STRATEGY


def test_worker_keeps_stdout_clean_for_the_protocol() -> None:
    from jesse.research import fake_range_candles

    noisy = GOOD.replace(
        "    def go_long(self) -> None:\n        self.buy = 1, self.price",
        "    def go_long(self) -> None:\n        print('noise from strategy')\n"
        "        self.buy = 1, self.price",
    )
    proc = _run_worker(
        encode_job(_job(noisy, "Good"), _bundle(fake_range_candles(300)))
    )

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.OK
    assert b"noise from strategy" in proc.stderr
