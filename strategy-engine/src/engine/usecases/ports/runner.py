from __future__ import annotations

from typing import Protocol

from engine.domain.dataset.models import CandleBundle
from engine.domain.runtime.contracts import RunnerJob, RunnerResult


class StrategyRunner(Protocol):
    """Execute a strategy in an isolated environment."""

    async def run(self, job: RunnerJob, bundle: CandleBundle) -> RunnerResult:
        ...
