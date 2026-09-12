"""CandleRepository backed by Jesse's native PostgreSQL candle store."""

from __future__ import annotations

import datetime as dt
import functools
import threading

import numpy as np

from engine.domain.dataset.hashing import dataset_hash
from engine.domain.dataset.models import (
    MAX_DATASET_ROWS,
    CandleBundle,
    DatasetRef,
    DateRange,
)
from engine.domain.shared.errors import DatasetTooLarge, DatasetUnavailable

_CANDLE_COLUMNS = 6
_ONE_MINUTE_MS = 60_000

# Jesse's research API keeps global state and a shared DB connection, while the
# use case calls this repository from worker threads. Serialize all access.
_JESSE_LOCK = threading.Lock()


def _serialized(method):
    @functools.wraps(method)
    def wrapper(*args, **kwargs):
        with _JESSE_LOCK:
            return method(*args, **kwargs)

    return wrapper


def _utc_day_start(timestamp_ms: int) -> int:
    value = dt.datetime.fromtimestamp(timestamp_ms / 1000, tz=dt.UTC)
    start = value.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(start.timestamp() * 1000)


def _to_date(timestamp_ms: int) -> str:
    return dt.datetime.fromtimestamp(
        timestamp_ms / 1000,
        tz=dt.UTC,
    ).strftime("%Y-%m-%d")


def _validate_date_range(date_range: DateRange) -> None:
    if (
        date_range.start_ms != _utc_day_start(date_range.start_ms)
        or date_range.finish_ms != _utc_day_start(date_range.finish_ms)
    ):
        raise DatasetUnavailable(
            "Jesse candle ranges must start and finish at UTC day boundaries"
        )


def _warmup_minutes_within_limit(
    date_range: DateRange,
    timeframe: str,
    warmup_candles_num: int,
) -> int:
    """Reject a request too large for one runner job before touching Jesse's DB."""
    from jesse.helpers import timeframe_to_one_minutes

    try:
        warmup_minutes = warmup_candles_num * timeframe_to_one_minutes(timeframe)
    except Exception as error:  # Jesse raises its own InvalidTimeframe.
        raise DatasetUnavailable(f"unsupported timeframe {timeframe!r}") from error

    trading_minutes = (date_range.finish_ms - date_range.start_ms) // _ONE_MINUTE_MS
    if warmup_minutes + trading_minutes > MAX_DATASET_ROWS:
        raise DatasetTooLarge(
            f"{trading_minutes} trading + {warmup_minutes} warmup one-minute candles "
            f"exceed the {MAX_DATASET_ROWS} candle limit; shorten the date range "
            "or lower warmup_candles_num"
        )
    return warmup_minutes


def _validate_trading_candles(
    trading: np.ndarray,
    date_range: DateRange,
) -> None:
    if trading.ndim != 2 or trading.shape[1] != _CANDLE_COLUMNS:
        raise DatasetUnavailable(
            f"Jesse returned candles with invalid shape {trading.shape}"
        )
    if len(trading) == 0:
        raise DatasetUnavailable("Jesse returned an empty trading dataset")

    timestamps = trading[:, 0]
    expected_rows = (date_range.finish_ms - date_range.start_ms) // _ONE_MINUTE_MS
    if (
        len(trading) != expected_rows
        or int(timestamps[0]) != date_range.start_ms
        or int(timestamps[-1]) != date_range.finish_ms - _ONE_MINUTE_MS
        or np.any(np.diff(timestamps) != _ONE_MINUTE_MS)
    ):
        raise DatasetUnavailable(
            "stored candles do not form a continuous one-minute series "
            "for the requested range"
        )


def _normalize_and_validate(
    warmup: np.ndarray | None,
    trading: np.ndarray,
    *,
    date_range: DateRange,
    warmup_candles_num: int,
) -> tuple[np.ndarray, np.ndarray]:
    trading_array = np.ascontiguousarray(trading, dtype=np.float64)
    _validate_trading_candles(trading_array, date_range)

    if warmup is None:
        warmup_array = np.empty((0, _CANDLE_COLUMNS), dtype=np.float64)
    else:
        warmup_array = np.ascontiguousarray(warmup, dtype=np.float64)
        if warmup_array.ndim != 2 or warmup_array.shape[1] != _CANDLE_COLUMNS:
            raise DatasetUnavailable(
                f"Jesse returned warmup candles with invalid shape {warmup_array.shape}"
            )
    if warmup_candles_num > 0 and len(warmup_array) == 0:
        raise DatasetUnavailable("Jesse returned no requested warmup candles")
    return warmup_array, trading_array


