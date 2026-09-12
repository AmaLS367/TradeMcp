"""Characterize parameter propagation through Jesse's research API."""

import numpy as np
import pytest

from engine.adapters.jesse.backtest import run_jesse_backtest
from engine.domain.backtest.models import BacktestConfig

pytestmark = pytest.mark.integration

SOURCE = """
from jesse.strategies import Strategy

class Parameterized(Strategy):
    def hyperparameters(self):
        return [{'name': 'qty', 'type': int, 'min': 1, 'max': 10, 'default': 1}]

    def should_long(self) -> bool:
        return self.index == 10

    def go_long(self) -> None:
        self.buy = self.hp['qty'], self.price

    def should_short(self) -> bool:
        return False
"""


def _strategy_class() -> type:
    from jesse.strategies import Strategy

    namespace: dict = {"Strategy": Strategy}
    exec(SOURCE, namespace)  # noqa: S102 - trusted test fixture
    return namespace["Parameterized"]


def _config() -> BacktestConfig:
    return BacktestConfig(
        exchange="Binance",
        symbol="BTC-USDT",
        timeframe="1m",
        initial_balance=10_000.0,
        fee_rate=0.0,
    )


def test_hyperparameters_change_the_result() -> None:
    from jesse.research import fake_range_candles

    candles = fake_range_candles(400)
    empty = np.empty((0, 6), dtype=np.float64)
    strategy_class = _strategy_class()

    small, _ = run_jesse_backtest(
        strategy_class=strategy_class,
        config=_config(),
        warmup=empty,
        trading=candles,
        parameters={"qty": 1},
    )
    large, _ = run_jesse_backtest(
        strategy_class=strategy_class,
        config=_config(),
        warmup=empty,
        trading=candles,
        parameters={"qty": 5},
    )

    assert small.net_return_percent != large.net_return_percent, (
        "hyperparameters did not reach the strategy"
    )
