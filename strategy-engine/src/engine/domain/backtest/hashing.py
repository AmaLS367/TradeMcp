from __future__ import annotations

from dataclasses import asdict

from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DateRange
from engine.domain.shared.hashing import canonical_json, sha256_of


def run_hash(
    *,
    strategy_hash: str,
    dataset_hash: str,
    engine_version: str,
    jesse_version: str,
    config: BacktestConfig,
    date_range: DateRange,
    warmup_rows: int,
) -> str:
    """Compose all inputs that determine a reproducible backtest result."""
    payload = canonical_json(
        {
            "strategy_hash": strategy_hash,
            "dataset_hash": dataset_hash,
            "engine_version": engine_version,
            "jesse_version": jesse_version,
            "config": asdict(config),
            "start_ms": date_range.start_ms,
            "finish_ms": date_range.finish_ms,
            "warmup_rows": warmup_rows,
        }
    )
    return sha256_of(payload)
