from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from engine.entrypoints.api.deps import get_validate_strategy, require_token
from engine.entrypoints.api.schemas.strategy import (
    ValidateStrategyRequest,
    ValidateStrategyResponse,
)
from engine.usecases.strategy.validate_strategy import ValidateStrategy

router = APIRouter(prefix="/api/v1/strategy", dependencies=[Depends(require_token)])


@router.post("/validate", response_model=ValidateStrategyResponse)
async def validate_strategy(
    body: ValidateStrategyRequest,
    usecase: Annotated[ValidateStrategy, Depends(get_validate_strategy)],
) -> ValidateStrategyResponse:
    outcome = usecase.execute(body.source_code, body.parameters)
    return ValidateStrategyResponse(
        valid=outcome.validation.valid,
        strategy_hash=outcome.strategy_hash,
        strategy_class_name=outcome.validation.strategy_class_name,
        errors=list(outcome.validation.errors),
        detected_methods=list(outcome.validation.detected_methods),
    )
