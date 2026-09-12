from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BacktestConfig:
    exchange: str
    symbol: str
    timeframe: str
    initial_balance: float
    fee_rate: float
    market_type: str = "futures"
    leverage: int = 1
    leverage_mode: str = "cross"
    # These placeholders already participate in run_hash, so introducing a
    # real execution simulator will invalidate results produced under Jesse's
    # defaults instead of silently mixing both models.
    fee_model: str = "jesse_default"
    slippage_model: str = "jesse_default"
