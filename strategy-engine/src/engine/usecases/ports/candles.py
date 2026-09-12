from __future__ import annotations

from typing import Protocol

from engine.domain.dataset.models import CandleBundle, DateRange


class CandleRepository(Protocol):
    """Source of historical candle data for application use cases."""

    def ensure(
        self,
        *,
        exchange: str,
        symbol: str,
        date_range: DateRange,
    ) -> None:
        """Ensure that a continuous one-minute series exists for the range."""
        ...

    def load(
        self,
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> CandleBundle:
        """Load candles as opaque bytes without leaking numpy into use cases."""
        ...
