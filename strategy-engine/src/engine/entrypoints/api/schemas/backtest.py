from __future__ import annotations

import datetime as dt
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class BacktestRequest(BaseModel):
    source_code: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    symbol: str = "BTC-USDT"
    timeframe: str = "1h"
    exchange: str = "Binance"
    start_date: dt.date = Field(..., description="YYYY-MM-DD, inclusive")
    end_date: dt.date = Field(..., description="YYYY-MM-DD, exclusive")
    initial_balance: float = Field(10_000.0, gt=0)
    fee_rate: float = Field(0.0006, ge=0, lt=1)
    warmup_candles_num: int = Field(210, ge=0, le=5000)

    @field_validator("symbol")
    @classmethod
    def _normalize_symbol(cls, value: str) -> str:
        # Jesse only understands "BTC-USDT"; normalizing here keeps run hashes
        # identical for "BTC/USDT" and "btc-usdt".
        return value.strip().replace("/", "-").upper()

    @model_validator(mode="after")
    def _check_range(self) -> BacktestRequest:
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class MetricsResponse(BaseModel):
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


class EquityPointResponse(BaseModel):
    timestamp_ms: int
    equity: float


class DatasetResponse(BaseModel):
    exchange: str
    symbol: str
    timeframe: str
    start_ms: int
    finish_ms: int
    warmup_rows: int
    trading_rows: int


class BacktestResponse(BaseModel):
    run_hash: str
    strategy_hash: str
    dataset_hash: str
    dataset: DatasetResponse
    metrics: MetricsResponse
    equity_curve: list[EquityPointResponse] = Field(default_factory=list)
