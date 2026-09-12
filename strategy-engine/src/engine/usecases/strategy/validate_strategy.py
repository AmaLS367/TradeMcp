from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from engine.domain.strategy.hashing import strategy_hash
from engine.domain.strategy.models import SourceValidation
from engine.domain.strategy.source_policy import validate_source


@dataclass(frozen=True)
class ValidatedStrategy:
    validation: SourceValidation
    strategy_hash: str | None


class ValidateStrategy:
    def execute(
        self,
        source_code: str,
        parameters: Mapping[str, Any] | None = None,
    ) -> ValidatedStrategy:
        validation = validate_source(source_code)
        if not validation.valid:
            return ValidatedStrategy(validation=validation, strategy_hash=None)
        return ValidatedStrategy(
            validation=validation,
            strategy_hash=strategy_hash(source_code, parameters or {}),
        )
