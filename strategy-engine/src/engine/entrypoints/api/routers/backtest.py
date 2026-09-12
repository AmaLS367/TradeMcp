from __future__ import annotations

import dataclasses
import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DateRange
from engine.entrypoints.api.deps import get_run_backtest, require_token
from engine.entrypoints.api.schemas.backtest import (
    BacktestRequest,
    BacktestResponse,
    DatasetResponse,
    EquityPointResponse,
    MetricsResponse,
)
from engine.usecases.backtest.run_backtest import BacktestCommand, RunBacktest

router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])


def _utc_midnight_ms(day: dt.date) -> int:
    return int(dt.datetime.combine(day, dt.time(), tzinfo=dt.UTC).timestamp() * 1000)


@router.post("/backtest", response_model=BacktestResponse)
async def run_backtest(
    body: BacktestRequest,
    request: Request,
    usecase: Annotated[RunBacktest, Depends(get_run_backtest)],
) -> BacktestResponse:
    config = BacktestConfig(
        exchange=body.exchange,
        symbol=body.symbol,
        timeframe=body.timeframe,
        initial_balance=body.initial_balance,
        fee_rate=body.fee_rate,
    )
    outcome = await usecase.execute(
        BacktestCommand(
            source_code=body.source_code,
            parameters=body.parameters,
            config=config,
            date_range=DateRange(
                _utc_midnight_ms(body.start_date),
                _utc_midnight_ms(body.end_date),
            ),
            warmup_candles_num=body.warmup_candles_num,
            timeout_seconds=request.app.state.settings.runner_timeout_seconds,
        )
    )

    ref = outcome.dataset_ref
    metrics = dataclasses.asdict(outcome.metrics)
    metrics.pop("trades", None)
    return BacktestResponse(
        run_hash=outcome.run_hash,
        strategy_hash=outcome.strategy_hash,
        dataset_hash=ref.dataset_hash,
        dataset=DatasetResponse(
            exchange=ref.exchange,
            symbol=ref.symbol,
            timeframe=ref.timeframe,
            start_ms=ref.date_range.start_ms,
            finish_ms=ref.date_range.finish_ms,
            warmup_rows=ref.warmup_rows,
            trading_rows=ref.trading_rows,
        ),
        metrics=MetricsResponse(**metrics),
        equity_curve=[
            EquityPointResponse(timestamp_ms=p.timestamp_ms, equity=p.equity)
            for p in outcome.equity_curve
        ],
    )
