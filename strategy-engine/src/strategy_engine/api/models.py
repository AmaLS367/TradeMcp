"""Pydantic v2 models for Strategy Engine API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ValidateStrategyRequest(BaseModel):
    source_code: str = Field(..., description="Python source code of the Jesse strategy")


class ValidateStrategyResponse(BaseModel):
    valid: bool
    strategy_hash: str | None = None
    strategy_class_name: str | None = None
    errors: list[str] = Field(default_factory=list)
    detected_methods: list[str] = Field(default_factory=list)
    detected_hyperparameters: dict[str, Any] = Field(default_factory=dict)


class BacktestRequest(BaseModel):
    source_code: str = Field(..., description="Python source code of the Jesse strategy")
    parameters: dict[str, Any] = Field(default_factory=dict)
    symbol: str = Field("BTC/USDT", description="Trading pair symbol")
    timeframe: str = Field("1h", description="Candle timeframe e.g. 1m, 15m, 1h, 4h, 1d")
    exchange: str = Field("Binance", description="Exchange name e.g. Binance, Bybit")
    start_date: str = Field("2023-01-01", description="Backtest start date YYYY-MM-DD")
    end_date: str = Field("2024-01-01", description="Backtest end date YYYY-MM-DD")
    initial_balance: float = Field(10000.0, description="Initial balance in USDT")
    fee_rate: float = Field(0.0006, description="Maker/taker fee rate")
    candles: list[list[float]] | None = Field(
        None,
        description="Optional preloaded OHLCV candles [[timestamp, open, close, high, low, volume], ...]",
    )


class BacktestMetrics(BaseModel):
    net_return: float
    sharpe: float
    sortino: float
    calmar: float
    max_drawdown: float
    win_rate: float
    profit_factor: float
    total_trades: int
    trades: list[dict[str, Any]] = Field(default_factory=list)


class EquityPoint(BaseModel):
    timestamp: int
    equity: float


class BacktestResponse(BaseModel):
    run_hash: str
    strategy_hash: str
    metrics: BacktestMetrics
    equity_curve: list[EquityPoint] = Field(default_factory=list)


class SignificanceRequest(BaseModel):
    source_code: str
    symbol: str = "BTC/USDT"
    timeframe: str = "1h"
    samples: int = Field(1000, ge=100, le=5000)
    candles: list[list[float]] | None = None


class SignificanceResponse(BaseModel):
    p_value: float
    edge_detected: bool
    iterations: int
    message: str


class MonteCarloRequest(BaseModel):
    trades: list[dict[str, Any]] = Field(..., description="Trades from backtest run")
    runs: int = Field(1000, ge=100, le=10000)


class MonteCarloResponse(BaseModel):
    runs: int
    median_sharpe: float
    median_return: float
    p5_drawdown: float
    risk_of_ruin: float
    overfit_risk: str


class PaperStepRequest(BaseModel):
    session_id: str
    candle: list[float] = Field(..., description="[timestamp, open, close, high, low, volume]")


class PaperStepResponse(BaseModel):
    session_id: str
    order_intent: dict[str, Any] | None = None
    position: dict[str, Any] | None = None
    balance: float
