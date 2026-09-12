"""Framed binary protocol between the orchestrator and isolated runner.

Job payloads contain an eight-byte big-endian JSON-header length, the header,
then warmup and trading candles as raw float64 bytes. Stream frames add a
separate eight-byte payload length before that complete payload.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import struct
from typing import Any

import numpy as np

from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle
from engine.domain.runtime.contracts import (
    RunnerError,
    RunnerJob,
    RunnerResult,
    RunnerStatus,
    RuntimeMode,
)
from engine.domain.shared.hashing import canonical_json

_HEADER_LEN = struct.Struct(">Q")
_FRAME_LEN = struct.Struct(">Q")
_FLOAT64 = np.dtype("float64")
_MAX_FRAME_BYTES = 128 * 1024 * 1024


def _validate_bundle(job: RunnerJob, bundle: CandleBundle) -> None:
    ref = bundle.ref
    if ref.dtype != "float64":
        raise ValueError("candle dtype must be float64")
    if (
        isinstance(ref.columns, bool)
        or not isinstance(ref.columns, int)
        or ref.columns <= 0
    ):
        raise TypeError("candle columns must be a positive integer")
    if any(
        isinstance(rows, bool) or not isinstance(rows, int) or rows < 0
        for rows in (ref.warmup_rows, ref.trading_rows)
    ):
        raise TypeError("candle row counts must be non-negative integers")
    if job.warmup_rows != ref.warmup_rows:
        raise ValueError("job warmup_rows does not match the dataset descriptor")
    if (
        isinstance(job.timeout_seconds, bool)
        or not isinstance(job.timeout_seconds, (int, float))
        or job.timeout_seconds <= 0
    ):
        raise ValueError("job timeout_seconds must be positive")

    row_bytes = ref.columns * _FLOAT64.itemsize
    if len(bundle.warmup) != ref.warmup_rows * row_bytes:
        raise ValueError("warmup bytes do not match the dataset descriptor")
    if len(bundle.trading) != ref.trading_rows * row_bytes:
        raise ValueError("trading bytes do not match the dataset descriptor")


def encode_job(job: RunnerJob, bundle: CandleBundle) -> bytes:
    _validate_bundle(job, bundle)
    header = canonical_json(
        {
            "job_id": job.job_id,
            "mode": job.mode.value,
            "source_code": job.source_code,
            "strategy_class_name": job.strategy_class_name,
            "parameters": job.parameters,
            "config": dataclasses.asdict(job.config),
            "warmup_rows": job.warmup_rows,
            "trading_rows": bundle.ref.trading_rows,
            "timeout_seconds": job.timeout_seconds,
            "columns": bundle.ref.columns,
            "dtype": bundle.ref.dtype,
            "warmup_bytes": len(bundle.warmup),
            "trading_bytes": len(bundle.trading),
        }
    ).encode("utf-8")
    payload = _HEADER_LEN.pack(len(header)) + header + bundle.warmup + bundle.trading
    if len(payload) > _MAX_FRAME_BYTES:
        raise ValueError(f"job payload exceeds {_MAX_FRAME_BYTES} bytes")
    return payload


def _decode_header(payload: bytes) -> tuple[dict[str, Any], int]:
    if len(payload) > _MAX_FRAME_BYTES:
        raise ValueError(f"job payload exceeds {_MAX_FRAME_BYTES} bytes")
    if len(payload) < _HEADER_LEN.size:
        raise ValueError("job payload is missing its header length")

    (header_len,) = _HEADER_LEN.unpack_from(payload)
    header_end = _HEADER_LEN.size + header_len
    if header_end > len(payload):
        raise ValueError("job payload contains a truncated header")

    try:
        header = json.loads(
            payload[_HEADER_LEN.size : header_end],
            parse_constant=_reject_json_constant,
        )
    except (UnicodeDecodeError, ValueError) as error:
        raise ValueError("job payload contains an invalid JSON header") from error
    if not isinstance(header, dict):
        raise TypeError("job payload header must be a JSON object")
    return header, header_end


def _required_int(
    header: dict[str, Any],
    key: str,
    *,
    minimum: int = 0,
) -> int:
    value = header.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"job header field '{key}' must be an integer >= {minimum}")
    return value


def _required_string(header: dict[str, Any], key: str) -> str:
    value = header.get(key)
    if not isinstance(value, str):
        raise TypeError(f"job header field '{key}' must be a string")
    return value


def decode_job(payload: bytes) -> tuple[RunnerJob, np.ndarray, np.ndarray]:
    header, body_start = _decode_header(payload)
    columns = _required_int(header, "columns", minimum=1)
    warmup_rows = _required_int(header, "warmup_rows")
    trading_rows = _required_int(header, "trading_rows")
    warmup_bytes = _required_int(header, "warmup_bytes")
    trading_bytes = _required_int(header, "trading_bytes")

    if header.get("dtype") != "float64":
        raise ValueError("candle dtype must be float64")

    row_bytes = columns * _FLOAT64.itemsize
    if warmup_bytes != warmup_rows * row_bytes:
        raise ValueError("warmup byte length does not match header dimensions")
    if trading_bytes != trading_rows * row_bytes:
        raise ValueError("trading byte length does not match header dimensions")

    expected_length = body_start + warmup_bytes + trading_bytes
    if len(payload) != expected_length:
        raise ValueError(
            f"job payload length is {len(payload)}, expected {expected_length}"
        )

    warmup_end = body_start + warmup_bytes
    warmup = np.frombuffer(
        payload[body_start:warmup_end],
        dtype=_FLOAT64,
    ).reshape(warmup_rows, columns)
    trading = np.frombuffer(
        payload[warmup_end:],
        dtype=_FLOAT64,
    ).reshape(trading_rows, columns)

    parameters = header.get("parameters")
    config = header.get("config")
    timeout_seconds = header.get("timeout_seconds")
    if not isinstance(parameters, dict):
        raise TypeError("job header field 'parameters' must be an object")
    if not isinstance(config, dict):
        raise TypeError("job header field 'config' must be an object")
    if (
        isinstance(timeout_seconds, bool)
        or not isinstance(timeout_seconds, (int, float))
        or timeout_seconds <= 0
    ):
        raise ValueError("job header field 'timeout_seconds' must be positive")

    try:
        job = RunnerJob(
            job_id=_required_string(header, "job_id"),
            mode=RuntimeMode(_required_string(header, "mode")),
            source_code=_required_string(header, "source_code"),
            strategy_class_name=_required_string(header, "strategy_class_name"),
            parameters=parameters,
            config=BacktestConfig(**config),
            warmup_rows=warmup_rows,
            timeout_seconds=float(timeout_seconds),
        )
    except (TypeError, ValueError) as error:
        raise ValueError("job payload contains invalid contract fields") from error

    return job, np.array(warmup, dtype=_FLOAT64), np.array(trading, dtype=_FLOAT64)


def encode_result(result: RunnerResult) -> bytes:
    return canonical_json(
        {
            "job_id": result.job_id,
            "status": result.status.value,
            "metrics": dataclasses.asdict(result.metrics) if result.metrics else None,
            "equity_curve": [dataclasses.asdict(point) for point in result.equity_curve],
            "error": dataclasses.asdict(result.error) if result.error else None,
        }
    ).encode("utf-8")


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number is prohibited: {value}")


def decode_result(payload: bytes) -> RunnerResult:
    try:
        data = json.loads(payload, parse_constant=_reject_json_constant)
    except (UnicodeDecodeError, ValueError) as error:
        raise ValueError("runner result is not valid JSON") from error
    if not isinstance(data, dict):
        raise TypeError("runner result must be a JSON object")

    metrics_data = data.get("metrics")
    if metrics_data is not None:
        if not isinstance(metrics_data, dict):
            raise ValueError("runner metrics must be an object or null")
        trades = metrics_data.get("trades", ())
        if not isinstance(trades, (list, tuple)):
            raise ValueError("runner metric trades must be an array")
        metrics = BacktestMetrics(**{**metrics_data, "trades": tuple(trades)})
    else:
        metrics = None

    curve_data = data.get("equity_curve", [])
    error_data = data.get("error")
    if not isinstance(curve_data, list):
        raise TypeError("runner equity_curve must be an array")
    if error_data is not None and not isinstance(error_data, dict):
        raise ValueError("runner error must be an object or null")

    try:
        return RunnerResult(
            job_id=_required_string(data, "job_id"),
            status=RunnerStatus(_required_string(data, "status")),
            metrics=metrics,
            equity_curve=tuple(EquityPoint(**point) for point in curve_data),
            error=RunnerError(**error_data) if error_data else None,
        )
    except (TypeError, ValueError) as error:
        raise ValueError("runner result contains invalid contract fields") from error


async def write_frame(writer: asyncio.StreamWriter, payload: bytes) -> None:
    if len(payload) > _MAX_FRAME_BYTES:
        raise ValueError(f"frame exceeds {_MAX_FRAME_BYTES} bytes")
    writer.write(_FRAME_LEN.pack(len(payload)))
    writer.write(payload)
    await writer.drain()


async def read_frame(reader: asyncio.StreamReader) -> bytes:
    raw_length = await reader.readexactly(_FRAME_LEN.size)
    (length,) = _FRAME_LEN.unpack(raw_length)
    if length > _MAX_FRAME_BYTES:
        raise ValueError(f"frame exceeds {_MAX_FRAME_BYTES} bytes")
    return await reader.readexactly(length)
