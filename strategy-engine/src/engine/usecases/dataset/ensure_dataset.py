from __future__ import annotations

from engine.domain.dataset.models import CandleBundle, DateRange
from engine.usecases.ports.candles import CandleRepository


class EnsureDataset:
    """Prepare a real candle dataset, then return its opaque bytes."""

    def __init__(self, candles: CandleRepository) -> None:
        self._candles = candles

    def execute(
        self,
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> CandleBundle:
        request = {
            "exchange": exchange,
            "symbol": symbol,
            "timeframe": timeframe,
            "date_range": date_range,
            "warmup_candles_num": warmup_candles_num,
        }
        self._candles.ensure(**request)
        return self._candles.load(**request)
