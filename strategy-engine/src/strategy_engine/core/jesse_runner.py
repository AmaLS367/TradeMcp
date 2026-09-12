"""Jesse Research Backtest Runner with AST security isolation."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

import numpy as np
from jesse.research import backtest, fake_range_candles
from jesse.strategies import Strategy

from strategy_engine.api.models import (
    BacktestMetrics,
    BacktestRequest,
    BacktestResponse,
    EquityPoint,
)
from strategy_engine.security.ast_validator import (
    ALLOWED_ROOT_MODULES,
    validate_strategy_source,
)


def _safe_import(
    name: str,
    globals: Any = None,
    locals: Any = None,
    fromlist: Any = (),
    level: int = 0,
) -> Any:
    root = name.split(".")[0]
    if root not in ALLOWED_ROOT_MODULES:
        raise ImportError(f"Import of '{name}' is prohibited by security policy")
    return __import__(name, globals, locals, fromlist, level)


def compute_strategy_hash(source_code: str, parameters: dict[str, Any]) -> str:
    """Computes deterministic SHA-256 hash for strategy source and parameters."""
    normalized_source = "\n".join(
        line.rstrip() for line in source_code.strip().splitlines() if line.strip()
    )
    payload = f"{normalized_source}::{json.dumps(parameters, sort_keys=True)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_run_hash(
    strategy_hash: str,
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str,
    fee_rate: float,
    candles_count: int,
) -> str:
    """Computes deterministic SHA-256 hash for reproducible run execution."""
    payload = (
        f"{strategy_hash}::{symbol}::{timeframe}::{start_date}::{end_date}::"
        f"{fee_rate}::{candles_count}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _sanitize_float(val: Any, default: float = 0.0) -> float:
    if val is None or not isinstance(val, (int, float)):
        return default
    if math.isnan(val) or math.isinf(val):
        return default
    return float(val)


def run_strategy_backtest(req: BacktestRequest) -> BacktestResponse:
    """Validates and runs backtest on user strategy code."""
    # 1. AST Validation
    val_res = validate_strategy_source(req.source_code)
    if not val_res.valid or not val_res.strategy_class_name:
        raise ValueError(f"Strategy validation failed: {'; '.join(val_res.errors)}")

    strategy_hash = compute_strategy_hash(req.source_code, req.parameters)

    # 2. Compile class in isolated sandbox namespace
    import builtins

    safe_builtins = builtins.__dict__.copy()
    for blocked in ("open", "eval", "exec", "compile", "breakpoint", "exit", "quit"):
        safe_builtins.pop(blocked, None)
    safe_builtins["__import__"] = _safe_import

    safe_globals: dict[str, Any] = {
        "__builtins__": safe_builtins,
        "Strategy": Strategy,
    }

    exec(req.source_code, safe_globals)  # noqa: S102
    strategy_class = safe_globals[val_res.strategy_class_name]

    # Apply hyperparameters if provided
    if req.parameters and hasattr(strategy_class, "hp"):
        strategy_class.hp = req.parameters

    # 3. Format candles
    formatted_symbol = req.symbol.replace("/", "-")
    exchange = req.exchange.capitalize()

    if req.candles and len(req.candles) > 0:
        candles_arr = np.array(req.candles, dtype=np.float64)
    else:
        # Fallback to test fake candles
        candles_arr = fake_range_candles(1000)

    candles_dict = {
        f"{exchange}-{formatted_symbol}": {
            "exchange": exchange,
            "symbol": formatted_symbol,
            "candles": candles_arr,
        }
    }

    # 4. Jesse Route and Config
    routes = [
        {
            "exchange": exchange,
            "symbol": formatted_symbol,
            "timeframe": req.timeframe,
            "strategy": strategy_class,
        }
    ]

    config = {
        "starting_balance": req.initial_balance,
        "fee": req.fee_rate,
        "type": "futures",
        "futures_leverage": 1,
        "futures_leverage_mode": "cross",
        "exchange": exchange,
        "warm_up_candles": 0,
    }

    # 5. Execute Jesse pure backtest function
    result = backtest(
        config=config,
        routes=routes,
        data_routes=[],
        candles=candles_dict,
        generate_equity_curve=True,
    )

    m = result.get("metrics", {})

    metrics = BacktestMetrics(
        net_return=_sanitize_float(m.get("net_profit_percentage")),
        sharpe=_sanitize_float(m.get("sharpe_ratio")),
        sortino=_sanitize_float(m.get("sortino_ratio")),
        calmar=_sanitize_float(m.get("calmar_ratio")),
        max_drawdown=_sanitize_float(m.get("max_drawdown")),
        win_rate=_sanitize_float(m.get("win_rate")),
        profit_factor=_sanitize_float(m.get("ratio_avg_win_loss")),
        total_trades=int(m.get("total", 0)),
        trades=result.get("trades", []) or [],
    )

    equity_curve: list[EquityPoint] = []
    raw_equity = result.get("equity_curve", [])
    if raw_equity:
        for point in raw_equity:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                equity_curve.append(
                    EquityPoint(timestamp=int(point[0]), equity=float(point[1]))
                )

    run_hash = compute_run_hash(
        strategy_hash=strategy_hash,
        symbol=req.symbol,
        timeframe=req.timeframe,
        start_date=req.start_date,
        end_date=req.end_date,
        fee_rate=req.fee_rate,
        candles_count=len(candles_arr),
    )

    return BacktestResponse(
        run_hash=run_hash,
        strategy_hash=strategy_hash,
        metrics=metrics,
        equity_curve=equity_curve,
    )