class JesseCandleRepository:
    @_serialized
    def ensure(
        self,
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> None:
        from jesse.exceptions import CandleNotFoundInDatabase
        from jesse.research import import_candles

        _validate_date_range(date_range)
        warmup_minutes = _warmup_minutes_within_limit(
            date_range,
            timeframe,
            warmup_candles_num,
        )
        needs_import = False
        try:
            warmup, trading = self._fetch(
                exchange=exchange,
                symbol=symbol,
                timeframe=timeframe,
                date_range=date_range,
                warmup_candles_num=warmup_candles_num,
            )
            _normalize_and_validate(
                warmup,
                trading,
                date_range=date_range,
                warmup_candles_num=warmup_candles_num,
            )
        except CandleNotFoundInDatabase:
            needs_import = True
        except DatasetUnavailable:
            needs_import = True
        except Exception as error:  # Jesse exposes several DB/config errors.
            raise DatasetUnavailable(
                f"could not inspect candles for {symbol} on {exchange}: {error}"
            ) from error
        if not needs_import:
            return

        import_start_ms = date_range.start_ms - warmup_minutes * _ONE_MINUTE_MS
        try:
            import_candles(
                exchange,
                symbol,
                _to_date(import_start_ms),
                show_progressbar=False,
            )
            warmup, trading = self._fetch(
                exchange=exchange,
                symbol=symbol,
                timeframe=timeframe,
                date_range=date_range,
                warmup_candles_num=warmup_candles_num,
            )
            _normalize_and_validate(
                warmup,
                trading,
                date_range=date_range,
                warmup_candles_num=warmup_candles_num,
            )
        except Exception as error:  # Import and DB failures share no stable base type.
            raise DatasetUnavailable(
                f"could not prepare candles for {symbol} on {exchange}: {error}"
            ) from error

    @_serialized
    def load(
        self,
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> CandleBundle:
        _validate_date_range(date_range)
        _warmup_minutes_within_limit(date_range, timeframe, warmup_candles_num)
        try:
            warmup, trading = self._fetch(
                exchange=exchange,
                symbol=symbol,
                timeframe=timeframe,
                date_range=date_range,
                warmup_candles_num=warmup_candles_num,
            )
        except Exception as error:  # Jesse exposes several DB/config errors.
            raise DatasetUnavailable(
                f"candles for {symbol} {timeframe} are unavailable: {error}"
            ) from error

        warmup_array, trading_array = _normalize_and_validate(
            warmup,
            trading,
            date_range=date_range,
            warmup_candles_num=warmup_candles_num,
        )

        warmup_bytes = warmup_array.tobytes()
        trading_bytes = trading_array.tobytes()
        ref = DatasetRef(
            exchange=exchange,
            symbol=symbol,
            timeframe=timeframe,
            date_range=date_range,
            warmup_rows=len(warmup_array),
            trading_rows=len(trading_array),
            columns=_CANDLE_COLUMNS,
            dtype="float64",
            dataset_hash=dataset_hash(
                exchange=exchange,
                symbol=symbol,
                timeframe=timeframe,
                start_ms=date_range.start_ms,
                finish_ms=date_range.finish_ms,
                warmup_rows=len(warmup_array),
                trading_rows=len(trading_array),
                columns=_CANDLE_COLUMNS,
                dtype="float64",
                warmup_bytes=warmup_bytes,
                trading_bytes=trading_bytes,
            ),
        )
        return CandleBundle(ref=ref, warmup=warmup_bytes, trading=trading_bytes)

    @staticmethod
    def _fetch(
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> tuple[np.ndarray | None, np.ndarray]:
        from jesse.research import get_candles

        return get_candles(
            exchange,
            symbol,
            timeframe,
            date_range.start_ms,
            date_range.finish_ms,
            warmup_candles_num=warmup_candles_num,
            caching=False,
            is_for_jesse=True,
        )
