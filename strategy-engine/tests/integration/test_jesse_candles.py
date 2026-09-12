"""Tests requiring a Jesse project with imported BTC-USDT candles."""

import datetime as dt

import pytest

from engine.adapters.jesse.candles import JesseCandleRepository
from engine.domain.dataset.models import DateRange
from engine.domain.shared.errors import DatasetUnavailable

pytestmark = pytest.mark.integration


def _ms(year: int, month: int, day: int) -> int:
    return int(
        dt.datetime(year, month, day, tzinfo=dt.UTC).timestamp() * 1000
    )


def test_loaded_dataset_is_hash_stable() -> None:
    repo = JesseCandleRepository()
    date_range = DateRange(_ms(2023, 1, 1), _ms(2023, 1, 3))

    first = repo.load(
        exchange="Binance Perpetual Futures",
        symbol="BTC-USDT",
        timeframe="1h",
        date_range=date_range,
        warmup_candles_num=0,
    )
    second = repo.load(
        exchange="Binance Perpetual Futures",
        symbol="BTC-USDT",
        timeframe="1h",
        date_range=date_range,
        warmup_candles_num=0,
    )

    assert first.ref.dataset_hash == second.ref.dataset_hash
    assert first.trading == second.trading
    assert first.ref.trading_rows == 2 * 24 * 60


def test_warmup_changes_the_dataset_hash() -> None:
    repo = JesseCandleRepository()
    date_range = DateRange(_ms(2023, 1, 2), _ms(2023, 1, 3))

    without = repo.load(
        exchange="Binance Perpetual Futures",
        symbol="BTC-USDT",
        timeframe="1h",
        date_range=date_range,
        warmup_candles_num=0,
    )
    with_warmup = repo.load(
        exchange="Binance Perpetual Futures",
        symbol="BTC-USDT",
        timeframe="1h",
        date_range=date_range,
        warmup_candles_num=10,
    )

    assert without.ref.dataset_hash != with_warmup.ref.dataset_hash
    assert with_warmup.ref.warmup_rows > 0


def test_unknown_symbol_raises_dataset_unavailable() -> None:
    repo = JesseCandleRepository()

    with pytest.raises(DatasetUnavailable):
        repo.load(
            exchange="Binance Perpetual Futures",
            symbol="NOSUCH-COIN",
            timeframe="1h",
            date_range=DateRange(_ms(2023, 1, 1), _ms(2023, 1, 2)),
            warmup_candles_num=0,
        )
