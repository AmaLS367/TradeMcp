from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DateRange:
    start_ms: int
    finish_ms: int

    def __post_init__(self) -> None:
        if self.finish_ms <= self.start_ms:
            raise ValueError("finish_ms must be strictly greater than start_ms")


@dataclass(frozen=True)
class DatasetRef:
    exchange: str
    symbol: str
    timeframe: str
    date_range: DateRange
    warmup_rows: int
    trading_rows: int
    columns: int
    dtype: str
    dataset_hash: str


@dataclass(frozen=True)
class CandleBundle:
    """Opaque candle bytes passed from a repository to a runner."""

    ref: DatasetRef
    warmup: bytes
    trading: bytes
