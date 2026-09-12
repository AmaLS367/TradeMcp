import dataclasses

from engine.domain.backtest.hashing import run_hash
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DateRange

CONFIG = BacktestConfig(
    exchange="Binance",
    symbol="BTC-USDT",
    timeframe="1h",
    initial_balance=10_000.0,
    fee_rate=0.0006,
)
RANGE = DateRange(start_ms=1_600_000_000_000, finish_ms=1_600_086_400_000)

BASE = {
    "strategy_hash": "s" * 64,
    "dataset_hash": "d" * 64,
    "engine_version": "0.2.0+abc1234",
    "jesse_version": "3.1.3",
    "config": CONFIG,
    "date_range": RANGE,
    "warmup_rows": 200,
}


def test_run_hash_is_deterministic() -> None:
    assert run_hash(**BASE) == run_hash(**BASE)


def test_engine_version_participates() -> None:
    other = {**BASE, "engine_version": "0.3.0+def5678"}
    assert run_hash(**BASE) != run_hash(**other)


def test_dataset_hash_participates() -> None:
    other = {**BASE, "dataset_hash": "e" * 64}
    assert run_hash(**BASE) != run_hash(**other)


def test_fill_model_participates() -> None:
    """Execution model changes must invalidate earlier run identifiers."""
    config = dataclasses.replace(CONFIG, slippage_model="microstructure_v1")
    assert run_hash(**BASE) != run_hash(**{**BASE, "config": config})


def test_fee_rate_participates() -> None:
    config = dataclasses.replace(CONFIG, fee_rate=0.001)
    assert run_hash(**BASE) != run_hash(**{**BASE, "config": config})
