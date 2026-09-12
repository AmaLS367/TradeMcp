from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ValidateStrategyRequest(BaseModel):
    source_code: str = Field(..., description="Python source of a Jesse strategy")
    parameters: dict[str, Any] = Field(default_factory=dict)


class ValidateStrategyResponse(BaseModel):
    valid: bool
    strategy_hash: str | None = None
    strategy_class_name: str | None = None
    errors: list[str] = Field(default_factory=list)
    detected_methods: list[str] = Field(default_factory=list)
