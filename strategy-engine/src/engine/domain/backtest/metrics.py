from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any


def clean_float(value: Any) -> float | None:
    """Map missing and non-finite metrics to None, never to a false zero."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        result = float(value)
    except (OverflowError, ValueError):
        return None
    return result if math.isfinite(result) else None


@dataclass(frozen=True)
class EquityPoint:
    timestamp_ms: int
    equity: float


@dataclass(frozen=True)
class BacktestMetrics:
    net_return_percent: float | None = None
    sharpe: float | None = None
    sortino: float | None = None
    calmar: float | None = None
    omega: float | None = None
    max_drawdown_percent: float | None = None
    win_rate: float | None = None
    profit_factor: float | None = None
    payoff_ratio: float | None = None
    expectancy: float | None = None
    starting_balance: float | None = None
    finishing_balance: float | None = None
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    longs_count: int = 0
    shorts_count: int = 0
    trades: tuple[dict[str, Any], ...] = field(default_factory=tuple)
