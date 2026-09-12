from __future__ import annotations

from dataclasses import dataclass

# Warmup plus trading one-minute candles one runner job may carry. At 48 bytes
# per row (six float64 columns) this stays well under the 128 MiB frame limit,
# and it is enforced before Jesse imports or materializes anything.
MAX_DATASET_ROWS = 2_000_000


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
