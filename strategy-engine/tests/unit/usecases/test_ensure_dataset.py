import pytest

from engine.domain.dataset.models import CandleBundle, DatasetRef, DateRange
from engine.domain.shared.errors import DatasetUnavailable
from engine.usecases.dataset.ensure_dataset import EnsureDataset

RANGE = DateRange(1_600_000_000_000, 1_600_086_400_000)


def _bundle() -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance",
        symbol="BTC-USDT",
        timeframe="1m",
        date_range=RANGE,
        warmup_rows=0,
        trading_rows=2,
        columns=6,
        dtype="float64",
        dataset_hash="d" * 64,
    )
    return CandleBundle(ref=ref, warmup=b"", trading=b"\x00" * 96)


class _Repo:
    def __init__(
        self,
        bundle: CandleBundle | None,
        ensure_error: Exception | None = None,
    ) -> None:
        self.bundle = bundle
        self.ensure_error = ensure_error
        self.calls: list[tuple[str, dict]] = []

    def ensure(self, **kwargs) -> None:
        self.calls.append(("ensure", kwargs))
        if self.ensure_error:
            raise self.ensure_error

    def load(self, **kwargs) -> CandleBundle:
        self.calls.append(("load", kwargs))
        assert self.bundle is not None
        return self.bundle


def test_ensure_runs_before_load_with_the_complete_dataset_request() -> None:
    repo = _Repo(_bundle())

    result = EnsureDataset(repo).execute(
        exchange="Binance",
        symbol="BTC-USDT",
        timeframe="1h",
        date_range=RANGE,
        warmup_candles_num=10,
    )

    assert result.ref.dataset_hash == "d" * 64
    assert [name for name, _ in repo.calls] == ["ensure", "load"]
    assert repo.calls[0][1] == repo.calls[1][1]
    assert repo.calls[0][1]["timeframe"] == "1h"
    assert repo.calls[0][1]["warmup_candles_num"] == 10


def test_missing_data_surfaces_without_attempting_load() -> None:
    repo = _Repo(None, ensure_error=DatasetUnavailable("no data"))

    with pytest.raises(DatasetUnavailable, match="no data"):
        EnsureDataset(repo).execute(
            exchange="Binance",
            symbol="BTC-USDT",
            timeframe="1m",
            date_range=RANGE,
            warmup_candles_num=0,
        )

    assert [name for name, _ in repo.calls] == ["ensure"]
