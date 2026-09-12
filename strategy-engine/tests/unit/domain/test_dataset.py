import pytest

from engine.domain.dataset.hashing import dataset_hash
from engine.domain.dataset.models import DateRange

BASE = {
    "exchange": "Binance",
    "symbol": "BTC-USDT",
    "timeframe": "1m",
    "start_ms": 1_600_000_000_000,
    "finish_ms": 1_600_086_400_000,
    "warmup_rows": 0,
    "trading_rows": 2,
    "columns": 6,
    "dtype": "float64",
}


def test_same_bytes_same_hash() -> None:
    first = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01\x02")
    second = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01\x02")
    assert first == second


def test_different_bytes_same_length_differ() -> None:
    """Equal candle counts must not collapse different datasets."""
    first = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01\x02")
    second = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x03\x04")
    assert first != second


def test_warmup_participates_in_hash() -> None:
    first = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01")
    second = dataset_hash(
        **{**BASE, "warmup_rows": 1},
        warmup_bytes=b"\x09",
        trading_bytes=b"\x01",
    )
    assert first != second


def test_symbol_participates_in_hash() -> None:
    first = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01")
    second = dataset_hash(
        **{**BASE, "symbol": "ETH-USDT"},
        warmup_bytes=b"",
        trading_bytes=b"\x01",
    )
    assert first != second


def test_date_range_rejects_empty_or_reversed_ranges() -> None:
    with pytest.raises(ValueError):
        DateRange(start_ms=10, finish_ms=10)
    with pytest.raises(ValueError):
        DateRange(start_ms=10, finish_ms=9)
