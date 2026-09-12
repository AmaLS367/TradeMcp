"""FastAPI Application for TradeMCP Strategy Engine."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from strategy_engine.api.models import (
    BacktestRequest,
    BacktestResponse,
    ValidateStrategyRequest,
    ValidateStrategyResponse,
)
from strategy_engine.core.jesse_runner import (
    compute_strategy_hash,
    run_strategy_backtest,
)
from strategy_engine.security.ast_validator import validate_strategy_source

app = FastAPI(
    title="TradeMCP Strategy Engine",
    version="0.1.0",
    description="Headless quant research and Jesse-powered execution engine for TradeMCP",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "trade-strategy-engine"}


@app.post("/api/v1/strategy/validate", response_model=ValidateStrategyResponse)
async def validate_strategy_endpoint(
    req: ValidateStrategyRequest,
) -> ValidateStrategyResponse:
    res = validate_strategy_source(req.source_code)
    strat_hash = None
    if res.valid:
        strat_hash = compute_strategy_hash(req.source_code, res.detected_hyperparameters)

    return ValidateStrategyResponse(
        valid=res.valid,
        strategy_hash=strat_hash,
        strategy_class_name=res.strategy_class_name,
        errors=res.errors,
        detected_methods=res.detected_methods,
        detected_hyperparameters=res.detected_hyperparameters,
    )


@app.post("/api/v1/backtest", response_model=BacktestResponse)
async def backtest_endpoint(req: BacktestRequest) -> BacktestResponse:
    try:
        return run_strategy_backtest(req)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Backtest execution error: {err}") from err


def main() -> None:
    import uvicorn
    uvicorn.run("strategy_engine.main:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
