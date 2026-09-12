from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceValidation:
    valid: bool
    strategy_class_name: str | None = None
    errors: tuple[str, ...] = ()
    detected_methods: tuple[str, ...] = ()
