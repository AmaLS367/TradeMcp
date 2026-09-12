import numpy as np
import pytest

from engine.adapters.jesse.candles import JesseCandleRepository
from engine.domain.dataset.models import DateRange
from engine.domain.shared.errors import DatasetUnavailable

DAY_START = 1_609_459_200_000
DAY_FINISH = DAY_START + 86_400_000


def _candles() -> np.ndarray:
    timestamps = np.arange(DAY_START, DAY_FINISH, 60_000, dtype=np.float64)
    prices = np.ones((len(timestamps), 5), dtype=np.float64)
    return np.column_stack((timestamps, prices))


def test_load_builds_a_stable_descriptor_from_exact_candle_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = JesseCandleRepository()
    trading = _candles()
    monkeypatch.setattr(repo, "_fetch", lambda **kwargs: (None, trading))
    request = {
        "exchange": "Binance",
        "symbol": "BTC-USDT",
        "timeframe": "1h",
        "date_range": DateRange(DAY_START, DAY_FINISH),
        "warmup_candles_num": 0,
    }

    first = repo.load(**request)
    second = repo.load(**request)

    assert first == second
    assert first.ref.trading_rows == 1_440
    assert first.ref.columns == 6
    assert len(first.ref.dataset_hash) == 64


def test_load_rejects_a_gap_in_the_one_minute_series(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = JesseCandleRepository()
    trading = np.delete(_candles(), 10, axis=0)
    monkeypatch.setattr(repo, "_fetch", lambda **kwargs: (None, trading))

    with pytest.raises(DatasetUnavailable, match="continuous"):
        repo.load(
            exchange="Binance",
            symbol="BTC-USDT",
            timeframe="1h",
            date_range=DateRange(DAY_START, DAY_FINISH),
            warmup_candles_num=0,
        )


def test_load_rejects_ranges_that_jesse_would_silently_round_to_days() -> None:
    repo = JesseCandleRepository()

    with pytest.raises(DatasetUnavailable, match="UTC day boundaries"):
        repo.load(
            exchange="Binance",
            symbol="BTC-USDT",
            timeframe="1h",
            date_range=DateRange(DAY_START + 60_000, DAY_FINISH),
            warmup_candles_num=0,
        )
