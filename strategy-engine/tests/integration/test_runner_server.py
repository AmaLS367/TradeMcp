"""Exercise the long-lived runner server through a real TCP socket."""

import asyncio
import os
import time

import numpy as np
import pytest

from engine.adapters.sandbox.codec import (
    decode_result,
    encode_job,
    read_frame,
    write_frame,
)
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DatasetRef, DateRange
from engine.domain.runtime.contracts import RunnerJob, RunnerStatus, RuntimeMode
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

HANGING = """
from jesse.strategies import Strategy

class Hanging(Strategy):
    def should_long(self) -> bool:
        while True:
            pass
    def go_long(self) -> None:
        pass
"""


# Leaves a process that has left the worker's session, so killing the worker's
# process group alone would not catch it.
ORPHANING = """
from jesse.strategies import Strategy
import jesse.helpers as jh

jh.os.system("setsid sleep 300 >/dev/null 2>&1 &")

class Orphaning(Strategy):
    def should_long(self) -> bool:
        return self.index == 10
    def go_long(self) -> None:
        self.buy = 1, self.price
    def should_short(self) -> bool:
        return False
"""

WORKER_UID_BASE = 20_000


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


def _job(source: str, class_name: str, timeout: float) -> RunnerJob:
    return RunnerJob(
        job_id="job-1",
        mode=RuntimeMode.BACKTEST,
        source_code=source,
        strategy_class_name=class_name,
        parameters={},
        config=BacktestConfig(
            exchange="Binance Perpetual Futures",
            symbol="BTC-USDT",
            timeframe="1m",
            initial_balance=10_000.0,
            fee_rate=0.0,
        ),
        warmup_rows=0,
        timeout_seconds=timeout,
    )


@pytest.fixture
def settings() -> Settings:
    return Settings(
        runner_transport="tcp",
        runner_host="127.0.0.1",
        runner_port=0,
        runner_timeout_seconds=10.0,
    )


async def _ask(
    server: RunnerServer,
    job: RunnerJob,
    bundle: CandleBundle,
):
    host, port = server.bound_address
    reader, writer = await asyncio.open_connection(host, port)
    try:
        await write_frame(writer, encode_job(job, bundle))
        return decode_result(await read_frame(reader))
    finally:
        writer.close()
        await writer.wait_closed()


async def test_server_runs_a_backtest(settings: Settings) -> None:
    from jesse.research import fake_range_candles

    server = RunnerServer(settings)
    await server.start()
    try:
        result = await _ask(
            server,
            _job(FAST, "Fast", 60.0),
            _bundle(fake_range_candles(300)),
        )
    finally:
        await server.stop()

    assert result.status is RunnerStatus.OK
    assert result.metrics is not None


async def test_worker_runs_in_a_private_scratch_dir_that_is_removed(
    settings: Settings,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Jesse writes storage/ relative to cwd; the runner root is read-only."""
    import tempfile

    from jesse.research import fake_range_candles

    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    server = RunnerServer(settings)
    await server.start()
    try:
        result = await _ask(
            server,
            _job(FAST, "Fast", 60.0),
            _bundle(fake_range_candles(300)),
        )
    finally:
        await server.stop()

    assert result.status is RunnerStatus.OK, result.error
    assert list(tmp_path.iterdir()) == [], "per-run scratch dir must be cleaned up"


async def test_job_deadline_kills_hung_worker_and_server_survives(
    settings: Settings,
) -> None:
    """A job deadline shorter than the server cap must be enforced."""
    from jesse.research import fake_range_candles

    candles = fake_range_candles(300)
    server = RunnerServer(settings)
    await server.start()
    started = time.monotonic()
    try:
        hung = await _ask(
            server,
            _job(HANGING, "Hanging", 1.0),
            _bundle(candles),
        )
        elapsed = time.monotonic() - started
        assert hung.status is RunnerStatus.TIMEOUT
        assert hung.job_id == "job-1"
        assert elapsed < 5.0

        healthy = await _ask(
            server,
            _job(FAST, "Fast", 60.0),
            _bundle(candles),
        )
    finally:
        await server.stop()

    assert healthy.status is RunnerStatus.OK


@pytest.mark.skipif(
    os.name != "posix" or os.geteuid() != 0,
    reason="per-slot worker uids need a root runner, as in the runner container",
)
async def test_isolated_worker_runs_as_its_slot_uid_and_leaves_nothing_behind(
    settings: Settings,
) -> None:
    from jesse.research import fake_range_candles

    from engine.entrypoints.runner.server import _pids_owned_by

    server = RunnerServer(
        settings.model_copy(update={"runner_worker_uid_base": WORKER_UID_BASE})
    )
    await server.start()
    try:
        result = await _ask(
            server,
            _job(ORPHANING, "Orphaning", 60.0),
            _bundle(fake_range_candles(300)),
        )
    finally:
        await server.stop()

    assert result.status is RunnerStatus.OK, result.error
    assert _pids_owned_by(WORKER_UID_BASE) == [], "the slot uid must be reaped"
