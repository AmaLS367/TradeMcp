"""Translate between stable engine contracts and Jesse's result formats."""

from __future__ import annotations

from typing import Any

import numpy as np

from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint, clean_float
from engine.domain.backtest.models import BacktestConfig


def map_metrics(raw: dict[str, Any], trades: list[dict[str, Any]]) -> BacktestMetrics:
    gross_profit = clean_float(raw.get("gross_profit"))
    gross_loss = clean_float(raw.get("gross_loss"))
    profit_factor = None
    if gross_profit is not None and gross_loss:
        profit_factor = clean_float(gross_profit / abs(gross_loss))

    return BacktestMetrics(
        net_return_percent=clean_float(raw.get("net_profit_percentage")),
        sharpe=clean_float(raw.get("sharpe_ratio")),
        sortino=clean_float(raw.get("sortino_ratio")),
        calmar=clean_float(raw.get("calmar_ratio")),
        omega=clean_float(raw.get("omega_ratio")),
        max_drawdown_percent=clean_float(raw.get("max_drawdown")),
        win_rate=clean_float(raw.get("win_rate")),
        profit_factor=profit_factor,
        payoff_ratio=clean_float(raw.get("ratio_avg_win_loss")),
        expectancy=clean_float(raw.get("expectancy")),
        starting_balance=clean_float(raw.get("starting_balance")),
        finishing_balance=clean_float(raw.get("finishing_balance")),
        total_trades=int(raw.get("total") or 0),
        winning_trades=int(raw.get("total_winning_trades") or 0),
        losing_trades=int(raw.get("total_losing_trades") or 0),
        longs_count=int(raw.get("longs_count") or 0),
        shorts_count=int(raw.get("shorts_count") or 0),
        trades=tuple(trades or ()),
    )


def map_equity_curve(
    raw: list[dict[str, Any]] | None,
) -> tuple[EquityPoint, ...]:
    if not raw:
        return ()

    series = next((item for item in raw if item.get("name") == "Portfolio"), raw[0])
    points = []
    for point in series.get("data", []):
        time_seconds = clean_float(point.get("time"))
        equity = clean_float(point.get("value"))
        if time_seconds is None or equity is None:
            continue
        points.append(EquityPoint(timestamp_ms=int(time_seconds * 1000), equity=equity))
    return tuple(points)


def jesse_config(config: BacktestConfig, warmup_rows: int) -> dict[str, Any]:
    return {
        "starting_balance": config.initial_balance,
        "fee": config.fee_rate,
        "type": config.market_type,
        "futures_leverage": config.leverage,
        "futures_leverage_mode": config.leverage_mode,
        "exchange": config.exchange,
        "warm_up_candles": warmup_rows,
    }


def jesse_routes(
    config: BacktestConfig,
    strategy_class: type,
) -> list[dict[str, Any]]:
    return [
        {
            "exchange": config.exchange,
            "symbol": config.symbol,
            "timeframe": config.timeframe,
            "strategy": strategy_class,
        }
    ]


def run_jesse_backtest(
    *,
    strategy_class: type,
    config: BacktestConfig,
    warmup: np.ndarray,
    trading: np.ndarray,
    parameters: dict[str, Any],
) -> tuple[BacktestMetrics, tuple[EquityPoint, ...]]:
    from jesse.research import backtest

    key = f"{config.exchange}-{config.symbol}"
    entry = {"exchange": config.exchange, "symbol": config.symbol}

    result = backtest(
        config=jesse_config(config, warmup_rows=len(warmup)),
        routes=jesse_routes(config, strategy_class),
        data_routes=[],
        candles={key: {**entry, "candles": trading}},
        warmup_candles=(
            {key: {**entry, "candles": warmup}} if len(warmup) else None
        ),
        hyperparameters=parameters or None,
        generate_equity_curve=True,
    )

    return (
        map_metrics(result.get("metrics") or {}, result.get("trades") or []),
        map_equity_curve(result.get("equity_curve")),
    )
