"""Domain errors without transport or HTTP concerns."""

from __future__ import annotations


class EngineError(Exception):
    """Base error for the strategy engine."""


class SourceValidationError(EngineError):
    def __init__(self, errors: tuple[str, ...]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


class DatasetUnavailable(EngineError):
    """Candles for the requested range are unavailable."""


class DatasetTooLarge(EngineError):
    """The requested range would exceed what one runner job may carry."""


class RunnerTimeout(EngineError):
    """The strategy exceeded its execution deadline."""


class RunnerCrashed(EngineError):
    """The runner crashed or returned an unreadable response."""
