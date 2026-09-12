from __future__ import annotations

from engine.domain.shared.hashing import canonical_json, sha256_of


def dataset_hash(
    *,
    exchange: str,
    symbol: str,
    timeframe: str,
    start_ms: int,
    finish_ms: int,
    warmup_rows: int,
    trading_rows: int,
    columns: int,
    dtype: str,
    warmup_bytes: bytes,
    trading_bytes: bytes,
) -> str:
    """Hash the dataset descriptor together with the exact candle bytes."""
    descriptor = canonical_json(
        {
            "exchange": exchange,
            "symbol": symbol,
            "timeframe": timeframe,
            "start_ms": start_ms,
            "finish_ms": finish_ms,
            "warmup_rows": warmup_rows,
            "trading_rows": trading_rows,
            "columns": columns,
            "dtype": dtype,
        }
    )
    return sha256_of(descriptor, warmup_bytes, trading_bytes)
