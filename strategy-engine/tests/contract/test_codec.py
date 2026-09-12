import asyncio
import dataclasses
import math
from typing import cast

import numpy as np
import pytest

from engine.adapters.sandbox.codec import (
    decode_job,
    decode_result,
    encode_job,
    encode_result,
    read_frame,
    write_frame,
)
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DatasetRef, DateRange
from engine.domain.runtime.contracts import (
    RunnerError,
    RunnerJob,
    RunnerResult,
    RunnerStatus,
    RuntimeMode,
)

CONFIG = BacktestConfig(
    exchange="Binance",
    symbol="BTC-USDT",
    timeframe="1h",
    initial_balance=10_000.0,
    fee_rate=0.0006,
)


def _bundle(warmup: np.ndarray, trading: np.ndarray) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance",
        symbol="BTC-USDT",
        timeframe="1m",
        date_range=DateRange(1_600_000_000_000, 1_600_086_400_000),
        warmup_rows=len(warmup),
        trading_rows=len(trading),
        columns=6,
        dtype="float64",
        dataset_hash="d" * 64,
    )
    return CandleBundle(
        ref=ref,
        warmup=np.ascontiguousarray(warmup).tobytes(),
        trading=np.ascontiguousarray(trading).tobytes(),
    )


def _job(*, warmup_rows: int = 2) -> RunnerJob:
    return RunnerJob(
        job_id="job-1",
        mode=RuntimeMode.BACKTEST,
        source_code="class S: pass",
        strategy_class_name="S",
        parameters={"period": 14},
        config=CONFIG,
        warmup_rows=warmup_rows,
        timeout_seconds=30.0,
    )


def test_job_round_trip_preserves_candles_exactly() -> None:
    warmup = np.arange(12, dtype=np.float64).reshape(2, 6)
    trading = np.arange(100, 118, dtype=np.float64).reshape(3, 6)

    job, decoded_warmup, decoded_trading = decode_job(
        encode_job(_job(), _bundle(warmup, trading))
    )

    assert job.job_id == "job-1"
    assert job.parameters == {"period": 14}
    assert job.config == CONFIG
    np.testing.assert_array_equal(decoded_warmup, warmup)
    np.testing.assert_array_equal(decoded_trading, trading)


def test_candles_survive_full_float64_precision() -> None:
    trading = np.array(
        [[1.0000000000000002, 2.0, 3.0, 4.0, 5.0, 6.0]], dtype=np.float64
    )
    warmup = np.empty((0, 6), dtype=np.float64)

    _, _, decoded = decode_job(
        encode_job(_job(warmup_rows=0), _bundle(warmup, trading))
    )

    assert decoded[0, 0].item() == trading[0, 0].item()


def test_empty_warmup_round_trips() -> None:
    warmup = np.empty((0, 6), dtype=np.float64)
    trading = np.ones((1, 6), dtype=np.float64)

    _, decoded_warmup, _ = decode_job(
        encode_job(_job(warmup_rows=0), _bundle(warmup, trading))
    )

    assert decoded_warmup.shape == (0, 6)


def test_ok_result_round_trip() -> None:
    result = RunnerResult(
        job_id="job-1",
        status=RunnerStatus.OK,
        metrics=BacktestMetrics(
            net_return_percent=12.5,
            sharpe=None,
            total_trades=7,
        ),
        equity_curve=(EquityPoint(1_600_000_000_000, 10_000.0),),
        error=None,
    )

    decoded = decode_result(encode_result(result))

    assert decoded.status is RunnerStatus.OK
    assert decoded.metrics == result.metrics
    assert decoded.metrics is not None
    assert decoded.metrics.sharpe is None
    assert decoded.equity_curve == result.equity_curve


def test_error_result_round_trip() -> None:
    result = RunnerResult(
        job_id="job-1",
        status=RunnerStatus.RUNTIME_ERROR,
        metrics=None,
        equity_curve=(),
        error=RunnerError(
            type="ZeroDivisionError",
            message="division by zero",
            traceback_tail="...",
        ),
    )

    decoded = decode_result(encode_result(result))

    assert decoded.status is RunnerStatus.RUNTIME_ERROR
    assert decoded.error == result.error
    assert decoded.metrics is None


def test_result_codec_rejects_non_finite_metrics() -> None:
    result = RunnerResult(
        job_id="job-1",
        status=RunnerStatus.OK,
        metrics=BacktestMetrics(sharpe=math.nan),
    )

    with pytest.raises(ValueError):
        encode_result(result)

    with pytest.raises(ValueError, match="valid JSON"):
        decode_result(
            b'{"job_id":"job-1","status":"ok","metrics":{"sharpe":NaN}}'
        )


def test_encode_job_rejects_descriptor_byte_mismatch() -> None:
    warmup = np.empty((0, 6), dtype=np.float64)
    trading = np.ones((1, 6), dtype=np.float64)
    bundle = _bundle(warmup, trading)
    invalid_ref = dataclasses.replace(bundle.ref, trading_rows=2)

    with pytest.raises(ValueError, match="trading"):
        encode_job(
            _job(warmup_rows=0),
            dataclasses.replace(bundle, ref=invalid_ref),
        )


def test_encode_job_rejects_non_float64_descriptor() -> None:
    warmup = np.empty((0, 6), dtype=np.float64)
    trading = np.ones((1, 6), dtype=np.float64)
    bundle = _bundle(warmup, trading)
    invalid_ref = dataclasses.replace(bundle.ref, dtype="float32")

    with pytest.raises(ValueError, match="float64"):
        encode_job(
            _job(warmup_rows=0),
            dataclasses.replace(bundle, ref=invalid_ref),
        )


def test_decode_job_rejects_truncated_payload() -> None:
    warmup = np.empty((0, 6), dtype=np.float64)
    trading = np.ones((1, 6), dtype=np.float64)
    payload = encode_job(_job(warmup_rows=0), _bundle(warmup, trading))

    with pytest.raises(ValueError, match="payload length"):
        decode_job(payload[:-1])


def test_decode_job_rejects_trailing_payload() -> None:
    warmup = np.empty((0, 6), dtype=np.float64)
    trading = np.ones((1, 6), dtype=np.float64)
    payload = encode_job(_job(warmup_rows=0), _bundle(warmup, trading))

    with pytest.raises(ValueError, match="payload length"):
        decode_job(payload + b"unexpected")


class _MemoryWriter:
    def __init__(self) -> None:
        self.data = bytearray()
        self.drained = False

    def write(self, data: bytes) -> None:
        self.data.extend(data)

    async def drain(self) -> None:
        self.drained = True


@pytest.mark.asyncio
async def test_frame_round_trip() -> None:
    writer = _MemoryWriter()
    await write_frame(cast(asyncio.StreamWriter, writer), b"payload")

    reader = asyncio.StreamReader()
    reader.feed_data(bytes(writer.data))
    reader.feed_eof()

    assert await read_frame(reader) == b"payload"
    assert writer.drained
