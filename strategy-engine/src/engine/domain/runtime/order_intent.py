"""Deterministic order intent for future paper and live adapters."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TakeProfitTarget:
    price: float
    portion: float


@dataclass(frozen=True)
class StrategyOrderIntent:
    strategy_hash: str
    run_hash: str
    session_id: str

    exchange: str
    symbol: str

    side: str
    type: str

    quantity: float
    price: float | None = None

    reduce_only: bool = False
    post_only: bool = False

    stop_loss: float | None = None
    take_profits: tuple[TakeProfitTarget, ...] = ()

    generated_at_ms: int = 0
    candle_timestamp_ms: int = 0

    signal: str = ""
    indicators: dict[str, float] = field(default_factory=dict)
