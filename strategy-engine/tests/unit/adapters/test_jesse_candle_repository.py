import numpy as np
import pytest

from engine.adapters.jesse.candles import JesseCandleRepository
from engine.adapters.sandbox.codec import _MAX_FRAME_BYTES
from engine.domain.dataset.models import MAX_DATASET_ROWS, DateRange
from engine.domain.shared.errors import DatasetTooLarge, DatasetUnavailable

DAY_MS = 86_400_000
DAY_START = 1_609_459_200_000
DAY_FINISH = DAY_START + DAY_MS


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


def _refuse_fetch(**kwargs):
    raise AssertionError("an oversized request must not reach Jesse")


@pytest.mark.parametrize(
    ("days", "timeframe", "warmup_candles_num"),
    [
        (MAX_DATASET_ROWS // 1_440 + 1, "1m", 0),  # the trading range alone
        (1, "1D", 5_000),  # a one-day range with ~14 years of warmup
    ],
)
@pytest.mark.parametrize("method", ["ensure", "load"])
def test_oversized_requests_are_rejected_before_touching_the_database(
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    days: int,
    timeframe: str,
    warmup_candles_num: int,
) -> None:
    repo = JesseCandleRepository()
    monkeypatch.setattr(repo, "_fetch", _refuse_fetch)

    with pytest.raises(DatasetTooLarge):
        getattr(repo, method)(
            exchange="Binance",
            symbol="BTC-USDT",
            timeframe=timeframe,
            date_range=DateRange(DAY_START, DAY_START + days * DAY_MS),
            warmup_candles_num=warmup_candles_num,
        )


def test_largest_allowed_dataset_fits_in_one_runner_frame() -> None:
    # Six float64 columns per candle, with a quarter of the frame left for the
    # JSON header (strategy source and parameters).
    assert MAX_DATASET_ROWS * 6 * 8 <= _MAX_FRAME_BYTES * 3 // 4
